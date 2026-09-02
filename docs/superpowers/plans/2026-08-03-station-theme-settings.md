# Station Theme Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and apply independent light/dark themes for Salão, Quente A, Quente B, and Fria through the advanced management screen.

**Architecture:** Store `theme` on the three real `kitchen_stations` rows and store Salão's value in `system_settings.station_theme_salao`. The admin tab edits one station per row; operational pages load their theme from a public endpoint, with dark as the defensive fallback. Quente A/B become deterministic through `?station=quente_a|quente_b`.

**Tech Stack:** Fastify, TypeScript, PostgreSQL/Supabase SQL, vanilla HTML/CSS/JavaScript, Socket.IO, Playwright/Webwright.

## Global Constraints

- Theme values are exactly `dark` or `light`.
- Initial/default theme is `dark`.
- Salão appears as a fixed row in the existing `Cozinhas` tab.
- Each row saves with its own button; changing a select does not auto-save.
- Operational pages use the database value and do not use localStorage as an override.
- Any endpoint failure or invalid stored value applies `dark`.
- Existing demand, capacity, Socket.IO, filters, and admin flows remain functional.
- Do not commit or push without explicit user approval.

---

### Task 1: Schema and Types

**Files:**
- Create: `supabase/migrations/2026-08-03-station-themes.sql` (the repository has no existing versioned Supabase SQL directory, so this creates the explicit migration location).
- Modify: `src/types.ts` `KitchenStation` interface.
- Modify: `src/seed-prod.ts` or the active seed path if required by the existing schema convention.

**Interfaces:**
- Produces `kitchen_stations.theme: 'dark' | 'light'`.
- Produces `system_settings.station_theme_salao = 'dark'` when absent.

- [ ] Add idempotent SQL for `kitchen_stations.theme text NOT NULL DEFAULT 'dark'` and a `dark/light` check constraint.
- [ ] Add idempotent `system_settings` upsert for `station_theme_salao`.
- [ ] Update `KitchenStation` to expose `theme: 'dark' | 'light'`.
- [ ] Run the project's schema/type verification or `npm run build` and inspect SQL for idempotency.

### Task 2: Station Theme API

**Files:**
- Create: `src/routes/station-themes.ts`.
- Modify: `src/routes/kitchen-stations.ts`.
- Modify: `src/server.ts`.

**Interfaces:**
- `GET /api/v1/station-themes/:stationCode` returns `{ stationCode: string, theme: 'dark' | 'light' }`.
- `PATCH /api/v1/station-themes/salao` accepts `{ theme: 'dark' | 'light' }` and returns the same response shape.
- `PATCH /api/v1/kitchen-stations/:id` accepts partial `{ capacity?: number, theme?: 'dark' | 'light' }` and returns the updated station.

- [ ] Implement theme normalization so only `light` remains light and every other stored value is read as `dark`.
- [ ] Implement public reads for `salao`, `quente_a`, `quente_b`, and `fria`; return 404 for unknown codes.
- [ ] Implement Salão upsert with validation and HTTP 400 for invalid themes.
- [ ] Extend kitchen station PATCH validation to support partial capacity/theme updates while preserving existing capacity behavior and queue recomputation only when capacity changes.
- [ ] Register the route with the existing API prefixes.
- [ ] Verify API response shapes and 400/404 behavior with focused HTTP requests.

### Task 3: Admin Kitchens Tab

**Files:**
- Modify: `src/views/admin.html` panel `#panel-cozinhas`, station loader, row renderer, and save handlers.

**Interfaces:**
- `renderStationRow(station)` renders a real kitchen row with capacity, theme select, and save button.
- `renderSalonThemeRow(theme)` renders the fixed Salão row.
- `saveStationSettings(id)` preserves the current capacity and submits theme.
- `saveSalonTheme()` submits the selected Salão theme.

- [ ] Change table columns to Estação, Código, Capacidade, Tema, Salvar.
- [ ] Render fixed Salão row before API-loaded station rows.
- [ ] Populate each theme select from the database value with `dark` fallback.
- [ ] Keep capacity editing and update behavior intact.
- [ ] Disable only the active row's save button while saving and show `Salvando...`.
- [ ] Use the existing toast for success and error responses.
- [ ] Ensure labels, selects, active tabs, primary buttons, warning buttons, and table text use contrasting theme tokens in both admin themes; do not use `--c-primary` as text on an amber background.
- [ ] Verify light and dark screenshots of the tab at desktop and touch widths.

### Task 4: Shared Operational Theme Loader

**Files:**
- Create: `src/views/scripts/station-theme.js`.
- Modify: `package.json` build copy rule if the new asset is not already covered.
- Modify: `src/views/styles/theme.css` only for missing semantic contrast tokens/utilities.

**Interfaces:**
- `window.KDSStationTheme.apply(theme): 'dark' | 'light'`.
- `window.KDSStationTheme.load(stationCode): Promise<'dark' | 'light'>`.

- [ ] Implement `normalizeTheme`, `apply`, and endpoint-backed `load` with dark fallback.
- [ ] Never write station preferences to localStorage.
- [ ] Verify the asset is served and copied to `dist/views/scripts`.

### Task 5: Operational View Integration

**Files:**
- Modify: `src/views/salao.html`.
- Modify: `src/views/cozinha-quente.html`.
- Modify: `src/views/cozinha-fria.html`.
- Modify: `src/server.ts` routes/links only if needed to preserve explicit station selection.

- [ ] Add dark anti-flash bootstrap and load `station-theme.js`.
- [ ] Load `salao` in Salão and `fria` in Fria before rendering theme-dependent content.
- [ ] Make Quente A/B deterministic with `?station=quente_a|quente_b`, defaulting to `quente_a` when absent.
- [ ] Load only the selected hot station's theme and filter/render only that station when the query is present.
- [ ] Preserve existing socket room behavior, demand filters, action buttons, and capacity displays.
- [ ] Migrate operational text/background/border/button selectors to semantic tokens where required for readable light and dark variants.
- [ ] Explicitly audit every label, heading, badge, action button, disabled state, hover state, and modal control for readable foreground/background pairs in both themes.

### Task 6: Automated and Visual Verification

**Files:**
- Create/update: `outputs/final_runs/plan.md`.
- Create/update: `outputs/final_runs/run_<n>/final_script.py`.
- Create/update: `outputs/contrast_audit/` and screenshot artifacts.

- [ ] Run `npm run build`.
- [ ] Verify API persistence by setting each station to light and reading it back.
- [ ] Use Webwright to verify admin rows, per-row saves, reload persistence, and fallback behavior.
- [ ] Capture admin `Cozinhas` dark/light at `1280x1800` and `768x1024`.
- [ ] Capture Salão dark/light, Quente A dark/light, Quente B dark/light, and Fria dark/light at both viewports.
- [ ] Read every screenshot and inspect for label/background blending, especially tabs, selects, brown/amber buttons, action buttons, badges, station scores, modal text, and disabled controls.
- [ ] Run a computed-style contrast audit for representative controls and fail when foreground/background pairs are indistinguishable.
- [ ] Verify operational page errors are absent and existing functional controls remain present.
