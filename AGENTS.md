# KDS Bridge — Agent Instructions

## Current State (v2.5 — implemented & fixed, 23/07/2026)

- **All 21 v2.5 items implemented** (22/07/2026) per `PLANO_MUDANCAS_CLIENTE.md`. **9 bugs fixed** (23/07/2026).
- **Database:** Supabase cloud (`DATABASE_URL` in `.env` points to `db.gyhrbtvodalafsvcwygq.supabase.co`). The `SUPABASE_URL` / `SUPABASE_ANON_KEY` are used **only for JWT auth**.
- **v2.5 migration already applied** on Supabase: 6 new columns on `demands` (`is_replacement`, `replaced_product_id`, `ready_out_of_order`, `annulled_at`, `annulled_by`, `annul_reason`), updated status constraint (includes `annulled`), `daily_menu_effective` view, `system_settings.data_retention_days`.
- **Local PostgreSQL is NOT used anymore** — the server connects directly to Supabase. The `client.ts` DNS resolution (IPv6→IPv4 fallback) handles the Supabase host transparently.

## Stack & Architecture

- **Backend:** Node.js + TypeScript, Fastify HTTP server, Socket.IO for real-time, `pg` (node-postgres) for PostgreSQL.
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks or bundlers). Views live in `src/views/`.
- **Database:** PostgreSQL via Supabase cloud (`db.gyhrbtvodalafsvcwygq.supabase.co`). Local PG (`127.0.0.1:5432`) is available for offline dev — swap `DATABASE_URL` in `.env`.
- **Sidecar:** `dashboard/` is a standalone Python/Streamlit analytics app (independent from the Node.js server).

## Working with OpenCode

### Parallelism

- **Launch sub-agents for research.** Use `Task` (subagent_type: `explore`) to scan multiple directories, grep patterns, or answer architectural questions in parallel — a single Task can cover ground faster than sequential `Read`/`Grep` calls.
- **Batch independent tool calls.** When you need to read several files or run independent bash commands, issue them in a single message. OpenCode executes parallel tool calls concurrently.
- **Read before writing.** Always use `Read` on an existing file before calling `Edit` or `Write` on it.

### Skills

Loaded via the `Skill` tool. Useful ones for this project:

| Skill | When to use |
|---|---|---|
| `code-review` | Review changes since a branch point, PR, or commit across two axes (standards + spec) |
| `high-end-visual-design` | Making UI changes to any `src/views/*.html` file — enforces polished design conventions |
| `improve-codebase-architecture` | Scanning the codebase for structural issues and proposing improvements |
| `webwright` | Browser testing of web views — replaces Playwright MCP. Drives a local Firefox via Bash+Playwright, saves screenshots, self-verifies. |

### After making changes

1. Run `npx tsc --noEmit` to catch type errors (dev server doesn't typecheck).
2. If server code changed, restart `npm run dev` or let `ts-node-dev` hot-reload.
3. Test the affected flows via Playwright MCP (see Testing section below).

## Commands

```bash
npm run dev          # Start dev server (ts-node-dev, hot reload, --transpile-only — no type checking)
npm run build        # tsc + copy views to dist/views
npm start            # Run compiled JS from dist/
npx tsc --noEmit     # Type-check only (required separately — dev does NOT check types)
streamlit run dashboard/app.py   # Python analytics dashboard
```

## Database

- **Schema lives in `supabase_schema.sql`** — source of truth for DDL. Run via Supabase SQL Editor or `psql`.
- **Migration scripts:** When adding new columns/tables, write a standalone `.ts` migration script using `import { query } from './src/db/client'` and run it with `npx ts-node --transpile-only`. Delete the script after applying. Do NOT put migrations in `src/db/migrations.ts` (it's a no-op placeholder).
- `db/client.ts` has custom DNS resolution (IPv6 first, IPv4 fallback) to handle Supabase hosts that only publish AAAA records. It auto-detects local IPs and disables SSL for them.
- All queries use `$1` parameterization (PostgreSQL style). Never use SQLite `?` placeholders.
- **Always verify schema before debugging frontend.** If a feature fails (e.g. "column does not exist"), check the DB schema first — frontend bugs are often cascading from missing migrations.

## Server Startup & Seeding

- `src/server.ts` is the single entry point. On start it: connects DB, runs `seedDatabase()` (idempotent — checks COUNT of each table), then starts Fastify.
- `seedDatabase()` inserts kitchen stations, units, products, menus, product_units, menu_products. It uses transactions and `ON CONFLICT DO NOTHING` so it's safe to run repeatedly.
- `src/seed-prod.ts` is an alternate standalone seed script (`node dist/seed-prod.js`).

## Socket.IO

- Rooms: `salao`, `cozinha_quente`, `cozinha_fria`, `gerente`.
- Clients identify by emitting `identify` (legacy) or `join` with one of these rooms.
- `fastify.io` is available in all routes via TypeScript module augmentation in `src/types.ts` (line 3-7). No `as any` cast needed in new code.
- Key events emitted: `demand:new`, `demand:urgent`, `demand:ready`, `demand:retrieved`, `demand:cancelled`, `demand:stockout`, `demand:queue-updated`, `demand:cross-cancel`, `demand:annulled`, `product:updated`, `menu:updated`, `kitchen:capacity-updated`.

## Demand Lifecycle

Status flow: `pending` -> `ready` (cozinha marks ready) -> `retrieved` (salao confirms pickup). Either side can cancel: `cancelled_salao` (only from pending) or `cancelled_cozinha` (from pending or ready). Gerente can annul any demand → `annulled` (excluded from all metrics).

### SLA Tracking

- Dual SLA: cooking SLA (`evaluateCookingSla`, fires on ready) and pickup SLA (`evaluatePickupSla`, fires on retrieve, tolerance from `system_settings.pickup_tolerance_minutes`).
- Products have `sla_minutes_normal` and `sla_minutes_urgente` columns. The demand inherits whichever matches its priority at creation time.
- **Stockout SLA swap:** When `POST /:id/stockout` promotes priority to `urgent`, `sla_minutes` is recalculated to `Math.min(current_sla, product.sla_minutes_urgente)`. The queue recomputation (`recomputeStationQueue`) then recalculates `expected_ready_at` with the shorter SLA. The socket event (`demand:stockout`) must be emitted AFTER the recompute, not before.

### Queue Engine

- `src/services/queue.service.ts` — greedy slot scheduling per kitchen station. Uses `kitchen_stations.capacity` to determine how many demands can cook concurrently (`cooking_started`). Demands are sorted urgent-first, then FIFO.

## Key Conventions

- **TypeScript strict mode** is on. All interfaces are in `src/types.ts`.
- **Routes** are Fastify plugins registered with a prefix (e.g. `/api/v1/demands`, `/api/v1/products`). Use `fastify.register()` in `server.ts`.
- **Services** contain business logic (queue, SLA, menu rotation, performance scoring, event logging). Routes should delegate to services, not inline complex logic.
- **Menu rotation:** 14 menus, deterministic rotation via `src/services/menu.service.ts`. The `GET /calendar` endpoint is pure (does not persist future dates). Overrides use `PUT /admin/daily-menu/:date`.
- **Performance scoring:** `src/services/performance.service.ts` computes daily 0–5 scores per entity. Recalculated on every demand state change.
- **Route ordering matters:** Routes with fixed path segments (e.g. `/search`, `/calendar`) MUST be registered BEFORE parameterized routes (`/:id`, `/:date`) or Fastify will capture them as params.

## Gotchas — CRITICAL (read before writing any code)

### Silent error swallowing

**Never use `.catch(function() {})` with an empty body.** Always add at least `console.error(err)`. Multiple views had this pattern, making backend errors invisible — the user sees "nothing happens" with zero feedback. Pattern to use:
```javascript
.catch(function(err) {
    console.error('Contexto do erro:', err);
    // update UI to show error state
});
```

### buildContent / innerHTML without try/catch

Any function that builds HTML from API data (like `buildContent` in `dashboard.html`) MUST be wrapped in try/catch. If the API returns data in unexpected shape, the uncaught exception leaves the loading spinner running forever and the user sees infinite "Carregando...". Fix:
```javascript
try {
    content.innerHTML = buildContent(data);
} catch (e) {
    console.error('Render error:', e);
    content.innerHTML = '...error message...';
}
// Always restore UI state AFTER try/catch, not inside it
loading.style.display = 'none';
content.style.display = 'block';
```

### var hoisting with DOM element references

Variables declared with `var` are hoisted but `undefined`. If `document.getElementById('btnExport')` is at line 1295 but referenced at line 1210 inside `loadDashboard`, the reference is `undefined`. Use `document.getElementById()` inline or declare element refs at the top of the script.

### Event listener cleanup with closures

When re-attaching event listeners on each `loadDashboard()` call, a new closure is created each time. `removeEventListener(fn)` fails because `fn` is a different reference. Store the handler on the DOM element itself:
```javascript
if (el._ch) el.removeEventListener('change', el._ch);
var handler = function() { ... };
el.addEventListener('change', handler);
el._ch = handler;
```

### PowerShell inline Node.js

PowerShell mangles quotes in inline Node.js one-liners. Instead of:
```powershell
cmd /c "node -e "require('...').query(...)""
```
Always write a temporary `.ts` file and run with `npx ts-node --transpile-only`. Delete after use.

### Server process management

- `npm run dev` started via the shell tool is killed when the timeout expires. Use `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized` to run in background.
- Port 3000 may be occupied by a previous instance. Kill with `cmd /c "taskkill /PID <pid> /F"` before restarting.
- The first request after server start triggers lazy DB pool initialization — expect ~75ms response time for the first query.

### View HTML — no hot reload

The server reads HTML files at startup via `fs.readFileSync`. Changes to `.html` files require a server restart (or ts-node-dev will respawn automatically since views are loaded at request time... actually, views are preloaded at startup in `server.ts` line 51-58, so a manual restart IS required for HTML changes).

### No automated test suite

Use the `webwright` skill (configured in `opencode.jsonc` — replaces the old Playwright MCP) for browser-based testing of the web views.
- After changing any `.html` file, restart the server and test the affected view via Webwright.
- `src/db/seed.ts` (old) is stale — the real seeding is in `server.ts` and `seed-prod.ts`.
- `ARQUITETURA_KDS_BRIDGE.md` documents v1.0 (SQLite era). Prefer `KDS_Bridge_Handoff_CONSOLIDADO.md` for current architecture.
- `PLANO_MUDANCAS_CLIENTE.md` — v2.5 implemented & fixed. Use for reference on what was built.
- The `dashboard/` Python app and `dashboard.html` native view are separate analytics surfaces — changes to one don't affect the other.

## Testing with Webwright

This project has no traditional test framework. Use the `webwright` skill to verify UI changes:

1. **Load the skill:** `/skill webwright`
2. **Start the dev server first.** Use `Start-Process` so it survives shell timeouts.
3. Wait 3-5 seconds for the server to be ready (DB connection is lazy on first query).
4. Webwright drives a local Firefox via Bash+Playwright — write a Playwright script, save screenshots, and inspect them with `Read`.
5. **Always check browser console errors** — silent JS errors are the #1 cause of "nothing happens" bugs.

**Key flows to test after changes:**
- `GET /salao` → select product → verify unit dropdown populates
- `GET /dashboard` → verify 0 console errors, station dropdown populated, export button enabled
- `GET /cozinha-quente` → verify `#timerA` and `#timerB` exist, `.card-timer` per card
- `GET /cozinha-fria` → verify `#globalTimer` and `.card-timer` per card
- `POST /api/v1/demands` → verify demand appears in cozinha views and salao
- Cancel / stockout → verify status transitions, SLA evaluation, queue recompute

## Relevant Documentation Files

- `KDS_Bridge_Handoff_CONSOLIDADO.md` — Current architecture (v2.5), project history, deployment notes.
- `PLANO_MUDANCAS_CLIENTE.md` — v2.5 client changes (implemented & fixed). Reference for what was built.
- `supabase_schema.sql` — Database DDL (source of truth for schema).
- `orange-pi-autostart.sh` — Kiosk mode setup for Orange Pi devices.
