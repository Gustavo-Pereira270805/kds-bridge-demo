# Revisão do Sistema de Notas de Performance das Estações — v2 (spec stand-alone)

> Documento de design autossuficiente. Destinado a uma sessão de implementação **sem contexto prévio** do projeto. Leia de ponta a ponta antes de qualquer mudança, especialmente as seções 2 (histórico de falhas), 3 (escopo/guardrails) e 8 (gotchas do codebase).

## 1. Contexto do projeto

Sistema KDS Bridge: comunicação cozinha–salão (kitchen display system) com backend **Fastify + Socket.IO + pg** em TypeScript, views **HTML/JS vanilla** (sem framework, sem bundler) em `src/views/`, banco **Postgres na nuvem (Supabase)** via `DATABASE_URL` em `.env`. Toda a comunicação (código, comentários, commits, docs) é em **português (pt-BR)** — escreva tudo em pt-BR.

Comandos e convenções (também em `AGENTS.md`, leia o arquivo):

```bash
npm run dev          # dev server (ts-node-dev --transpile-only) — NÃO typechecka
npx tsc --noEmit     # único typecheck (obrigatório após qualquer mudança TS)
npm run build        # tsc + copyfiles src/views -> dist/views (só para produção)
npm start            # node dist/server.js
```

- Não existe framework de testes nem lint. Verificação de UI é feita com o skill `webwright` (test_webwright/ e outputs/weights_ui/ têm padrões de uso) ou scripts Playwright one-off.
- Views são lidas do disco a cada request (`server.ts:getView()`) — edições em HTML/CSS/JS são **live no dev** sem restart. Em produção é preciso `npm run build`.
- TypeScript strict; interfaces compartilhadas em `src/types.ts`.
- Consultas SQL sempre com placeholders `$1` (estilo pg — nunca `?`).
- O servidor dev roda na porta 3000. Se a porta estiver presa por instância antiga: `taskkill /PID <pid> /F`. Para rodar servidor em background via shell que vai expirar: `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized` (o shell do agente mata processos filhos ao expirar).
- PowerShell 5.1 **mangla** one-liners inline de `node -e` — para scripts de verificação, escreva um arquivo `.ts` temporário e rode com `npx ts-node --transpile-only` (padrão já usado em `root *.py` e `scripts/` no histórico).
- O banco é remoto (Supabase). Queries manuais podem ser feitas no SQL editor do Supabase ou via script temporário usando `src/db/client.ts`.

## 2. Histórico: por que este spec existe (IMPORTANTE)

Um spec anterior (`docs/superpowers/specs/2026-08-03-performance-station-scoring-design.md`, acessível para consulta histórica) foi implementado (commits `ed11287`..`93657da` no git, todos datados 03–04/08/2026) e depois **revertido por completo** porque a implementação foi um desastre que vazou de escopo:

1. **Autenticação não solicitada**: commits `d4f1023`/`f9f1e87` modificaram `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/server.ts` e criaram um `src/services/operational-date.service.ts` — nenhuma dessas mudanças era necessária para o sistema de notas. O dashboard NÃO usa autenticação hoje (só `/api/v1/auth/me` usa `requireAuth`).
2. **Layout do dashboard alterado**: `22beb1d` reescreveu 471 linhas de `src/views/dashboard.html` (+401/−101), mudando a estrutura visual inteira.
3. **Módulo de exportação refatorado sem motivo**: `af8d700` + vários "corrige exportações" mexeram na estrutura do exportador (modal, `exportReportHtml`, paginação PDF, Excel por dia).
4. **Pesos indisponíveis no dashboard**: o modal de critérios passou a depender de dados/endpoint que quebraram — o usuário perdeu acesso aos pesos na interface principal.
5. **Complexidade não solicitada**: tabela `performance_weight_versions` com versionamento de pesos, snapshot por score, nota "operacional" de período — tudo rejeitado na revisão.

A reversão não foi um `git revert` único: o estado atual (HEAD `93657da`) é o código **pré-implementação**, e a migration `supabase/migrations/2026-08-03-performance-score-versions.sql` foi **deletada**. **O código atual é o ponto de partida correto** — não há resquícios da implementação antiga no working tree.

### Decisões desta v2 (já alinhadas com o usuário)

- Pesos **simples** em `system_settings` (sem versionamento, sem snapshot, sem tabela nova).
- Período = **apenas média das notas diárias** + descontos reais somados (sem nota "operacional").
- **Penalidade dinâmica por SLA** (curva linear configurável min/max, teto em 2,5× SLA) substituindo os critérios fixos de SLA e **removendo** os critérios "preparo lento"/"retirada lenta".
- Modal de critérios do dashboard busca os pesos **da API** (nunca hardcoded).
- Exportações: correção mínima de dados (sem mudança estrutural).
- Arredondamento: sempre **até 2 casas decimais** (múltiplos de 0,01) em todas as penalidades.

## 3. Escopo — guardrails absolutos

### Proibido (regras absolutas — falhas da implementação anterior)

| # | Proibido | Motivo |
|---|---|---|
| G1 | Modificar `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/server.ts` | Auth não solicitada quebrou o dashboard |
| G2 | Adicionar qualquer autenticação/preHandler a rotas do dashboard ou analytics | Idem |
| G3 | Criar serviços novos (ex.: `operational-date.service.ts`) | Foi criado sem necessidade |
| G4 | Alterar o HTML/layout geral do `dashboard.html` (navegação, seções, bento-grids, CSS, KPI strip, outras funções de render) | Layout foi reescrito indevidamente |
| G5 | Refatorar a estrutura do módulo de exportação (modal de exportação, `exportReportHtml`, fluxo PDF/Excel, chamadas de export) | Refatoração não solicitada |
| G6 | Criar arquivos em `supabase/migrations/` ou qualquer mudança de schema | Nenhuma migration necessária (colunas existentes permanecem) |
| G7 | Criar tabelas novas (ex.: `performance_weight_versions`) | Versionamento rejeitado |
| G8 | Criar endpoints novos fora de `/api/v1/analytics/performance` e `/api/v1/admin/settings/weights` | Contrato mínimo |
| G9 | Alterar `src/services/sla.service.ts` e o fluxo de flags `sla_breached_*` | Usado pelos KPIs de atraso de outras seções |
| G10 | Alterar `filterForPerf`/filtros de período do dashboard, sockets, `demands.ts` | Fora do escopo |

### Permitido (lista completa de mudanças)

1. `src/services/performance.service.ts` — regras de cálculo, curva dinâmica, agregação de período, detratores com descontos reais.
2. `src/routes/analytics.ts` — somente o handler `GET /performance` (contrato).
3. `src/routes/admin.ts` — somente GET/PUT `/settings/weights`.
4. `src/views/admin.html` — somente o painel `#panel-weights` e `loadWeights`/`saveWeights`.
5. `src/views/dashboard.html` — somente: funções `renderScoreCards`, `renderPerfDetractors`, `loadPerformance`, conteúdo do modal de critérios (`#criteriaModal`), `exportPerformanceHtml`, `appendPerformanceExcel`.
6. `src/types.ts` — somente os tipos de performance (`EntityScore`, etc.).
7. Arquivo de spec (este) e, na fase de implementação, um plano em `docs/superpowers/plans/` e scripts de verificação temporários (não commitados).

### Critérios de aceite (aferíveis por git diff)

- `git diff` não mostra nenhuma alteração em arquivos de auth, `server.ts`, `sla.service.ts`, `demands.ts`, nem em `supabase/`.
- `git diff src/views/dashboard.html` toca apenas: `renderScoreCards`, `renderPerfDetractors`, `loadPerformance`, conteúdo do `#criteriaModal`, `exportPerformanceHtml`, `appendPerformanceExcel` (e, se necessário, uma função pequena nova de preencher o modal).
- `git diff src/views/dashboard.html` não altera o HTML estrutural das seções/nav/CSS.
- Os pesos aparecem no modal do dashboard vindos da API (sem valores fixos).

## 4. Estado atual do código (mapa preciso para navegação)

> Números de linha referem-se ao estado atual (HEAD `93657da`). Se o arquivo mudou, localize por nome de função (`grep`).

### 4.1 `src/services/performance.service.ts` (363 linhas — coração do sistema)

- `getWeights()` (L11–23): lê `SELECT key, value FROM system_settings WHERE key LIKE 'score_weight_%'` e devolve `{ sla_breach: 0.15, cancellation: 0.30, stockout_salao: 0.10, slow_item: 0.10 }` com defaults via `??`.
- `entityFromStationCode(code)` (L25–29): `quente_a`→`cozinha_quente_a`, `quente_b`→`cozinha_quente_b`, qualquer outro (incl. `fria`)→`cozinha_fria`.
- `upsertScore(entity, dateStr, finalScore, total, slaBreaches, slaDed, cancellations, cancelDed, stockouts, stockDed, slowItems, slowDed)` (L31–59): `INSERT INTO performance_scores ... ON CONFLICT (entity, date) DO UPDATE`. `base_score` é sempre 5.0 hardcoded.
- `safeCount(sql, params)` (L61–64): COUNT com parse.
- `computeDailyScores(dateStr)` (L66–202):
  - Para cada estação: conta `sla_breached_cozinha=true` (L78–83), `status='cancelled_cozinha'` (L84–89), `stockout_reported=true` (L90–95), **lento**: `ready_at − created_at > sla_minutes × 1.5` (L96–103), total não-anulado (L104–109).
  - Deduções: `round2(count × peso)`; `stockDed = 0` (L113 — zerado da cozinha não desconta); `finalScore = max(0, round1(5.0 − totalDed))` (L116).
  - Salão (L122–162): SLA de retirada (flag `sla_breached_salao`), cancelamento `cancelled_salao`, zerado (peso `stockout_salao`), lento `retrieved_at − ready_at > tolerância × 2` (tolerância lida de `pickup_tolerance_minutes`, default 3 — L136–139), total.
  - `cozinha_geral` (L164–201): agrega as 3 estações — somas das colunas e `ROUND(AVG(final_score), 1)` — e grava via `upsertScore`.
- `ensureScoresForDate(dateStr)` (L204–212): se `COUNT(*) FROM performance_scores WHERE date = $1 < 5`, chama `computeDailyScores`. **Não** recalcula datas com 5+ linhas (scores de datas antigas só mudam via recálculo retroativo do PUT de pesos).
- `buildDetractors(score)` (L214–230): monta lista `{label, count, deduction}` — 'Estouros de SLA', 'Cancelamentos', 'Zerados' (label 'Zerados'), 'Preparo/Retirada lenta' — ordenada por deduction desc.
- `DetractorDate` (L232–238): `{ type, date, demand_id, product_name, detail }`.
- `getDetractorDates(entity, dateFrom, dateTo)` (L240–363): ocorrências individuais por entidade. Cozinha: SLA (detalhe "Excedeu em X min"), cancelamentos (detalhe = `cancel_reason`), zerados ("Produto zerou na cozinha"), lento ("SLA: X min"). Salão: SLA ("Excedeu em X min"), cancelamentos, zerados ("Reportado pelo salão"), lento ("Retirada > X min"). `cozinha_geral` (L350–359): concatena as 3 estações. Ordena por data desc (L361).

### 4.2 `src/routes/analytics.ts` (846 linhas)

- `GET /performance` (L688–834): query `{ range?, from?, to?, station_id? }` — NOTA: `station_id` é aceito mas **não filtra nada** (não há coluna de estação em `performance_scores`); mantenha esse comportamento (o relatório mostra todas as entidades).
  - Resolução de datas (L695–722): `from/to` (ISO YYYY-MM-DD, máx 31 dias, validado por `validarDataIso` L26 e `intervaloInclusivo` L32), senão `range=week` (−7d), `month` (−30d), senão hoje.
  - Loop `ensureScoresForDate` por dia do intervalo (L726–731) — garante scores de todas as datas.
  - `entities = ['cozinha_geral','cozinha_quente_a','cozinha_quente_b','cozinha_fria','salao']` (L733).
  - `current` (L736–759): `SELECT *` de `performance_scores` da data `dateTo`, monta `EntityScore` com `detractors: buildDetractors(row)`.
  - `detractor_dates` (L762–769): chama `getDetractorDates` para cada entidade com `try/catch` (falha → `[]`).
  - `history` (L772–793): todas as linhas do período, agrupadas por dia → `{ date, [entity]: final_score }`.
  - `averages` (L796–825): `SELECT entity, ROUND(AVG(final_score),1), SUM(total_demands), SUM(sla_breaches), SUM(cancellations), SUM(stockouts), SUM(slow_items) GROUP BY entity` — **não retorna deduções** (é por isso que o frontend inventa descontos sintéticos).
  - Retorno (L827): `{ current, history, averages, detractor_dates }`.

### 4.3 `src/routes/admin.ts`

- `GET /settings/weights` (L432–450): retorna os 4 pesos atuais (`sla_breach`, `cancellation`, `stockout_salao`, `slow_item`).
- `PUT /settings/weights` (L452–499): body `{ sla_breach, cancellation, stockout_salao, slow_item }`; upsert em `system_settings` (L471–479) ignorando campos não numéricos; **recálculo retroativo em background** (L483–492): busca `SELECT DISTINCT date FROM performance_scores`, itera `computeDailyScores(dateStr)` com `.catch(e => request.log.error(e))` em cada um, sem travar a request. Retorna `{ success: true, message: 'Recálculo em background iniciado.' }`.

### 4.4 `src/views/admin.html`

- `#panel-weights` (L298–324): título "Critérios de Avaliação (Pesos da Nota de Performance)", 4 inputs `step="0.01" min="0" max="5"`: `weightSlaBreach` (L306), `weightCancellation` (L310), `weightStockoutSalao` (L314), `weightSlowItem` (L318), botão `saveWeights()` (L321).
- `switchTab('weights')` (L412) chama `loadWeights()` (L416–422): GET `/api/v1/admin/settings/weights` e preenche os 4 inputs.
- `saveWeights()` (L425+): monta body com os 4 `parseFloat` e faz PUT; toast de sucesso "Pesos salvos! As notas de todas as datas serão recalculadas." (L437).

### 4.5 `src/views/dashboard.html` (2194 linhas)

- `#criteriaModal` (L442–479): **HTML estático com valores desatualizados** — tabela com "Zerou (cozinha) −0.20 por ocorrência" (L452), exemplo com −0.20 (L460–463), escala de cores 4.0/3.0/2.0 (L466–471), texto das entidades (L472–474). Tudo isso será substituído por conteúdo dinâmico.
- `scoreClass(v)` (L1245–1250): `>=4.5 'score-great'`, `>=3.5 'score-good'`, `>=2.5 'score-warn'`, senão `'score-bad'` — **esta é a escala real dos cards**; o modal deve refleti-la.
- `perfStars(v)` (L1252–1259): estrelas ★½☆.
- `renderScoreCards(perf)` (L1261–1281): cartões por entidade na ordem `['cozinha_geral','cozinha_quente_a','cozinha_quente_b','cozinha_fria','salao']`; usa `perf.averages` quando existe (modo período, label "Media:") senão `perf.current`. Não precisa mudar além de herdar os dados corretos.
- `renderPerfDetractors(perf, detractorDates, sourceOverride)` (L1283–1334): monta painéis `.score-detail-panel[data-entity]` (`display:none`). **Pula entidades sem detratores** (L1293 `if(!det.length) continue;`). Barras com `maxD` relativo e cor `#e63946` (L1294–1301). Tabela de ocorrências com colunas Data/Tipo/Produto/Detalhe (L1304–1330).
- `loadPerformance(filter)` (L1336–1413): `pr = filter==='today' ? 'week' : (filter==='month' ? 'month' : 'week')` (L1338) — **manter** esse bucketing. Monta o artigo "Desempenho da Equipe" + botão `#btnCriteria` (L1344–1347). **Bloco de detratores sintéticos** (L1349–1368): quando há `averages`, cria `detractorSource` com `deduction: Math.min(2.5, count × 0.5)` — **remover**. Gráfico de evolução `createPerfTrendChart` (L1370–1385) — manter. Click handler (L1387–1406): `#btnCriteria` abre o modal; card `.score-card` → `.selected` + mostra painel correspondente (esconde os outros).
- `filterForPerf()` (L1427–1431) e `filterToParams()`/`getFilterLabel()`/`getDaySpan()`/`getExportDates()` — **não mudar**.
- `exportPerformanceHtml(perf)` (L1756–1773): usa `source = averages || current`; **fallback sintético** (L1764–1766): se averages sem detratores, cria com `Math.min(2.5, count × 0.5)` incluindo 'Itens lentos' — **remover**.
- `fetchExportPerformance(from, to)` (L1802–1809): GET `/performance?from=&to=` — manter (funciona com o novo contrato).
- `appendPerformanceExcel(wb, perf, prefix)` (L1811–1823): aba 'Notas Performance' com colunas incluindo **'Itens lentos'** (L1817) — remover coluna; aba 'Detratores' já usa `d.deduction` (passará a ser real).
- Estilo do arquivo: **ES5 puro** — `var`, `function(){}`, concatenação de strings com `+`, escapes `\u` (nunca template literals/arrow/`let`). Respeite isso nas edições.

### 4.6 `src/types.ts`

- `PerformanceScoreRow` (L309–324): espelho da tabela (inclui `slow_items`, `slow_item_deduction`).
- `PerformanceDetractor` (L326–330): `{ label, count, deduction }`.
- `EntityScore` (L332–346): shape da API (inclui `slow_items`, `slow_item_deduction` — **remover esses 2 campos**).
- `PerformanceResponse` (L348–351): `{ current, history }` (desatualizado vs. resposta real, que também tem `averages` e `detractor_dates`).

### 4.7 Banco (relevante)

- `performance_scores`: `id, entity, date, base_score, final_score, total_demands, sla_breaches, sla_breach_deduction, cancellations, cancellation_deduction, stockouts, stockout_deduction, slow_items, slow_item_deduction, updated_at`; UNIQUE `(entity, date)`. **Nada muda**; `slow_items`/`slow_item_deduction` continuam existindo (gravados 0).
- `system_settings`: `(key, value)` texto, UNIQUE key. Chaves atuais de peso (4). `pickup_tolerance_minutes` (default '3').
- `demands` (colunas usadas): `created_at, ready_at, retrieved_at, sla_minutes, sla_breached_cozinha, sla_breach_minutes_cozinha, sla_breached_salao, sla_breach_minutes_salao, stockout_reported, status ('pending'|'ready'|'retrieved'|'cancelled_salao'|'cancelled_cozinha'|'annulled'), cancel_reason, cancel_reason_id, product_name, quantity, priority, kitchen_station_id, cooking_started_at, is_replacement`.
- `kitchen_stations`: `id, code ('quente_a'|'quente_b'|'fria'), name ('Cozinha Quente A'|'Cozinha Quente B'|'Cozinha Fria'), capacity, theme`.
- `cancel_reasons`: `id, label, category ('salao'|'cozinha'), active` (para detalhe de cancelamento usa-se `COALESCE(cr.label, d.cancel_reason, 'Sem motivo')` no dashboard; em `getDetractorDates` usa-se `d.cancel_reason` direto).
- Sem DDL no repo; migrations versionadas em `supabase/migrations/` (só `2026-08-03-station-themes.sql` existe). `seedDatabase()` em `server.ts` não semeia pesos de score (defaults vivem no código via `??`).

### 4.8 `src/services/sla.service.ts` (NÃO MUDAR)

- `evaluateCookingSla` (L4–32): ao marcar pronto, se `elapsed > sla_minutes`, grava `sla_breached_cozinha=true` + `sla_breach_minutes_cozinha`.
- `evaluatePickupSla` (L34–62): ao retirar, se `elapsed > tolerância`, grava `sla_breached_salao=true` + `sla_breach_minutes_salao`.
- Implicação: **flag = fator > 1,0** — toda demanda sinalizada tem fator > 1 e portanto penalidade ≥ `sla_min` (se `sla_min > 0`).

## 5. Regras de negócio (novas)

### 5.1 Nota diária (todas as entidades)

```
nota_final = max(0, round(5,0 − soma_penalidades, 1 casa decimal))
```

`round_n(x) = Math.round(x × 10^n) / 10^n`. Toda penalidade individual é `round_2` (múltiplos de 0,01). A soma é arredondada implicitamente (soma de valores de 2 casas tem 2 casas). Exceção: `round_1` apenas no `final_score` final.

### 5.2 Penalidade dinâmica de SLA (cozinha e salão)

```
cozinha: factor = (ready_at − created_at) em minutos / sla_minutes
salão:   factor = (retrieved_at − ready_at) em minutos / tolerância   (pickup_tolerance_minutes, default 3)

se factor <= 1,0        → penalidade = 0
senão:
  penalidade = sla_min + (sla_max − sla_min) × (factor − 1) / 1,5
  penalidade = min(sla_max, max(sla_min, penalidade))     # clamp
  penalidade = round_2(penalidade)                        # SEMPRE 2 casas (0,0567 → 0,06)
```

- Fator de teto **2,5× fixo em código** (constante, ex.: `SLA_MAX_FACTOR = 2.5`; o divisor `1.5` = 2.5 − 1.0 também derivado da constante).
- Valores de referência (com defaults 0.05/0.30): fator 1,0 → 0,05; 1,5 → ≈0,13; 2,2 → 0,25; ≥2,5 → 0,30.
- **Contagem**: `sla_breaches` = demandas com `sla_breached_* = true` (mesma semântica de hoje — só entram as que passaram do SLA, ou seja, factor > 1).
- **Dedução**: soma das penalidades individuais `round_2` de cada ocorrência.
- Cada demanda penaliza **exatamente uma vez por fase** (preparo para cozinha, retirada para salão). Não há critério "lento" separado (removido).

### 5.3 Critérios fixos restantes

| Critério | Contagem | Dedução | Entidades |
|---|---|---|---|
| Estouro de SLA | flag `sla_breached_*` | curva dinâmica (5.2) | estações (preparo), salão (retirada) |
| Cancelamento | `status = 'cancelled_cozinha'` | `count × score_weight_cancellation_cozinha` (default 0.30) | estações |
| Cancelamento | `status = 'cancelled_salao'` | `count × score_weight_cancellation_salao` (default 0.30) | salão |
| Zerado | `stockout_reported = true` | 0 (informativo) | estações |
| Zerado | `stockout_reported = true` | `count × score_weight_stockout_salao` (default 0.10) | salão |
| **Lento (preparo/retirada)** | **removido** | **removido** | — |

- Deduções fixas também passam por `round_2` (pesos já são 2 casas, então `count × peso` é 2 casas).
- Total (`total_demands`): demandas não anuladas (inclui pendentes), como hoje.

### 5.4 Pesos em `system_settings` (5 chaves)

| Chave | Default | Nota |
|---|---|---|
| `score_weight_cancellation_cozinha` | 0.30 | nova |
| `score_weight_cancellation_salao` | 0.30 | nova |
| `score_weight_stockout_salao` | 0.10 | já existe hoje |
| `score_weight_sla_min` | 0.05 | nova (limite inferior da curva) |
| `score_weight_sla_max` | 0.30 | nova (limite superior da curva) |

- Chaves legadas a **apagar** no PUT: `score_weight_sla_breach`, `score_weight_cancellation`, `score_weight_slow_item`.
- `getWeights()` deve ler as **5 chaves exatas** (não mais `LIKE 'score_weight_%'`), com defaults via `??`.
- `sla_min` e `sla_max` configuráveis; `0 ≤ sla_min ≤ sla_max ≤ 5`, valores com até 2 casas (sanitizar com `round_2` no PUT). O fator 2,5× não é configurável.

### 5.5 Entidades e agregações

- `cozinha_quente_a/b`, `cozinha_fria`, `salao`: apuração direta por entidade (seção 5.1–5.3).
- `cozinha_geral`: `final_score = ROUND(AVG(final_score) das 3 estações, 1)` e **somas** das demais colunas (padrão SQL existente em `computeDailyScores` L164–201 — manter o mesmo formato, sem `slow_*`).
- Recálculo (gatilhos mantidos, nada a fazer): `demands.ts` L229/280/345/417/518 (mudanças de estado), PUT de pesos (retroativo em background), `ensureScoresForDate` (< 5 linhas).
- **Pós-deploy**: notas diárias existentes ficam com números antigos (regras novas) até um recálculo retroativo — agendar um recálculo único após o deploy (script temporário iterando `computeDailyScores` sobre `SELECT DISTINCT date FROM performance_scores`, ou salvar os pesos pelo admin uma vez, que dispara o mesmo recálculo).

## 6. Contrato novo de `GET /api/v1/analytics/performance`

### 6.1 Resposta (exemplo completo, `range=week`)

```json
{
  "current": {
    "cozinha_geral": {
      "entity": "cozinha_geral", "final_score": 4.7, "base_score": 5.0, "total_demands": 120,
      "sla_breaches": 3, "sla_breach_deduction": 0.61,
      "cancellations": 1, "cancellation_deduction": 0.3,
      "stockouts": 2, "stockout_deduction": 0,
      "detractors": [
        { "label": "Estouros de SLA", "count": 3, "deduction": 0.61 },
        { "label": "Cancelamentos", "count": 1, "deduction": 0.3 },
        { "label": "Zerados", "count": 2, "deduction": 0 }
      ]
    }
  },
  "averages": {
    "cozinha_geral": {
      "entity": "cozinha_geral", "final_score": 4.8, "total_demands": 820,
      "sla_breaches": 21, "sla_breach_deduction": 3.42,
      "cancellations": 5, "cancellation_deduction": 1.5,
      "stockouts": 9, "stockout_deduction": 0,
      "detractors": [ { "label": "Estouros de SLA", "count": 21, "deduction": 3.42 }, "..." ]
    }
  },
  "history": [
    { "date": "2026-08-01", "cozinha_geral": 4.9, "cozinha_quente_a": 4.8, "cozinha_quente_b": 5.0, "cozinha_fria": 4.9, "salao": 4.7 }
  ],
  "detractor_dates": {
    "cozinha_geral": [
      {
        "type": "Estouro de SLA", "date": "2026-08-03T12:15:00.000Z", "demand_id": "uuid",
        "product_name": "Bife Acebolado", "detail": "Excedeu em 18 min (2,2× SLA)", "deduction": 0.25,
        "station": "Cozinha Quente A"
      },
      { "type": "Cancelamento", "date": "...", "demand_id": "uuid", "product_name": "Arroz Branco",
        "detail": "Cliente desistiu", "deduction": 0.3, "station": "Cozinha Quente A" }
    ]
  },
  "weights": { "sla_min": 0.05, "sla_max": 0.30, "cancellation_cozinha": 0.30, "cancellation_salao": 0.30, "stockout_salao": 0.10 }
}
```

### 6.2 Mudanças exatas no handler

1. **`averages`**: no SELECT atual (L798–813) adicionar `SUM(sla_breach_deduction)`, `SUM(cancellation_deduction)`, `SUM(stockout_deduction)`; **remover** `SUM(slow_items)`. Depois, para cada entidade, montar `detractors` chamando uma função do serviço (reutilizar `buildDetractors` passando um objeto com os campos somados, já que ela só lê os campos de contagem/dedução — ver 5.3/7.1).
2. **`detractor_dates`**: cada item ganha `deduction` (number) e `station` (string, presente **sempre** nas linhas de cozinha — das 3 estações — e do salão também, por consistência; na prática preencher com `ks.name` ou 'Salão').
3. **Novo campo `weights`**: retornar o objeto de `getWeights()` (as 5 chaves do serviço).
4. **`current`**: remover `slow_items`/`slow_item_deduction` da resposta (o `EntityScore` montado em L742–758 não deve mais incluir os campos).
5. `history`, validações, loop de `ensureScoresForDate`, tratamento de erro — **inalterados**.

## 7. Mudanças por arquivo (passo a passo de implementação)

### 7.1 `src/services/performance.service.ts`

1. `getWeights()` → devolve `{ sla_min, sla_max, cancellation_cozinha, cancellation_salao, stockout_salao }` com defaults `{0.05, 0.30, 0.30, 0.30, 0.10}`; query com as 5 chaves exatas (`WHERE key = ANY($1)` ou 5 ANDs). Manter a interface `Weights` local atualizada.
2. Constantes: `SLA_MAX_FACTOR = 2.5` e helper `penaltyForSlaFactor(factor, slaMin, slaMax)` → `factor <= 1 ? 0 : round2(clamp(...))`. Helper `round2(x)`.
3. `computeDailyScores`:
   - **Cozinha** (L78–103): manter contagens de SLA/cancelamento/zerado/total. SLA agora precisa das deduções por fator: trocar o `safeCount` de SLA por uma query que retorne as linhas com `ready_at, created_at, sla_minutes` (apenas `sla_breached_cozinha = true`), computar `factor` e somar `round2(penalty)` no TS. **Remover** a query de lento (L96–103). `stockDed` continua 0.
   - **Salão** (L122–162): mesmo tratamento para SLA de retirada (`sla_breached_salao = true`, linhas com `retrieved_at, ready_at`; tolerância de `pickup_tolerance_minutes`); **remover** query de lento (L141–147).
   - `upsertScore`: remover parâmetros `slowItems/slowDed`; gravar `slow_items = 0, slow_item_deduction = 0` nas colunas (mantidas no banco).
   - Agregação `cozinha_geral` (L164–201): remover `slow_*` do SELECT/SOMA; manter `ROUND(AVG(final_score), 1)` e somas das demais.
4. `buildDetractors`: remover o bloco de lento (L225–227). Ordenar por deduction desc (manter).
5. `getDetractorDates`:
   - Cozinha: SLA → query inclui `ks.name AS station`; para cada linha, `factor = (ready_at − created_at)/sla_minutes`, `deduction = penaltyForSlaFactor`, `detail = \`Excedeu em ${min} min (${fator}× SLA)\`` (fator com 1 casa, ex.: "2,2×"); `station = ks.name`. Remover query de lento (L283–295).
   - Cancelamento (cozinha): `deduction = cancellation_cozinha`, `station = ks.name`.
   - Zerado (cozinha): `deduction = 0`, `station = ks.name`.
   - Salão: análogo (SLA com fator sobre tolerância; cancelamento → `cancellation_salao`; zerado → `stockout_salao`; `station = 'Salão'`). Remover query de lento (L336–347).
   - `cozinha_geral` (L350–359): continua concatenando as 3 estações (cada linha já traz `station`).
   - Manter formatação de data atual (`(r.created_at as any) instanceof Date ? toISOString : String(...)`).
   - `DetractorDate` → `{ type, date, demand_id, product_name, detail, deduction: number, station?: string }`.

### 7.2 `src/routes/analytics.ts` (só `/performance`)

Conforme seção 6.2. Importar o novo shape de `getWeights` se precisar (o `weights` pode vir do serviço). Não tocar em mais nada do arquivo.

### 7.3 `src/routes/admin.ts` (GET/PUT `/settings/weights`)

- GET (L432–450): devolve `{ cancellation_cozinha, cancellation_salao, stockout_salao, sla_min, sla_max }` (defaults: 0.30/0.30/0.10/0.05/0.30).
- PUT (L452–499): body com as 5 chaves; validação:
  - todos numéricos finitos (`Number.isFinite`) e ≥ 0 e ≤ 5;
  - `sla_min ≤ sla_max`;
  - invalid → `reply.code(400).send({ error: '...' })` (mensagem pt-BR clara, ex.: 'Valores inválidos: confira mínimo ≤ máximo e limites 0–5');
  - sanitizar cada valor com `round_2`;
  - upsert das 5 chaves; `DELETE FROM system_settings WHERE key IN ('score_weight_sla_breach','score_weight_cancellation','score_weight_slow_item')`;
  - manter o recálculo retroativo em background (L483–492) e o retorno `{ success, message }`.

### 7.4 `src/types.ts`

- `EntityScore` (L332–346): remover `slow_items` e `slow_item_deduction`.
- `PerformanceScoreRow` (L309–324): pode manter os campos `slow_*` (espelho do banco) ou removê-los — se remover, ajustar o `SELECT *` das queries que o materializam. **Recomendação**: manter, para minimizar superfície; o serviço simplesmente não usa mais.
- `PerformanceResponse`: não é estritamente necessário alterar (não é usado para tipar o handler), mas atualizar para incluir `averages` e `detractor_dates` se conveniente.

### 7.5 `src/views/dashboard.html`

1. `loadPerformance` (L1336–1413):
   - **Remover** o bloco sintético L1349–1368 (detractorSource fabricado). Chamar `renderPerfDetractors(perf, perf.detractor_dates)` com fonte interna (`perf.current` ou `perf.averages`).
   - Guardar `perf.weights` numa variável de escopo do módulo (ex.: `window._perfWeights` ou closure) para o modal.
   - Resto inalterado (trend chart, click handler).
2. `renderPerfDetractors` (L1283–1334):
   - `source = perf.averages && tem chaves ? perf.averages : (perf.current || {})`; remover `sourceOverride` (ou manter parâmetro opcional sem uso).
   - Não pular entidades sem detratores: renderizar painel para **todas** as entidades presentes em `source`; sem detratores → barra "Sem ocorrências registradas." (ou texto equivalente).
   - Barras: usar `d.deduction` real (já vêm do backend).
   - Tabela de ocorrências: adicionar colunas **Dedução** (`−` + `toFixed(2)`) e **Estação** (exibir `occ.station`; vazio se ausente).
   - Painel: adicionar **botão de fechar** (ex.: `✕`) que esconde o painel e remove `.selected` dos cards.
   - Manter o estilo ES5 do arquivo e as classes/CSS existentes (`bar-row`, `bar-track`, `bar-fill`, `score-detail-panel` etc.).
3. Modal `#criteriaModal` (L442–479): substituir o tbody/valores fixos por renderização dinâmica:
   - Nova função (ex.: `populateCriteriaModal(weights)`) chamada pelo handler do `#btnCriteria` (L1390–1394) e, se possível, já no `loadPerformance`.
   - Conteúdo: nota base 5.0; "Estouro de SLA (cozinha)": curva dinâmica com `sla_min`–`sla_max` reais, teto 2,5×; idem "Estouro de SLA (salão)"; "Cancelamento (cozinha)" `cancellation_cozinha`; "Cancelamento (salão)" `cancellation_salao`; "Zerado (salão)" `stockout_salao`; "Zerado (cozinha)": informativo (sem desconto).
   - Exemplo de cálculo com os valores reais (ex.: "SLA de 20 min, preparo 44 min → fator 2,2 → −0,25").
   - Escala de cores alinhada ao `scoreClass`: **≥4,5 Ótimo / ≥3,5 Bom / ≥2,5 Regular / <2,5 Ruim**.
   - Se `weights` ausente/falha (undefined): mostrar texto de erro explícito ("Não foi possível carregar os pesos da API.") — **nunca** valores hardcoded.
   - Pode manter a estrutura HTML do modal (título, botão Fechar) — só o conteúdo dinâmico muda.
4. `exportPerformanceHtml` (L1756–1773): remover o fallback sintético (L1764–1766); usar `item.detractors` direto; remover menção a 'Itens lentos'. O restante (cards, trend) inalterado.
5. `appendPerformanceExcel` (L1811–1823): remover a coluna `'Itens lentos'` (L1817). Aba Detratores inalterada (já usa `d.deduction`).
6. **Não tocar**: `renderScoreCards`, `scoreClass`, `perfStars`, `filterForPerf`, `createPerfTrendChart`, `fetchExportPerformance`, estrutura HTML/CSS.

### 7.6 `src/views/admin.html`

- `#panel-weights` (L298–324): substituir os 4 inputs por 5: `weightCancellationCozinha`, `weightCancellationSalao`, `weightStockoutSalao`, `weightSlaMin`, `weightSlaMax` (todos `step="0.01" min="0" max="5"`). Remover o input `weightSlowItem` e o `weightSlaBreach`.
- Texto explicativo do painel: atualizar para descrever a curva (mín/máx configuráveis, teto em 2,5× SLA) e os pesos fixos.
- `loadWeights()` (L416–422): preencher os 5 inputs com os campos do novo GET.
- `saveWeights()` (L425+): body com as 5 chaves (`cancellation_cozinha`, `cancellation_salao`, `stockout_salao`, `sla_min`, `sla_max`). Toast mantido.

## 8. Gotchas do codebase (aprendidos na marra — respeite)

- **Nunca** usar `.catch(function() {})` vazio — erros ficam invisíveis. Sempre `console.error` + estado de erro na UI.
- Funções que montam HTML a partir de dados (como `buildContent`/`render*` do dashboard) devem ser envolvidas em `try/catch`; exceção não tratada deixa o "Carregando..." girando para sempre. Restaurar o estado da UI após o try/catch.
- Referências de DOM por `document.getElementById` usadas antes da sua linha viram `undefined` (var hoisting) — busque refs no topo ou inline.
- Ao re-anexar listeners a cada load, `removeEventListener` com closure nova falha silenciosamente — guarde o handler no elemento (`el._ch = handler`) e remova esse.
- O dashboard lê views do disco a cada request: mudanças de HTML/JS valem em dev sem restart. Produção exige `npm run build`.
- PowerShell 5.1 mangla one-liners `node -e` — escreva `.ts` temporário + `npx ts-node --transpile-only`.
- Servidor de fundo morre quando o comando do shell expira — use `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`; porta 3000 presa → `taskkill /PID <pid> /F`.
- Estilo das views: ES5 estrito (var/function/concat) — não introduza template literals/arrow/let nesses arquivos.
- Rotas delegam para serviços (`src/services/*`) — não inlina lógica no handler.
- Todos os campos de data do Postgres chegam como string ou Date conforme o driver — o código atual trata com `(x as any) instanceof Date ? ... : String(x)`; preserve esse padrão.
- Não "consertar" timezone: scores usam `created_at::date` no fuso do servidor, enquanto gráficos usam `America/Sao_Paulo` — é o comportamento vigente e está fora do escopo.

## 9. Plano de verificação (obrigatório, nesta ordem)

### 9.1 Estático

- `npx tsc --noEmit` sem erros.

### 9.2 Fórmula (script temporário `.ts` em `scripts/` ou raiz, não commitado)

Validar `penaltyForSlaFactor` com: fator 1,0 → 0; 1,1 → 0,07 (0,05 + 0,25×0,1/1,5 = 0,0667 → 0,07); 1,5 → 0,13; 2,2 → 0,25; 2,5 → 0,30; 3,0 → 0,30. E com `sla_min = 0.10, sla_max = 0.50`: fator 1,0 → 0,10; 2,5 → 0,50.

### 9.3 Integração (servidor dev rodando)

- Criar demanda de produto da estação quente_a com SLA conhecido (ex.: SLA 20 min), marcar pronta após 44 min (ou ajustar via SQL se necessário) → `GET /api/v1/analytics/performance` (dia) deve mostrar `sla_breaches = 1`, `sla_breach_deduction = 0.25`, nota 4.8, `detractor_dates` com `deduction: 0.25` e `station`.
- Retirada do salão após > 2,5× tolerância → `sla_breach_deduction` do salão = 0.30.
- Cancelamento pela cozinha → `cancellation_deduction = 0.30`.
- Consistência: soma de `detractor_dates[entity]` por tipo ≈ `detractors` do mesmo entity; `final_score = round1(5 − Σ)`.
- Modo período (`range=week`): `averages` com deduções somadas e `detractors` reais; `weights` presente.
- PUT `/api/v1/admin/settings/weights` com `sla_min: 0.10` → 200, legacy keys apagadas, recálculo retroativo roda (aguardar) e datas antigas mudam. PUT inválido (`sla_min > sla_max`) → 400.
- `ensureScoresForDate` continua criando as 5 entidades para datas novas.

### 9.4 UI com webwright (obrigatório — o usuário pediu verificação sempre que possível)

Padrão em `test_webwright/` e `outputs/weights_ui/`. Validar no dashboard (`http://localhost:3000/dashboard`):
1. Seção Performance em modo dia: cards com notas; clicar card → painel com barras reais e tabela com colunas Dedução/Estação; entidade sem detratores → "Sem ocorrências registradas"; botão fechar funciona.
2. Modo período (semana): barras com descontos reais (comparar com a API).
3. Modal "Como são calculadas as notas?": valores vindos da API (0.05/0.30 etc.), escala ≥4,5/≥3,5/≥2,5, sem "Zerou (cozinha) −0.20".
4. Admin (`/admin` → aba "Critérios de Avaliação"): 5 inputs preenchidos do GET; salvar com valores novos → toast; dashboard reflete (modal atualizado).
5. Exportar PDF: seção de performance sem valores sintéticos (barras com deduções reais); Excel: aba Notas Performance sem coluna "Itens lentos".
6. Regressão visual: demais seções do dashboard renderizam normalmente; KPI de atrasos inalterado.

Salvar evidências (screenshots + log) em `outputs/` conforme padrão do skill.

## 10. Definição de pronto

- [ ] Todos os critérios de aceite da seção 3 (git diff limpo por arquivo).
- [ ] `npx tsc --noEmit` OK.
- [ ] Casos da seção 9.2 passam.
- [ ] Integração 9.3 validada (comprovantes de API).
- [ ] UI 9.4 validada com webwright (screenshots salvos).
- [ ] Recálculo retroativo pós-deploy executado (notas históricas alinhadas).
- [ ] Nenhum commit feito sem aval explícito do usuário (o usuário pediu: commit somente com autorização dele).

## 11. Referências úteis

- `AGENTS.md` — comandos, arquitetura, gotchas (fonte da seção 8).
- Spec anterior (histórico, supersedido): `docs/superpowers/specs/2026-08-03-performance-station-scoring-design.md`.
- Plano anterior (histórico): `docs/superpowers/plans/2026-08-03-performance-station-scoring-plan.md` (contém detalhes que a implementação antiga seguiu — usar apenas como referência do que foi rejeitado).
- Commits da implementação anterior no git (`ed11287`..`93657da`) — consultáveis para entender erros cometidos; não copiar.
- Skills disponíveis: `webwright` (verificação UI), `executing-plans`/`subagent-driven-development` (se o plano for executado por subagentes), `verification-before-completion` (evidências antes de declarar pronto).
