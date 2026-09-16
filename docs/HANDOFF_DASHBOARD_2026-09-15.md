# HANDOFF — Dashboard do Gerente: drill-downs + fuso e melhorias v2

**Data:** 2026-09-15 · **Autor:** sessão opencode · **Status:** v1 (drill-downs) e v2 (fuso + melhorias, Tasks 1-6) **implementadas e verificadas localmente; NÃO commitadas** (ver §9). Impacto em produção e checklist de rollout em §10/§11.

Este documento é para retomar a sessão após compactação. Leia inteiro antes de editar qualquer coisa.

---

## 1. Objetivo

Melhorar o dashboard do gerente (`src/views/dashboard.html` + `src/routes/analytics.ts`), sempre respeitando o período/estação selecionados. Entregue (v1): drill-downs de **Motivos de Cancelamento**, **Zerados por Produto**, **SLA por Produto**, **Heatmap** e **Trocas**, com detalhes por demanda, chips Cozinha/Salão e detalhes nas exportações. Pendente (v2, plano pronto): **fuso dos períodos (crítico)**, **estação nas Notas/Detratores**, **deltas dos KPIs**, **tempo de preparo por produto correto** e **ajustes menores**.

## 2. Estado do git e do trabalho

- `HEAD = cec3442` (`feat: demanda do jantar antes do turno vai para a cozinha quente A`) — esse commit e o `8e3279e` (telas das cozinhas) **foram deployados na Oracle** e estão em produção.
- **Não commitado (working tree):** v1 (drill-downs) + v2 (Tasks 1-6) em:
  `src/routes/analytics.ts`, `src/views/dashboard.html`, `src/routes/admin.ts`, `src/routes/demands.ts`, `src/services/performance.service.ts`, `src/services/shift.service.ts`, `src/types.ts` + **novo** `src/services/period.service.ts`.
- **PROIBIDO** commit/push/deploy sem autorização explícita do usuário. O script de deploy existente é `scripts/deploy-kds.bat` (+ `git push origin main`). Checklist em §11.
- Diversos arquivos untracked são antigos/de skills (não mexer).

## 3. Ambiente local (como rodar)

**Portas:** 3000 está ocupada por OUTRO projeto (`jurema-api`, processo node não relacionado — não matar). Use **3100** para o KDS.

1) **Postgres local** (cluster `C:\Program Files\PostgreSQL\18\data`, serviço `postgresql-x64-18` parado; subir sem admin via pg_ctl):

```
Start-Process cmd -ArgumentList "/c `"$env:TEMP\opencode\start-pg.bat`"" -WindowStyle Minimized
# o bat contém: "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\18\data" -l "%TEMP%\opencode\pg-kds.log"
```

- Banco: `postgresql://kds:kds_local_123@localhost:5432/kds` (`.env` local aponta para cá; schema + migrations aplicados; `seedDatabase()` popula no boot).
- **Timezone do cluster: `UTC`** (`ALTER DATABASE kds SET timezone TO 'UTC'`, paridade com produção — feito na execução do plano, §9). Para voltar a BRT: `ALTER DATABASE kds SET timezone TO 'America/Sao_Paulo';`.
- Fixtures locais criadas à mão (existem só neste banco): estações `quente_a/quente_b/fria` + vínculos de produtos + 6 `cancel_reasons` (3 cozinha/3 salão). Script: `%TEMP%\opencode\fixtures-kds.sql`.

2) **Servidor de dev** (restart obrigatório após mudar `.ts`; HTML/CSS/JS valem sem restart):

```
$env:PORT='3100'; $env:KDS_KIOSK_IPS='127.0.0.1,::1,::ffff:127.0.0.1'
Start-Process cmd -ArgumentList "/c npm run dev > `"$env:TEMP\opencode\kds-dev.log`" 2>&1" -WindowStyle Minimized -WorkingDirectory (Get-Location).Path
```

- Health: `curl.exe -s http://localhost:3100/health` → `{"status":"ok",...}`.
- **Atenção:** se o banco estiver fora no boot, o ts-node-dev fica vivo em espera e o log mostra o erro; depois de subir o Postgres, **mate a cadeia e suba de novo** (`taskkill` no `node` do ts-node-dev) — ele não reconecta sozinho de forma confiável.
- Dashboard: `http://localhost:3100/login?next=/dashboard` — login `gustanpereira@gmail.com` / `Gp#270805` (admin; Supabase Auth na nuvem).

3) **O dia atual é controlado por `America/Sao_Paulo` no app**, mas o **banco de produção roda em UTC** (ver §5.1). Testes de fuso exigem o banco local em UTC + linhas de borda (Task 1 do plano).

## 4. Dados de teste (mantidos por pedido do usuário)

Todas as linhas de teste têm `notes LIKE 'QA-CANCEL-%'` no banco local:

| notes | o que é | quando (BRT) | estação | status |
|---|---|---|---|---|
| QA-CANCEL-1..3 | cancelamentos via API (Frango/Salada pela cozinha; Batata pelo salão) | hoje ~15:33 | jantar (turno jantar ativo) | cancelled_* |
| QA-CANCEL-4 | Arroz Branco cancelada cozinha (catálogo "Item queimou") | ontem 12:30 | quente_a | cancelled_cozinha |
| QA-CANCEL-5 | Tomate Picado cancelada salão (texto livre) | ontem 19:05 | fria | cancelled_salao |
| QA-CANCEL-6 | Bife Acebolado cancelada cozinha ("Erro de preparo") | D-10 13:15 | quente_a | cancelled_cozinha |
| QA-CANCEL-7 | estouro de SLA 45min (SLA 20) | D-3 12:00 | quente_a | retrieved |
| QA-CANCEL-8 | troca: Frango substituiu Bife | ontem 13:20 | quente_a | retrieved |
| QA-CANCEL-9 | zerado/rotura (Batata Frita, fator 0.00× SLA) | hoje ~16:29 | jantar | pending/urgent |

Scripts: `outputs/dashboard-cancelamentos/cria_dados_hoje.py`, `cria_stockout_hoje.py`, `manifest.json` (IDs), e os SQLs em `%TEMP%\opencode\cria-dados-retro-kds.sql` / `cria-dados-sla-troca-kds.sql`. Para limpar depois: `DELETE FROM demands WHERE notes LIKE 'QA-CANCEL-%'` (+ eventos em cascata lógica).

## 5. Achados verificados (evidências)

### 5.1 CRÍTICO — fuso: "Hoje" zera após as 21h BRT
- O **banco de produção roda em UTC** — confirmado via SSH na Oracle executando no container: `{"tz":"UTC", ...}` (script `%TEMP%\opencode\prod-tz.py`, usa base64 + `docker exec -w /app kds-bridge node`; `require('/app/node_modules/pg')`).
- Frontend monta datas com `new Date().toISOString().split('T')[0]` (UTC) → às 22h BRT envia `hoje = amanhã`. Demonstração: `node -e "console.log(new Date('2026-09-15T22:00:00-03:00').toISOString().split('T')[0])"` → `2026-09-16`.
- Backend filtra `created_at::date = $1` (fuso da sessão = UTC em produção) e agrupa DOW cru (UTC) no heatmap/sazonalidade.
- **Efeito:** de 21h à meia-noite BRT o "Hoje" mostra outro recorte (quase vazio) e o heatmap joga pedidos da noite para o dia seguinte. Localmente também reproduz (frontend), embora o cluster local esteja em BRT.
- Fix detalhado: **Task 1 do plano** (`src/services/period.service.ts` novo com `brDay/brDayOf/shiftDay`; trocar filtros em `analytics.ts` e `performance.service.ts`; `brToday()/listDays()` no frontend). Método de teste: banco local em UTC + linha de borda `QA-FUSO-1` às 22:30 BRT.

### 5.2 Filtro de estação ignora Notas/Detratores
- Frontend não envia `station_id` no `/performance` (`loadPerformance`, ~1764) e o backend o destrutura mas **nunca usa** (`analytics.ts` ~869-871).
- Detalhe importante: as notas JÁ são por estação (entidades `cozinha_*` filtram `ks.code` em `getDetractorDates`, `performance.service.ts` ~416-491). Solução aprovada: escopar a seção à entidade da estação selecionada (`stationEntity()` + `perfEntities()`), com badge "Filtro: <estação>" — **Task 2**.

### 5.3 Deltas dos KPIs são feature morta
- `renderKpis` lê `k.comparison.pedidos/sla/atrasos_*`, mas o backend nunca devolve `comparison` (só `week_comparison`). Implementar janela anterior de mesmo tamanho — **Task 3**.

### 5.4 Tempo de preparo por produto enviesado
- `qty_vs_time` usa `ORDER BY quantity DESC LIMIT 200` e o frontend agrega isso (`buildContent` ~1336). Agregar no backend (`prep_by_product`) e remover `qty_vs_time` — **Task 4** (checar consumidores com `grep -rn qty_vs_time src/` antes).

### 5.5 Outros (backlog, NÃO aprovados)
- `filterForPerf()` é código morto (`loadPerformance` ignora o argumento; usa `getExportDates()` — que reflete o período corretamente, ok).
- `.score-detail-toggle` (CSS) e `getFilterLabel` são código morto.
- `weekday_seasonality`/heatmap usam DOW no fuso da sessão (coberto pela Task 1).
- Painel "Cancelados após início do preparo" (desperdício) foi proposto (item E) e **não aprovado** — não implementar sem nova aprovação.

## 6. Verificação já existente (reutilizar e estender)

Scripts em `outputs/dashboard-cancelamentos/` (gitignored) — números atuais em §9:
- `valida_api.py` — login + cenários de período/estação + consistência **agregado×detalhe** (cancelamentos, SLA, zerados, trocas) + heatmap célula×detalhe + deltas de KPI. Último resultado: **0 falhas**.
- `valida_fuso.py` — fuso/dia operacional BRT com banco em UTC (linha de borda `QA-FUSO-1`, célula do heatmap BRT×UTC): **15/15**.
- `valida_notas.py` — consistência das notas, incl. temporal (QA-FUSO-1 no dia 13/09 e não no 14/09) e contadores de detratores × agregado: **26/26**.
- `e2e_dashboard.py` — Playwright Firefox: **63/63** (login, drill-downs, acordeão/teclado, períodos, estação, perf escopada, deltas, prep por produto, toggle zerados, chips, heatmap, tema claro, overflow, console, exports, relógio falso 22:30 BRT). Gera `evidencias/` e valida xlsx (`openpyxl`) e PDF (`pymupdf`).
- `e2e_jantar.py` — **4/4** (turno jantar + tema claro).
- `verifica_chips.py` — chips visíveis/não clipados + ausência de "NaN".
- `smoke.py` — login + resumo dos detalhes (útil pós-restart).
- `evidencias/` — screenshots (01..17), `dashboard_30d.xlsx`, `dashboard_hoje_por_dia.xlsx`, `dashboard_hoje.pdf`, `pdf_pagina1.png`.

Ferramentas locais (fora do repo):
- `%TEMP%\opencode\check-html-js.mjs` — valida sintaxe dos `<script>` inline do `dashboard.html` sem executar (roda com `node`).
- `%TEMP%\opencode\start-pg.bat` / `start-kds-dev.bat` — sobem o Postgres e o dev server (PORT=3100).
- `%TEMP%\opencode\audit-notas-kds.sql` — auditoria SQL das notas × demandas por dia BRT (0 divergências quando em dia).
- `%TEMP%\opencode\cria-fuso-kds.sql` — insere a linha de borda `QA-FUSO-1` (idempotente).
- Python 3.13 com `playwright`, `openpyxl`, `pypdf`, `pymupdf`: `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe`.

## 7. Armadilhas (aprendidas na marra)

- **PowerShell:** nunca `node -e` inline complexo (aspas quebram); escrever arquivo e rodar. `psql` com acentos: escrever o SQL em arquivo UTF-8 e usar `-f` (o `-c` mangla o encoding).
- **Servidores:** sempre `Start-Process cmd ... -WindowStyle Minimized` (morrem com o shell se não); se o log não muda, a chain antiga ainda está viva → `taskkill` no PID do `node` com `ts-node-dev`.
- **Deploy/SSH:** paramiko em `.py` (chave `C:\Users\Milena\.ssh\kds_oracle`); para rodar node dentro do container, base64 do script + `docker cp` + `docker exec -w /app` e `require('/app/node_modules/pg')`.
- **Testes de API com Python `urllib`:** omitir `Content-Type` quando não há body; nos cenários de auth usar `Authorization: Bearer`.
- **Playwright:** perfil Firefox headless; downloads via `expect_download`; detalhes por drill usam `data-drill-prefix` + `data-idx` (ids `#<prefixo>-detail-<idx>`) — **não** assumir `#cancel-detail-*` (bug de harness já cometido).
- **tsc:** `npx tsc --noEmit` depois de QUALQUER mexida em `.ts`.
- **Nunca** reintroduzir `created_at::date` cru nem `toISOString()` para datas de negócio (ver §5.1).

## 8. Próximo passo

Executar o plano `docs/superpowers/plans/2026-09-15-dashboard-fuso-periodos-e-melhorias.md` na ordem (Task 1 é a crítica; Tasks 2-5 independentes entre si; Task 6 é o gate final). Duas formas:

1. **subagent-driven-development** (recomendado pelo formato do plano): um subagente por task, revisão entre tasks.
2. **execução inline** (executing-plans): lotes com checkpoints.

Ao final: apresentar resumo com números de verificação e **pedir autorização** para commit (sugestão de mensagens: `fix: corrige fuso dos períodos do dashboard (America/Sao_Paulo)` para a Task 1; `feat: ...` por task) e deploy (só se o usuário pedir, via `deploy-kds.bat`).

---

## 9. Execução do plano (2026-09-15, segunda metade da sessão)

**Status: Tasks 1-6 concluídas e verificadas localmente. Nada commitado/deployado.**

- `src/services/period.service.ts` criado (`BR_TZ`, `brDay`, `brDayFrom`, `brDayOf`, `shiftDay`). `brDayFrom` não estava no plano — foi adicionado porque os chamadores de `computeDailyScores` (`demands.ts` ×5, `admin.ts` ×2) precisavam converter `created_at` para dia BRT.
- Fuso corrigido em: `analytics.ts` (ranges, filtros, trend, volume, DOW de sazonalidade/heatmap, week comparison, indicadores diários, trocas, `/heatmap-details`, `/performance`), `performance.service.ts` (todos os `created_at::date` + guard do jantar agora deriva o dia BRT via SQL), `shift.service.ts` (3 usos no pré-turno), `admin.ts` (menu de hoje, `demandDate` da anulação, revert do jantar), `demands.ts` (callers do compute DailyScores), `dashboard.html` (`brToday`/`listDays`, botão Ontem, `getExportDates`, loops de export PDF/Excel).
- Guard do jantar: o valor de `shift_dinner_started_at` é gravado por `now()::text` (fuso da sessão — UTC em produção); o dia agora vem de `(value::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date` na própria query. **Verificado no caso crítico** (valor UTC `2026-09-14 01:30+00` = 22:30 BRT de 13/09 → `salao_jantar` de 13/09 com 1 demanda; o código antigo daria 0).
- Tasks 2-5 entregues: notas escopadas pela estação (`stationEntity`/`perfEntities` + badge "Filtro: X"), `kpis.comparison` (janela anterior, `%`/`pts`/invert), `prep_by_product` no servidor (removeu `qty_vs_time`/`QtyVsTimeRow`), ajustes (Atualizado às HH:MM + botão Atualizar, % nos motivos, toggle volume/taxa nos zerados, ordem de entidades unificada).
- **Banco local mantido em UTC** (`ALTER DATABASE kds SET timezone TO 'UTC'`) — paridade com produção; aceito pelo plano.
- **Verificação (tudo com banco em UTC):** `valida_fuso.py` 15/15 (0 falhas); `valida_api.py` 0 falhas (incl. 3 cenários de `comparison` conferidos por SQL manual); `e2e_dashboard.py` **63/63** (fuso com relógio falso 22:30 BRT, perf escopada, deltas, prep 33m/SLA 20, toggle zerados, atualizado às, exports xlsx/PDF conferidos); `e2e_jantar.py` 4/4; `verifica_chips.py` OK; `tsc --noEmit` limpo. Evidências novas: `14_perf_estacao.png`, `15_kpi_deltas.png`, `16_prep_produto.png`, `17_ajustes.png`.
- **Auditoria das NOTAS (consistência, incl. temporal):** `valida_notas.py` **26/26** — 13/09 (QA-FUSO-1 às 22:30 BRT) entra no dia 13/09 e não no 14/09; contadores de detratores por tipo == `sla_breaches`/`cancellations`/`stockouts` de cada entidade. Auditoria SQL (`%TEMP%\opencode\audit-notas-kds.sql`, reproduz as definições de `computeDailyScores`): **0 divergências** em todos os blocos (cozinhas, salão, salão jantar, cozinha geral, operação) e presença de 8 entidades por dia com demandas.
  - **Caveat encontrado e explicado:** dias com notas antigas (8 linhas já gravadas) **não são recalculados** por `ensureScoresForDate` — inserções retroativas por SQL cru deixaram 12/09, 13/09 e 14/09 desatualizados (faltavam QA-7/QA-FUSO-1/QA-8). Recálculo forçado (`DELETE FROM performance_scores WHERE date IN (...)`) e reauditado: tudo consistente. Em produção não ocorre porque toda mudança de demanda passa pelo app (`computeDailyScores` do dia BRT em create/ready/retrieve/cancel/annul/stockout/ativação do jantar).
- **Dados de teste:** `QA-FUSO-1` adicionado (22:30 BRT de 13/09, Arroz Branco/quente_a) via `%TEMP%\opencode\cria-fuso-kds.sql` — mantido para conferência, como os demais `QA-*`.
- **Pendências conhecidas (fora do escopo):** `daily-menu.ts /today` ainda usa `CURRENT_DATE` (menu do salão após 21h BRT mostra o dia UTC); histórico de `performance_scores` de dias passados permanece como foi calculado (recompute sob demanda).

## 10. Impacto em produção (deploy + banco com dados históricos)

**Deploy — só código, sem tocar no banco**
- Nenhuma migração, coluna, env var ou mudança de timezone no Supabase. `deploy-kds.bat` = git pull + rebuild da imagem + restart do container (Node 24 tem ICU completo — `Intl`/`America/Sao_Paulo` ok). Rollback de código reverter + redeploy; **nenhum dado é reescrito pelo deploy em si**.
- A sessão do banco de produção continua UTC — as queries novas convertem explicitamente para BRT, não há nada a configurar.

**Consultas com histórico — mudam números, não dados**
- Fronteira do dia: 00:00 UTC (21h BRT) → 00:00 BRT. Pedidos criados **21h–24h BRT** que eram contados no dia seguinte passam para o dia correto.
- Afeta: trend, volume/média móvel, heatmap (hora e DOW), sazonalidade, comparativo semanal, trocas, KPIs de "Hoje", deltas e exports por dia. **Totais de períodos longos não mudam** — só a atribuição entre dias vizinhos. Numa casa com jantar até tarde a diferença diária pode ser material.
- Hora-do-dia e turnos já eram BRT (não mudam). O índice `idx_demands_created_at` continua não sendo usado por essas queries — **mas já não era antes** (`created_at::date`); as rotas com range cru (`/summary`, `/peak-hours`, `/sla-breaches`, `/cancellations`, `/stockouts`) não mudaram.

**Notas (`performance_scores`) — o ponto de atenção**
- O deploy **não recalcula histórico**: `ensureScoresForDate` só recomputa dias com <8 linhas. Dias passados mantêm a atribuição antiga (UTC) até um recálculo — a série "Evolução das Notas" mistura história antiga com dias novos BRT se nada for feito.
- Recalcula quando: (a) qualquer mudança de demanda do dia (agora no dia BRT correto; antes, ação após 21h mexia no dia errado); (b) **salvar pesos no admin** (dispara recálculo retroativo de TODAS as datas); (c) `DELETE` pontual + visualizar o período.
- Recomendado: rodar o recálculo retroativo UMA vez pós-deploy (com backup) e revisar 2-3 dias com jantar que teve pedidos 21h+ — esses dias podem mudar de nota, pois eram os errados.
- Limitação pré-existente do guard do jantar: `shift_dinner_started_at` guarda a última ativação; recomputar um dia antigo em que o jantar começou em outro dia grava `salao_jantar = 0` (mesmo comportamento de antes).

**Features novas com histórico**
- "Preparo por Produto": ranking e médias de períodos passados podem mudar (o viés do `LIMIT 200` saiu) — mais correto.
- Deltas de KPI, filtro de estação na Performance, chips e toggle volume/taxa: só apresentação; não tocam dados.
- **Pendência**: `daily-menu.ts /today` ainda usa `CURRENT_DATE` (UTC em prod) — pós-deploy o dashboard vira o dia às 00:00 BRT mas o cardápio do salão ainda vira às 21h BRT. Corrigir antes/junto se quiser consistência total (usar expressão BRT, como `todaySP()` em `shift.service`).

## 11. Checklist de rollout

**Pré-deploy**
- [ ] Backup lógico de `performance_scores` (e `system_settings`) — rollback de código não desfaz recálculo de notas. Opções: export CSV no SQL Editor do Supabase; `pg_dump` pelo host Oracle (IPv6); ou `CREATE TABLE performance_scores_bkp_20260915 AS SELECT * FROM performance_scores;`
- [ ] Registrar baseline: `SHOW timezone;` (esperado UTC) e `SELECT date, COUNT(*) FROM performance_scores GROUP BY date ORDER BY date DESC LIMIT 5;`
- [ ] `npx tsc --noEmit` limpo + suíte local verde (números §9) + `git status` sem surpresas.
- [ ] Commit(s) + push **com autorização**; preferir janela fora do serviço (restart curto do container; sem migração).

**Deploy**
- [ ] `scripts/deploy-kds.bat` (paramiko → Oracle).
- [ ] `curl.exe -s https://kds-framboa.duckdns.org/health` → ok.

**Pós-deploy**
- [ ] Login gerente: conferir "Hoje" (se for ≥21h BRT, é o teste do bug — o painel deve mostrar os pedidos do dia, não vazio) e o heatmap com drill-down.
- [ ] Botão Ontem, filtro de estação, export PDF/Excel.
- [ ] (Recomendado, uma vez) salvar os pesos no admin com os **mesmos valores** para disparar o recálculo retroativo; acompanhar o log e conferir 2-3 dias com jantar que teve pedidos 21h+.
- [ ] Conferir `performance_scores` do dia após a primeira transição de demanda.

**Rollback**
- [ ] Código: `git revert <commits>` + redeploy (não há migração para desfazer).
- [ ] Dados: restaurar o backup de `performance_scores` se o recálculo retroativo já tiver rodado; caso contrário, nada a fazer.
