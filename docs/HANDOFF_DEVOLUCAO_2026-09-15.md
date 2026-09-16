# HANDOFF — Devolução pelo salão + busca de unidades (spec+plano prontos, implementação pendente)

**Data:** 2026-09-15 · **Autor:** sessão opencode · **Status:** IMPLEMENTADO e verificado localmente (Tasks 1–7 verdes). **NADA commitado, NADA em produção** (migration ainda não rodada no Supabase).

Este documento é autossuficiente para retomar numa sessão limpa. Leia inteiro antes de fazer qualquer coisa.

---

## 1. Objetivo e modo de execução

O salão poderá **devolver** uma demanda marcada como pronta (`ready`) que não está conforme: ela volta ao preparo (`pending`), ganha **+2 min** de SLA, gera ocorrência do detrator novo **"Devolvidas pelo salão"** (peso 0,20) para a cozinha, e o card ganha visual próprio âmbar com faixa. Modal com **motivo (≤50)** e **observação (≤80)** opcionais. No mesmo lote: **busca digitável no campo de unidade** da criação de demanda (padrão de produtos/trocas).

- Spec aprovada: `docs/superpowers/specs/2026-09-15-devolucao-pelo-salao-design.md` (224 linhas).
- Plano: `docs/superpowers/plans/2026-09-15-devolucao-pelo-salao.md` (7 tasks, sem passos de commit).
- **Modo de execução escolhido pelo usuário: Inline.** Ao retomar: invocar o skill `executing-plans` e executar o plano task por task, com checkpoints. NÃO usar subagentes (escolha explícita).

## 2. Estado do git (verificado em 2026-09-15, pós-implementação)

- `HEAD = cec3442`. **Working tree com DUAS frentes não commitadas:** dashboard v1+v2 (anterior) + devolução (esta). Arquivos desta frente: `M src/routes/demands.ts, server.ts, admin.ts, analytics.ts, performance.service.ts, types.ts, views/salao.html, cozinha.html, cozinha-quente.html, cozinha-fria.html, gerente.html, admin.html, dashboard.html, supabase/schema.sql` + novo `supabase/migrations/2026-09-15-devolucao-pelo-salao.sql` (untracked, junto de spec/plano/handoff).
- **ATENÇÃO:** o diff mistura as duas frentes (ex.: `performance.service.ts`, `admin.ts`, `dashboard.html` têm mudanças das duas). Não commitar sem autorização; quando o usuário pedir, separar os commits por frente.
- Plano restaurado: o arquivo `docs/superpowers/plans/2026-09-15-devolucao-pelo-salao.md` estava TRUNCADO (terminava no meio do Step 8 da Task 2 com marcador literal); o rabo (Step 8 completo + Steps 9–13 + Tasks 3–7) foi reconstruído da spec aprovada + código real antes de executar. Arquivo hoje íntegro (38.496 chars, Tasks 1–7).

## 3. Ambiente local (como rodar)

**Portas:** 3000 é de OUTRO projeto (`jurema-api`) — não matar. KDS no **3100**.

1) **Postgres local** (serviço `postgresql-x64-18` geralmente parado):
```
Start-Process cmd -ArgumentList "/c `"$env:TEMP\opencode\start-pg.bat`"" -WindowStyle Minimized
```
Banco: `postgresql://kds:kds_local_123@localhost:5432/kds` (`$env:PGPASSWORD='kds_local_123'` para o psql em `"C:\Program Files\PostgreSQL\18\bin\psql.exe"`). **Timezone do banco local: UTC** (paridade com produção).

2) **Dev server** (restart obrigatório após mudar `.ts`; HTML/CSS/JS valem sem restart):
```
$env:PORT='3100'; $env:KDS_KIOSK_IPS='127.0.0.1,::1,::ffff:127.0.0.1'
Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized
```
Health em loop: `curl.exe -s http://localhost:3100/health`. Se a porta travar: `taskkill` no PID de `Get-NetTCPConnection -LocalPort 3100`. Nunca `Start-Job`.

3) **Login teste (admin):** `gustanpereira@gmail.com` / `Gp#270805` (Supabase Auth na nuvem — nunca commitar). Da máquina dev, rotas `requireKitchen` passam sem token (IP quiosque); `/admin/*` e `/analytics/*` exigem `Authorization: Bearer`. Páginas gerente/admin/dashboard no Playwright: login via API + `sessionStorage.setItem('kds_token_session', token)`. Salão e cozinhas abrem sem login de localhost.

4) **Python dos scripts:** `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe` (`playwright`, `openpyxl`, `pymupdf` instalados).

## 4. Regras inegociáveis

- Tudo em **pt-BR** (código, UI, mensagens, commits, docs).
- `npx tsc --noEmit` limpo após qualquer `.ts`. SQL com `$1` (nunca `?`). Sem `.catch` vazio.
- **PROIBIDO commit/push/deploy sem autorização explícita.** `scripts/deploy-kds.bat` só com ordem direta.
- PowerShell: nunca `node -e` inline (escrever arquivo); SQL com acento só via arquivo UTF-8 + `psql -f` (a migration desta frente é ASCII pura de propósito); `curl.exe -d` inline quebra JSON (usar `-d @arquivo`); `urllib` sem `Content-Type` quando não há body.
- Testes: sem framework no repo — scripts Python em `outputs/` (gitignored). Dados de teste com `notes LIKE 'QA-DEVOL-%'`, criados no dia e **mantidos**; limpar só via anulação mesmo-dia (`POST /api/v1/admin/demands/:id/annul`) ou `DELETE` direto quando a anulação for barrada (guard de dia), apagando `demand_events` antes.
- Deploy futuro desta frente exige rodar a migration no Supabase via SQL editor (o boot também aplica o patch do `seedDatabase`, então sem janela obrigatória).

## 5. Decisões de design aprovadas (não reabrir sem motivo)

1. **+2 min + detrator novo + estouro soma por cima:** `sla_minutes = COALESCE(NULLIF(sla_minutes,0),10) + 2` por devolução; categoria nova com peso **0,20** (editável); se a nova "pronta" estourar, o desconto de SLA acumula (teto 5/dia/entidade mantido).
2. **Rótulo:** "Devolvidas pelo salão".
3. **Motivo (≤50) e observação (≤80), ambos opcionais** no modal (além do texto explicativo). Campo próprio persistido — NÃO substitui a observação do registro (runtime, intacta).
4. **Só `ready`** (botão "Reportar" ao lado de "Retirar"); após "Retirar" não há como reportar.
5. **Reincidência conta:** cada devolução +2 min e +1 ocorrência (banner mostra "(2x)").
6. Abordagem A: endpoint dedicado reaproveitando a **mecânica** do `annul-step` (B = expor o endpoint admin ao salão e C = status novo foram recusados).
7. Card devolvido com visual próprio âmbar + faixa (cozinha ×3 e salão); **sem** handler novo de socket nas cozinhas (o `demand:queue-updated` global já recarrega — evita reload duplo).

## 6. Mapa técnico essencial

- Fluxo: `pending -> ready -> retrieved`; `ready → pending` já existe como anulação de passo do gerente (`POST /api/v1/admin/demands/:id/annul-step`, `admin.ts` ~486-585; caso `marked_ready` limpa `ready_at`/`ready_out_of_order`/SLA e anula eventos `marked_ready`+`sla_breach_cozinha`). A rota nova espelha isso + penalidade.
- SLA do preparo: `evaluateCookingSla` (`sla.service.ts`) mede `created_at → ready_at` vs `sla_minutes`. ETA da fila: `recomputeStationQueue` (`queue.service.ts`) projeta `expected_ready_at` a partir de `sla_minutes`.
- Notas: `performance.service.ts` — base 5.0, categorias (SLA/cancelamento/zerado) com `capDeductions` (teto 5); pesos em `system_settings` (`score_weight_*`, default via `getWeights`); `upsertScore` + agregados `cozinha_geral`/`operacao`; `buildDetractors` (labels) e `getDetractorDates` (ocorrências). Pesos editáveis em `PUT /api/v1/admin/settings/weights` (dispara recálculo retroativo!) + `admin.html` (`weightCancellationCozinha`, `weightCancellationSalao`, `weightStockoutSalao`, `weightSlaMin`, `weightSlaMax`, `loadWeights`/`saveWeights`) + modal de critérios do `dashboard.html` (`populateCriteriaModal`, `fields` ~1724).
- Tipos: `Demand`, `DemandEventType`, `PerformanceWeights`, `PerformanceScoreRow`, `EntityScore` em `src/types.ts`.
- Salão (`salao.html`): cards em `renderDemands` (~573-654; ações do `ready` ~629-635), modais `cancelModal`/`confirmModal` (~371-392) como molde, dropdowns via `makeProductDropdown` (~909-950), submit lendo `unitSelect` (~1097-1188), `loadUnitsForProduct` (~847-868), socket `demand:queue-updated → loadActiveDemands` (~1218). CSS: `.stockout-btn` (~120), `.demand-card.stockout` (~149).
- Cozinhas: padrão `if (d.stockout_reported) classes.push('stockout')` + `stockout-label` (`cozinha-quente.html` ~645-671, `cozinha-fria.html` ~521-547, `cozinha.html` ~406-450); CSS `.card.stockout` com tokens `--c-warn`/`--alert-warn-bg-*` (`theme.css` ~15/42). Reload via `demand:queue-updated` (~663/913/787).
- Gerente: `EVENT_LABELS` (~466) + refetch no `demand:stockout` (~1112) como molde. Dashboard live: lista de eventos em `dashboard.html` ~2623.
- Unidades: `GET /api/v1/units/by-product/:productId` (`units.ts`); admin de unidades em `admin.html` ~189-280.
- Constraints de eventos: `supabase/schema.sql` ~167 + bloco `DO $$` no `server.ts` ~367-396 (molde do `step_rollback`).

## 7. O plano (EXECUTADO — Tasks 1–7 verdes)

`docs/superpowers/plans/2026-09-15-devolucao-pelo-salao.md` — ordem 1→7 executada:

1. **Banco + tipos** ✅ — migration aplicada no PG local (4+2 colunas, peso 0.2, CHECK com tipo novo), `schema.sql`, espelho `seedDatabase`, `types.ts`. Boot idempotente OK.
2. **Detrator + pesos** ✅ — `capDeductions` 4ª categoria, `getWeights.returned`, `upsertScore` 12 args, contagem por estação, agregados `operacao`/`cozinha_geral`, `buildDetractors` + `getDetractorDates`, PUT weights, `/performance` current+average, campo no admin, linha no modal de critérios, `demand:returned` no reload do dashboard. `tsc` limpo; roundtrip de pesos 8/8 (`%TEMP%\opencode\check-weights.py`).
3. **Endpoint** ✅ — `POST /:id/return-to-kitchen` (CAS + guard de dia + transação + emits). `outputs/devolucao-salao/valida_devolucao.py`: **45/45 PASS**.
4. **Salão** ✅ — botão Reportar, `reportModal` (motivo≤50/obs≤80), card `.returned` + faixa + detalhe, socket `demand:returned`. `e2e_salao_report.py`: **tudo PASS** (4 screenshots). Detalhe: regra de jantar `:root body[data-shift="dinner"] .demand-card` (especificidade maior) exigiu incluir `.returned` na lista âmbar do jantar.
5. **Cozinhas + gerente** ✅ — `.returned` + faixa `(Nx)` + motivo/obs nas 3 (quente cobre jantar; sem handler novo de socket), `EVENT_LABELS` + refetch no gerente. `e2e_cozinha_devolvida.py`: **tudo PASS** incl. update ao vivo `(2x)` (4 screenshots). Screenshot inicial escuro era artefato do `flash-in` (1000 ms de espera antes do shot 2x).
6. **Unidades** ✅ — `unitSearch` + select oculto + dropdown (classes `.product-search-wrapper`/`.product-dropdown`), filtro cliente, `unit_id`/`unit_label` intactos. `e2e_unidades.py`: **tudo PASS** com 3 unidades QA semeadas e removidas (4 screenshots). Constatado: banco local sem nenhuma unidade cadastrada.
7. **Gate final** ✅ — `tsc` limpo; `valida_api.py` 0 falhas; `e2e_dashboard.py` 63/63; `audita_notas.py` 25/25; `npm run build` OK. Evidências em `outputs/devolucao-salao/` (5 scripts + 12 screenshots em `evidencias/`). **Sem commit, sem push, sem deploy.**

Achados de teste (todos resolvidos; utilidade futura): turno jantar ativo roteia demandas novas p/ estação jantar (scripts leem a estação da demanda criada, não a do produto); `quantity` volta como `'7.00'` (comparar com float); subprocess psql precisa `encoding='utf-8'` (mojibake `Â·` em cp1252); `page.fill` no produto clica opção obsoleta do cardápio — esperar item exato + confirmar `productSelect.value`.

## 8. Pendências e riscos conhecidos

- Migration precisa ir ao Supabase antes do deploy em produção (com o patch de boot, sem janela obrigatória).
- `daily-menu.ts /today` ainda usa `CURRENT_DATE` (UTC em prod) — pendência da outra frente, fora deste escopo.
- Salvar pesos no admin recalcula TODAS as datas em background — o script de teste restaura o peso após o roundtrip.
- Devolvida não refeita até a virada: continua `pending`; nova devolução no dia seguinte é barrada (403).
- Endpoint público (padrão `retrieve`/`stockout`); única barreira extra é o guard de dia.
