# Devolução pelo Salão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir ao salão devolver demanda `ready` ao preparo (`pending`), com +2 min de SLA, evento `returned_to_kitchen`, detrator novo "Devolvidas pelo salão" (peso 0,20) nas notas, card devolvido com visual próprio, modal com motivo+observação opcionais, e busca digitável no campo de unidade.

**Architecture:** Endpoint dedicado `POST /demands/:id/return-to-kitchen` cuja transação espelha o `annul-step` do gerente (ready→pending + anulação dos eventos do passo), acrescido de `sla_minutes += 2`, contador de devoluções na demanda e nova categoria no `performance.service` (colunas novas, sem reaproveitar `slow_items`). UI segue os padrões existentes (modal do salão, `stockout-label` das cozinhas, dropdown de produtos).

**Tech Stack:** TypeScript strict (Fastify + pg `$1`), Postgres/Supabase com migration versionada + espelho no `seedDatabase`, HTML/CSS/JS vanilla, verificação via scripts Python (`urllib`) e Playwright Firefox em `outputs/devolucao-salao/`.

## Global Constraints

- Todo código, UI, mensagens e docs em pt-BR.
- TypeScript strict; `npx tsc --noEmit` limpo após qualquer mudança em `.ts`.
- SQL sempre com placeholders `$1` (nunca `?`); nunca `.catch(function(){})` vazio — sempre log + estado de erro na UI.
- **NÃO commitar, NÃO dar push, NÃO deployar sem autorização explícita do usuário.** Cada task termina em verificação, nunca em commit.
- Servidor dev na porta **3100** (3000 é outro projeto — não matar). `KDS_KIOSK_IPS` inclui `127.0.0.1`: da máquina dev, rotas `requireKitchen` passam sem token; rotas `/admin/*` e `/analytics/*` exigem `Authorization: Bearer <token admin>`.
- Subir Postgres: `Start-Process cmd -ArgumentList "/c `"$env:TEMP\opencode\start-pg.bat`"" -WindowStyle Minimized`. Subir dev: `$env:PORT='3100'; $env:KDS_KIOSK_IPS='127.0.0.1,::1,::ffff:127.0.0.1'` + `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`, depois sondar `curl.exe -s http://localhost:3100/health` em loop (nunca `Start-Job`; se a porta travar, `taskkill` no PID de `Get-NetTCPConnection -LocalPort 3100`). `.ts` exige restart; HTML/CSS/JS valem sem restart.
- PowerShell: nunca `node -e` inline; SQL com acento só via arquivo UTF-8 + `psql -f`; `curl.exe -d` inline quebra JSON — usar `-d @arquivo`.
- Python dos scripts: `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe` com `sys.stdout.reconfigure(encoding='utf-8', errors='replace')`; `urllib` OMITINDO `Content-Type` quando não há body.
- Login admin de teste: `gustanpereira@gmail.com` / `Gp#270805` (nunca commitar). Páginas gerente/admin/dashboard no Playwright: obter token via `POST /api/v1/auth/login` e injetar `sessionStorage.setItem('kds_token_session', token)` antes do `goto`.
- Dados de teste com `notes LIKE 'QA-DEVOL-%'`; manter para conferência; ao final de cada script, anular (mesmo dia) via `POST /api/v1/admin/demands/:id/annul` com token admin.
- Arquivo SQL da migration em ASCII puro (sem acentos) para o `psql` não manglar nada.

---

## File Structure

| Arquivo | Responsabilidade nesta feature |
|---|---|
| `supabase/migrations/2026-09-15-devolucao-pelo-salao.sql` (novo) | DDL idempotente: 4 colunas em `demands`, 2 em `performance_scores`, peso `score_weight_returned`, tipo de evento novo |
| `supabase/schema.sql` | Acrescentar `returned_to_kitchen` ao CHECK inline de `demand_events` (linha ~167) |
| `src/server.ts` | Espelhar o patch no `seedDatabase` (após o bloco `step_rollback`, ~linha 396) |
| `src/types.ts` | `Demand` += 3 campos; `DemandEventType` += `'returned_to_kitchen'`; `PerformanceWeights.returned`; `PerformanceScoreRow`/`EntityScore` += 2 campos |
| `src/services/performance.service.ts` | Peso novo, contagem por estação/dia, `capDeductions` com 4ª categoria, `upsertScore`, agregados, `buildDetractors`, `getDetractorDates` |
| `src/routes/admin.ts` | `PUT /settings/weights` aceita `returned` |
| `src/routes/analytics.ts` | Blocos `current` e `average` do `/performance` com os campos novos |
| `src/routes/demands.ts` | `POST /:id/return-to-kitchen` (importar `pool`) |
| `src/views/salao.html` | Botão Reportar + `reportModal` + card `.returned` + handler `demand:returned` + busca de unidades |
| `src/views/cozinha.html`, `cozinha-quente.html`, `cozinha-fria.html` | Classe `.returned` + faixa `returned-label` nos cards `pending` |
| `src/views/gerente.html` | `EVENT_LABELS` + refetch no `demand:returned` |
| `src/views/admin.html` | Campo `weightReturned` no painel de pesos |
| `src/views/dashboard.html` | Linha do peso no modal de critérios + `demand:returned` na lista de reload |
| `outputs/devolucao-salao/valida_devolucao.py` (novo) | Verificação API/DB/notas da Task 3 |
| `outputs/devolucao-salao/e2e_*.py` (novos) | Verificação Playwright das Tasks 4–6 |

Task 6 (unidades) é independente e pode ir ao ar separada. Ordem sugerida: 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

### Task 1: Banco + tipos

**Files:**
- Create: `supabase/migrations/2026-09-15-devolucao-pelo-salao.sql`
- Modify: `supabase/schema.sql` (CHECK da linha ~167), `src/server.ts` (após bloco `step_rollback`), `src/types.ts` (Demand, DemandEventType, PerformanceWeights, PerformanceScoreRow, EntityScore)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: colunas `demands.returned_to_kitchen_count/at/reason/observation`, `performance_scores.returned/returned_deduction`, setting `score_weight_returned='0.2'`, evento `returned_to_kitchen` válido no CHECK; tipos TS usados pelas Tasks 2–3.

- [ ] **Step 1: Escrever a checagem de ausência (vai falhar)**

Criar `%TEMP%\opencode\check-devol-ddl.sql` com:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'demands' AND column_name LIKE 'returned\_to\_kitchen\_%' ORDER BY 1;
SELECT column_name FROM information_schema.columns
WHERE table_name = 'performance_scores' AND column_name IN ('returned','returned_deduction') ORDER BY 1;
SELECT value FROM system_settings WHERE key = 'score_weight_returned';
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'demand_events_event_type_check';
```
Run:
```powershell
$env:PGPASSWORD='kds_local_123'; & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U kds -d kds -f "$env:TEMP\opencode\check-devol-ddl.sql"
```
Expected: primeira query 0 linhas, segunda 0 linhas, terceira 0 linhas (colunas ainda não existem).

- [ ] **Step 2: Criar a migration** `supabase/migrations/2026-09-15-devolucao-pelo-salao.sql` (ASCII puro):
```sql
-- Devolucao pelo salao: contador e auditoria por demanda + categoria nas notas
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_count int NOT NULL DEFAULT 0;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_at timestamptz NULL;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_reason text NULL;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_observation text NULL;

ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS returned int NOT NULL DEFAULT 0;
ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS returned_deduction numeric NOT NULL DEFAULT 0;

INSERT INTO system_settings (key, value) VALUES ('score_weight_returned', '0.2')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demand_events_event_type_check'
      AND contype = 'c' AND conrelid = 'demand_events'::regclass
      AND pg_get_constraintdef(oid) LIKE '%returned_to_kitchen%'
  ) THEN
    ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
    ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
      CHECK (event_type IN (
        'created', 'marked_ready', 'retrieved',
        'cancelled_salao', 'cancelled_cozinha',
        'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
        'annulled', 'shift_transfer', 'step_rollback', 'returned_to_kitchen'
      ));
  END IF;
END $$;
```

- [ ] **Step 3: Aplicar no banco local e rodar a checagem (agora passa)**

Run:
```powershell
$env:PGPASSWORD='kds_local_123'; & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U kds -d kds -f supabase/migrations/2026-09-15-devolucao-pelo-salao.sql
$env:PGPASSWORD='kds_local_123'; & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U kds -d kds -f "$env:TEMP\opencode\check-devol-ddl.sql"
```
Expected: 4 colunas em `demands`, 2 em `performance_scores`, `0.2`, CHECK contendo `returned_to_kitchen`.

- [ ] **Step 4: Atualizar `supabase/schema.sql`** — na linha do CHECK de `demand_events` (~167), acrescentar `'returned_to_kitchen'` à lista (mesma ordem da migration).

- [ ] **Step 5: Espelhar no `seedDatabase` (`src/server.ts`, após o bloco `step_rollback` ~linha 396)**

Inserir:
```ts
// Devolução pelo salão: colunas de contagem + tipo returned_to_kitchen (espelha supabase/migrations/2026-09-15-devolucao-pelo-salao.sql)
await client.query(
  `ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_count int NOT NULL DEFAULT 0`
);
await client.query(
  `ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_at timestamptz NULL`
);
await client.query(
  `ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_reason text NULL`
);
await client.query(
  `ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_observation text NULL`
);
await client.query(
  `ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS returned int NOT NULL DEFAULT 0`
);
await client.query(
  `ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS returned_deduction numeric NOT NULL DEFAULT 0`
);
await client.query(
  `INSERT INTO system_settings (key, value) VALUES ('score_weight_returned', '0.2') ON CONFLICT (key) DO NOTHING`
);
await client.query(
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
         WHERE conname = 'demand_events_event_type_check'
         AND contype = 'c' AND conrelid = 'demand_events'::regclass
         AND pg_get_constraintdef(oid) LIKE '%returned_to_kitchen%'
     ) THEN
       ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
       ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
         CHECK (event_type IN (
           'created', 'marked_ready', 'retrieved',
           'cancelled_salao', 'cancelled_cozinha',
           'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
           'annulled', 'shift_transfer', 'step_rollback', 'returned_to_kitchen'
         ));
     END IF;
   END $$`
);
```

- [ ] **Step 6: Atualizar `src/types.ts`**

a) Em `DemandEventType`, acrescentar `| 'returned_to_kitchen'` após `'step_rollback'`.
b) Em `Demand`, após `annul_reason: string | null;`, acrescentar:
```ts
returned_to_kitchen_count: number;
returned_to_kitchen_at: string | null;
returned_to_kitchen_reason: string | null;
returned_to_kitchen_observation: string | null;
```
c) Em `PerformanceWeights`, acrescentar `returned: number;` após `stockout_salao: number;`.
d) Em `PerformanceScoreRow` e em `EntityScore`, acrescentar após `stockout_deduction`:
```ts
returned: number;
returned_deduction: number;
```

- [ ] **Step 7: Typecheck + boot**

Run: `npx tsc --noEmit` (Expected: limpo). Reiniciar o dev (`taskkill` na cadeia antiga se preciso, `npm run dev`, sondar `/health` até `{"status":"ok"`). Expected: boot sem erro de seed (o patch é idempotente sobre colunas já criadas no Step 3).

---

### Task 2: Detrator nas notas + pesos no admin

**Files:**
- Modify: `src/services/performance.service.ts`, `src/routes/admin.ts` (PUT `/settings/weights`), `src/routes/analytics.ts` (blocos `current` e `average` do `/performance`), `src/views/admin.html` (input + `loadWeights`/`saveWeights`), `src/views/dashboard.html` (`fields`, linha do modal, lista de reload)

**Interfaces:**
- Consumes: tipos da Task 1 (`PerformanceWeights.returned`, colunas novas).
- Produces: `getWeights(): Promise<PerformanceWeights>` com `returned`; `computeDailyScores(dateStr)` gravando `returned`/`returned_deduction` por estação/dia e agregados; `PUT /admin/settings/weights` aceitando `returned`; `/performance` expondo os campos; admin mostrando o campo "Devolvida pelo salão (cozinha)".

- [ ] **Step 1: `capDeductions` com 4ª categoria** — substituir a função (linhas 18-27) por:
```ts
function capDeductions(sla: number, canc: number, stock: number, ret: number): { sla: number; canc: number; stock: number; ret: number; total: number } {
  const total = sla + canc + stock + ret;
  if (total <= 5) return { sla, canc, stock, ret, total };
  const scale = 5 / total;
  // distribui proporcionalmente e corrige arredondamento no stock
  const s = round2(sla * scale);
  const c = round2(canc * scale);
  const r = round2(ret * scale);
  const st = round2(5 - s - c - r);
  return { sla: s, canc: c, stock: Math.max(0, st), ret: r, total: 5 };
}
```

- [ ] **Step 2: `getWeights`** — na lista `keys`, acrescentar `'score_weight_returned'`; no retorno, acrescentar `returned: valueOrDefault(map.score_weight_returned, 0.20),` após `stockout_salao`.

- [ ] **Step 3: `upsertScore`** — nova assinatura e SQL:
```ts
async function upsertScore(
  entity: string, dateStr: string, finalScore: number, total: number,
  slaBreaches: number, slaDed: number,
  cancellations: number, cancelDed: number,
  stockouts: number, stockDed: number,
  returned: number, returnedDed: number
): Promise<void> {
  await query(
     `INSERT INTO performance_scores (entity, date, base_score, final_score, total_demands,
       sla_breaches, sla_breach_deduction, cancellations, cancellation_deduction,
       stockouts, stockout_deduction, returned, returned_deduction, slow_items, slow_item_deduction, updated_at)
      VALUES ($1, $2, 5.0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, now())
      ON CONFLICT (entity, date) DO UPDATE SET
       final_score = EXCLUDED.final_score,
       total_demands = EXCLUDED.total_demands,
       sla_breaches = EXCLUDED.sla_breaches,
       sla_breach_deduction = EXCLUDED.sla_breach_deduction,
       cancellations = EXCLUDED.cancellations,
       cancellation_deduction = EXCLUDED.cancellation_deduction,
       stockouts = EXCLUDED.stockouts,
       stockout_deduction = EXCLUDED.stockout_deduction,
       returned = EXCLUDED.returned,
       returned_deduction = EXCLUDED.returned_deduction,
       slow_items = 0,
       slow_item_deduction = 0,
       updated_at = now()`,
     [entity, dateStr, finalScore, total,
      slaBreaches, slaDed, cancellations, cancelDed,
      stockouts, stockDed, returned, returnedDed]
   );
}
```

- [ ] **Step 4: Bloco das estações em `computeDailyScores`** — após o `total` (linha ~172-177), inserir:
```ts
const returnedCount = await safeCount(
  `SELECT COALESCE(SUM(returned_to_kitchen_count), 0)::int AS cnt FROM demands
   WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2
     AND status != 'annulled'`,
  [sid, dateStr]
);
```
Trocar o cálculo final por:
```ts
const slaDedRaw = round2(slaRows.reduce((sum, row) => {
  const factor = slaFactor(row.created_at, row.ready_at, Number(row.sla_minutes));
  return sum + penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max);
}, 0) + lateStockDed);
const cancelDedRaw = round2(cancellations * weights.cancellation_cozinha);
const stockDedRaw = 0; // Removido o peso para cozinha: "Zerou" não tira nota da cozinha
const returnedDedRaw = round2(returnedCount * weights.returned);
const cappedK = capDeductions(slaDedRaw, cancelDedRaw, stockDedRaw, returnedDedRaw);
const finalScore = Math.max(0, Math.round((5.0 - cappedK.total) * 10) / 10);

await upsertScore(entity, dateStr, finalScore, total,
  slaBreaches + lateStockBreaches, cappedK.sla, cancellations, cappedK.canc, stockouts, cappedK.stock,
  returnedCount, cappedK.ret);
```
Blocos salão e salão-jantar: trocar `capDeductions(x, y, z)` por `capDeductions(x, y, z, 0)` e acrescentar `, 0, 0` ao final das chamadas `upsertScore` (linhas ~231 e ~279).

- [ ] **Step 5: Agregado `operacao`** — no SELECT de `opLeaves`, acrescentar `returned, returned_deduction` à lista de colunas. Na função `eff`, somar `parseFloat(r.returned_deduction || '0')`. No `totalRaw`/`sumCat`, incluir a dedução nova. Substituir o trecho das médias por:
```ts
const avgSla = round2(sumCat((r) => r.sla_breach_deduction) / n * (scale || 1));
const avgCanc = round2(sumCat((r) => r.cancellation_deduction) / n * (scale || 1));
const avgStock = round2(sumCat((r) => r.stockout_deduction) / n * (scale || 1));
const avgRet = round2(sumCat((r) => r.returned_deduction) / n * (scale || 1));
// Ajuste de arredondamento para garantir soma = avgEffDed
const adj = round2(avgEffDed - (avgSla + avgCanc + avgStock + avgRet));
const finalAvgStock = round2(avgStock + adj);
```
E na chamada `upsertScore('operacao', ...)`, acrescentar `sumInt((r) => r.returned), avgRet` antes do `finalAvgStock` (mantendo a ordem dos parâmetros: `..., stockouts, stockDed, returned, returnedDed`).

- [ ] **Step 6: Agregado `cozinha_geral`** — no SELECT de `stationRows`, acrescentar `SUM(returned)::int AS returned,` e `AVG(returned_deduction) AS returned_deduction,`; na chamada, acrescentar `parseInt(agg.returned || '0', 10), parseFloat(agg.returned_deduction || '0'),` após o `stockout_deduction`.

- [ ] **Step 7: `buildDetractors`** — trocar o `Pick` para incluir `'returned' | 'returned_deduction'`; ler `const returned = Number(score.returned) || 0;` e `const returnedDeduction = Number(score.returned_deduction) || 0;`; inserir antes do `sort`:
```ts
if (returned > 0) {
  list.push({ label: 'Devolvidas pelo salão', count: returned, deduction: returnedDeduction });
}
```

- [ ] **Step 8: `getDetractorDates` (ramo das cozinhas)** — após o bloco `lateStockRows.forEach` (linha ~496), inserir:
```ts
const returnedRows = await query<{
  id: string; product_name: string; created_at: string | Date;
  returned_to_kitchen_count: number; returned_to_kitchen_reason: string | null;
  returned_to_kitchen_observation: string | null; station: string;
}>(
  `SELECT d.id, d.product_name, d.created_at, d.returned_to_kitchen_count,
     d.returned_to_kitchen_reason, d.returned_to_kitchen_observation, ks.name AS station
   FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
   WHERE ks.code = $1 AND ${brDayOf('d.created_at')} >= $2 AND ${brDayOf('d.created_at')} <= $3
     AND d.returned_to_kitchen_count > 0 AND d.status != 'annulled'`,
  [stationCode, dateFrom, dateTo]
);
returnedRows.forEach(r => {
  const n = Number(r.returned_to_kitchen_count) || 0;
  const parts: string[] = [];
  const motivo = (r.returned_to_kitchen_reason || '').trim();
  const obs = (r.re
  const obs = (r.returned_to_kitchen_observation || '').trim();
      if (motivo) parts.push(`Motivo: ${motivo}`);
      if (obs) parts.push(`Obs.: ${obs}`);
      results.push({
        type: 'Devolvida pelo salão', date: formatDate(r.created_at),
        demand_id: r.id, product_name: r.product_name,
        detail: parts.length > 0 ? parts.join(' · ') : 'Sem motivo informado',
        deduction: round2(n * weights.returned),
        station: r.station,
      });
    });
  }
```
(`type` no singular por ocorrência — o dashboard renderiza `occ.type` como texto livre na tabela de ocorrências, sem agrupamento; o rótulo do detrator continua 'Devolvidas pelo salão' via `buildDetractors`. `deduction = count × peso`, como manda a spec §3.2.)

- [ ] **Step 9: `PUT /admin/settings/weights` (`src/routes/admin.ts`)** — no Body, acrescentar `returned: number;`; no array `values`, acrescentar `body.returned`; nas `queries`, acrescentar `{ key: 'score_weight_returned', val: round2(body.returned as number) },` após o `stockout_salao`. (A validação 0–5 e o recálculo retroativo já cobrem o campo novo.)

- [ ] **Step 10: `/performance` (`src/routes/analytics.ts`)** — no bloco `current`, acrescentar `returned: Number(row.returned),` e `returned_deduction: Number(row.returned_deduction),` após o `stockout_deduction`. No bloco `average`: somar `returned` (`rows.reduce`), acumular `sumEffRet` com `ret` incluído no `totalRaw`/`effective`/`scale`, e expor `returned,` + `returned_deduction: Math.round((sumEffRet / daysWithData) * 100) / 100,` no objeto `average`. (O `SELECT *` já traz as colunas novas; `buildDetractors(average)` passa a incluí-las pelo Pick atualizado.)

- [ ] **Step 11: campo no admin (`src/views/admin.html`)** — após o bloco do `weightStockoutSalao`, inserir bloco idêntico com label "Devolvida pelo salão (cozinha)" e `id="weightReturned"`; em `loadWeights`, `document.getElementById('weightReturned').value = data.returned;`; em `saveWeights`, `returned: parseFloat(document.getElementById('weightReturned').value),`.

- [ ] **Step 12: dashboard (`src/views/dashboard.html`)** — no `populateCriteriaModal`, após a linha "Zerado (cozinha)", acrescentar `'<tr><td>Devolvida pelo sal&atilde;o (cozinha)</td><td>&minus;' + formatPerfWeight(weights.returned) + ' por ocorr&ecirc;ncia</td></tr>'`. Na lista de reload por socket (~linha 2623), acrescentar `'demand:returned'` ao array. (Gráficos/exportações já renderizam qualquer label do servidor — nada mais a mudar, spec §3.6.)

- [ ] **Step 13: typecheck + boot + roundtrip de pesos**
Run: `npx tsc --noEmit` (Expected: limpo). Reiniciar o dev (porta 3100) e sondar `/health`.
Run: `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe "$env:TEMP\opencode\check-weights.py"` (login admin → GET weights com `returned == 0.2` → PUT `returned=0.99` → GET confirma → PUT restaura `0.2` → GET `/performance` com `returned`/`returned_deduction` em `current.operacao`).
Expected: 8 PASS, nenhuma falha.

---

### Task 3: Endpoint `POST /:id/return-to-kitchen`

**Files:**
- Modify: `src/routes/demands.ts` (importar `pool`; rota nova após o bloco `/stockout`)
- Create: `outputs/devolucao-salao/valida_devolucao.py`

**Interfaces:**
- Consumes: colunas/tipos da Task 1; `recomputeStationQueue`, `computeDailyScores`, `brDayFrom`, `getObservation`, `getStationRoom` (já importados/usados em `demands.ts`).
- Produces: `POST /api/v1/demands/:id/return-to-kitchen` público (sem `preHandler`, como `retrieve`/`stockout`); eventos `demand:returned` (sala da estação + `salao` + `gerente`) + `demand:queue-updated` global.

- [ ] **Step 1: importar `pool`** — trocar a linha 2 de `demands.ts` por `import { query, pool } from '../db/client';`.

- [ ] **Step 2: escrever a rota** (após o bloco `/stockout`, ~linha 795), espelhando `annul-step` + `stockout` (spec §3.3; mensagens exatas da spec §5):
```ts
  // Salão devolve demanda pronta ao preparo (público, kiosk fixo)
  fastify.post<{ Params: { id: string }; Body: { reason?: string; observation?: string } }>(
    '/:id/return-to-kitchen',
    async (request, reply) => {
      const client = await pool.connect();
      try {
        const { id } = request.params;
        const rawReason = request.body?.reason;
        const rawObs = request.body?.observation;
        const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
        const observation = typeof rawObs === 'string' ? rawObs.trim() : '';
        if (reason.length > 50) { client.release(); return reply.code(400).send({ error: 'Motivo com no máximo 50 caracteres' }); }
        if (observation.length > 80) { client.release(); return reply.code(400).send({ error: 'Observação com no máximo 80 caracteres' }); }
        const reasonDb = reason || null;
        const obsDb = observation || null;

        const { rows: [demand] } = await client.query<Demand>('SELECT * FROM demands WHERE id = $1', [id]);
        if (!demand) { client.release(); return reply.code(404).send({ error: 'Demanda não encontrada' }); }
        if (demand.status !== 'ready') { client.release(); return reply.code(409).send({ error: 'Só é possível devolver demandas prontas aguardando retirada' }); }

        // Guard de dia BRT (GET /demands lista ativas de qualquer dia)
        const { rows: [dayRow] } = await client.query<{ is_today: boolean }>(
          `SELECT ($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date AS is_today`,
          [demand.created_at]
        );
        if (!dayRow.is_today) { client.release(); return reply.code(403).send({ error: 'Só é possível devolver demandas do dia atual' }); }

        await client.query('BEGIN');
        const { rows: [updated] } = await client.query<Demand>(
          `UPDATE demands SET status = 'pending', ready_at = NULL, ready_out_of_order = false,
             sla_breached_cozinha = false, sla_breach_minutes_cozinha = NULL,
             sla_minutes = COALESCE(NULLIF(sla_minutes, 0), 10) + 2,
             expected_ready_at = now() + ((COALESCE(NULLIF(sla_minutes, 0), 10) + 2) * INTERVAL '1 minute'),
             returned_to_kitchen_count = returned_to_kitchen_count + 1,
             returned_to_kitchen_at = now(),
             returned_to_kitchen_reason = $2, returned_to_kitchen_observation = $3
           WHERE id = $1 AND status = 'ready' RETURNING *`,
          [id, reasonDb, obsDb]
        );
        if (!updated) { await client.query('ROLLBACK'); client.release(); return reply.code(409).send({ error: 'Demanda mudou de estado, recarregue o quadro' }); }
        await client.query(
          `UPDATE demand_events SET annulled_at = now(), annulled_by = 'salao', annul_reason = $2
           WHERE demand_id = $1 AND event_type IN ('marked_ready', 'sla_breach_cozinha') AND annulled_at IS NULL`,
          [id, reasonDb]
        );
        const noteParts: string[] = [];
        if (reason) noteParts.push(`Motivo: ${reason}`);
        if (observation) noteParts.push(`Obs.: ${observation}`);
        await client.query(
          `INSERT INTO demand_events (demand_id, event_type, actor, notes) VALUES ($1, 'returned_to_kitchen', 'salao', $2)`,
          [id, noteParts.length > 0 ? noteParts.join(' · ') : null]
        );
        await client.query('COMMIT');
        client.release();

        // Pós-commit: recompute ANTES dos emits (mesma ordem do stockout)
        const demandDate = brDayFrom(updated.created_at);
        if (updated.kitchen_station_id) { await recomputeStationQueue(updated.kitchen_station_id); }
        const [withName] = await query<Demand>(
          `SELECT d.*, rp.name AS replaced_name
           FROM demands d LEFT JOIN products rp ON rp.id = d.replaced_product_id
           WHERE d.id = $1`,
          [id]
        );
        computeDailyScores(demandDate).catch(err => request.log.error(err));
        // Segue ativa no quadro: reacopla a observação runtime (sem clearObservation)
        const out = getObservation(id) ? { ...withName, observation: getObservation(id) } : withName;
        const station = updated.kitchen_station_id
          ? await query<{ code: string }>(
              'SELECT code FROM kitchen_stations WHERE id = $1',
              [updated.kitchen_station_id]
            )
          : [];
        const room = station.length > 0 ? getStationRoom(station[0].code) : 'cozinha_quente';
        fastify.io.to(room).emit('demand:returned', out);
        fastify.io.to('salao').emit('demand:returned', out);
        fastify.io.to('gerente').emit('demand:returned', out);
        fastify.io.emit('demand:queue-updated');
        return out;
      } catch (error) {
        await client.query('ROLLBACK').catch((e) => request.log.error(e));
        client.release();
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao devolver demanda para a cozinha' });
      }
    }
  );
```
Notas: `cooking_started`/`priority` NÃO mudam (spec §3.3); `SET` usa sempre o valor antigo da linha (sla novo = antigo + 2, ETA projetada do novo); `annulled_by='salao'`.

- [ ] **Step 3: typecheck + restart** — `npx tsc --noEmit` limpo; restart dev 3100; `/health` ok.

- [ ] **Step 4: escrever `outputs/devolucao-salao/valida_devolucao.py`** (padrão `valida_api.py`; `urllib` sem `Content-Type` quando sem body; token admin em tudo — `requireKitchen` aceita admin e o bypass de quiosque vale para localhost; `psql` com `$env:PGPASSWORD='kds_local_123'`). Fluxo:
  1. Login admin. `GET /api/v1/products/all` → primeiro produto ativo (guarda `station_id`, `sla_normal`). Cria demanda principal `notes='QA-DEVOL-<ts>'` via `POST /api/v1/demands` (`product_id`, `quantity: 1`).
  2. `PATCH /:id/ready` (token admin) → assert `status == 'ready'`; guarda `sla0 = sla_minutes`, `ready_at` não nulo.
  3. Backdate via psql (`UPDATE demands SET created_at = now() - interval '40 minutes'` na demanda) para forçar estouro; `PATCH /:id/ready` de novo? Não — já está ready. Em vez disso: **anular o passo** não; o fluxo certo é: backdate ANTES do ready. Ordem: cria → backdate 40 min → ready (gera `sla_breached_cozinha=true`) → devolve (motivo 'Ponto errado' + observação 'Voltar ao fogo') → asserts: `status == 'pending'`, `ready_at` nulo, `sla_minutes == sla0 + 2`, `returned_to_kitchen_count == 1`, `reason`/`observation` gravados, `sla_breached_cozinha == false`; eventos: existe `returned_to_kitchen` não anulado; `marked_ready` e `sla_breach_cozinha` com `annulled_at` não nulo e `annulled_by == 'salao'`.
  4. Re-pronta (`PATCH ready`) → `sla_breached_cozinha == true` de novo (created continua antigo; estouro soma por cima). `GET /performance` → entidade da estação com `returned >= 1`, `returned_deduction >= 0.20`, detrator `label == 'Devolvidas pelo salão'` com `count` igual ao `SUM(returned_to_kitchen_count)`; `detractor_dates[entidade]` contém `type == 'Devolvida pelo salão'`.
  5. 2ª devolução (sem motivo/observação → `notes` do evento nulo) → `count == 2`, `sla_minutes == sla0 + 4`, evento novo com `notes` nulo.
  6. Teto: `GET /performance` → `(5 - final_score) <= 5` na estação; auditoria SQL: `SELECT returned, returned_deduction, final_score FROM performance_scores WHERE entity + hoje` confere `returned == 2` e `returned_deduction == round(2 * peso, 2)` salvo cap proporcional (aceita menor se o teto atuou; falha se MAIOR).
  7. Erros (demandas separadas `QA-DEVOL-ERR-*`): uuid inexistente → 404; devolver `pending` (nunca pronta) → 409 com a mensagem da spec; motivo com 51 chars → 400; observação com 81 chars → 400; backdate 2 dias + devolve → 403 (limpa essa via `DELETE FROM demand_events` + `DELETE FROM demands` direto, pois a anulação é mesmo-dia-somente).
  8. Roundtrip de pesos: GET guarda `returned` original → PUT `0.35` → GET `== 0.35` → PUT restaura → GET confere.
  9. Limpeza: `POST /api/v1/admin/demands/:id/annul` (`{reason: 'QA devolucao'}`) nas demandas do dia; mantém os dados se algum assert falhar (para inspeção).
Expected: todos os PASS; nenhum FAIL; demandas de teste anuladas ao final.

- [ ] **Step 5: rodar o script** — `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe outputs/devolucao-salao/valida_devolucao.py`. Expected: saída toda PASS. Se `PATCH ready` der 401/403, conferir `KDS_KIOSK_IPS` do processo dev (precisa incluir o IP de origem do script).

---

### Task 4: Salão (botão Reportar + modal + card + socket)

**Files:**
- Modify: `src/views/salao.html` (CSS + card `ready` + `reportModal` + `renderDemands` + socket; sem restart)

**Interfaces:**
- Consumes: `POST /:id/return-to-kitchen` (Task 3); `demand:returned` + `demand:queue-updated` do servidor.
- Produces: botão "Reportar" nos cards `ready`; modal com motivo/observação; cards devolvidos com `.returned`; toast de sucesso/erro.

Âncoras (verificar números antes de editar): ações do card `ready` em `renderDemands` (~629-635); modais `cancelModal`/`confirmModal` (~371-392) como molde; CSS `.stockout-btn` (~120) e `.demand-card.stockout` (~149); socket `demand:queue-updated → loadActiveDemands` (~1218).

- [ ] **Step 1: CSS** — após `.demand-card.stockout`, acrescentar `.report-btn` (mesmo padrão do `.stockout-btn`, tom âmbar) e `.demand-card.returned` (fundo âmbar translúcido + filete `4px solid var(--c-warn)`, junto das variantes de tema claro/jantar) + `.returned-label` (faixa) + `.returned-detail` (linha motivo/obs).
- [ ] **Step 2: botão no card `ready`** — nas ações do card `ready`, ao lado de "Retirar", acrescentar `<button class="report-btn" onclick="openReportModal('<id>')">Reportar</button>`.
- [ ] **Step 3: `reportModal`** — molde `cancelModal`: título "Reportar Demanda"; texto "O pedido voltará para a cozinha para ser preparado novamente. A cozinha terá +2 min de prazo e será avaliada por isso."; inputs `reportReason` (maxlength 50, placeholder "Motivo (opcional)") e `reportObservation` (maxlength 80, placeholder "Observação (opcional)"); botões "Sim, devolver para a cozinha" (destaque, `confirmReport()`) e "Cancelar". `confirmReport()`: desabilita o botão, `POST /:id/return-to-kitchen` com `{reason, observation}` (vazios → strings vazias; o servidor normaliza para nulo), sucesso → fecha modal + `showToast('Demanda devolvida para a cozinha (+2 min de preparo).')`, erro → `showToast(err.message)`; reabilita no fim (sem `.catch` vazio).
- [ ] **Step 4: card devolvido** — em `renderDemands`, se `(d.returned_to_kitchen_count || 0) > 0`, classe `returned` + faixa `DEVOLVIDA PELO SALÃO` (+ `(Nx)` se `> 1`) + linha `.returned-detail` com motivo/observação (só as partes preenchidas), acima da `.obs-strip` do registro (que continua).
- [ ] **Step 5: socket** — `socket.on('demand:returned', ...)` atualiza/substitui a linha do card (mesmo tratamento dos demais eventos de demanda); `demand:queue-updated` já recarrega.
- [ ] **Step 6: `outputs/devolucao-salao/e2e_salao_report.py`** (Playwright Firefox headless, padrão `e2e_dashboard.py`; salão abre sem login de localhost; screenshots em `outputs/devolucao-salao/`): fluxo — cria demanda QA via API → cozinha marca pronta via API → abre `/salao`, aguarda card `ready` com botão "Reportar" → clica, preenche motivo+observação, confirma → toast de sucesso; card vira `pending.returned` com faixa + motivo/obs; recarrega a página e confere persistência. Expected: todos os asserts passam + screenshots.

---

### Task 5: Cozinhas ×3 + gerente

**Files:**
- Modify: `src/views/cozinha.html`, `src/views/cozinha-quente.html`, `src/views/cozinha-fria.html`, `src/views/gerente.html` (sem restart)

**Interfaces:**
- Consumes: campos `returned_to_kitchen_*` já presentes no payload das cozinhas (mesmo `GET /demands`); `demand:returned`/`demand:queue-updated` (reload já existente — nenhum handler novo).
- Produces: cards `pending` devolvidos com `.returned` + faixa + motivo/obs; gerente com label do evento e refetch.

Âncoras: padrão `if (d.stockout_reported) classes.push('stockout')` + `stockout-label` (`cozinha-quente.html` ~645-671, `cozinha-fria.html` ~521-547, `cozinha.html` ~406-450); CSS `.card.stockout` com tokens `--c-warn`/`--alert-warn-bg-*` (`theme.css` ~15/42); reload em `demand:queue-updated` (~663/913/787); gerente `EVENT_LABELS` (~466) + refetch no `demand:stockout` (~1112) como molde.

- [ ] **Step 1 (×3 cozinhas): card** — onde houver o `push('stockout')`, acrescentar `if ((d.returned_to_kitchen_count || 0) > 0) classes.push('returned')`; após a `stockout-label`, faixa `returned-label` "DEVOLVIDA PELO SALÃO" (+ `(Nx)`) + linha de motivo/observação acima da `.obs-strip`. CSS `.card.returned` espelhando `.card.stockout` (fundo/filete âmbar via tokens).
- [ ] **Step 2 (gerente):** `EVENT_LABELS` += `returned_to_kitchen: 'devolvida pelo salão'`; no socket, `demand:returned` dispara o mesmo refetch do `demand:stockout`. Status segue `pending` (nenhum mapa muda).
- [ ] **Step 3: `outputs/devolucao-salao/e2e_cozinha_devolvida.py`** — prepara demanda devolvida via API (cria → pronta → devolve com motivo), abre a cozinha da estação (sem login, localhost) e confere classe `.returned`, faixa `(1x)`/texto, motivo/obs; devolve 2ª vez e confere `(2x)`; screenshots.

---

### Task 6: Busca digitável no campo de unidade (independente)

**Files:**
- Modify: `src/views/salao.html` (HTML do `unitSelect` + `loadUnitsForProduct` + submit/reset; sem restart)

**Interfaces:**
- Consumes: `GET /api/v1/units/by-product/:productId` (inalterado); `unit_id`/`unit_label` do submit (inalterados).
- Produces: input digitável com dropdown filtrável no lugar do select puro.

Âncoras: `loadUnitsForProduct` (~847-868); submit lendo `unitSelect` (~1097-1188); dropdowns via `makeProductDropdown` (~909-950) como molde de classes (`.product-search-wrapper`/`.product-dropdown`).

- [ ] **Step 1: HTML** — envolver o `unitSelect` num `.product-search-wrapper`: `<input id="unitSearch" placeholder="Buscar unidade...">` + `unitSelect` oculto + `<div class="unit-dropdown product-dropdown">`. Sem produto → `unitSearch` disabled; produto sem unidade → item "Sem unidade".
- [ ] **Step 2: JS** — ao focar/digitar abre/filtra a lista no cliente (`toLowerCase`); escolher preenche input + `unitSelect`; limpar o input limpa a seleção; `loadUnitsForProduct` passa a popular input+dropdown (mantendo o `unitSelect` como fonte da verdade para o submit, que NÃO muda); reset pós-envio limpa input + seleção.
- [ ] **Step 3: `outputs/devolucao-salao/e2e_unidades.py`** — abre `/salao`, escolhe produto com unidades, digita filtro (lista reduz), escolhe item (input + submit coerentes), limpa (seleção limpa), produto sem unidade ("Sem unidade"); cria demanda QA com unidade e confere `unit_label` gravado; screenshots.

---

### Task 7: Gate final

- [ ] **Step 1: `npx tsc --noEmit`** — Expected: limpo.
- [ ] **Step 2: suítes antigas** — `outputs/dashboard-cancelamentos/valida_api.py` (Expected: 0 falhas) e `e2e_dashboard.py` (Expected: 63/63 ou o total vigente; screenshots novos NÃO sobrescrevem os antigos — sair em pasta própria).
- [ ] **Step 3: auditoria SQL das notas do dia** — via `psql`: para cada entidade com movimento, `final_score == max(0, round((5 - (sla+cancel+stock+returned capped)) * 10) / 10)`; `returned == SUM(returned_to_kitchen_count)` das demandas não anuladas da estação; `(5 - final_score) <= 5`. Expected: 0 divergências.
- [ ] **Step 4: `npm run build`** — Expected: sucesso (views copiadas para `dist/`).
- [ ] **Step 5: evidências + handoff** — saídas dos scripts e screenshots em `outputs/devolucao-salao/`; atualizar `docs/HANDOFF_DEVOLUCAO_2026-09-15.md` (§1 status, §2 git, §7 tasks concluídas). **Sem commit, sem push, sem deploy.**
