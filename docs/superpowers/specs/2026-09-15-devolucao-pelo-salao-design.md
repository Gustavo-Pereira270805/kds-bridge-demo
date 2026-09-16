# Devolução pelo salão (ready → preparo) + busca de unidades — Design

Data: 2026-09-15. Origem: pedido do dono (salão reporta demanda marcada como
pronta que não está conforme; ela volta ao preparo, com +2 min de prazo, novo
detrator para a cozinha e card com visual próprio; motivo e observação
opcionais). Inclui melhoria pedida no mesmo lote: busca no campo de unidade da
criação de demanda, igual à busca de produtos/trocas.

## 1. Objetivo

- Salão pode **devolver** uma demanda em `ready` (botão ao lado de "Retirar").
  A demanda volta para `pending`, a cozinha recebe **+2 min** na janela de
  preparo (`sla_minutes`), e cada devolução gera uma ocorrência do detrator
  novo **"Devolvidas pelo salão"** (peso padrão 0,20, editável no admin).
- Se a nova "pronta" estourar o SLA, o desconto de estouro **soma por cima**
  do detrator de devolução (teto diário de 5 pontos por entidade inalterado).
- Card devolvido tem visual próprio (âmbar) e faixa "DEVOLVIDA PELO SALÃO"
  (+ "(2x)" se reincidente, + motivo/observação) no salão e nas 3 cozinhas.
- Campo de unidade do salão vira busca digitável (mesmo padrão de produtos).

## 2. Não-objetivos (YAGNI)

- Devolver demanda depois de `retrieved` (só `ready`; o card sai do quadro).
- Status novo no fluxo (`pending` já representa "em preparo").
- Promover a devolvida a urgente (prioridade permanece como estava).
- Editar a observação criada no registro da demanda (continua runtime, §2026-09-10).
- Reusar `slow_items`/`slow_item_deduction` legado (sem uso; colunas novas).
- Motivo/observação da devolução com categorias pré-cadastradas (texto livre).

## 3. Arquitetura

```
salao.html (card ready: "Reportar" + modal motivo/observação)
  │ POST /api/v1/demands/:id/return-to-kitchen { reason?, observation? }
  ▼
demands.ts — transação (espelha annul-step 'marked_ready')
  │ ready → pending; sla_minutes += 2; count/at/reason/observation;
  │ anula eventos marked_ready/sla_breach_cozinha; insere returned_to_kitchen
  ▼
recomputeStationQueue (ETA) + computeDailyScores (brDayFrom)
  │ emits demand:returned (estação+salão+gerente) + demand:queue-updated (global)
  ▼
cards devolvidos (salao.html + cozinha*.html) + notas/dashboard/admin
```

### 3.1 Banco (migration + espelho no `seedDatabase`)

Migration nova `supabase/migrations/2026-09-15-devolucao-pelo-salao.sql`
(idempotente) e patch espelhado em `server.ts` (`seedDatabase`), como manda o
AGENTS.md:

- `demands` += `returned_to_kitchen_count int NOT NULL DEFAULT 0`,
  `returned_to_kitchen_at timestamptz NULL`,
  `returned_to_kitchen_reason text NULL`,
  `returned_to_kitchen_observation text NULL`.
- `performance_scores` += `returned int NOT NULL DEFAULT 0`,
  `returned_deduction numeric NOT NULL DEFAULT 0`.
- `system_settings` += `score_weight_returned = '0.2'`
  (`INSERT ... ON CONFLICT DO NOTHING`).
- Constraint `demand_events_event_type_check` ganha `returned_to_kitchen`
  (mesmo bloco `DO $$ ... pg_get_constraintdef LIKE ...` usado no
  `step_rollback`).

Sem backfill: demandas antigas ficam com contador 0 (default).

### 3.2 Notas (`src/services/performance.service.ts`)

- `getWeights()` lê `score_weight_returned` (default 0,20; clamp 0–5).
  `PerformanceWeights` ganha `returned: number`.
- Por estação/dia: `returnedCount = SUM(returned_to_kitchen_count)` das
  demandas da estação criadas no dia BRT (`status != 'annulled'`).
  **Cada devolução conta** (reincidência acumula).
- `capDeductions(sla, canc, stock, ret)` ganha a 4ª categoria (distribuição
  proporcional mantida quando a soma passa de 5).
- `returnedDeductionRaw = round2(returnedCount * weights.returned)`.
- `upsertScore` passa a gravar `returned`/`returned_deduction`; agregados
  `cozinha_geral` (SUM/AVG) e `operacao` (quebra por categoria + `eff()`)
  incluem a categoria. **Salão não é penalizado** (falha é da cozinha).
- `buildDetractors` ganha o item `{ label: 'Devolvidas pelo salão', count,
  deduction }`. `getDetractorDates` lista as demandas com
  `returned_to_kitchen_count > 0` e `status != 'annulled'` no período
  (`detail = motivo || observação || 'Sem motivo informado'`;
  `deduction = count * peso`).
- `PerformanceScoreRow`/`EntityScore` ganham os campos novos. As listas
  explícitas de colunas nos agregados (`opLeaves`, `stationRows` e o SELECT
  do `/performance` em `analytics.ts`) incluem `returned`/`returned_deduction`.

### 3.3 API (`src/routes/demands.ts`)

`POST /:id/return-to-kitchen` — público (kiosk fixo), como `retrieve` e
`stockout`. Body `{ reason?: string; observation?: string }` (trim; motivo
≤ 50 e observação ≤ 80; vazio → nulo; excedeu → 400 em pt-BR).

Transação única (pool client, BEGIN/COMMIT), espelhando `annul-step`:

1. Valida: 404 se não existe; 409 se `status != 'ready'`; 403 se o dia BRT de
   `created_at` não é hoje (`GET /demands` lista ativas de qualquer dia).
2. `UPDATE demands SET status='pending', ready_at=NULL,
   ready_out_of_order=false, sla_breached_cozinha=false,
   sla_breach_minutes_cozinha=NULL,
   sla_minutes = COALESCE(NULLIF(sla_minutes, 0), 10) + 2,
   expected_ready_at = now() + (sla_minutes novo) minutes,
   returned_to_kitchen_count = returned_to_kitchen_count + 1,
   returned_to_kitchen_at = now(), returned_to_kitchen_reason = $r,
   returned_to_kitchen_observation = $o
   WHERE id = $1 AND status = 'ready' RETURNING *` (CAS; 0 linhas → 409).
3. `UPDATE demand_events SET annulled_at=now(), annulled_by='salao',
   annul_reason = $r WHERE demand_id=$1 AND event_type IN
   ('marked_ready','sla_breach_cozinha') AND annulled_at IS NULL`.
4. `INSERT demand_events (returned_to_kitchen, 'salao', notes)` com
   `notes = 'Motivo: X · Obs.: Y'` (só as partes preenchidas; ambas vazias →
   NULL).
5. Commit. Depois: `recomputeStationQueue(station)`; fetch do `updated` com
   `replaced_name`; `computeDailyScores(brDayFrom(created_at))`
   fire-and-forget; observação runtime do registro **permanece** (demanda
   segue ativa; sem `clearObservation`).

`cooking_started`/`cooking_started_at` e `priority` **não** mudam (igual à
anulação de passo; a fila trata o retorno no recompute).

### 3.4 Salão (`src/views/salao.html`)

- Card `ready`: ações = "Retirar" + **"Reportar"** (`report-btn`).
- Modal `reportModal`: título "Reportar Demanda"; texto "O pedido voltará
  para a cozinha para ser preparado novamente. A cozinha terá +2 min de prazo
  e será avaliada por isso."; **Motivo (opcional)** ≤ 50; **Observação
  (opcional)** ≤ 80; botões "Sim, devolver para a cozinha" (destaque) e
  "Cancelar". Sucesso → toast "Demanda devolvida para a cozinha (+2 min de
  preparo)."; erro → `showToast(err.message)`; botão reabilitado no fim.
- Card com `returned_to_kitchen_count > 0` (pending ou ready) ganha
  `class="returned"` + faixa "DEVOLVIDA PELO SALÃO" (+ "(Nx)") e uma linha
  própria com motivo/observação da devolução (a `.obs-strip` da observação
  do registro continua aparecendo, se houver).
- Socket `demand:returned` atualiza/substitui a linha; `demand:queue-updated`
  já recarrega.
- **Busca de unidades**: o `<select id="unitSelect">` vira input digitável
  (`unitSearch`) + select oculto + dropdown, reusando as classes
  `.product-search-wrapper`/`.product-dropdown` (tema escuro/claro/jantar já
  cobertos). Abre a lista ao focar, filtra no cliente (`toLowerCase`),
  escolher preenche input + `unitSelect`; limpar o input limpa a seleção;
  sem produto → disabled; produto sem unidade → "Sem unidade".
  `unit_id`/`unit_label` do submit permanecem idênticos; o reset pós-envio
  limpa input + seleção.

### 3.5 Cozinhas (`cozinha.html`, `cozinha-quente.html`, `cozinha-fria.html`)

- Cards `pending` com `returned_to_kitchen_count > 0`: mesma classe
  `returned` + faixa "DEVOLVIDA PELO SALÃO" (+ "(Nx)") + motivo/observação
  quando houver, acima da `.obs-strip` (posição fixa para leitura).
- CSS novo com tokens do tema: fundo âmbar translúcido, filete esquerdo
  `4px solid var(--c-warn)`, texto em var de corpo; variantes claro/jantar
  junto das regras existentes de `.card.urgent`/`.stockout`.
- Atualização via `demand:queue-updated` global (reload já existente nas 3
  telas); nenhum handler novo de socket (evita reload duplo, já que a rota
  emite os dois eventos).

### 3.6 Admin, dashboard e gerente

- Admin → Critérios de Avaliação: campo novo "Devolvida pelo salão (cozinha)"
  (id `weightReturned`, 0–5), incluído em `loadWeights`/`saveWeights` e no
  `PUT /admin/settings/weights` (validação + upsert como os demais).
- Dashboard: `populateCriteriaModal` ganha a linha "Devolvida pelo salão
  (cozinha) — −0,20 por ocorrência". Gráficos/exportações já renderizam
  qualquer label vindo do servidor (nada mais a mudar).
- Gerente: `EVENT_LABELS` += `returned_to_kitchen: 'devolvida pelo salão'`.
  Status segue `pending` (nenhum mapa de status muda).

## 4. Socket

- Evento novo `demand:returned` com a demanda atualizada, emitido para a
  sala da estação + `salao` + `gerente` (mesmo padrão do `demand:stockout`).
- `demand:queue-updated` global após o recompute (padrão do zerou).
- `demand_events` novo tipo não muda payloads existentes.

## 5. Erros (pt-BR, sem `.catch` vazio)

- `400 'Motivo com no máximo 50 caracteres'` / `'Observação com no máximo 80 caracteres'`.
- `409 'Só é possível devolver demandas prontas aguardando retirada'`.
- `403 'Só é possível devolver demandas do dia atual'`.
- `409 'Demanda mudou de estado, recarregue o quadro'` (CAS).
- `500 'Erro ao devolver demanda para a cozinha'` (log + toast no salão).

## 6. Ciclo de vida

| Evento | Efeito |
|---|---|
| devolução (1ª..Nª) | `count += 1`, `sla_minutes += 2`, eventos do passo anulados, `returned_to_kitchen` novo |
| nova "pronta" | `evaluateCookingSla` reavalia do zero (com o SLA maior); estouro desconta junto com o detrator |
| anulação total (gerente) | `status='annulled'`; devoluções deixam de contar nas notas (filtro já existente) |
| anulação de passo `marked_ready` | volta para `pending`; devoluções anteriores **permanecem** (fato ocorrido) |
| restart servidor | nada muda (tudo persistido; observação do registro segue runtime) |

## 7. Testes

- `npx tsc --noEmit` limpo.
- Migration aplicada no Postgres local (`psql -f`) e boot do servidor com o
  patch do `seedDatabase` (convergência idempotente).
- `outputs/dashboard-cancelamentos/valida_devolucao.py` (novo, padrão
  `valida_api.py`): cria demanda de teste do dia → cozinha marca pronta →
  devolve com motivo+observação → asserts de status/pending, `ready_at` nulo,
  `sla_minutes +2`, `count=1`, colunas gravadas, evento novo e eventos do
  passo anulados; re-pronta → estouro soma com 0,20; 2ª devolução → `count=2`
  e SLA +2 de novo; teto de 5 no dia; auditoria SQL das notas do dia.
- Erros: 404, 409 (não pronta), 403 (dia anterior), motivo/observação > limite.
- Playwright (estende `e2e_dashboard.py` + novo script do salão): botão
  "Reportar" + modal + toast; card devolvido no salão e na cozinha (classe,
  faixa, motivo/observação); detrator "Devolvidas pelo salão" no dashboard;
  campo de pesos no admin; busca de unidade (filtrar, escolher, limpar,
  sem produto). Screenshots em `outputs/devolucao-salao/`.
- Dados de teste `QA-*` mantidos (novo prefixo `QA-DEVOL-`), banco local.

## 8. Riscos e limitações

- Antes do deploy, a migration precisa ser rodada no Supabase (AGENTS.md:
  migrations via SQL editor) — o boot também aplica o patch, então não há
  janela obrigatória de manutenção.
- O estouro de SLA anterior à devolução é anulado e reavaliado na nova
  pronta; se a re-pronta couber no SLA +2 (raro, pois o tempo total só
  cresce), o estouro original deixa de contar — mas o 0,20 da devolução
  permanece.
- Demanda devolvida e não refeita até a virada do dia continua `pending`;
  nova devolução no dia seguinte é barrada pelo guard de dia (403).
- Kiosk público: o endpoint segue o padrão `retrieve`/`stockout` (sem token);
  o guard de dia é a única barreira adicional.
- Sem impacto em CSRF/socket (sem leitura de cookie; sala `salao` pública).
