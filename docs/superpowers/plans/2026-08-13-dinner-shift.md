# Modo Jantar (Turno Noturno) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o Modo Jantar ao KDS Bridge: botão do gerente ativa turno noturno isolado (estação `jantar`, cardápio via overrides, sala socket própria, métricas isoladas em `cozinha_jantar`) e a tela da cozinha quente transiciona automaticamente na mesma janela.

**Architecture:** Overrides em `daily_menu_overrides` materializam o cardápio do jantar (produtos ativos da estação `jantar`). Estado do turno em `system_settings.shift_dinner_active_date` (comparado com `CURRENT_DATE` — reset implícito diário). Transferência de demandas `pending` para a estação jantar com evento `shift_transfer` em `demand_events`. Kiosk `/cozinha-quente` reage ao evento socket `shift:updated`.

**Tech Stack:** TypeScript (strict), Fastify, Socket.IO, pg/Supabase Postgres, HTML/CSS/JS vanilla (ES5 nas views), Playwright (Python, `py -m playwright`).

## Global Constraints

- **Toda UI copy, logs, erros e commits em pt-BR.** Views em **ES5 estrito** (`var`/`function()`, sem arrow/template literals/`let`).
- **Nunca** `.catch(function(){})` vazio — sempre `console.error` + estado de erro visível.
- `npx tsc --noEmit` é o único typecheck; rodar após toda mudança TS. `npm run build` antes de `npm start`.
- **Commits somente com autorização explícita do usuário** (regra do projeto). Os passos "Commit" abaixo são opcionais/sob aval.
- Eventos socket de fila (`demand:queue-updated`) são emitidos **após** o recompute da fila (gotcha do AGENTS.md).
- Não commitar secrets; não alterar arquivos fora da lista de cada task.
- Spec de referência: `docs/superpowers/specs/2026-08-13-dinner-shift-design.md`.

---

### Task 1: Migration + espelho no seed (estação jantar, setting, evento shift_transfer)

**Files:**
- Create: `supabase/migrations/2026-08-13-dinner-shift.sql`
- Modify: `src/server.ts:117-271` (`seedDatabase`)

**Interfaces:**
- Produces: estação `kitchen_stations.code='jantar'` (capacity 1, theme dark), `system_settings.key='shift_dinner_active_date'` (value ''), CHECK `demand_events_event_type_check` incluindo `'shift_transfer'`. Consumidos pelas Tasks 2-5.

- [ ] **Step 1: Criar a migration**

Criar `supabase/migrations/2026-08-13-dinner-shift.sql` com:

```sql
-- Modo Jantar: estação isolada do turno noturno
INSERT INTO kitchen_stations (code, name, capacity, theme)
VALUES ('jantar', 'Cozinha Jantar', 1, 'dark')
ON CONFLICT (code) DO NOTHING;

-- Estado do turno: data em que o jantar foi ativado ('' = inativo)
INSERT INTO system_settings (key, value)
VALUES ('shift_dinner_active_date', '')
ON CONFLICT (key) DO NOTHING;

-- Novo tipo de evento: transferência de demanda para o turno jantar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demand_events_event_type_check'
      AND contype = 'c'
      AND conrelid = 'demand_events'::regclass
      AND pg_get_constraintdef(oid) LIKE '%shift_transfer%'
  ) THEN
    ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
    ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
      CHECK (event_type IN (
        'created', 'marked_ready', 'retrieved',
        'cancelled_salao', 'cancelled_cozinha',
        'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
        'annulled', 'shift_transfer'
      ));
  END IF;
END $$;
```

- [ ] **Step 2: Espelhar no `seedDatabase()` (server.ts)**

Em `src/server.ts`, logo **antes** do bloco `const { rows: ksRows } = await client.query('SELECT id, code FROM kitchen_stations');` (linha ~151), inserir:

```ts
      // Espelho da migration dinner-shift: estação jantar + estado do turno + evento shift_transfer
      await client.query(
        `INSERT INTO kitchen_stations (code, name, capacity, theme)
         VALUES ('jantar', 'Cozinha Jantar', 1, 'dark')
         ON CONFLICT (code) DO NOTHING`
      );
      await client.query(
        `INSERT INTO system_settings (key, value)
         VALUES ('shift_dinner_active_date', '')
         ON CONFLICT (key) DO NOTHING`
      );
      await client.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conname = 'demand_events_event_type_check'
               AND contype = 'c' AND conrelid = 'demand_events'::regclass
               AND pg_get_constraintdef(oid) LIKE '%shift_transfer%'
           ) THEN
             ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
             ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
               CHECK (event_type IN (
                 'created', 'marked_ready', 'retrieved',
                 'cancelled_salao', 'cancelled_cozinha',
                 'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
                 'annulled', 'shift_transfer'
               ));
           END IF;
         END $$`
      );
```

- [ ] **Step 3: Verificar typecheck e aplicar no banco**

Run: `npx tsc --noEmit`
Expected: sem erros.

Aplicar a migration no Supabase SQL Editor (ou, em dev local, deixar o `seedDatabase` convergir no boot). Confirmar no banco:

```sql
SELECT code, name, capacity FROM kitchen_stations WHERE code = 'jantar';
SELECT value FROM system_settings WHERE key = 'shift_dinner_active_date';
```

- [ ] **Step 4: Commit (somente com autorização do usuário)**

```bash
git add supabase/migrations/2026-08-13-dinner-shift.sql src/server.ts
git commit -m "feat(jantar): migration e seed da estação jantar e estado do turno"
```

---

### Task 2: Tipos, serviço de turno, rota GET /shift/status e salas socket

**Files:**
- Modify: `src/types.ts:74-82` (DailyMenuEffective), `src/types.ts:138-147` (DemandEventType), `src/types.ts:266-272` (ProductSearchRow); adicionar tipos novos após `DailyMenuOverride` (~linha 72)
- Create: `src/services/shift.service.ts`
- Create: `src/routes/shift.ts`
- Modify: `src/server.ts:89-97` (registro da rota)
- Modify: `src/routes/demands.ts:10-13` (`getStationRoom`)
- Modify: `src/socket/handlers.ts:3-9` (`VALID_ROOMS`)

**Interfaces:**
- Produces:
  - `src/services/shift.service.ts` → `export async function getCurrentShift(): Promise<'lunch' | 'dinner'>`
  - `src/routes/shift.ts` → default export `shiftRoutes(fastify)` com `GET /status` → `{ shift: 'lunch' | 'dinner' }`
  - Sala socket `cozinha_jantar` válida; `getStationRoom('jantar') === 'cozinha_jantar'`
- Consumes: setting `shift_dinner_active_date` (Task 1).

- [ ] **Step 1: Tipos em src/types.ts**

Alterar `DailyMenuEffective` (linhas 74-82) — adicionar `station_code`:

```ts
export interface DailyMenuEffective {
  date: string;
  daily_menu_id: string;
  product_id: string;
  name: string;
  category: string;
  default_unit: string;
  origin: 'base' | 'manual_add';
  station_code?: string;
}
```

Alterar `DemandEventType` (linhas 138-147) — adicionar `'shift_transfer'`:

```ts
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
  | 'shift_transfer';
```

Alterar `ProductSearchRow` (linhas 266-272) — adicionar `station_code`:

```ts
export interface ProductSearchRow {
  id: string;
  name: string;
  category: string | null;
  kitchen_station_id: string | null;
  in_today_menu: boolean;
  station_code?: string;
}
```

Adicionar os tipos novos logo após `DailyMenuOverride` (~linha 72):

```ts
export interface ShiftStatus {
  shift: 'lunch' | 'dinner';
}

export interface StartDinnerResponse {
  shift: 'dinner';
  added_products: number;
  transferred_demands: number;
  pending_lunch_demands: number;
}
```

- [ ] **Step 2: Criar src/services/shift.service.ts**

```ts
import { query } from '../db/client';

export async function getCurrentShift(): Promise<'lunch' | 'dinner'> {
  const rows = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'shift_dinner_active_date'`
  );
  const activeDate = rows.length > 0 ? rows[0].value : '';
  const [{ today }] = await query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  return activeDate === today ? 'dinner' : 'lunch';
}
```

- [ ] **Step 3: Criar src/routes/shift.ts**

```ts
import { FastifyInstance } from 'fastify';
import { getCurrentShift } from '../services/shift.service';

export default async function shiftRoutes(fastify: FastifyInstance) {
  fastify.get('/status', async (request, reply) => {
    try {
      const shift = await getCurrentShift();
      return { shift };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao consultar turno atual' });
    }
  });
}
```

- [ ] **Step 4: Registrar a rota em src/server.ts**

Adicionar import junto aos demais (`import shiftRoutes from './routes/shift';`) e registrar após `stationThemeRoutes` (linha 95):

```ts
fastify.register(shiftRoutes, { prefix: '/api/v1/shift' });
```

- [ ] **Step 5: Sala socket jantar**

Em `src/routes/demands.ts` (linhas 10-13):

```ts
function getStationRoom(code: string): string {
  if (code === 'fria') return 'cozinha_fria';
  if (code === 'jantar') return 'cozinha_jantar';
  return 'cozinha_quente';
}
```

Em `src/socket/handlers.ts` (linhas 3-9):

```ts
const VALID_ROOMS = new Set([
  'salao',
  'cozinha_quente',
  'cozinha_fria',
  'cozinha_jantar',
  'cozinha',
  'gerente',
]);
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

Subir o servidor e testar:
```bash
Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized
```
(`taskkill` na instância antiga da porta 3000 se necessário). Depois:
```
curl http://localhost:3000/api/v1/shift/status
```
Expected: `{"shift":"lunch"}`

- [ ] **Step 7: Commit (somente com autorização do usuário)**

```bash
git add src/types.ts src/services/shift.service.ts src/routes/shift.ts src/server.ts src/routes/demands.ts src/socket/handlers.ts
git commit -m "feat(jantar): serviço de turno, rota de status e sala cozinha_jantar"
```

---

### Task 3: POST /api/v1/admin/shift/dinner (transição)

**Files:**
- Modify: `src/routes/admin.ts` (imports linhas 1-7; inserir rota após `PUT /daily-menu/:date`, ~linha 429)

**Interfaces:**
- Produces: `POST /api/v1/admin/shift/dinner` → `StartDinnerResponse` (types.ts, Task 2). Emite `menu:updated`, `shift:updated { shift: 'dinner' }`, `demand:queue-updated` (broadcast, após recompute).
- Consumes: `ensureTodayMenu` (menu.service), `recomputeStationQueue` (queue.service), `computeDailyScores` (performance.service), `pool` (db/client), estação jantar (Task 1).

- [ ] **Step 1: Adicionar imports em src/routes/admin.ts**

Linha 2 já importa `pool`. Adicionar `ensureTodayMenu` ao import de serviços (novo import, após a linha 7):

```ts
import { ensureTodayMenu } from '../services/menu.service';
```

- [ ] **Step 2: Inserir a rota após PUT /daily-menu/:date (após linha 429)**

```ts
  fastify.post('/shift/dinner', async (request, reply) => {
    const client = await pool.connect();
    try {
      const dailyMenuId = await ensureTodayMenu();

      const { rows: stationRows } = await client.query<{ id: string }>(
        `SELECT id FROM kitchen_stations WHERE code = 'jantar'`
      );
      if (stationRows.length === 0) {
        client.release();
        return reply.code(500).send({ error: 'Estação jantar não encontrada' });
      }
      const jantarId = stationRows[0].id;

      const [{ today }] = await client.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);

      await client.query('BEGIN');

      const { rows: addedRows } = await client.query(
        `INSERT INTO daily_menu_overrides (daily_menu_id, product_id, action, reason)
         SELECT $1, p.id, 'add', 'Turno jantar ativado'
         FROM products p
         WHERE p.active = true AND p.kitchen_station_id = $2
         ON CONFLICT (daily_menu_id, product_id) DO NOTHING
         RETURNING id`,
        [dailyMenuId, jantarId]
      );

      const { rows: sourceRows } = await client.query<{ kitchen_station_id: string | null }>(
        `SELECT DISTINCT kitchen_station_id FROM demands
         WHERE status = 'pending' AND created_at::date = $1 AND kitchen_station_id <> $2`,
        [today, jantarId]
      );

      const { rows: countRows } = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::int AS cnt FROM demands
         WHERE status = 'pending' AND created_at::date = $1 AND kitchen_station_id <> $2`,
        [today, jantarId]
      );
      const pendingLunchDemands = parseInt(countRows[0].cnt, 10);

      const { rows: transferred } = await client.query<{ id: string }>(
        `UPDATE demands SET kitchen_station_id = $1
         WHERE status = 'pending' AND created_at::date = $2 AND kitchen_station_id <> $1
         RETURNING id`,
        [jantarId, today]
      );

      for (const t of transferred) {
        await client.query(
          `INSERT INTO demand_events (demand_id, event_type, actor, notes)
           VALUES ($1, 'shift_transfer', 'sistema',
             'Transferida para a Cozinha Jantar na ativação do turno jantar')`,
          [t.id]
        );
      }

      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ('shift_dinner_active_date', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [today]
      );

      await client.query('COMMIT');
      client.release();

      await recomputeStationQueue(jantarId);
      for (const s of sourceRows) {
        if (s.kitchen_station_id && s.kitchen_station_id !== jantarId) {
          await recomputeStationQueue(s.kitchen_station_id);
        }
      }
      computeDailyScores(today).catch((e) => request.log.error(e));

      fastify.io.emit('menu:updated', { date: today, shift: 'dinner' });
      fastify.io.emit('shift:updated', { shift: 'dinner' });
      fastify.io.emit('demand:queue-updated');

      return {
        shift: 'dinner' as const,
        added_products: addedRows.length,
        transferred_demands: transferred.length,
        pending_lunch_demands: pendingLunchDemands,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao ativar turno jantar' });
    }
  });
```

Notas:
- `ensureTodayMenu()` roda fora da transação (mesmo padrão de `PATCH /daily-menu/today`) — aceitável.
- `ON CONFLICT ... DO NOTHING` preserva removals manuais feitos pelo gerente via `PATCH /today` (item jantar removido não volta).
- Re-clique no mesmo dia é idempotente (re-sync de produtos jantar criados depois).

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Teste manual (sem demandas pendentes)**

Com o servidor rodando e um produto ativo vinculado à estação jantar no banco:

```sql
INSERT INTO products (name, category, kitchen_station_id, sla_minutes_normal, sla_minutes_urgente)
SELECT 'Tilápia Grelhada Jantar', 'Proteína', id, 18, 12 FROM kitchen_stations WHERE code = 'jantar';
```

```
curl -X POST http://localhost:3000/api/v1/admin/shift/dinner
```
Expected: `{"shift":"dinner","added_products":1,"transferred_demands":0,"pending_lunch_demands":0}`

Confirmar:
```
curl http://localhost:3000/api/v1/shift/status
```
Expected: `{"shift":"dinner"}`

- [ ] **Step 5: Teste manual (com pendência do almoço)**

Criar uma demanda normal via `POST /api/v1/demands` (produto de `quente_a`), repetir o Step 4 e conferir no banco:

```sql
SELECT id, kitchen_station_id, status FROM demands ORDER BY created_at DESC LIMIT 3;
SELECT * FROM demand_events WHERE event_type = 'shift_transfer';
```
Expected: demanda com `kitchen_station_id` da estação jantar; um registro `shift_transfer` com `actor='sistema'`.

- [ ] **Step 6: Commit (somente com autorização do usuário)**

```bash
git add src/routes/admin.ts
git commit -m "feat(jantar): endpoint de ativação do turno jantar com transferência de pendências"
```

---

### Task 4: Enriquecimento de /daily-menu/today e /products/search

**Files:**
- Modify: `src/routes/daily-menu.ts:28-49` (GET /today)
- Modify: `src/routes/products.ts:19-39` (GET /search)

**Interfaces:**
- Produces: `GET /daily-menu/today` → `{ menu, date, products, shift }` com `products[i].station_code`; `GET /products/search` → linhas com `station_code`, ordenação jantar primeiro.
- Consumes: `getCurrentShift` (Task 2), `DailyMenuEffective.station_code` / `ProductSearchRow.station_code` (Task 2).

- [ ] **Step 1: Alterar GET /today em src/routes/daily-menu.ts**

Adicionar import no topo:

```ts
import { getCurrentShift } from '../services/shift.service';
```

Substituir o corpo do handler (linhas 29-44 atuais) por:

```ts
    try {
      // "Hoje" segundo o banco (CURRENT_DATE) para evitar divergência de timezone
      const [{ today }] = await query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
      const menu = await getMenuForDate(today);

      const products = await query<DailyMenuEffective>(
        `SELECT dme.*, ks.code AS station_code
         FROM daily_menu_effective dme
         JOIN products p ON p.id = dme.product_id
         LEFT JOIN kitchen_stations ks ON ks.id = p.kitchen_station_id
         WHERE dme.daily_menu_id = $1
         ORDER BY (ks.code = 'jantar') DESC, dme.category, dme.name`,
        [menu.daily_menu_id]
      );

      const shift = await getCurrentShift();

      // v2.5 (§2.4) — metadata do cardápio envelopando os produtos
      return {
        menu: { number: menu.menu_number, name: menu.menu_name },
        date: today,
        products,
        shift,
      };
    } catch (error) {
```

- [ ] **Step 2: Alterar GET /search em src/routes/products.ts**

Substituir a query (linhas 22-33 atuais) por:

```ts
      const rows = await query<ProductSearchRow>(
        `SELECT p.id, p.name, p.category, p.kitchen_station_id, ks.code AS station_code,
          EXISTS(
            SELECT 1 FROM daily_menu_effective dme
            WHERE dme.product_id = p.id AND dme.date = CURRENT_DATE
          ) AS in_today_menu
        FROM products p
        LEFT JOIN kitchen_stations ks ON ks.id = p.kitchen_station_id
        WHERE p.active = true AND p.name ILIKE $1
        ORDER BY (ks.code = 'jantar') DESC, in_today_menu DESC, p.name
        LIMIT 15`,
        [`%${q}%`]
      );
```

- [ ] **Step 3: Verificar typecheck e resposta**

Run: `npx tsc --noEmit`
Expected: sem erros.

```
curl http://localhost:3000/api/v1/daily-menu/today
curl "http://localhost:3000/api/v1/products/search?q=til"
```
Expected: `/today` retorna `shift` e `station_code` por produto; `/search` retorna itens da estação jantar primeiro, com `station_code:"jantar"`.

- [ ] **Step 4: Commit (somente com autorização do usuário)**

```bash
git add src/routes/daily-menu.ts src/routes/products.ts
git commit -m "feat(jantar): cardápio do dia e busca de produtos com estação e turno"
```

---

### Task 5: Isolamento de métricas (performance.service + analytics)

**Files:**
- Modify: `src/services/performance.service.ts:73-77` (entityFromStationCode), `:239-247` (ensureScoresForDate), `:285-287` (getDetractorDates)
- Modify: `src/routes/analytics.ts:733` (entities)

**Interfaces:**
- Produces: `entityFromStationCode('jantar') === 'cozinha_jantar'`; `ensureScoresForDate` considera completo com ≥6 linhas; `getDetractorDates('cozinha_jantar', ...)` filtra `ks.code='jantar'`; `/performance` retorna a entidade `cozinha_jantar`.
- Nota: `computeDailyScores` já itera todas as `kitchen_stations` — a estação jantar entra automaticamente. A query de `cozinha_geral` (linhas 204-236) **não muda**: continua a média apenas de quente_a/quente_b/fria.
- `dashboard.html` usa arrays próprios de entidades (linhas 1214-1320, 1794-1845) e ignora chaves extras da resposta — adicionar `cozinha_jantar` na API não quebra o dashboard.

- [ ] **Step 1: entityFromStationCode**

```ts
function entityFromStationCode(code: string): string {
  if (code === 'quente_a') return 'cozinha_quente_a';
  if (code === 'quente_b') return 'cozinha_quente_b';
  if (code === 'jantar') return 'cozinha_jantar';
  return 'cozinha_fria';
}
```

- [ ] **Step 2: ensureScoresForDate (≥6 linhas)**

Substituir a condição (linha 244):

```ts
  if (parseInt(row?.cnt || '0', 10) < 6) {
    await computeDailyScores(dateStr);
  }
```

- [ ] **Step 3: getDetractorDates — branch jantar**

Substituir o if e o mapeamento (linhas 285-287):

```ts
  if (entity === 'cozinha_quente_a' || entity === 'cozinha_quente_b' || entity === 'cozinha_fria' || entity === 'cozinha_jantar') {
    const stationCode = entity === 'cozinha_quente_a' ? 'quente_a'
      : entity === 'cozinha_quente_b' ? 'quente_b'
      : entity === 'cozinha_jantar' ? 'jantar' : 'fria';
```

- [ ] **Step 4: Lista de entidades em src/routes/analytics.ts (linha 733)**

```ts
        const entities = ['cozinha_geral', 'cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'cozinha_jantar', 'salao'];
```

- [ ] **Step 5: Verificar typecheck e scores**

Run: `npx tsc --noEmit`
Expected: sem erros.

```
curl http://localhost:3000/api/v1/analytics/performance
```
Expected: `current.cozinha_jantar` presente com `final_score` 5.0 (ou recalculado conforme demandas do dia).

- [ ] **Step 6: Commit (somente com autorização do usuário)**

```bash
git add src/services/performance.service.ts src/routes/analytics.ts
git commit -m "feat(jantar): entidade cozinha_jantar isolada nas métricas de performance"
```

---

### Task 6: Tela do gerente — botão e modal de transição

**Files:**
- Modify: `src/views/gerente.html:239-247` (header), `:292-319` (após annulModal), `:366-369` (socket), `:425-447` (fetchProducts), `:678-692` (init/listeners)
- Modify: `src/views/styles/theme.css` (classes `.btn-shift-dinner`, `.badge-dinner`)

**Interfaces:**
- Consumes: `GET /api/v1/shift/status`, `POST /api/v1/admin/shift/dinner`, evento `shift:updated`, `GET /api/v1/demands` (contagem pendente), `GET /api/v1/daily-menu/today` (com `station_code`).
- Produces: botão `#dinnerShiftBtn`, modal `#dinnerShiftModal` com `#dinnerShiftPendingInfo`, `#dinnerShiftError`, `#dinnerShiftConfirm`, `#dinnerShiftCancel`.

- [ ] **Step 1: Botão no header (gerente.html, linha 239-247)**

Adicionar antes do `themeToggle`:

```html
            <button type="button" id="dinnerShiftBtn" class="btn-shift-dinner">Iniciar Turno Jantar</button>
```

- [ ] **Step 2: Modal de confirmação (após o annulModal, linha 319)**

```html
    <div class="modal-overlay" id="dinnerShiftModal">
        <div class="modal-card">
            <h3>Iniciar Turno Jantar</h3>
            <p class="modal-hint">Os itens do cardápio do jantar ficarão disponíveis no salão e a Cozinha Jantar assumirá o turno. A tela da cozinha quente passará automaticamente para o modo jantar.</p>
            <p class="modal-hint" id="dinnerShiftPendingInfo"></p>
            <div class="modal-error" id="dinnerShiftError" style="display:none;"></div>
            <div class="modal-actions">
                <button type="button" class="btn-modal-cancel" id="dinnerShiftCancel">Cancelar</button>
                <button type="button" class="btn-modal-confirm" id="dinnerShiftConfirm">Confirmar</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 3: CSS em theme.css (após o bloco .btn-theme-toggle, linha 404)**

```css
/* === Botão turno jantar (gerente) === */
.btn-shift-dinner {
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 42px; padding: 8px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--c-accent-gold);
  background: transparent;
  color: var(--c-accent-gold);
  font-size: 0.85rem; font-weight: var(--fw-semi);
  cursor: pointer; font-family: inherit;
  transition: all var(--t-fast) var(--ease-out);
}
.btn-shift-dinner:hover { background: rgba(212, 165, 116, 0.15); }
.btn-shift-dinner:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-shift-dinner.btn-shift-active {
  background: var(--c-accent-gold);
  color: var(--c-primary);
  font-weight: var(--fw-bold);
}

.badge-dinner {
  background: var(--c-accent-gold);
  color: var(--c-primary);
}
```

- [ ] **Step 4: JS do botão/modal (inserir antes de `function refreshAll()`, linha 678)**

```js
    var dinnerShiftBtn = document.getElementById('dinnerShiftBtn');
    function updateDinnerShiftButton(shift) {
        if (!dinnerShiftBtn) return;
        if (shift === 'dinner') {
            dinnerShiftBtn.disabled = true;
            dinnerShiftBtn.textContent = 'Turno Jantar ativo';
            dinnerShiftBtn.classList.add('btn-shift-active');
        } else {
            dinnerShiftBtn.disabled = false;
            dinnerShiftBtn.textContent = 'Iniciar Turno Jantar';
            dinnerShiftBtn.classList.remove('btn-shift-active');
        }
    }
    function fetchShiftStatus() {
        api('/api/v1/shift/status').then(function(data) {
            updateDinnerShiftButton(data.shift);
        }).catch(console.error);
    }
    if (dinnerShiftBtn) dinnerShiftBtn.addEventListener('click', function() {
        var errEl = document.getElementById('dinnerShiftError');
        if (errEl) errEl.style.display = 'none';
        var info = document.getElementById('dinnerShiftPendingInfo');
        if (info) info.textContent = 'Consultando demandas pendentes do almoço...';
        api('/api/v1/demands').then(function(demands) {
            var pending = (demands || []).filter(function(d) { return d.status === 'pending'; }).length;
            if (info) {
                info.textContent = pending > 0
                    ? pending + ' demanda(s) pendente(s) serão transferidas para a Cozinha Jantar.'
                    : 'Nenhuma demanda pendente no momento.';
            }
        }).catch(function(err) {
            console.error(err);
            if (info) info.textContent = '';
        });
        var modal = document.getElementById('dinnerShiftModal');
        if (modal) modal.style.display = 'flex';
    });
    var dinnerShiftConfirm = document.getElementById('dinnerShiftConfirm');
    if (dinnerShiftConfirm) dinnerShiftConfirm.addEventListener('click', function() {
        dinnerShiftConfirm.disabled = true;
        api('/api/v1/admin/shift/dinner', { method: 'POST' }).then(function(data) {
            var modal = document.getElementById('dinnerShiftModal');
            if (modal) modal.style.display = 'none';
            dinnerShiftConfirm.disabled = false;
            updateDinnerShiftButton('dinner');
            var msg = 'Turno Jantar ativado: ' + data.added_products + ' item(ns) no cardápio.';
            if (data.transferred_demands > 0) msg += ' ' + data.transferred_demands + ' demanda(s) transferida(s).';
            showToast(msg, 'info');
            refreshAll();
            fetchCalendar();
        }).catch(function(err) {
            dinnerShiftConfirm.disabled = false;
            var errEl = document.getElementById('dinnerShiftError');
            if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
        });
    });
    var dinnerShiftCancel = document.getElementById('dinnerShiftCancel');
    if (dinnerShiftCancel) dinnerShiftCancel.addEventListener('click', function() {
        var modal = document.getElementById('dinnerShiftModal');
        if (modal) modal.style.display = 'none';
    });
    var dinnerShiftModal = document.getElementById('dinnerShiftModal');
    if (dinnerShiftModal) dinnerShiftModal.addEventListener('click', function(e) {
        if (e.target === dinnerShiftModal) dinnerShiftModal.style.display = 'none';
    });
```

- [ ] **Step 5: Badge "Jantar" no Cardápio do Dia (fetchProducts, linha 440-445)**

Substituir o `container.innerHTML`:

```js
            container.innerHTML = products.map(function(p) {
                var badge = (p.station_code === 'jantar')
                    ? ' <span class="badge-pill badge-dinner">Jantar</span>'
                    : '';
                return '<div class="product-row">' +
                    '<span><strong>' + p.name + '</strong> <small style="color:#999;">(' + p.category + ')</small>' + badge + '</span>' +
                    '<button class="btn-toggle out-menu" data-id="' + p.product_id + '">Remover</button>' +
                '</div>';
            }).join('');
```

- [ ] **Step 6: Listeners/init (linhas 678-692)**

Adicionar ao bloco de listeners:

```js
    socket.on('shift:updated', function(data) {
        if (data && data.shift) updateDinnerShiftButton(data.shift);
    });
```

E no `socket.on('connect', ...)` existente (linha 688) adicionar `fetchShiftStatus();` dentro do handler; ao final do init (após `fetchCalendar();`, linha 691) adicionar:

```js
    fetchShiftStatus();
```

- [ ] **Step 7: Verificar no navegador**

Run: `npx tsc --noEmit` (não há TS, sanity) e abrir `http://localhost:3000/gerente`:
Expected: botão "Iniciar Turno Jantar" no header; clicar → modal mostra pendências; confirmar → toast, botão vira "Turno Jantar ativo" (desabilitado); cardápio mostra badge "Jantar" nos itens da estação jantar.

- [ ] **Step 8: Commit (somente com autorização do usuário)**

```bash
git add src/views/gerente.html src/views/styles/theme.css
git commit -m "feat(jantar): botão e modal de ativação do turno na tela do gerente"
```

---

### Task 7: Tela do salão — hierarquia do dropdown, tags e badge de turno

**Files:**
- Modify: `src/views/salao.html:217-221` (header), `:527-559` (loadProducts/populateReplacedProducts), `:601-625` (normalizeTodayProducts/renderProductDropdown), `:801-802` (listeners)
- Modify: `src/views/styles/theme.css` (classe `.badge-jantar`)

**Interfaces:**
- Consumes: `GET /daily-menu/today` com `shift` e `station_code` (Task 4), `GET /products/search` com `station_code` (Task 4), evento `shift:updated`.
- Produces: dropdown com itens jantar no topo (badge `JANTAR`) e demais itens de hoje com badge `ALMOÇO`/`HOJE`; badge "Turno Jantar ativo" no header.

- [ ] **Step 1: Badge de turno no header (salao.html, linhas 217-221)**

```html
    <div class="top-header" id="topHeader">
        <span id="headerDate">—</span>
        <span class="header-sep">·</span>
        <span id="headerMenu">—</span>
        <span class="header-sep" id="shiftSep" style="display:none;">·</span>
        <span id="shiftBadge" class="badge-pill badge-dinner" style="display:none;">Turno Jantar ativo</span>
    </div>
```

- [ ] **Step 2: Estado do turno + badge (dentro do IIFE, após `var currentDropdownItems = [];`, linha 296)**

```js
    var currentShift = 'lunch';

    function updateShiftBadge() {
        var badge = document.getElementById('shiftBadge');
        var sep = document.getElementById('shiftSep');
        if (!badge) return;
        var active = currentShift === 'dinner';
        badge.style.display = active ? '' : 'none';
        if (sep) sep.style.display = active ? '' : 'none';
    }
```

- [ ] **Step 3: loadProducts captura shift e chama o badge (linha 532-536)**

Substituir o `.then` inicial de `loadProducts`:

```js
        api('/api/v1/daily-menu/today').then(function(data) {
            products = data.products || [];
            todayMenuProducts = products;
            currentShift = data.shift || 'lunch';
            updateHeader(data);
            updateShiftBadge();
            populateReplacedProducts();
```

- [ ] **Step 4: normalizeTodayProducts com station_code (linha 601-605)**

```js
    function normalizeTodayProducts() {
        return todayMenuProducts.map(function(p) {
            return { id: p.product_id, name: p.name, category: p.category || '', in_today_menu: true, station_code: p.station_code || '' };
        });
    }
```

- [ ] **Step 5: renderProductDropdown com ordenação e tags (linha 607-625)**

Substituir a função inteira:

```js
    function renderProductDropdown(items) {
        var dropdown = document.getElementById('productDropdown');
        if (!dropdown) return;
        var sorted = (items || []).slice().sort(function(a, b) {
            var aj = (a.station_code === 'jantar') ? 1 : 0;
            var bj = (b.station_code === 'jantar') ? 1 : 0;
            if (aj !== bj) return bj - aj;
            var at = a.in_today_menu ? 1 : 0;
            var bt = b.in_today_menu ? 1 : 0;
            if (at !== bt) return bt - at;
            return a.name.localeCompare(b.name);
        });
        currentDropdownItems = sorted;
        if (currentDropdownItems.length === 0) {
            dropdown.innerHTML = '<div class="product-empty">Nenhum produto encontrado</div>';
            dropdown.classList.add('open');
            return;
        }
        dropdown.innerHTML = currentDropdownItems.map(function(p, i) {
            var badge = p.station_code === 'jantar'
                ? '<span class="today-badge badge-jantar">JANTAR</span>'
                : (p.in_today_menu
                    ? (currentShift === 'dinner' ? '<span class="today-badge">ALMOÇO</span>' : '<span class="today-badge">HOJE</span>')
                    : '');
            return '<div class="product-option" data-idx="' + i + '">' +
                '<span><span class="opt-name">' + p.name + '</span>' +
                (p.category ? '<span class="opt-cat">' + p.category + '</span>' : '') +
                '</span>' + badge +
            '</div>';
        }).join('');
        dropdown.classList.add('open');
    }
```

- [ ] **Step 6: Listener shift:updated (junto aos listeners, linha 801)**

```js
    socket.on('shift:updated', function(data) {
        currentShift = (data && data.shift === 'dinner') ? 'dinner' : 'lunch';
        loadProducts();
    });
```

- [ ] **Step 7: CSS .badge-jantar em theme.css (junto ao .badge-dinner da Task 6)**

```css
.badge-jantar {
  background: var(--c-accent-gold);
  color: var(--c-primary);
}
```

- [ ] **Step 8: Verificar no navegador**

Abrir `http://localhost:3000/salao` com o turno ativado:
Expected: badge "Turno Jantar ativo" no header; focar a busca → itens jantar no topo com badge `JANTAR`, demais com `ALMOÇO`; digitar na busca → mesma hierarquia. Sem turno ativo → badges `HOJE` e sem badge de turno.

- [ ] **Step 9: Commit (somente com autorização do usuário)**

```bash
git add src/views/salao.html src/views/styles/theme.css
git commit -m "feat(jantar): salão com hierarquia de cardápio e badge de turno"
```

---

### Task 8: Kiosk cozinha quente — modo jantar e transição automática

**Files:**
- Modify: `src/views/cozinha-quente.html:269-283` (HTML do body), `:295-315` (init), `:333-345` (socket), `:431-448` (render), `:640-700` (listeners demand), `:772-796` (timers), `:796-800` (polling)
- Modify: `src/views/styles/theme.css:106-119` (tokens noturnos no `:root`)

**Interfaces:**
- Consumes: `GET /api/v1/shift/status`, evento `shift:updated`, sala `cozinha_jantar` (Task 2), `GET /api/v1/kitchen-stations` (inclui jantar, Task 1).
- Produces: `baseStation` (`quente_a|quente_b|jantar` via `?station=`), `selectedStation` (efetiva: `jantar` quando turno dinner), coluna única `#gridJ/#readyJ/#timerJ`, paleta noturna via `[data-station="jantar"]`.

- [ ] **Step 1: Tokens noturnos em theme.css (`:root`, após linha 119)**

```css
  /* === Turno Jantar (paleta noturna) === */
  --dinner-bg: #0b1020;
  --dinner-surface: #141a2e;
  --dinner-accent: #d4a574;
```

- [ ] **Step 2: CSS da coluna jantar no <style> da página (após linha 67, junto aos h2 das colunas)**

```css
        .column-jantar { flex: 1; }
        .column-jantar h2 { background: #101827; color: var(--dinner-accent); border-bottom: 3px solid var(--dinner-accent); }

        body[data-station="jantar"] { background: var(--dinner-bg); }
        body[data-station="jantar"] .card { background: var(--dinner-surface); }
        body[data-station="jantar"] .card.cooking { background: #1d2436; border-left-color: var(--dinner-accent); }
        body[data-station="jantar"] .card .eta { color: var(--dinner-accent); }
        body[data-station="jantar"] .card .actions .ready-btn { background: var(--dinner-accent); color: #141218; }
        body[data-station="jantar"] .card .actions .ready-btn:hover { background: #e5bc90; }
        body[data-station="jantar"] .ready-strip-header { color: var(--dinner-accent); }
        body[data-station="jantar"] .ready-strip .ready-pill { background: #1d2436; border-color: var(--dinner-accent); }
        body[data-station="jantar"] .ready-strip .ready-pill .pill-name { color: #e5bc90; }
        body[data-station="jantar"] .column-jantar .grid { max-width: 860px; margin: 0 auto; width: 100%; }
```

(Nota: as regras de sobrescrita ficam no `<style>` da página porque ele carrega após `theme.css` e vence a especificidade; os tokens ficam compartilhados em `theme.css`, conforme a spec §6.2.)

- [ ] **Step 3: HTML da coluna jantar (após a column-b, linha 280)**

```html
    <div class="column column-jantar" hidden>
        <h2>COZINHA JANTAR <span class="col-timer" id="timerJ">--:--</span></h2>
        <div id="gridJ" class="grid"></div>
        <div id="readyJ" class="ready-strip"></div>
    </div>
```

- [ ] **Step 4: Init — baseStation, shift e modo (substituir linhas 299-315)**

Substituir de `const stationParam = ...` até `let stationIds = ...`:

```js
        const stationParam = new URLSearchParams(window.location.search).get('station');
        const baseStation = stationParam === 'quente_b' ? 'quente_b' : (stationParam === 'jantar' ? 'jantar' : 'quente_a');
        let selectedStation = baseStation;
        let currentShift = 'lunch';

        function applyStationMode() {
            document.documentElement.dataset.station = selectedStation;
            document.body.dataset.station = selectedStation;
            document.querySelector('.column-a').hidden = selectedStation !== 'quente_a';
            document.querySelector('.column-b').hidden = selectedStation !== 'quente_b';
            document.querySelector('.column-jantar').hidden = selectedStation !== 'jantar';
            KDSStationTheme.load(selectedStation);
            watchStationTheme(selectedStation);
        }

        const watchedStations = {};
        function watchStationTheme(stationCode) {
            if (watchedStations[stationCode]) return;
            watchedStations[stationCode] = true;
            KDSStationTheme.watch(socket, stationCode);
        }

        function setShift(shift) {
            if (currentShift === shift) return;
            currentShift = shift;
            selectedStation = currentShift === 'dinner' ? 'jantar' : baseStation;
            applyStationMode();
            joinRooms();
            carregarDemandas();
        }

        function fetchShiftStatus() {
            fetch('/api/v1/shift/status')
                .then(function(res) { return res.json(); })
                .then(function(data) { setShift(data && data.shift === 'dinner' ? 'dinner' : 'lunch'); })
                .catch(function(err) { console.error('Falha ao buscar turno:', err); });
        }

        const socket = io({
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });
        let demands = [];
        let timeInterval;
        let stationIds = { quente_a: null, quente_b: null, jantar: null };
```

Atenção à ordem: `applyStationMode` usa `socket` (via `watchStationTheme`) — a primeira chamada fica no Step 5, **depois** da criação do `io()`. `KDSStationTheme.watch` apenas registra `socket.on`, então é seguro nesse ponto.

- [ ] **Step 5: Joins e connect (substituir linhas 333-339)**

```js
        function joinRooms() {
            socket.emit('join', 'cozinha_quente');
            if (selectedStation === 'jantar') socket.emit('join', 'cozinha_jantar');
        }
        applyStationMode();
        joinRooms();

        socket.on('connect', () => {
            document.getElementById('reconnectBanner').style.display = 'none';
            joinRooms();
            carregarDemandas();
            fetchShiftStatus();
        });
```

- [ ] **Step 6: Listener shift:updated (após o listener kitchen:capacity-updated, linha 704)**

```js
        socket.on('shift:updated', (data) => {
            setShift(data && data.shift === 'dinner' ? 'dinner' : 'lunch');
        });
```

- [ ] **Step 7: render() com coluna jantar (substituir linhas 436-447)**

```js
            const filterA = demands.filter(d =>
                d.kitchen_station_id === stationIds.quente_a &&
                (d.status === 'pending' || d.status === 'ready')
            );
            const filterB = demands.filter(d =>
                d.kitchen_station_id === stationIds.quente_b &&
                (d.status === 'pending' || d.status === 'ready')
            );
            const filterJ = demands.filter(d =>
                d.kitchen_station_id === stationIds.jantar &&
                (d.status === 'pending' || d.status === 'ready')
            );

            renderGrid('gridA', 'readyA', selectedStation === 'quente_a' ? filterA : []);
            renderGrid('gridB', 'readyB', selectedStation === 'quente_b' ? filterB : []);
            renderGrid('gridJ', 'readyJ', selectedStation === 'jantar' ? filterJ : []);
            flashIds.clear();
```

- [ ] **Step 8: Filtrar eventos por estação efetiva (demand:new/urgent/stockout, linhas 640-696)**

Adicionar guarda no início de cada handler:

```js
        socket.on('demand:new', (demand) => {
            if (demand && stationIds[selectedStation] && demand.kitchen_station_id !== stationIds[selectedStation]) return;
            demands.push(demand);
```

```js
        socket.on('demand:urgent', (demand) => {
            if (demand && stationIds[selectedStation] && demand.kitchen_station_id !== stationIds[selectedStation]) return;
            demands.push(demand);
```

```js
        socket.on('demand:stockout', (updated) => {
            if (updated && stationIds[selectedStation] && updated.kitchen_station_id !== stationIds[selectedStation]) return;
            const idx = demands.findIndex(d => d.id === updated.id);
```

- [ ] **Step 9: cross-cancel só se o card estiver na tela (substituir o handler das linhas 673-688)**

```js
        socket.on('demand:cross-cancel', (data) => {
            if (!data || data.cancelled_by !== 'salao') return;
            const btn = data.id
                ? document.querySelector('.ready-btn[data-id="' + data.id + '"]')
                : null;
            if (!btn) return;
            if (typeof Tone !== 'undefined') Tone.start();
            playCrossCancelAlert();
            const card = btn.closest('.card');
            if (card) {
                card.classList.add('cross-cancelled');
                setTimeout(() => {
                    if (card.isConnected) card.classList.remove('cross-cancelled');
                }, 6000);
            }
            showCrossCancelToast(data.message || 'ATENÇÃO: Item cancelado pelo Salão já estava em preparo!');
        });
```

- [ ] **Step 10: Timer da coluna jantar (updateAllTimers, linha 772-774)**

```js
        function updateAllTimers() {
            if (stationIds.quente_a) updateColumnTimer('timerA', stationIds.quente_a);
            if (stationIds.quente_b) updateColumnTimer('timerB', stationIds.quente_b);
            if (stationIds.jantar) updateColumnTimer('timerJ', stationIds.jantar);
```

- [ ] **Step 11: Inicialização do shift no load (após `carregarDemandas();`, linha 429)**

```js
        fetchShiftStatus();
```

- [ ] **Step 12: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

Abrir `http://localhost:3000/cozinha-quente?station=quente_a`; ativar o turno pelo gerente em outra aba:
Expected: a MESMA janela vira "COZINHA JANTAR" (coluna única, fundo azulado escuro, botão PRONTO âmbar), sem reload manual. Abrir `?station=jantar` direto também funciona. No dia seguinte (ou `shift_dinner_active_date` apontando para outra data), a tela volta ao almoço no reload.

- [ ] **Step 13: Commit (somente com autorização do usuário)**

```bash
git add src/views/cozinha-quente.html src/views/styles/theme.css
git commit -m "feat(jantar): modo jantar no kiosk da cozinha quente com transição automática"
```

---

### Task 9: Verificação E2E (Playwright + image-analyzer) e build

**Files:**
- Create: `test_webwright/dinner_shift_e2e.py` (script one-off, padrão dos `*.py` de raiz)

**Interfaces:**
- Consumes: app rodando em `http://localhost:3000` com banco seedado (Task 1).

- [ ] **Step 1: Escrever o roteiro Playwright**

```python
"""E2E do Modo Jantar — evidências em final_runs/run_dinner/"""
import os, json, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("KDS_BASE", "http://localhost:3000")
OUT = "final_runs/run_dinner"
os.makedirs(OUT, exist_ok=True)

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
        with urllib.request.urlopen(req, data) as r: return json.load(r)
    with urllib.request.urlopen(req) as r: return json.load(r)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 900})
    page = ctx.new_page()

    # 0. Sanidade: turno inicia em lunch
    status = api("GET", "/api/v1/shift/status")
    assert status["shift"] == "lunch", status

    # 1. Garantir produto de jantar (idempotente via admin)
    products = api("GET", "/api/v1/products/all")
    jantar_station = next(s for s in api("GET", "/api/v1/kitchen-stations") if s["code"] == "jantar")
    tilapia = next((pr for pr in products if pr["name"] == "Tilápia Grelhada Jantar"), None)
    if tilapia is None:
        api("POST", "/api/v1/admin/products", {
            "name": "Tilápia Grelhada Jantar",
            "category": "Proteína",
            "kitchen_station_id": jantar_station["id"],
            "sla_minutes_normal": 18,
            "sla_minutes_urgente": 12,
        })
        tilapia = next(pr for pr in api("GET", "/api/v1/products/all") if pr["name"] == "Tilápia Grelhada Jantar")

    # 2. Tela do gerente: botão + modal
    page.goto(BASE + "/gerente")
    page.wait_for_selector("#dinnerShiftBtn")
    page.screenshot(path=f"{OUT}/01_gerente_inicial.png")
    page.click("#dinnerShiftBtn")
    page.wait_for_selector("#dinnerShiftModal", state="visible")
    page.screenshot(path=f"{OUT}/02_gerente_modal.png")

    # 3. Kiosk quente aberto ANTES da transição (para provar a transição na mesma janela)
    page2 = ctx.new_page()
    page2.goto(BASE + "/cozinha-quente?station=quente_a")
    page2.wait_for_selector(".column-a")
    page2.screenshot(path=f"{OUT}/03_cozinha_antes.png")

    # 4. Ativa o turno pelo gerente
    page.click("#dinnerShiftConfirm")
    page.wait_for_selector("#dinnerShiftBtn.btn-shift-active", timeout=10000)
    page.screenshot(path=f"{OUT}/04_gerente_ativado.png")

    # 5. Kiosk deve transicionar na MESMA janela (sem reload)
    page2.wait_for_selector(".column-jantar:not([hidden])", timeout=15000)
    page2.screenshot(path=f"{OUT}/05_cozinha_jantar_transicao.png")
    assert page2.locator("h2").first.inner_text().startswith("COZINHA JANTAR")

    # 6. Salão: badge de turno + dropdown hierarquizado
    page3 = ctx.new_page()
    page3.goto(BASE + "/salao")
    page3.wait_for_selector("#shiftBadge", state="visible", timeout=10000)
    page3.screenshot(path=f"{OUT}/06_salao_badge_turno.png")
    page3.click("#productSearch")
    page3.wait_for_selector(".product-option")
    page3.screenshot(path=f"{OUT}/07_salao_dropdown.png")

    # 7. Criar demanda de jantar e ver na cozinha jantar
    menu = api("GET", "/api/v1/daily-menu/today")
    unit = api("GET", f"/api/v1/units/by-product/{tilapia['id']}")[0]
    demand = api("POST", "/api/v1/demands", {
        "product_id": tilapia["id"],
        "quantity": 2,
        "unit_id": unit["id"],
        "unit_label": unit["label"],
    })
    page2.wait_for_function(
        "document.querySelectorAll('#gridJ .card').length > 0",
        timeout=15000,
    )
    page2.screenshot(path=f"{OUT}/08_cozinha_jantar_demanda.png")

    # 8. PRONTO + retirada
    page2.click("#gridJ .ready-btn")
    time.sleep(0.3)
    page2.click("#gridJ .ready-btn")
    page2.wait_for_selector("#readyJ .ready-pill", timeout=10000)
    page2.screenshot(path=f"{OUT}/09_cozinha_jantar_pronto.png")
    page3.reload()
    page3.click("#demandList .retrieve-btn")
    page3.wait_for_selector("#confirmRetrieveBtn", state="visible")
    page3.click("#confirmRetrieveBtn")
    time.sleep(1.0)

    # 9. Evidências de banco (via endpoints)
    perf = api("GET", "/api/v1/analytics/performance")
    assert "cozinha_jantar" in perf["current"], perf["current"].keys()
    print("OK — cozinha_jantar isolada:", perf["current"]["cozinha_jantar"])

    page.screenshot(path=f"{OUT}/10_final.png")
    browser.close()
    print("E2E do Modo Jantar concluído. Screenshots em", OUT)
```

Observações: seletores conferidos no código atual — `.retrieve-btn` dentro de `#demandList` (`salao.html:370`) e `#confirmRetrieveBtn` no modal `#confirmModal` (`salao.html:272`).

- [ ] **Step 2: Rodar o roteiro**

```bash
py test_webwright/dinner_shift_e2e.py
```
Expected: saída `OK — cozinha_jantar isolada: {...}` e `E2E do Modo Jantar concluído`.

- [ ] **Step 3: Validação visual com o subagente image-analyzer**

Dispachar o subagente `image-analyzer` (`.opencode/agent/image-analyzer.md`) sobre as screenshots de `final_runs/run_dinner/`, pedindo verificação de:
- `05`: título "COZINHA JANTAR", coluna única centralizada, fundo azulado escuro, botão PRONTO âmbar (não verde);
- `07`: itens jantar no topo com badge `JANTAR`, itens do almoço com `ALMOÇO`;
- `06`: badge "Turno Jantar ativo" no header;
- `04`: botão "Turno Jantar ativo" desabilitado no gerente.
Corrigir desvios visuais e repetir os steps 1-2 conforme necessário.

- [ ] **Step 4: Verificações de regressão**

- Criar demanda de produto da estação `fria` e confirmar que `/cozinha-fria` a exibe e `/cozinha-quente` não (e vice-versa para jantar).
- `GET /api/v1/daily-menu/calendar?from=hoje&to=hoje+13` — rotação do almoço inalterada.
- `GET /api/v1/analytics/performance` — `cozinha_geral` sem demandas do jantar (conferir `total_demands`).

- [ ] **Step 5: Build de produção**

```bash
npm run build; npm start
```
Expected: `dist/views/` atualizado com as views novas; `GET /` das telas sem erro.

- [ ] **Step 6: Commit (somente com autorização do usuário)**

```bash
git add test_webwright/dinner_shift_e2e.py final_runs/run_dinner/
git commit -m "test(jantar): roteiro e2e playwright com evidências visuais"
```

---

## Definição de pronto (checklist global)

- [ ] Migration + espelho no seed (Task 1) aplicados; estação jantar visível em `/api/v1/kitchen-stations`.
- [ ] `GET /api/v1/shift/status` retorna `lunch`/`dinner` conforme `CURRENT_DATE`.
- [ ] `POST /api/v1/admin/shift/dinner` transfere pendências (com `shift_transfer`), injeta overrides, emite `menu:updated` + `shift:updated` + `demand:queue-updated` (após recompute).
- [ ] Salão hierarquiza dropdown (JANTAR no topo / ALMOÇO abaixo) e mostra badge de turno.
- [ ] Kiosk quente transiciona automaticamente para COZINHA JANTAR na mesma janela; `?station=jantar` funciona direto; volta ao almoço no dia seguinte.
- [ ] `cozinha_jantar` isolada em `performance_scores`; `cozinha_geral` sem contaminação; `ensureScoresForDate` usa ≥6.
- [ ] `npx tsc --noEmit` limpo; E2E Playwright OK; validação visual via image-analyzer OK; `npm run build` OK.
