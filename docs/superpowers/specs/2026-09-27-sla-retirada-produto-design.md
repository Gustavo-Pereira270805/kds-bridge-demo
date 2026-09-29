# SLA de Retirada do Salão por Produto — Design

Data: 2026-09-27
Status: aprovado (decisões do usuário registradas em conversa)

## Objetivo

Novo painel no dashboard: **"SLA de Retirada do Salão por Produto"**, com drill-down
por produto listando as ocorrências de estouro (data/hora da retirada, pedido,
estação, espera real e minutos excedidos). O painel ocupa o espaço vazio ao lado de
"Tempo de Fila por Estação" (grade `#sla`, `data-cols="6"`).

Leitura principal (aprovada): **espelho do painel "SLA por Produto" da cozinha** —
barra = nº de estouros (proporcional ao pior produto), valor = `%` de retiradas
dentro do SLA, cor por faixa (≥90 verde, ≥70 laranja, <70 vermelho), top 10.

## Decisões

- **D1 — Base de dados**: usa os flags gravados na retirada (`sla_breached_salao`,
  `sla_breach_minutes_salao`). É a mesma base do KPI "Atrasos do Salão" e dos
  detratores de salão, garantindo que painel × KPI × notas contem a mesma história.
- **D2 — Recálculo retroativo dos flags (opção B, aprovada)**: ao salvar tolerância
  ou pesos no admin, o recálculo em background passa a **reescrever também os flags**
  dos pedidos históricos com a tolerância nova, além de recalcular as notas. Sem
  isso, mudar a tolerância atualizaria as notas mas deixaria KPI/painel/detratores
  com a régua antiga.
- **D3 — Log de eventos intocado**: `demand_events` mantém os eventos
  `sla_breach_salao` originais (auditoria do que o sistema fez na hora). Flags e log
  podem divergir após um recálculo — aceito e documentado.
- **D4 — Painel da cozinha intocado**: o novo render é uma **cópia do padrão**
  (`renderSlaProductPanel` → `renderPickupSlaPanel`). Sem refactor compartilhado.
- **D5 — Detalhes embutidos no payload** (`pickup_sla_details`), como o
  `sla_details` da cozinha. Drill-down client-side em acordeão reusando
  `drillRowHtml`/`wireDrillGrid`. Sem endpoint novo.
- **D6 — Exportação incluída**: PDF (nova seção no relatório) e Excel (aba
  agregada + aba de detalhe), nos modos Consolidado e Por dia.

## Backend

### `src/types.ts`

```ts
export interface PickupSlaByProductRow {
  product_name: string;
  total: number;          // retiradas no período
  breached: number;       // estouros (sla_breached_salao)
  pct_ok: number;         // % dentro do SLA
  avg_overage_min: number; // média dos minutos excedidos (só estouros)
}
```

### `src/routes/analytics.ts`

Importa `getPickupTolerance` de `performance.service` e `PickupSlaByProductRow`.

**Step 7c `pickup_sla_by_product`** — mesmos filtros do agregado de cozinha:

```sql
SELECT product_name,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE sla_breached_salao = true)::int AS breached,
  ROUND((COUNT(*) FILTER (WHERE sla_breached_salao = false)::numeric
         / NULLIF(COUNT(*), 0)) * 100, 1) AS pct_ok,
  ROUND(COALESCE(AVG(sla_breach_minutes_salao)
         FILTER (WHERE sla_breached_salao = true), 0)::numeric, 1) AS avg_overage_min
FROM demands
WHERE ${dateFilter} AND retrieved_at IS NOT NULL AND ready_at IS NOT NULL
  AND status != 'annulled' ${stationFilter}
GROUP BY product_name
ORDER BY breached DESC, total DESC
```

**Step 7d `pickup_sla_details`** — espelho do 7b (mesma janela e `daily_seq`):

```sql
WITH ranked AS (
  SELECT d.id, d.product_name, d.created_at, d.ready_at, d.retrieved_at,
    d.sla_breached_salao, d.sla_breach_minutes_salao, d.kitchen_station_id,
    ROW_NUMBER() OVER (
      PARTITION BY (d.created_at AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY d.created_at, d.id
    ) AS daily_seq
  FROM demands d
  WHERE ${dateFilterD} ${stationFilterD}
)
SELECT r.id, r.product_name, r.daily_seq, r.ready_at, r.retrieved_at,
  r.sla_breach_minutes_salao AS overage_min, ks.name AS station
FROM ranked r
LEFT JOIN kitchen_stations ks ON ks.id = r.kitchen_station_id
WHERE r.sla_breached_salao = true AND r.retrieved_at IS NOT NULL
  AND r.ready_at IS NOT NULL AND r.status != 'annulled'
ORDER BY r.retrieved_at DESC NULLS LAST
```

**Payload**: `pickup_sla_by_product`, `pickup_sla_details` e
`pickup_tolerance_min: await getPickupTolerance()` (para o subtítulo).

### Recálculo retroativo (D2)

`src/services/sla.service.ts` — nova função:

```ts
export async function recomputePickupSlaFlags(): Promise<number>
```

Um único `UPDATE ... FROM (SELECT ...) ... RETURNING d.id`, com guarda
`IS DISTINCT FROM` para só tocar linhas que mudam de valor. Regra: para pedidos
com `ready_at` e `retrieved_at` não nulos e `status != 'annulled'`,
`breached = espera > tolerância` e `overage = ROUND(espera - tolerância, 2)` (NULL
quando dentro). Parâmetro `$1::numeric`.

`src/routes/admin.ts` — `scheduleRetroactiveRecompute` chama
`recomputePickupSlaFlags()` **antes** do loop de `computeDailyScores`, para os
detratores de salão já lerem os flags novos. Falha no recálculo de flags é logada
e não impede o recálculo das notas.

## Frontend (`src/views/dashboard.html`)

- `renderPickupSlaPanel(data)` — cópia de `renderSlaProductPanel`:
  - prefixo `pickup-sla`, classe `pickup-sla-row`, top 10 produtos;
  - valor `pct_ok + '%'`, `valueLabel = breached + ' estouros'`, cores por faixa;
  - `head`: `N estouros · X% dentro do SLA · tolerância Y min`;
  - detalhe: `Data/Hora` (retirada), `Pedido #`, `Estação`,
    `Espera real` (`ready → retrieved` via `fmtRealMinutes`), `Excedeu` (min);
  - detalhe ordenado por `retrieved_at` desc; defensivo (`|| []`).
- Painel `data-cols="6"` inserido **logo após** o bloco "Tempo de Fila por Estação",
  condicionado a `pickup_sla_by_product.length` (sem retiradas → painel oculto).
  Subtítulo: "Ordenado por estouros · barra = n° de estouros (vs o pior produto) ·
  % = retiradas dentro do SLA · tolerância atual: X min · clique para detalhar".
- `wireDrillGrid(slaGrid, ...)` ganha `{ selector: '.pickup-sla-row', prefix: 'pickup-sla' }`.
- Sem estouros no período: linhas com 0 estouros / 100% e detalhe "Sem registros."
  (comportamento herdado de `drillTableHtml`).

## Exportação (D6)

- **PDF**: nova linha em `exportReportHtml` logo após "SLA por produto |
  Cancelamentos": "SLA de retirada do salão por produto (tolerância: X min)" com
  `exportBars(pickup_sla_by_product, 'product_name', breached, '#e76f51')` +
  tabela "Retiradas — exemplos recentes" (até 8 estouros: Data/Hora, Produto,
  Estação, Espera, Excedeu). Vale para Consolidado e Por dia (o payload diário já
  traz os dados).
- **Excel**: lista consolidada ganha `['pickup_sla_by_product', 'SLA Retirada']`;
  `appendDetailSheets` ganha 'SLA Retirada Detalhe' (Data/Hora, Pedido, Produto,
  Estação, Espera (min), Excedeu (min)).

## Verificação (local, sem deploy/commit)

1. `npx tsc --noEmit` limpo; check de JS inline (`check-html-js.mjs`) no dashboard.
2. Fixture local (`QA-PICKUP-%`): pedidos com `created_at`/`ready_at`/`retrieved_at`
   controlados (hoje), vários produtos/estações, estouros e não-estouros.
3. Script de validação da API:
   - agregado por produto = detalhe (contagens por produto);
   - soma de `breached` = KPI `atrasos_salao` (mesmo filtro);
   - `pct_ok` conferido à mão;
   - filtro por estação respeitado;
   - recálculo (D2): mudar tolerância via `PUT /admin/settings/pickup-tolerance`,
     aguardar o background e conferir que flags/minutos foram reescritos; eventos
     em `demand_events` inalterados; restaurar tolerância original.
4. E2E Playwright (`outputs/dashboard-sla-retirada/`):
   - painel presente ao lado do de fila, título/subtítulo/tolerância, ordenação,
     valores das barras e cores;
   - expandir/colapsar por clique e por teclado; colunas e linhas do detalhe
     batendo com a fixture; screenshot de cada estado (dark e light);
   - estado sem estouros e estado sem retiradas (painel oculto);
   - exportação PDF: download gerado + seção nova presente no relatório;
   - exportação Excel: abas novas presentes com as linhas da fixture.
5. Auditoria visual: prints do painel fechado/expandido nos dois temas, comparados
   com o painel de cozinha (tipografia, espaçamento, cores, barras); iterar até
   ficar consistente.

## Fora do escopo

- Refactor compartilhado com o painel da cozinha (D4).
- Reescrever/limpar `demand_events` no recálculo (D3).
- Deploy em produção e commit (ordem explícita do usuário: local apenas).
