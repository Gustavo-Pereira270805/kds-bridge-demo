# Anulação por Passo com Cascata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O gerente anula passos específicos da timeline de cada demanda (retirada, pronta, cancelada, criação), com cascata automática dos passos posteriores, modal de aviso com motivo obrigatório e dispensa do aviso até o fim do turno.

**Architecture:** Novo endpoint `POST /api/v1/admin/demands/:id/annul-step` (herda o hook gerente/admin de `admin.ts`) recalcula o estado no servidor dentro de transação (nunca confia na lista do cliente), marca os eventos derrubados com `annulled_at/by/reason` (colunas novas via migration + patch no seed) e grava evento `step_rollback`; o `gerente.html` ganha botões por passo, modal dedicado e dispensa em `localStorage` por data BRT.

**Tech Stack:** Fastify + pg (`$1`, transação `BEGIN/COMMIT`, CAS por status), vanilla JS em `src/views/gerente.html`, `npx tsc --noEmit`, `npx ts-node --transpile-only`, skill `webwright` (`outputs/historico-real/final_runs/run_2/`).

## Global Constraints

- Todo o código, UI, mensagens de erro, comentários e docs novos em Brazilian Portuguese (pt-BR).
- TypeScript strict mode; tipos compartilhados em `src/types.ts`; queries pg com `$1` (nunca `?`).
- Ao adicionar migration, espelhar o patch no `seedDatabase()` em `src/server.ts` para bancos existentes convergirem.
- RBAC: endpoint novo dentro de `admin.ts` (hook gerente/admin já cobre); nunca remover `io.use` nem salas por papel.
- Nunca `.catch(function() {})` vazio; render de tabela sempre em try/catch com erro visível.
- PowerShell: sem `node -e` inline e sem heredoc `<<`; scripts temporários `.ts`/`.py` + `npx ts-node --transpile-only`.
- `npx tsc --noEmit` zerado após qualquer mudança em `.ts`; mudança em `.ts` exige restart do dev (views HTML/JS valem sem restart).
- PROIBIDO commit, push ou deploy sem permissão explícita do usuário. Passos de "commit" = gate de revisão local.
- Dia/turno sempre em `America/Sao_Paulo` (BRT).

---

## File Structure

- Create: `supabase/migrations/2026-09-06-demand-events-step-rollback.sql` — colunas `annulled_at/by/reason` + tipo `step_rollback` no CHECK.
- Modify: `src/server.ts:231-250` — espelha colunas + CHECK no seed (padrão `shift_transfer`).
- Modify: `src/types.ts` — `DemandEventType` += `'step_rollback'`; `DemandEvent` e `DemandHistoryEvent` += `annulled_at/by/reason`.
- Modify: `src/routes/demands.ts` (bloco `/history` da feature anterior) — SELECT passa a trazer `e.annulled_at, e.annulled_by, e.annul_reason`.
- Modify: `src/routes/admin.ts:378-430` — novo `POST /demands/:id/annul-step` após a rota `/annul`.
- Modify: `src/views/gerente.html` — modal `stepAnnulModal`, botões por passo, dispensa, indicador, listener de socket.
- Create (temporário, remover no fim): `_tmp_annul_step.ts`.
- Create (evidência): `outputs/historico-real/final_runs/run_2/final_script.py` + screenshots + log.

---

### Task 1: Schema — colunas de anulação + evento `step_rollback` + tipos

**Files:**
- Create: `supabase/migrations/2026-09-06-demand-events-step-rollback.sql`
- Modify: `src/server.ts:231-250`
- Modify: `src/types.ts:154-185`
- Modify: `src/routes/demands.ts` (SELECT de eventos do `/history`)
- Test: restart do dev (seed aplica o patch) + `\d demand_events` lógico via API

**Interfaces:**
- Consumes: padrão do bloco `demand_events_event_type_check` em `src/server.ts:231-250`.
- Produces: colunas `annulled_at/by/reason` em `demand_events`; tipo `'step_rollback'` válido; `DemandHistoryEvent` com os 3 campos novos.

- [ ] **Step 1: Escrever a migration (failing = ainda não aplicada)**

```sql
-- Anulação por passo: marca passos derrubados sem apagar auditoria
ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annulled_at timestamptz NULL;
ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annulled_by text NULL;
ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annul_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demand_events_event_type_check'
      AND contype = 'c' AND conrelid = 'demand_events'::regclass
      AND pg_get_constraintdef(oid) LIKE '%step_rollback%'
  ) THEN
    ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
    ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
      CHECK (event_type IN (
        'created', 'marked_ready', 'retrieved',
        'cancelled_salao', 'cancelled_cozinha',
        'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
        'annulled', 'shift_transfer', 'step_rollback'
      ));
  END IF;
END $$;
```

- [ ] **Step 2: Confirmar RED (colunas ainda não existem no banco)**

Run: `npx ts-node --transpile-only -e` NÃO — proibido. Criar `_tmp_annul_step.ts` na Task 2 e rodar; nesta task, a prova RED é o próprio `tsc` falhando após o uso dos campos novos nos tipos? Não. RED real: tentar inserir `step_rollback` hoje viola o CHECK. Registrar: `INSERT INTO demand_events ... 'step_rollback'` → 400 do CHECK (via script da Task 2 Step 1, que cobre as Tasks 1+2).

- [ ] **Step 3: Espelhar o patch no seed (`src/server.ts`, após o bloco `$$` do `shift_transfer`)**

```ts
await client.query(
  `ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annulled_at timestamptz NULL`
);
await client.query(
  `ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annulled_by text NULL`
);
await client.query(
  `ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annul_reason text NULL`
);
await client.query(
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
         WHERE conname = 'demand_events_event_type_check'
         AND contype = 'c' AND conrelid = 'demand_events'::regclass
         AND pg_get_constraintdef(oid) LIKE '%step_rollback%'
     ) THEN
       ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
       ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
         CHECK (event_type IN (
           'created', 'marked_ready', 'retrieved',
           'cancelled_salao', 'cancelled_cozinha',
           'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
           'annulled', 'shift_transfer', 'step_rollback'
         ));
     END IF;
   END $$`
);
```

- [ ] **Step 4: Tipos (`src/types.ts`)**

```ts
export interface DemandEvent {
  id: string;
  demand_id: string;
  event_type: DemandEventType;
  actor: 'salao' | 'cozinha' | 'sistema' | null;
  notes: string | null;
  created_at: string;
  annulled_at: string | null;
  annulled_by: string | null;
  annul_reason: string | null;
}

export type DemandEventType =
  | 'created'
  | 'marked_ready'
  | 'retrieved'
  | 'cancelled_salao'
  | 'cancelled_cozinha'
  | 'stockout_reported'
  | 'sla_breach_cozinha'
  | 'sla_breach_salao'
  | 'annulled'
  | 'shift_transfer'
  | 'step_rollback';
```

E em `DemandHistoryEvent`, trocar o corpo para:

```ts
export interface DemandHistoryEvent {
  event_type: DemandEventType;
  actor: 'salao' | 'cozinha' | 'sistema' | null;
  notes: string | null;
  created_at: string;
  annulled_at: string | null;
  annulled_by: string | null;
  annul_reason: string | null;
}
```

- [ ] **Step 5: `/history` passa a selecionar os 3 campos**

No `SELECT e.demand_id, e.event_type, ...` do `/history`, trocar por:

```ts
const events = await query<{
  demand_id: string;
  event_type: DemandEventType;
  actor: 'salao' | 'cozinha' | 'sistema' | null;
  notes: string | null;
  created_at: string;
  annulled_at: string | null;
  annulled_by: string | null;
  annul_reason: string | null;
}>(
  `SELECT e.demand_id, e.event_type, e.actor, e.notes, e.created_at,
          e.annulled_at, e.annulled_by, e.annul_reason
   FROM demand_events e
   WHERE e.demand_id = ANY($1::uuid[])
   ORDER BY e.created_at ASC`,
  [ids]
);
```

E no `list.push(...)` incluir `annulled_at: e.annulled_at, annulled_by: e.annulled_by, annul_reason: e.annul_reason`; no `evs.unshift(...)` do `created` sintetizado, incluir `annulled_at: null, annulled_by: null, annul_reason: null`.

- [ ] **Step 6: Gate (SEM commit)**

Run: `npx tsc --noEmit` → exit 0. Restart do dev para o seed aplicar colunas + CHECK. `git diff --stat` mostra só os 4 arquivos. Não commitar.

---

### Task 2: Backend — `POST /admin/demands/:id/annul-step` com cascata

**Files:**
- Modify: `src/routes/admin.ts` (novo bloco após `/demands/:id/annul`, ~linha 430)
- Test: `_tmp_annul_step.ts`

**Interfaces:**
- Consumes: `pool`, `Demand` (`admin.ts:2`), `recomputeStationQueue`, `computeDailyScores` (já importados), hook gerente/admin (já cobre a rota nova).
- Produces: `POST /api/v1/admin/demands/:id/annul-step { step, reason }` → `200` demanda atualizada; `400` passo inválido/sem motivo/demanda já anulada; `404` inexistente; `409` passo incompatível com o estado ou corrida (CAS).

Regra por passo (servidor recalcula tudo; a lista do cliente é só exibição):

| step | exige status | novo status | limpa | eventos marcados | volta para |
|---|---|---|---|---|---|
| `retrieved` | `retrieved` | `ready` | `retrieved_at`, SLA salão | `retrieved`, `sla_breach_salao` | pronta (aguardando retirada) |
| `marked_ready` | `ready`/`retrieved` | `pending` | `ready_at`, `ready_out_of_order`, SLA cozinha (+ campos de retirada/SLA salão se havia) | `marked_ready`, `sla_breach_cozinha`, `retrieved`, `sla_breach_salao` | em preparo |
| `created` | qualquer exceto `annulled` | `annulled` | (via fluxo total) | — (usa evento `annulled`) | — (anulação total) |
| `cancelled_salao`/`cancelled_cozinha` | status igual ao step | `ready` se `ready_at` senão `pending` | `cancelled_at`, `cancel_reason`, `cancel_reason_id` | o próprio step | pronta/em preparo |

- [ ] **Step 1: Escrever o teste falhando (`_tmp_annul_step.ts`)**

```ts
// Roda com: npx ts-node --transpile-only _tmp_annul_step.ts
const BASE = 'http://localhost:3000';
const EMAIL = 'test_admin_pis_1788392701765@gmail.com';
const PASS = 'Teste123456!';

async function api(path: string, method: string, body: unknown, token: string): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function main(): Promise<void> {
  const login = await fetch(BASE + '/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (!login.ok) throw new Error('login falhou: ' + login.status);
  const { token } = (await login.json()) as { token: string };
  const get = async (path: string) => {
    const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
    return r.json();
  };
  const prods = (await get('/api/v1/products')) as any[];
  const prod = prods.find((p) => p.active && p.kitchen_station_id);
  if (!prod) throw new Error('sem produto ativo com estação');

  const created = await api('/api/v1/demands', 'POST', { product_id: prod.id, quantity: 1 }, token);
  if (created.status !== 201) throw new Error('criar falhou: ' + created.status);
  const id = created.json.id as string;
  const step = async (s: string, reason: string) =>
    api(`/api/v1/admin/demands/${id}/annul-step`, 'POST', { step, reason }, token);

  const noReason = await step('retrieved', '   ');
  if (noReason.status !== 400) throw new Error('sem motivo deveria dar 400, deu ' + noReason.status);
  const badStep = await step('zerada', 'teste');
  if (badStep.status !== 400) throw new Error('passo fato deveria dar 400, deu ' + badStep.status);

  await api(`/api/v1/demands/${id}/ready`, 'PATCH', {}, token);
  await api(`/api/v1/demands/${id}/retrieve`, 'PATCH', {}, token);
  const unRet = await step('retrieved', 'teste rollback retirada');
  if (unRet.status !== 200 || unRet.json.status !== 'ready') throw new Error('anular retirada deveria voltar a ready: ' + JSON.stringify(unRet.json));
  const unReady = await step('marked_ready', 'teste rollback pronta');
  if (unReady.status !== 200 || unReady.json.status !== 'pending') throw new Error('anular pronta deveria voltar a pending: ' + JSON.stringify(unReady.json));
  const unCreated = await step('created', 'teste rollback total');
  if (unCreated.status !== 200 || unCreated.json.status !== 'annulled') throw new Error('anular criação deveria anular total: ' + JSON.stringify(unCreated.json));

  const hist = (await get('/api/v1/demands/history')) as any[];
  const row = hist.find((d) => d.id === id);
  if (!row || !Array.isArray(row.events) || !row.events.some((e: any) => e.event_type === 'step_rollback')) {
    throw new Error('histórico sem evento step_rollback');
  }
  console.log('OK annul-step: cascata + step_rollback no histórico');
  process.exit(0);
}
main().catch((e: any) => { console.error('FALHOU (esperado no RED):', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar (RED)**

Run: `npx ts-node --transpile-only _tmp_annul_step.ts`
Expected: `FALHOU (esperado no RED)` com 404 (rota ainda não existe).

- [ ] **Step 3: Implementação mínima (`src/routes/admin.ts`, após o bloco `/annul`)**

```ts
// Demandas: anular passo específico com cascata (volta ao estado anterior)
fastify.post<{ Params: { id: string }; Body: { step?: string; reason?: string } }>(
  '/demands/:id/annul-step', async (request, reply) => {
  const client = await pool.connect();
  try {
    const { id } = request.params;
    const step = request.body?.step;
    const reason = request.body?.reason?.trim();
    const ANNULLABLE = ['created', 'marked_ready', 'retrieved', 'cancelled_salao', 'cancelled_cozinha'];
    if (!step || !ANNULLABLE.includes(step)) { client.release(); return reply.code(400).send({ error: 'Passo inválido para anulação' }); }
    if (!reason) { client.release(); return reply.code(400).send({ error: 'Informe o motivo da anulação' }); }

    const { rows: [demand] } = await client.query<Demand>('SELECT * FROM demands WHERE id = $1', [id]);
    if (!demand) { client.release(); return reply.code(404).send({ error: 'Demanda não encontrada' }); }
    if (demand.status === 'annulled') { client.release(); return reply.code(400).send({ error: 'Demanda já anulada' }); }

    const by = request.user?.email ?? 'gerente';
    const demandDate = new Date(demand.created_at).toISOString().split('T')[0];

    // Passo 'created' equivale à anulação total (mesmo efeito do botão Anular)
    if (step === 'created') {
      await client.query('BEGIN');
      const { rows: [annulled] } = await client.query<Demand>(
        `UPDATE demands SET status = 'annulled', annulled_at = NOW(), annulled_by = $1, annul_reason = $2
         WHERE id = $3 AND status != 'annulled' RETURNING *`,
        [by, reason, id]
      );
      if (!annulled) { await client.query('ROLLBACK'); client.release(); return reply.code(409).send({ error: 'Demanda mudou de estado, recarregue o histórico' }); }
      await client.query(
        `INSERT INTO demand_events (demand_id, event_type, actor, notes) VALUES ($1, 'annulled', 'sistema', $2)`,
        [id, reason]
      );
      await client.query('COMMIT');
      client.release();
      if (demand.kitchen_station_id) { recomputeStationQueue(demand.kitchen_station_id).catch((e) => request.log.error(e)); }
      computeDailyScores(demandDate).catch((e) => request.log.error(e));
      fastify.io.emit('demand:annulled', annulled);
      return annulled;
    }

    let setClauses: string[] = [];
    let cascade: string[] = [];
    let backTo = '';
    if (step === 'retrieved') {
      if (demand.status !== 'retrieved') { client.release(); return reply.code(409).send({ error: 'A retirada só pode ser anulada em demanda retirada' }); }
      setClauses = [`status = 'ready'`, `retrieved_at = NULL`, `sla_breached_salao = false`, `sla_breach_minutes_salao = NULL`];
      cascade = ['retrieved', 'sla_breach_salao'];
      backTo = 'pronta (aguardando retirada)';
    } else if (step === 'marked_ready') {
      if (demand.status !== 'ready' && demand.status !== 'retrieved') { client.release(); return reply.code(409).send({ error: 'A pronta só pode ser anulada em demanda pronta ou retirada' }); }
      setClauses = [`status = 'pending'`, `ready_at = NULL`, `ready_out_of_order = false`, `sla_breached_cozinha = false`, `sla_breach_minutes_cozinha = NULL`];
      cascade = ['marked_ready', 'sla_breach_cozinha', 'retrieved', 'sla_breach_salao'];
      if (demand.status === 'retrieved') {
        setClauses.push(`retrieved_at = NULL`, `sla_breached_salao = false`, `sla_breach_minutes_salao = NULL`);
      }
      backTo = 'em preparo';
    } else {
      if (demand.status !== step) { client.release(); return reply.code(409).send({ error: 'Este cancelamento não é o estado atual da demanda' }); }
      const reopen = demand.ready_at ? `'ready'` : `'pending'`;
      backTo = demand.ready_at ? 'pronta (aguardando retirada)' : 'em preparo';
      setClauses = [`status = ${reopen}`, `cancelled_at = NULL`, `cancel_reason = NULL`, `cancel_reason_id = NULL`];
      cascade = [step];
    }

    await client.query('BEGIN');
    const { rows: [updated] } = await client.query<Demand>(
      `UPDATE demands SET ${setClauses.join(', ')} WHERE id = $1 AND status = $2 RETURNING *`,
      [id, demand.status]
    );
    if (!updated) { await client.query('ROLLBACK'); client.release(); return reply.code(409).send({ error: 'Demanda mudou de estado, recarregue o histórico' }); }
    await client.query(
      `UPDATE demand_events SET annulled_at = NOW(), annulled_by = $2, annul_reason = $3
       WHERE demand_id = $1 AND event_type = ANY($4) AND annulled_at IS NULL`,
      [id, by, reason, cascade]
    );
    await client.query(
      `INSERT INTO demand_events (demand_id, event_type, actor, notes) VALUES ($1, 'step_rollback', 'sistema', $2)`,
      [id, `Passo '${step}' anulado por ${by}; voltou para ${backTo}. Motivo: ${reason}`]
    );
    await client.query('COMMIT');
    client.release();

    if (updated.kitchen_station_id) { recomputeStationQueue(updated.kitchen_station_id).catch((e) => request.log.error(e)); }
    computeDailyScores(demandDate).catch((e) => request.log.error(e));
    fastify.io.emit('demand:step-rollback', updated);
    return updated;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    request.log.error(error);
    reply.code(500).send({ error: 'Erro ao anular passo' });
  }
});
```

Notas: CAS via `WHERE id = $1 AND status = $2` (padrão das rotas de cancelamento); `stockout_reported`/`shift_transfer` nunca entram no `cascade` (fatos preservados); `cooking_started` é mantido (a demanda continua em preparo).

- [ ] **Step 4: GREEN**

Run: `npx ts-node --transpile-only _tmp_annul_step.ts` → `OK annul-step: ...`
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Gate (SEM commit)**

`git diff --stat` só com migration, `server.ts`, `types.ts`, `demands.ts`, `admin.ts`. Não commitar.

---

### Task 3: Painel — botões por passo + modal + dispensa até o fim do turno

**Files:**
- Modify: `src/views/gerente.html` (modal novo após `#annulModal`, `renderHistory`, bindings, socket)
- Test: dev local + Task 4

**Interfaces:**
- Consumes: `lastDemands`/`renderHistory`/`formatTime`/`showToast` existentes; `POST /api/v1/admin/demands/:id/annul-step` da Task 2.
- Produces: `openStepAnnulModal(demandId, step)`, dispensa `kds_stepannul_compact_<YYYY-MM-DD-BRT>`, evento `demand:step-rollback` recarrega o dia.

- [ ] **Step 1: Modal HTML (após o bloco `#annulModal`)**

```html
<div class="modal-overlay" id="stepAnnulModal">
    <div class="modal-card">
        <h3>Anular passo</h3>
        <p class="modal-hint"><strong id="stepAnnulInfo"></strong></p>
        <p class="modal-hint" id="stepAnnulCascade"></p>
        <div id="stepAnnulFullWarn">
            <p class="modal-hint">Os passos anulados permanecem visíveis no histórico, riscados, com o motivo registrado. A fila da estação e as notas do dia serão recalculadas.</p>
            <label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px;">
                <input type="checkbox" id="stepAnnulQuiet"> Não mostrar este aviso até o fim do turno
            </label>
        </div>
        <label for="stepAnnulReason">Motivo da anulação *</label>
        <textarea id="stepAnnulReason" rows="3" placeholder="Ex: cliente desistiu do item, erro de lançamento..."></textarea>
        <div class="modal-error" id="stepAnnulError" style="display:none;"></div>
        <div class="modal-actions">
            <button type="button" class="btn-modal-cancel" id="stepAnnulCancel">Voltar</button>
            <button type="button" class="btn-modal-danger" id="stepAnnulConfirm" disabled>Confirmar anulação</button>
        </div>
    </div>
</div>
```

- [ ] **Step 2: JS — dispensa, rótulos e abertura**

```js
var stepAnnulTarget = null; // { id: string, step: string }
var STEP_FALL_LABELS = { created: 'criação', marked_ready: 'pronta', retrieved: 'retirada pelo salão', cancelled_salao: 'cancelada (salão)', cancelled_cozinha: 'cancelada (cozinha)' };
var STEP_BACK_LABELS = { created: 'anulação total', marked_ready: 'em preparo', retrieved: 'pronta (aguardando retirada)', cancelled_salao: 'estado anterior', cancelled_cozinha: 'estado anterior' };
function todayBRT() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function stepAnnulQuietKey() { return 'kds_stepannul_compact_' + todayBRT(); }
function isStepAnnulQuiet() { try { return window.localStorage.getItem(stepAnnulQuietKey()) === '1'; } catch (e) { return false; } }
function refreshWarnToggle() {
    var el = document.getElementById('historyWarnToggle');
    if (!el) return;
    if (isStepAnnulQuiet()) { el.style.display = ''; el.textContent = 'Avisos resumidos até o fim do turno — mostrar completos'; }
    else { el.style.display = 'none'; }
}
function stepApplies(d, type) {
    if (d.status === 'annulled') return false;
    if (type === 'created') return true;
    if (type === 'marked_ready') return !!d.ready_at || d.status === 'ready' || d.status === 'retrieved';
    if (type === 'retrieved') return !!d.retrieved_at;
    if (type === 'cancelled_salao' || type === 'cancelled_cozinha') return d.status === type;
    return false;
}
function openStepAnnulModal(demandId, step) {
    var demand = null;
    for (var i = 0; i < lastDemands.length; i++) { if (lastDemands[i].id === demandId) { demand = lastDemands[i]; break; } }
    if (!demand) return;
    stepAnnulTarget = { id: demandId, step: step };
    var falls = [];
    var seen = false;
    (demand.events || []).forEach(function(e) {
        if (e.annulled_at) return;
        if (e.event_type === step) { seen = true; return; }
        if (seen && STEP_FALL_LABELS[e.event_type]) falls.push(STEP_FALL_LABELS[e.event_type]);
    });
    var info = document.getElementById('stepAnnulInfo');
    if (info) info.textContent = '#' + pad3(demand.daily_seq) + ' ' + demand.product_name + ' — anular: ' + (EVENT_LABELS[step] || step);
    var casc = document.getElementById('stepAnnulCascade');
    if (casc) casc.textContent = 'Vai voltar para ' + (STEP_BACK_LABELS[step] || 'o estado anterior') + (falls.length ? '; cairão juntos: ' + falls.join(', ') + '.' : '.');
    var quiet = isStepAnnulQuiet();
    var full = document.getElementById('stepAnnulFullWarn');
    if (full) full.style.display = quiet ? 'none' : '';
    var chk = document.getElementById('stepAnnulQuiet');
    if (chk) chk.checked = false;
    var ta = document.getElementById('stepAnnulReason');
    if (ta) ta.value = '';
    var btn = document.getElementById('stepAnnulConfirm');
    if (btn) btn.disabled = true;
    var err = document.getElementById('stepAnnulError');
    if (err) err.style.display = 'none';
    var modal = document.getElementById('stepAnnulModal');
    if (modal) modal.style.display = 'flex';
    refreshWarnToggle();
}
function closeStepAnnulModal() {
    var modal = document.getElementById('stepAnnulModal');
    if (modal) modal.style.display = 'none';
    stepAnnulTarget = null;
}
```

- [ ] **Step 3: Botões por passo + estilo de anulado (dentro de `renderHistory`)**

No `steps` de cada demanda, trocar o `<li>` por:

```js
var ANNUL_STEPS = { created: 1, marked_ready: 1, retrieved: 1, cancelled_salao: 1, cancelled_cozinha: 1 };
var steps = (d.events || []).map(function(e) {
    var label = esc(EVENT_LABELS[e.event_type] || e.event_type);
    if (e.annulled_at) {
        return '<li class="step-annulled"><span class="mono">' + formatTime(e.created_at) + '</span> <strong>' + label + '</strong> <span>· ' + esc(ACTOR_LABELS[e.actor] || '—') + '</span><br><small>anulado ' + formatTime(e.annulled_at) + (e.annul_reason ? ' — ' + esc(e.annul_reason) : '') + '</small></li>';
    }
    var btn = (ANNUL_STEPS[e.event_type] && stepApplies(d, e.event_type))
        ? ' <button type="button" class="btn-step-annul" data-id="' + d.id + '" data-step="' + e.event_type + '">Anular passo</button>'
        : '';
    return '<li><span class="mono">' + formatTime(e.created_at) + '</span> <strong>' + label + '</strong> <span>· ' + esc(ACTOR_LABELS[e.actor] || '—') + '</span>' + (e.notes ? '<br><small>' + esc(e.notes) + '</small>' : '') + btn + '</li>';
}).join('');
```

Adicionar ao `<style>` do gerente:

```css
.step-annulled { text-decoration: line-through; opacity: 0.65; }
.btn-step-annul { margin-left: 8px; font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(239,68,68,.5); background: transparent; color: #f87171; cursor: pointer; }
```

E na barra `.history-controls`, após o botão Exportar:

```html
<button type="button" id="historyWarnToggle" class="btn-dashboard" style="display:none;"></button>
```

- [ ] **Step 4: Bindings (no bloco de bindings, sem remover os existentes)**

```js
historyTableBody.addEventListener('click', function(e) {
    var stepBtn = e.target.closest('.btn-step-annul');
    if (stepBtn && stepBtn.dataset.id && stepBtn.dataset.step) { openStepAnnulModal(stepBtn.dataset.id, stepBtn.dataset.step); return; }
    // ... manter btn-annul e toggle da linha como estão
});
```

Acrescentar (junto aos demais bindings do histórico):

```js
var stepAnnulReason = document.getElementById('stepAnnulReason');
if (stepAnnulReason) stepAnnulReason.addEventListener('input', function() {
    var btn = document.getElementById('stepAnnulConfirm');
    if (btn) btn.disabled = stepAnnulReason.value.trim().length === 0;
});
var stepAnnulCancel = document.getElementById('stepAnnulCancel');
if (stepAnnulCancel) stepAnnulCancel.addEventListener('click', closeStepAnnulModal);
var stepAnnulModal = document.getElementById('stepAnnulModal');
if (stepAnnulModal) stepAnnulModal.addEventListener('click', function(e) {
    if (e.target === stepAnnulModal) closeStepAnnulModal();
});
var stepAnnulConfirm = document.getElementById('stepAnnulConfirm');
if (stepAnnulConfirm) stepAnnulConfirm.addEventListener('click', function() {
    var ta = document.getElementById('stepAnnulReason');
    var reason = ta ? ta.value.trim() : '';
    if (!reason || !stepAnnulTarget) return;
    stepAnnulConfirm.disabled = true;
    api('/api/v1/admin/demands/' + stepAnnulTarget.id + '/annul-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepAnnulTarget.step, reason: reason })
    }).then(function() {
        var chk = document.getElementById('stepAnnulQuiet');
        if (chk && chk.checked) { try { window.localStorage.setItem(stepAnnulQuietKey(), '1'); } catch (e) {} }
        closeStepAnnulModal();
        refreshWarnToggle();
        fetchHistory();
        fetchMetrics();
        showToast('Passo anulado com sucesso.', 'info');
    }).catch(function(err) {
        stepAnnulConfirm.disabled = false;
        var el = document.getElementById('stepAnnulError');
        if (el) { el.textContent = err.message; el.style.display = 'block'; }
    });
});
var historyWarnToggle = document.getElementById('historyWarnToggle');
if (historyWarnToggle) historyWarnToggle.addEventListener('click', function() {
    try { window.localStorage.removeItem(stepAnnulQuietKey()); } catch (e) {}
    refreshWarnToggle();
    showToast('Avisos completos reativados.', 'info');
});
```

E nos sockets, acrescentar: `socket.on('demand:step-rollback', refreshAll);`. Chamar `refreshWarnToggle()` dentro de `refreshAll()` (ou após `fetchHistory()` inicial).

- [ ] **Step 5: Gate (SEM commit)**

Abrir `/gerente` no dev e conferir visualmente antes da Task 4. `git diff --stat` só com `gerente.html` além das Tasks 1–2.

---

### Task 4: Validação webwright (run_2) + tsc + limpeza, SEM subir

**Files:**
- Create: `outputs/historico-real/final_runs/run_2/final_script.py`, `screenshots/`, `final_script_log.txt`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: Tasks 1–3 + login gerente de teste.
- Produces: CPs abaixo todos com screenshot + log.

```
# Critical Points (run_2)
- [ ] CP1: modal de anular passo abre com destino + cascata ("vai voltar para...; cairão juntos...")
- [ ] CP2: sem motivo o confirmar fica desabilitado; com motivo, a retirada volta a pronta
- [ ] CP3: timeline risca os passos caídos com "anulado HH:MM — motivo" e step_rollback aparece
- [ ] CP4: marcar "não mostrar até o fim do turno" transforma o próximo em modal compacto (só motivo)
- [ ] CP5: anular a pronta de demanda retirada a devolve a em preparo (cascata total até a cozinha)
```

- [ ] **Step 1: Setup via API no próprio script** (criar demanda, `ready`, `retrieve` com o token gerente) e depois dirigir `/gerente`: expandir, clicar `Anular passo` da retirada.
- [ ] **Step 2: Executar e self-verify lendo cada PNG** (exigência webwright). Falha em qualquer CP → corrigir, `run_3`, re-verificar.
- [ ] **Step 3: `npx tsc --noEmit`** → exit 0.
- [ ] **Step 4: Limpeza + handoff SEM commit/push/deploy**: `Remove-Item _tmp_annul_step.ts`; `git status --short` só com os arquivos do plano; chamar o usuário para avaliar no dev e autorizar (ou não) o commit.

---

## Self-Review

1. **Spec coverage:** cadeia retirada→pronta→preparo→total + reabrir cancelada (Task 2); botões por passo incl. cancelada, fatos sem botão (Task 3); cascata com lista no modal (Tasks 2–3); motivo sempre obrigatório (Tasks 2–3); dispensa até o fim do turno com compacto + reativação (Task 3); auditoria sem apagar + step_rollback (Tasks 1–2); fila/notas/socket (Task 2). Total.
2. **Placeholder scan:** sem `TBD/TODO/"similar à Task N"` — SQL/TS/JS e comandos completos em cada passo. Corrigido inline.
3. **Type consistency:** `step_rollback` e `annulled_at/by/reason` com os mesmos nomes em migration, seed, tipos, SELECT do history, endpoint e frontend (`e.annulled_at`, `annul_reason`).
