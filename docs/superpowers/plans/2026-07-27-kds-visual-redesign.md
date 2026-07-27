# KDS Bridge Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visually redesign all 7 KDS Bridge HTML views by introducing a shared `theme.css` with design tokens, eliminating `#ff0000`/`alert()`, adding `prefers-reduced-motion`/`:focus-visible`/`:active` support, skeleton loaders, composed empty states, and tabular-nums — without breaking operational semantics.

**Architecture:** Fase 1 establishes `@fastify/static` + `theme.css` (no visible change). Fase 2 refactors each view's inline CSS to use tokens (visible changes). Fase 3 adds behavioral helpers (`showToast`, skeleton injection, composed empty states). Tokens-first means a broken token fails fast across all views, not per-view.

**Tech Stack:** Node.js + TypeScript (Fastify), vanilla HTML/CSS/JS, Socket.IO, PostgreSQL (Supabase). New dep: `@fastify/static`. New font: JetBrains Mono (Google Fonts CDN).

## Global Constraints

- **Stack:** Vanilla HTML/CSS/JS — no React, no Tailwind, no bundlers. CSS stays inline per view, with one shared `theme.css` linked via `<link rel="stylesheet" href="/styles/theme.css">` in each view's `<head>`.
- **Server entry:** `src/server.ts:38-46` loads views via `fs.readFileSync` at startup. After editing any `.html`, the dev server must be manually restarted (`ts-node-dev` does not re-trigger on HTML changes since views are cached). Use `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized` to run server in background; kill via `taskkill /PID <pid> /F` if port 3000 is occupied.
- **TypeScript:** Strict mode. Run `npx tsc --noEmit` after every change to `src/*.ts`. `npm run dev` uses `--transpile-only` so type errors won't surface there.
- **Banned literals (final state):** `#ff0000`, `#4a0000`, `alert(`, `confirm(` (except in `playNormalAlert()`/`playUrgentAlert()`/`playStockoutAlert()`/`playCrossCancelAlert()` which are JS function names, not the DOM `alert()`).
- **Preserved operational semantics (do NOT break):**
  - Salão modals `Confirmar Retirada` (`salao.html:335-344`) and `Cancelar Demanda` (`:320-333`) — intentional friction.
  - Gerente `Anular` modal with `disabled` confirm button until textarea filled (`gerente.html:291-296`).
  - Cozinha-quente split A/B columns + ready-strips `#readyA`/`#readyB` (`cozinha-quente.html:242,247`).
  - Cozinha-quente/fria Web Audio API alerts (`playNormalAlert`, `playUrgentAlert`, `playStockoutAlert`, `playCrossCancelAlert` — see `cozinha-quente.html:281-308`).
  - Salão `role="alert"` on `#toast` (`salao.html:284`).
  - Touch targets on salão buttons (`min-height: 48px`, padding `14px 28px`).
  - Cozinha-fria `#globalTimer` 28px top-right fixed.
  - Status color semantics: green=`#2a9d8f`, orange=`#f4a261`, red=`#e63946`, purple=stateful, cyan=`cozinha_fria` only.
- **Commits:** Atomic per task. Conventional commit style (`feat:`, `refactor:`, `fix:`, `style:`). DO NOT push or create PRs unless explicitly requested.
- **Per AGENTS.md gotcha:** Any `.catch(function() {})` empty body is forbidden — always include `console.error(err)`. Any `buildContent`/innerHTML must be wrapped in try/catch.
- **Per AGENTS.md gotcha:** When re-attaching event listeners on each load, store handler on DOM element (`el._ch = handler`) to allow `removeEventListener`.

---

## File Structure

**Files created:**
- `src/views/styles/theme.css` — Shared design tokens + base classes. ~150 lines.

**Files modified:**
- `package.json` — Add `@fastify/static` dep.
- `src/server.ts` — Register `@fastify/static` plugin (lines ~22-46).
- `src/views/salao.html` — Phase 2 token refactor (lines 9-275 inline CSS) + Phase 3 (1 alert → toast, skeleton, empty states, tabular-nums).
- `src/views/cozinha-quente.html` — Phase 2 (`#ff0000` removal, card.critical recolor, focus-visible) + Phase 3 (1 alert → toast).
- `src/views/cozinha-fria.html` — Phase 2 (cyan → `--c-accent-cold`, `#ff0000` removal) + Phase 3 (1 alert → toast).
- `src/views/cozinha.html` — Phase 2 tidy (legacy, low priority).
- `src/views/gerente.html` — Phase 2 (`badge-annulled` neutral recolor, tabular-nums in KPIs) + Phase 3 (skeleton, empty state).
- `src/views/admin.html` — Phase 2 (radius unification, tabular-nums in SLA inputs) + Phase 3 (3 `confirm()` → modal, skeleton in tbodies).
- `src/views/dashboard.html` — Phase 2 (`.mono` in 11 KPIs + score cards, `.btn-ghost` in period-selector) + Phase 3 (10 `alert()` → toast, empty state).

**Files NOT modified:**
- `dashboard/` Python/Streamlit sidecar (out of scope).
- Canvas drawing JS in `dashboard.html` (`drawMaChart`, etc.) — visually unchanged.

---

## Task 1: Baseline & Dependency Setup

**Files:**
- Modify (dep): `package.json`
- Read-only: all 7 views, `src/server.ts`, `AGENTS.md`

**Interfaces:**
- Produces: `@fastify/static` available to `import` in `src/server.ts`.

- [ ] **Step 1: Verify baseline state**

Run:
```powershell
npm run build
npx tsc --noEmit
```
Expected: Both pass with zero errors. If they don't, stop and fix existing errors before proceeding (out of scope for this plan otherwise).

- [ ] **Step 2: Install @fastify/static**

Run:
```powershell
npm install @fastify/static
npm install -D @types/@fastify-static 2>$null
```
Note: `@fastify/static` ships its own types as of v7+, so the `@types` install may 404. If so, ignore — types are already in-package.

- [ ] **Step 3: Verify package.json entry**

Read `package.json` `dependencies` block. Confirm `"@fastify/static": "^7.x.x"` (or similar recent version) is present.

- [ ] **Step 4: Run tsc to verify types resolve**

Run:
```powershell
npx tsc --noEmit
```
Expected: 0 errors. If `Cannot find module '@fastify/static'` appears, run `npm install` again; the previous install may have been interrupted.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json
git commit -m "chore: add @fastify/static for serving shared theme.css"
```

---

## Task 2: Create `theme.css` + Register `@fastify/static`

**Files:**
- Create: `src/views/styles/theme.css`
- Modify: `src/server.ts` (add `import fastifyStatic` near line 5, register plugin between DB connect and route definitions)

**Interfaces:**
- Produces: `GET /styles/theme.css` responds with the theme file. Available CSS custom properties listed in spec §4.2 (`--c-primary`, `--c-accent-warm`, `--c-accent-cold`, etc.). Base classes `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`, `.badge-pill`, `.card-base`, `.card-base-dark`, `.mono`, `.skeleton-block`, `.empty-state`, `.toast`, `.toast-error`, `.toast-warn`, `.toast-info`.

- [ ] **Step 1: Create `theme.css` directory**

Run:
```powershell
New-Item -ItemType Directory -Path "src\views\styles" -Force | Out-Null
```

- [ ] **Step 2: Write `theme.css` — full content per spec §4.2**

Write file `src/views/styles/theme.css` with this exact content:

```css
/* KDS Bridge — shared design tokens. Linked by all 7 views via
   <link rel="stylesheet" href="/styles/theme.css"> in their <head>.
   Inline <style> blocks in each view continue to exist and may
   reference these tokens via var(--...). */

@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

:root {
  /* === Color === */
  --c-primary: #1d3557;
  --c-primary-tint: #457b9d;
  --c-accent-warm: #2a9d8f;     /* teal — cooking/ok */
  --c-accent-cold: #00a8c8;     /* cyan desaturated — cozinha-fria */
  --c-warn: #f4a261;            /* orange — late/stockout */
  --c-danger: #e63946;          /* red — urgent/cancel */
  --c-danger-strong: #c81d25;   /* #ff0000 banido — ainda perigoso, mas não vestibular */
  --c-replacement: #8e7cc3;     /* roxo dessaturado (era #9b59b6) */

  /* === Surfaces === */
  --c-bg-light: #f4f4f5;
  --c-bg-dark: #0f0f0f;
  --c-bg-dark-cold: #0a1628;
  --c-surface: #ffffff;
  --c-surface-dark: #1a1a1a;
  --c-surface-dark-cold: #0d1f3c;

  /* === Text === */
  --c-text: #1e1e1e;
  --c-text-muted: #6b7280;
  --c-text-invert: #f4f4f5;
  --c-text-invert-muted: #9ca3af;

  /* === Borders === */
  --c-border-light: #e0e0e0;
  --c-border-dark: #2a2a2a;
  --c-border-dark-cold: #1a3054;

  /* === Alert state backgrounds === */
  --alert-urgent-bg-dark: #2d0a0a;
  --alert-urgent-bg-light: #fef2f2;
  --alert-warn-bg-dark: #2d1a00;
  --alert-warn-bg-light: #fff7ed;
  --alert-ok-bg-dark: #0a1a14;
  --alert-ok-bg-light: #f0fdf8;
  --alert-replacement-bg-dark: #1a1025;
  --alert-replacement-bg-light: #f5f0fa;

  /* === Radius scale (collapses 8 valores → 4) === */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 14px;
  --radius-pill: 999px;

  /* === Shadow — tinted, layered === */
  --shadow-card: 0 1px 0 rgba(255,255,255,0.04) inset, 0 6px 18px -8px rgba(29,53,87,0.18);
  --shadow-card-hover: 0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 32px -10px rgba(29,53,87,0.28);
  --shadow-card-dark: 0 1px 0 rgba(255,255,255,0.04) inset, 0 6px 18px -8px rgba(0,0,0,0.55);
  --shadow-elevated: 0 12px 32px -10px rgba(29,53,87,0.35);

  /* === Spacing scale (4px-based) === */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-7: 32px; --sp-8: 40px;

  /* === Typography === */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace;
  --fw-regular: 400; --fw-medium: 500; --fw-semi: 600;
  --fw-bold: 700; --fw-heavy: 800;

  /* === Motion === */
  --t-fast: 150ms; --t-base: 200ms; --t-slow: 300ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);

  /* === Z-index scale === */
  --z-base: 0; --z-content: 10; --z-sticky: 100;
  --z-toast: 200; --z-modal: 300;
}

/* === Base classes === */
.btn { padding: 12px 24px; font-size: 14px; font-weight: var(--fw-semi);
       border-radius: var(--radius-md); border: 0; cursor: pointer;
       transition: transform var(--t-fast) var(--ease-out),
                   background var(--t-fast) var(--ease-out),
                   box-shadow var(--t-fast) var(--ease-out); }
.btn-primary { background: var(--c-primary); color: var(--c-text-invert); }
.btn-primary:hover { filter: brightness(1.1); }
.btn-secondary { background: var(--c-surface); color: var(--c-text);
                 border: 1px solid var(--c-border-light); }
.btn-secondary:hover { border-color: var(--c-primary-tint); }
.btn-danger { background: var(--c-danger); color: var(--c-text-invert); }
.btn-danger:hover { filter: brightness(1.08); }
.btn-ghost { background: transparent; color: var(--c-primary);
             padding: 8px 16px; border: 1px solid transparent; }
.btn-ghost:hover { background: rgba(29,53,87,0.06); }

.badge-pill { border-radius: var(--radius-pill); padding: 4px 12px;
              font-size: 11px; font-weight: var(--fw-heavy);
              text-transform: uppercase; letter-spacing: 1px;
              display: inline-block; }

.card-base { background: var(--c-surface); border-radius: var(--radius-xl);
             padding: var(--sp-4); box-shadow: var(--shadow-card);
             transition: box-shadow var(--t-base) var(--ease-out),
                         transform var(--t-base) var(--ease-out); }
.card-base:hover { box-shadow: var(--shadow-card-hover); }

.card-base-dark { background: var(--c-surface-dark);
                  border-radius: var(--radius-lg);
                  border-left: 4px solid var(--c-border-dark);
                  padding: var(--sp-4) var(--sp-5); }

.mono { font-family: var(--font-mono);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0; }

/* === Focus-visible ring (teclado, não mouse) === */
:focus-visible {
  outline: 2px solid var(--c-accent-warm);
  outline-offset: 2px;
  border-radius: inherit;
}

/* === Active pressed (toque/clique físico) === */
.btn:active, button:active {
  transform: translateY(1px);
  transition-duration: 40ms;
}

/* === Skeleton shimmer === */
.skeleton-block {
  background: linear-gradient(90deg,
    var(--c-border-light) 25%, #f0f0f0 50%, var(--c-border-light) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

/* === Empty state composto === */
.empty-state {
  text-align: center; padding: var(--sp-8) var(--sp-5);
  color: var(--c-text-muted); display: flex; flex-direction: column;
  align-items: center; gap: var(--sp-3);
}
.empty-state svg { width: 48px; height: 48px;
                   stroke: var(--c-text-muted); stroke-width: 1.5;
                   fill: none; }
.empty-state h4 { font-size: 14px; font-weight: var(--fw-semi);
                  color: var(--c-text); margin: 0; }
.empty-state p { font-size: 13px; margin: 0; max-width: 320px; }
.empty-state .btn-ghost { margin-top: var(--sp-2); }

/* === Toast (substitui alert()) === */
.toast { position: fixed; right: var(--sp-5); top: var(--sp-5);
         background: var(--c-surface); padding: var(--sp-3) var(--sp-4);
         border-radius: var(--radius-md); box-shadow: var(--shadow-elevated);
         z-index: var(--z-toast); max-width: 360px;
         transition: opacity var(--t-base) var(--ease-out);
         font-size: 14px; color: var(--c-text); }
.toast-error { border-left: 4px solid var(--c-danger); }
.toast-warn { border-left: 4px solid var(--c-warn); }
.toast-info  { border-left: 4px solid var(--c-primary-tint); }

/* === prefers-reduced-motion: mata animação, preserva estado === */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  /* Explicit overrides: estado visual preservado (cor de fundo/borda) */
  .card.critical, .card.cross-cancelled, .card.urgent, .card.stockout,
  .badge.ready-badge, .col-timer, .card-timer {
    animation: none !important;
  }
  .skeleton-block { animation: none;
                    background: var(--c-border-light); }
}
```

- [ ] **Step 3: Register `@fastify/static` in `src/server.ts`**

Read `src/server.ts:1-50` to find the import block and `await fastify.register(...)` calls. Add the import at the top with other imports:

```typescript
import fastifyStatic from '@fastify/static';
```

Then register the plugin BEFORE the view route handlers (i.e. before line 48 `fastify.get('/salao', ...)`). Place this block right after the view preload object (after line 46):

```typescript
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'views', 'styles'),
  prefix: '/styles/',
  prefixAvoidTrailingSlash: true,
});
```

Note: This must be `await`ed inside the boot function — verify that `server.ts` already uses top-level await or wraps boot in an `async` function (it does, per AGENTS.md).

- [ ] **Step 4: Typecheck + build**

Run:
```powershell
npx tsc --noEmit
```
Expected: 0 errors. If error `"Property 'register' does not exist on type..."` appears, verify Fastify plugin types are auto-augmented (they should be).

- [ ] **Step 5: Start dev server in background**

Run:
```powershell
Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized
Start-Sleep -Seconds 5
```
Wait 5s for DB lazy-init.

- [ ] **Step 6: Curl `/styles/theme.css` to verify it serves**

Run:
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/styles/theme.css" -UseBasicParsing | Select-Object StatusCode, @{Name="Length";Expression={$_.Content.Length}}
```
Expected: `StatusCode = 200`, `Length > 3000` (theme.css is ~3000 chars).

- [ ] **Step 7: Commit**

```powershell
git add src/views/styles/theme.css src/server.ts
git commit -m "feat: add shared theme.css with design tokens + @fastify/static registration"
```

---

## Task 3: Link `theme.css` from all 7 views (no visual change yet)

**Files:**
- Modify: all 7 views in `src/views/*.html` — insert one `<link>` line in each `<head>`

**Interfaces:**
- Produces: All 7 views load `theme.css` (verified via Playwright network panel). Visual appearance unchanged because no inline CSS yet references the tokens.

- [ ] **Step 1: Read the `<head>` of each view to identify insertion anchor**

Use grep to find the Google Fonts `<link>` line (it's in all 7 views at line 6 or 7):

```powershell
Select-String -Path src\views\*.html -Pattern "fonts.googleapis.com" | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }
```

Expected: 7 hits, each at line 6 or 7 according to file.

- [ ] **Step 2: Insert `<link rel="stylesheet" href="/styles/theme.css">` immediately AFTER the Google Fonts `<link>` in each view**

For each of the 7 views, use the `edit` tool with:

**oldString:**
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```
**newString:**
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles/theme.css">
```

Verify each edit succeeds (no "oldString not found" errors — if so, check for whitespace variations in that view's link line).

- [ ] **Step 3: Restart dev server (HTML changes don't auto-reload)**

Kill the running dev server PID and restart:

```powershell
$port = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue)
if ($port) { taskkill /PID $port.OwningProcess /F }
Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized
Start-Sleep -Seconds 5
```

- [ ] **Step 4: Verify with Webwright — visual unchanged, theme.css loads**

Load each view via Playwright and check:
- `http://localhost:3000/salao` — Network: 200 for `/styles/theme.css`
- `http://localhost:3000/cozinha-quente` — same
- `http://localhost:3000/cozinha-fria` — same
- `http://localhost:3000/gerente` — same
- `http://localhost:3000/admin` — same
- `http://localhost:3000/dashboard` — same
- `http://localhost:3000/cozinha` — same

Use the `webwright` skill or Playwright MCP directly. For each view, snapshot the page and check browser console for 0 errors (no 404 on `/styles/theme.css`).

- [ ] **Step 5: Commit**

```powershell
git add src/views/*.html
git commit -m "feat: link shared theme.css from all 7 views"
```

---

## Task 4: Phase 2 — `salao.html` visual refactor (light view)

**Files:**
- Modify: `src/views/salao.html` (inline `<style>` lines 9-275, plus inline `<script>` lines 346-891)

**Interfaces:**
- Consumes: All tokens from Task 2's `theme.css`.
- Produces: Salao buttons use `.btn`, badges use `.badge-pill`, cards use `.card-base`. Tabular-nums on qty fields and counters.

- [ ] **Step 1: Read existing `<style>` block fully**

Read `src/views/salao.html:9-275` to inventory every hardcoded color, radius, shadow, and gradient.

- [ ] **Step 2: Replace hardcoded colors with token references**

Find and replace these patterns via the `edit` tool:

| Literal | Replacement |
|---|---|
| `#1d3557` (where it's primary) | `var(--c-primary)` |
| `#2a9d8f` (success/ready) | `var(--c-accent-warm)` |
| `#e63946` (danger/urgent) | `var(--c-danger)` |
| `#f4a261` (warn/stockout) | `var(--c-warn)` |
| `#457b9d` (normal/dusty) | `var(--c-primary-tint)` |
| `#f4f4f5` (light bg) | `var(--c-bg-light)` |
| `#1e1e1e` (text) | `var(--c-text)` |
| `#6b7280` (muted text) | `var(--c-text-muted)` |
| `#9ca3af` (placeholder) | `var(--c-text-invert-muted)` (used on light bg, so muted — actually need `--c-text-muted`) |
| `#e0e0e0` (light border) | `var(--c-border-light)` |

Use `replaceAll: true` on each color where appropriate, BUT after each `replaceAll`, scan the file for false positives (e.g. a color used in two contexts). Re-run `Read` on suspicious ranges.

- [ ] **Step 3: Replace 8 different border-radius values with token refs**

Per spec §6.9, standardize:
- `3px`, `4px` → `var(--radius-sm)` (small inputs, badges inner)
- `5px`, `6px`, `8px` → `var(--radius-md)` (buttons, badge inner)
- `10px`, `12px` → `var(--radius-lg)` (no usage in salao expected — verify)
- `14px`, `16px` → `var(--radius-xl)` (cards, panels)
- `20px`, `999px` → `var(--radius-pill)` (badges)

Targeted replacements via `edit` — DO NOT use global replaceAll on `border-radius: 8px` because it appears in different semantic contexts.

- [ ] **Step 4: Replace generic shadows with tinted tokens**

Find:
- `box-shadow: 0 4px 16px rgba(0,0,0,0.06)` (card surface) → `box-shadow: var(--shadow-card)`
- `box-shadow: 0 8px 24px rgba(0,0,0,0.1)` (hover) → `box-shadow: var(--shadow-card-hover)`
- `box-shadow: 0 2px 8px rgba(0,0,0,0.15)` (button shadow at `:42-55`) → keep but consider token (if salão buttons use min-height 48px touch, keep this shadow for tactile feel — DO NOT shrink).

- [ ] **Step 5: Add tabular-nums to qty and counter elements**

Find qty input, ndemand counter spans. Add `class="mono"` to:
- The qty input display (where `qty` is shown, likely an `<output>` or `<span>`)
- The "X demandas ativas" header counter
- Any `.card-number` / `.card-qty` element

For each, wrap the existing text-bearing element with `class="mono"` OR add `font-variant-numeric: tabular-nums` to its CSS rule. Verify by reading the surrounding markup.

- [ ] **Step 6: Restart dev server and review salao**

Kill PID + restart `npm run dev` (HTML changed — server caches views).

Open `http://localhost:3000/salao` via Playwright. Snapshot. Check:
- Layout unchanged (form with product/unit/qty)
- Buttons render with token-based colors (navy primary, teal/etc.)
- 0 console errors
- Pre-existing `role="alert"` on `#toast` still present
- Pre-existing modals (Confirmar Retirada, Cancelar Demanda) still openable (click "Pronto" badge on a ready demand → modal opens)

- [ ] **Step 7: Commit**

```powershell
git add src/views/salao.html
git commit -m "refactor(salao): replace hardcoded colors/radii/shadows with theme.css tokens"
```

---

## Task 5: Phase 2 — `cozinha-quente.html` critical card recolor + GPU-safe animation (kiosk)

**Files:**
- Modify: `src/views/cozinha-quente.html` (inline `<style>` lines 9-235, inline `<script>` lines 266-791)

**Interfaces:**
- Consumes: All tokens from Task 2.
- Produces: `.card.critical`, `.card.cross-cancelled`, `.card.urgent`, `.card.stockout` no longer use `#ff0000` or `#4a0000`. Animations now respect `prefers-reduced-motion` (from theme.css global). `:focus-visible` ring available on PRONTO/CANCELAR buttons.

- [ ] **Step 1: Read current kitchen card state styles**

Read `src/views/cozinha-quente.html:9-235` inline CSS, focusing on `.card.critical` (line 76), `.card.cross-cancelled` (line 82), `.card.urgent` (line 72), `.card.stockout` (line 77), keyframes (`urgentPulse`, `criticalPulse`, `crossCancelPulse`, `stockoutPulse`) defined elsewhere in the same inline style.

- [ ] **Step 2: Recolor `.card.critical` — eliminate `#ff0000` and `#4a0000`**

Locate (line 76 area):
```css
.card.critical { background: #4a0000; border-left-color: #ff0000; animation: criticalPulse 0.8s infinite; }
```

Replace with:
```css
.card.critical { background: var(--alert-urgent-bg-dark); border-left-color: var(--c-danger-strong); animation: criticalPulse 1.6s infinite; }
```

Changes:
- Background `#4a0000` → `var(--alert-urgent-bg-dark)` (#2d0a0a — remaining dangerous-feeling, not vestibular)
- Border `#ff0000` → `var(--c-danger-strong)` (#c81d25 — saturated but not pure)
- Animation period `0.8s` → `1.6s` (slower — less aggressive; slower pulse reads as "attention" not "emergency seizure")

- [ ] **Step 3: Recolor `.card.cross-cancelled` — eliminate `#ff0000`**

Locate (line 82 area):
```css
.card.cross-cancelled { border: 2px solid #ff0000 !important; animation: shake 0.5s ease 3, crossCancelPulse 1s infinite !important; }
```

Replace with:
```css
.card.cross-cancelled { border: 2px solid var(--c-danger-strong) !important; animation: shake 0.5s ease 3, crossCancelPulse 1.4s infinite !important; }
```

Changes:
- Border `#ff0000` → `var(--c-danger-strong)`
- crossCancelPulse slowed from `1s` to `1.4s` (calmer infinite cadence)
- `shake 0.5s ease 3` PRESERVED (only 3 cycles — vestibular-safe)

- [ ] **Step 4: Recolor `.urgent` and `.stockout` borders if they reference `#ff0000`**

Check `.card.urgent` (line 72) and `.card.stockout` (line 77). They use `#e63946` and `#f4a261` already. Update to tokens:
```css
.card.urgent { background: var(--alert-urgent-bg-dark); border-left-color: var(--c-danger); border-left-width: 6px; animation: urgentPulse 2s infinite; }
.card.stockout { background: var(--alert-warn-bg-dark); border: 2px solid var(--c-warn); border-left-width: 6px; animation: stockoutPulse 1.5s infinite; }
```

- [ ] **Step 5: Update keyframes to GPU-safe `transform`/`opacity` only**

For each pulse keyframe in this view, replace `box-shadow` animations with `transform: scale(1.01)` or `opacity`. Example:

```css
@keyframes urgentPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.01); opacity: 0.92; }
}
@keyframes criticalPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.015); }
}
@keyframes stockoutPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}
@keyframes crossCancelPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.01); }
}
```

Keep `shake` keyframe AS IS — it uses `transform: translateX()` already, GPU-safe.

- [ ] **Step 6: Add `:focus-visible` styling to action buttons**

The global `:focus-visible` rule from `theme.css` applies automatically. No additional inline CSS needed unless buttons currently have `outline: none` overrides. Search for `outline: none` in this view's CSS — remove it if present on buttons (per AGENTS.md gotcha about removing focus without replacing).

- [ ] **Step 7: Restart dev + verify via Webwright**

Kill PID + restart `npm run dev`.

Open `http://localhost:3000/cozinha-quente` full-screen (1080p viewport). Snapshot.

Manual flow:
1. POST a demand via `curl` or salao to create a `pending` card → verify renders, audio `playNormalAlert` fires, no console errors.
2. POST urgent demand → verify card.critical style triggers after SLA breach (or via direct DB manipulation if SLA is long). Check color is dark-red, not pure red. Check animation is calmer.
3. Cancel a demand from salao while it's cooking → cross-cancel toast + card shake (3 cycles) + border dark-red (not pure red).
4. Inspect `.card` element via DevTools — verify computed border-color and background use tokens.
5. Toggle `prefers-reduced-motion: reduce` in DevTools → verify all pulses stop, but cards still show their state colors.

- [ ] **Step 8: Commit**

```powershell
git add src/views/cozinha-quente.html
git commit -m "refactor(cozinha-quente): ban #ff0000, slow pulses for vestibular safety, GPU-safe transforms"
```

---

## Task 6: Phase 2 — `cozinha-fria.html` cyan integration + critical recolor

**Files:**
- Modify: `src/views/cozinha-fria.html` (lines 9-229 inline style, lines 255-766 script)

**Interfaces:**
- Consumes: tokens including new `--c-accent-cold` (#00a8c8), `--c-bg-dark-cold`, `--c-surface-dark-cold`, `--c-border-dark-cold`.
- Produces: Cold kitchen uses cyan as identity accent (h1, border-bottom). `#ff0000` and `#00d4ff` literals replaced by tokens.

- [ ] **Step 1: Read inline style block**

Read `src/views/cozinha-fria.html:9-229` to inventory colors. Identify lines using `#00d4ff` (line 51-52 area), `#ff0000` (line 71, 77 area).

- [ ] **Step 2: Replace `#00d4ff` with `--c-accent-cold`**

Find `#00d4ff` (cyan accent on cold kitchen h1 and border-bottom). Replace with `var(--c-accent-cold)` via the `edit` tool.

If used in:
- `h1 { color: #00d4ff; ... background: #0d1f3c; ... }` → `h1 { color: var(--c-accent-cold); ... background: var(--c-surface-dark-cold); ... }`
- `border-bottom: 1px solid #00d4ff` → `border-bottom: 1px solid var(--c-accent-cold)`

- [ ] **Step 3: Update background tokens**

Find `#0a1628` (body bg), `#0d1f3c` (surface). Replace with `var(--c-bg-dark-cold)`, `var(--c-surface-dark-cold)` respective.

- [ ] **Step 4: Same critical-card recolor as cozinha-quente**

Apply the same recolor from Task 5 Step 2-5 to this view's `.card.critical`, `.card.cross-cancelled`, `.card.urgent`, `.card.stockout`. Update keyframes to GPU-safe transforms.

- [ ] **Step 5: Restart + verify**

Restart dev server. Open `http://localhost:3000/cozinha-fria`. Snapshot.

Check:
- h1 uses desaturated cyan (slightly less neon than original `#00d4ff`)
- Top-right `#globalTimer` 28px still fixed and tabular
- 0 console errors
- `.card.critical` (force-trigger via DB or short SLA) shows dark-red instead of pure red

- [ ] **Step 6: Commit**

```powershell
git add src/views/cozinha-fria.html
git commit -m "refactor(cozinha-fria): integrate --c-accent-cold, ban #ff0000, GPU-safe pulses"
```

---

## Task 7: Phase 2 — `gerente.html` `badge-annulled` neutral recolor + KPI tabular-nums

**Files:**
- Modify: `src/views/gerente.html` (lines 9-225 style, plus script)

**Interfaces:**
- Consumes: tokens from theme.css.
- Produces: `.badge-annulled` is hollow (transparent bg, muted border + text) — neutral, not danger. `.metric-card p` (36px KPI numbers) uses tabular-nums. `.calendar-grid` cells use tabular-nums.

- [ ] **Step 1: Find `.badge-annulled` definition**

Read `src/views/gerente.html:200-210` to see current definition:
```css
.badge-annulled { display: inline-block; background: #e63946; color: white; font-size: 11px;
                  font-weight: 700; padding: 3px 10px; border-radius: 999px; letter-spacing: 0.5px; }
```

- [ ] **Step 2: Recolor to neutral hollow**

Replace with:
```css
.badge-annulled { display: inline-block; background: transparent; color: var(--c-text-muted);
                  font-size: 11px; font-weight: var(--fw-bold); padding: 3px 10px;
                  border: 1.5px solid var(--c-text-muted); border-radius: var(--radius-pill);
                  letter-spacing: 0.5px; }
```

Verify that `tr.row-annulled { opacity: 0.55; }` and `tr.row-annulled td { text-decoration: line-through; }` are UNCHANGED.

- [ ] **Step 3: Add tabular-nums to KPI numbers**

Locate `.metric-card p { font-size: 36px; font-weight: 800; }` (line 55 area). Update to:
```css
.metric-card p { font-size: 36px; font-weight: var(--fw-heavy);
                 font-variant-numeric: tabular-nums;
                 font-family: var(--font-mono); }
```

- [ ] **Step 4: Add tabular-nums to calendar dates + history table durations**

Find `.calendar-grid .day-cell` (or similar). Add `font-variant-numeric: tabular-nums;` to its CSS. Also find the history table cells that render durations (e.g. "12m 30s", "5m") — add `class="mono"` to those `<td>` elements in the render function (in JS).

Read the script section (lines 301-645) to find the `renderHistory` / `loadHistory` function. Locate where duration `<td>` is built. Wrap with `<td class="mono">${...}</td>`.

- [ ] **Step 5: Restart + verify**

Restart dev server. Open `http://localhost:3000/gerente`. Snapshot.

Check:
- Historical `Anulada` badge is now gray-bordered hollow, not red filled
- Metric card numbers (Total Demands Today, Avg Service Time, etc.) render with monospace tabular figures — width is fixed regardless of digit count
- Calendar grid dates render tabular
- 0 console errors
- `Anular` modal still requires text in textarea before enable (intentional friction preserved)

- [ ] **Step 6: Commit**

```powershell
git add src/views/gerente.html
git commit -m "refactor(gerente): badge-annulled neutral, KPIs/calendar use tabular-nums"
```

---

## Task 8: Phase 2 — `admin.html` radius unification + SLA tabular-nums

**Files:**
- Modify: `src/views/admin.html` (lines 9-116 style)

**Interfaces:**
- Produces: `.tab` uses `var(--radius-md)`, `.panel` uses `var(--radius-xl)`, SLA inputs use tabular-nums.

- [ ] **Step 1: Read inline style**

Read `src/views/admin.html:9-116`.

- [ ] **Step 2: Replace radius values**

Find `.tab { border-radius: 12px 12px 0 0; }` (line 22). Replace:
```css
.tab { border-radius: var(--radius-md) var(--radius-md) 0 0; }
```

Find `.panel { border-radius: 0 14px 14px 14px; }` (line 30). Replace:
```css
.panel { border-radius: 0 var(--radius-xl) var(--radius-xl) var(--radius-xl); }
```

- [ ] **Step 3: Add tabular-nums to SLA inputs**

SLA inputs exist in the product CRUD form (probably an `<input type="number">` for `sla_minutes_normal` / `sla_minutes_urgente`). Search for those input names in the script. Either:
- Add a class `.mono` to those inputs in markup, OR
- Add `input[type="number"] { font-variant-numeric: tabular-nums; }` to inline CSS.

Prefer the scoped approach — add a class `sla-input` to those specific inputs and CSS:
```css
.sla-input { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: Restart + verify**

Restart dev. Open `http://localhost:3000/admin`. Snapshot.

Check:
- Tabs at top of admin look unified
- Active tab and panel corners match (`--radius-md` for tabs, `--radius-xl` for panel)
- SLA inputs render in monospace font
- Tab switching still works (no JS regression)
- 0 console errors

- [ ] **Step 5: Commit**

```powershell
git add src/views/admin.html
git commit -m "refactor(admin): unify tab/panel radius, SLA inputs use tabular-nums"
```

---

## Task 9: Phase 2 — `dashboard.html` `.mono` on KPIs + `--c-*` token swaps

**Files:**
- Modify: `src/views/dashboard.html` (lines 12-218 style, plus KPI render in script)

**Interfaces:**
- Produces: All 11 `.kpi-value` elements use `class="mono"`. All score cards (entity performance 0-5) render in mono. Period-selector buttons use `.btn-ghost`. Hardcoded `#1d3557`/`#2a9d8f`/etc. colors in `<style>` are token-referenced.

- [ ] **Step 1: Read inline style + KPI render function**

Read `src/views/dashboard.html:12-218` (CSS) and grep for `kpi-value` in the script to find the render function. Likely at line 317 area per `renderKpis`.

- [ ] **Step 2: Replace CSS hardcoded colors with tokens**

Apply same targeted replacements as Task 4, but for THIS view's CSS only. Target the header `#1d3557`, the period-btn selectors, the `.c-*` color modifier classes on `.kpi-card`.

The `.c-cyan` modifier on `.kpi-card` (line 51 area) — change from `#457b9d` or `var(--c-primary-tint)` to `var(--c-accent-cold)` if those two KPIs (Tempo Médio Coz., Tempo Retirada) make more sense as cyan-coded (per spec §4.2 decision to use cyan for cold-side — but those KPIs aren't cold-related, they're timing. Use `var(--c-primary-tint)`.). Leave `.c-cyan` modifier using a darker variant for visual distinction. Verify by reading the surrounding markup intent.

- [ ] **Step 3: Wrap `.kpi-value` with class mono**

In the `renderKpis(data)` function, find where `<div class="kpi-value">...</div>` is built. Change to `<div class="kpi-value mono">...</div>` then CSS rule:
```css
.kpi-value { font-size: 26px; font-weight: var(--fw-heavy); margin: 4px 0; }
```
Add to this rule:
```css
.kpi-value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

Equivalent via `.mono` class addition in markup.

- [ ] **Step 4: Period-selector buttons → `.btn-ghost`**

Find `.period-btn { ... }` styles. Replace with tokens. Update the buttons in markup to also have `class="btn btn-ghost"` (so hover behaviors come from theme.css).

Read the existing `.period-btn` definition first to preserve its visual identity (active state for selected period). If `.period-btn.active` exists with a `#1d3557` background, preserve that.

- [ ] **Step 5: Score cards → mono**

Find the entity performance score cards in the render function (per spec they're at line 1009+). Wrap score number renders (e.g. "Score: 4.2" or "4.2 / 5") with `class="mono"` on the numeric portion.

- [ ] **Step 6: Restart + verify**

Restart dev. Open `http://localhost:3000/dashboard`. Snapshot.

Check:
- 11 KPIs render — values are monospace tabular (widths don't jump when digits change)
- Score cards render with mono numerics
- Period-selector buttons work (Hoje / Ontem / 7 dias / 30 dias)
- Custom date range still works
- Export PDF and Export Excel buttons open the export modal (don't trigger exports yet — that's panel 3)
- 0 console errors

- [ ] **Step 7: Commit**

```powershell
git add src/views/dashboard.html
git commit -m "refactor(dashboard): KPI values use .mono, period-selector uses .btn-ghost, tokens"
```

---

## Task 10: Phase 2 — `cozinha.html` (legacy) tidy

**Files:**
- Modify: `src/views/cozinha.html` (lines 8-163 style)

**Interfaces:**
- Produces: Legacy view tokens-referenced. `#ff0000` (if any) removed. Lowest priority — minimal effort.

- [ ] **Step 1: Read inline style**

Read `src/views/cozinha.html:8-163`.

- [ ] **Step 2: Tokenize colors + critical card recolor**

Apply same approach as Tasks 5-6 but lighter. Replace `#1d3557`, `#2a9d8f`, `#e63946`, `#f4a261`, `#4a0000`, `#ff0000` with their `var(--c-*)` and `var(--alert-*-bg-*)` counterparts.

Apply same critical-card recolor pattern as Tasks 5-6 if `.card.critical` exists here.

- [ ] **Step 3: Restart + verify**

Restart dev. Open `http://localhost:3000/cozinha`. Snapshot. Verify it loads without errors (this is the legacy aggregator view — not in Orange Pi deployment but must still work).

- [ ] **Step 4: Commit**

```powershell
git add src/views/cozinha.html
git commit -m "refactor(cozinha-legacy): tokenize colors, ban #ff0000"
```

---

## Task 11: Phase 3 — `showToast` helper + replace `alert()` in `dashboard.html` (10 calls)

**Files:**
- Modify: `src/views/dashboard.html` (script lines 309-1526)

**Interfaces:**
- Produces: `showToast(msg, kind)` function defined near top of script. All 10 `alert(...)` calls at lines 1279, 1281, 1282, 1284, 1322, 1431, 1437, 1447, 1474, 1500 replaced.

- [ ] **Step 1: Read script section + identify alert call sites**

Read `src/views/dashboard.html:1275-1285`, `:1320-1325`, `:1428-1435`, `:1438-1442`, `:1445-1450`, `:1472-1476`, `:1498-1502` to see context around each alert.

- [ ] **Step 2: Insert `showToast` helper near top of script**

After the `<script>` tag at line 309, find a good insertion point (after any existing `state` object or IIFE wrapper). Insert:

```javascript
function showToast(msg, kind /* 'error' | 'warn' | 'info' */) {
  var t = document.createElement('div');
  t.className = 'toast toast-' + (kind || 'info');
  t.setAttribute('role', 'alert');
  t.textContent = msg;
  document.body.appendChild(t);
  var duration = (kind === 'error') ? 12000 : 4000;
  setTimeout(function() {
    t.style.opacity = '0';
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
  }, duration);
}
```

- [ ] **Step 3: Replace each `alert(...)` call with `showToast(..., kind)`**

For each of the 10 lines, use `edit` with targeted oldString/newString. Mapping:

| Line | Old | New |
|---|---|---|
| 1279 | `alert('Selecione a data de início.');` | `showToast('Selecione a data de início.', 'warn');` |
| 1281 | `alert('Datas inválidas.');` | `showToast('Datas inválidas.', 'warn');` |
| 1282 | `alert('A data de início deve ser anterior à data final.');` | `showToast('A data de início deve ser anterior à data final.', 'warn');` |
| 1284 | `alert('O período máximo é de 31 dias.');` | `showToast('O período máximo é de 31 dias.', 'warn');` |
| 1322 | `alert('Carregue os dados primeiro.');` | `showToast('Carregue os dados primeiro.', 'warn');` |
| 1431 | `alert('Erro ao gerar PDF: ' + e.message);` | `showToast('Erro ao gerar PDF: ' + e.message, 'error');` |
| 1437 | `alert('Biblioteca XLSX não carregada.');` | `showToast('Biblioteca XLSX não carregada.', 'error');` |
| 1447 | `alert('Por dia limitado a 31 dias.');` | `showToast('Por dia limitado a 31 dias.', 'warn');` |
| 1474 | `alert('Nenhum dado encontrado para exportação.');` | `showToast('Nenhum dado encontrado para exportação.', 'warn');` |
| 1500 | `alert('Erro ao gerar Excel: ' + e.message);` | `showToast('Erro ao gerar Excel: ' + e.message, 'error');` |

- [ ] **Step 4: Restart + verify via Webwright**

Restart dev. Open `http://localhost:3000/dashboard`. Trigger each path:
- Open dashboard, click "Aplicar" with empty date range → expect toast (top-right) "Selecione a data de início.", 4s visible
- Put invalid date → expect toast "Datas inválidas."
- Click Exportar Excel with no data loaded → expect toast "Carregue os dados primeiro."
- (Generate PDF error harder to trigger — verify via reading the code path, no need to force an error)

Check that NO native browser `alert()` dialog opens in any of these flows. Verify 0 console errors.

- [ ] **Step 5: Commit**

```powershell
git add src/views/dashboard.html
git commit -m "feat(dashboard): replace 10 alert() with non-blocking toast helper"
```

---

## Task 12: Phase 3 — `showToast` in `salao.html` (1 alert), `cozinha-quente.html` (1 alert), `cozinha-fria.html` (1 alert), `gerente.html` (0 alerts)

**Files:**
- Modify: `src/views/salao.html`, `src/views/cozinha-quente.html`, `src/views/cozinha-fria.html`

**Interfaces:**
- Produces: Each of these 3 views has its own `showToast` helper inline (per AGENTS.md "JS is inline per view" architecture). Total 3 `alert()` calls removed.

- [ ] **Step 1: Read salao alert context**

Read `src/views/salao.html:800-810` to see the alert at line 804.

- [ ] **Step 2: Insert showToast helper + replace alert in salao**

Find an insertion point in the salao script (after existing `loadActiveDemands` and helpers, before any IIFE end). Insert the same `showToast` function as Task 11 Step 2.

Then replace line 804:
- Old: `alert('Selecione um produto para continuar.');`
- New: `showToast('Selecione um produto para continuar.', 'warn');`

Verify that the existing `#toast` element (`salao.html:284` with `role="alert"`) is unaffected — that's the existing inner toast for live updates, separate from the new generic `showToast` helper. They can coexist; the new helper appends a `.toast` class element to body, while the existing `#toast` is a single fixed element. Optionally consolidate later.

- [ ] **Step 3: Repeat for cozinha-quente**

Read `src/views/cozinha-quente.html:620-630` to see the alert at line 626. Insert the same `showToast` helper. Replace:
- Old: `alert('Erro ao cancelar demanda. Tente novamente.');`
- New: `showToast('Erro ao cancelar demanda. Tente novamente.', 'error');`

- [ ] **Step 4: Repeat for cozinha-fria**

Read `src/views/cozinha-fria.html:605-615` to see the alert at line 607. Insert `showToast`. Replace:
- Old: `alert('Erro ao cancelar demanda. Tente novamente.');`
- New: `showToast('Erro ao cancelar demanda. Tente novamente.', 'error');`

- [ ] **Step 5: Restart + verify each**

Restart dev. Open each of the 3 views via Webwright. Force the error path (e.g. via DevTools: block the cancel API fetch, then click "Cancelar" — toast should appear, no browser dialog).

For salao: click "Confirmar" (or whatever submits the form) without selecting a product → expect toast "Selecione um produto para continuar."

- [ ] **Step 6: Commit**

```powershell
git add src/views/salao.html src/views/cozinha-quente.html src/views/cozinha-fria.html
git commit -m "feat(salao,cozinha-*): replace 3 alert() with non-blocking toast helper"
```

---

## Task 13: Phase 3 — `admin.html` `confirm()` (3 calls) → `.modal` confirmation dialog

**Files:**
- Modify: `src/views/admin.html` (script lines 230-586, plus inline style for modal)

**Interfaces:**
- Produces: A reusable `.modal` confirmation. The 3 `confirm(...)` calls at lines 332, 520, 568 are replaced with modal-based confirm-and-execute flow. TheDestroy/exclude function is invoked only after the user clicks "Confirmar" in the modal.

- [ ] **Step 1: Read existing confirm call sites**

Read `src/views/admin.html:325-340`, `:515-525`, `:565-575`. Identify the pattern — each is `if (!confirm('Excluir X?')) return;` followed by the destroy fetch.

- [ ] **Step 2: Add modal markup to admin.html body**

Find the `</body>` tag (end of file ~line 587). Insert before it:

```html
<div class="modal-backdrop" id="confirmBackdrop" style="display:none;">
  <div class="modal-confirm" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
    <h3 id="confirmTitle">Confirmar exclusão</h3>
    <p id="confirmMessage"></p>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="confirmCancel">Cancelar</button>
      <button type="button" class="btn btn-danger" id="confirmOk">Excluir</button>
    </div>
  </div>
</div>
```

Add inline CSS for `.modal-backdrop` and `.modal-confirm` if not present:

```css
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45);
                  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
                  z-index: var(--z-modal); display: flex;
                  align-items: center; justify-content: center; }
.modal-confirm { background: var(--c-surface); padding: var(--sp-5);
                  border-radius: var(--radius-xl); max-width: 420px;
                  box-shadow: var(--shadow-elevated); }
.modal-confirm h3 { margin: 0 0 var(--sp-3); color: var(--c-text); }
.modal-confirm p { color: var(--c-text-muted); margin: 0 0 var(--sp-5); }
.modal-actions { display: flex; gap: var(--sp-3); justify-content: flex-end; }
```

- [ ] **Step 3: Add `confirmDialog(message)` helper in script**

Insert near top of script:

```javascript
function confirmDialog(message) {
  return new Promise(function(resolve) {
    var backdrop = document.getElementById('confirmBackdrop');
    var msg = document.getElementById('confirmMessage');
    var ok = document.getElementById('confirmOk');
    var cancel = document.getElementById('confirmCancel');
    msg.textContent = message;
    backdrop.style.display = 'flex';
    ok.focus();
    function cleanup() {
      backdrop.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    }
    function onOk()    { cleanup(); resolve(true); }
    function onCancel(){ cleanup(); resolve(false); }
    function onBackdrop(e) { if (e.target === backdrop) { cleanup(); resolve(false); } }
    function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(false); }
                       if (e.key === 'Enter')  { cleanup(); resolve(true); } }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}
```

- [ ] **Step 4: Replace 3 `confirm()` calls**

Each pattern becomes:

```javascript
if (!await confirmDialog('Excluir "' + name + '"?')) return;
```

But the surrounding function may not be `async`. Read each call site carefully:
- Line 332 — in `deleteProduct` (or similar)
- Line 520 — in `deleteUnit`
- Line 568 — in `deleteReason`

For each, change the surrounding function to `async function deleteX() { ... }` and replace `if (!confirm('...')) return;` with `if (!await confirmDialog('...')) return;`.

- [ ] **Step 5: Restart + verify each delete flow**

Restart dev. Open `http://localhost:3000/admin`. For each of the 3 delete flows:
1. Click delete on a row → modal opens with backdrop blur
2. Click "Cancelar" → modal closes, no row deleted
3. Open DevTools Network panel. Click delete on row, click "Excluir" in modal → DELETE fetch fired, row removed on success
4. Verify NO native browser `confirm()` dialog at any point
5. Try Escape key while modal open → modal closes
6. Try Enter key while modal open → confirms
7. 0 console errors

- [ ] **Step 6: Commit**

```powershell
git add src/views/admin.html
git commit -m "feat(admin): replace 3 confirm() with accessible modal dialog"
```

---

## Task 14: Phase 3 — Skeleton loaders replace "Carregando..."

**Files:**
- Modify: `src/views/dashboard.html` (line 245, render function), `src/views/gerente.html` (line 268, history tbody), `src/views/admin.html` (tbodies in 4 tables)

**Interfaces:**
- Produces: All initial-load placeholders use `.skeleton-block` (shimmer animation) instead of plain text. Skeletons hide when data arrives.

- [ ] **Step 1: Dashboard — replace "Carregando dados..." with KPI skeleton cards**

Read `src/views/dashboard.html:240-250` to see `#loading` markup (line 245: `<div id="loading" class="loading">Carregando dados...</div>`).

Replace the contents with 3 mock KPI skeleton cards:

```html
<div id="loading" class="loading">
  <div class="kpi-grid">
    <div class="kpi-card"><div class="skeleton-block" style="height:14px;width:60%;margin-bottom:8px;"></div><div class="skeleton-block" style="height:26px;width:80%;"></div></div>
    <div class="kpi-card"><div class="skeleton-block" style="height:14px;width:50%;margin-bottom:8px;"></div><div class="skeleton-block" style="height:26px;width:70%;"></div></div>
    <div class="kpi-card"><div class="skeleton-block" style="height:14px;width:55%;margin-bottom:8px;"></div><div class="skeleton-block" style="height:26px;width:65%;"></div></div>
  </div>
</div>
```

The existing `loading.style.display = 'none'` after data loads (already in code) will hide this. Verify by reading `buildContent(data)` and the show/hide logic per AGENTS.md gotcha about try/catch + restore UI state AFTER try/catch.

- [ ] **Step 2: Gerente — history tbody "Carregando histórico..."**

Find `src/views/gerente.html` line 268 (history `<tbody>` with `Carregando histórico...`).

Replace `<td colspan="7" ...>Carregando histórico...</td>` with skeleton rows:

```html
<tr><td colspan="7"><div class="skeleton-block" style="height:14px;width:100%;"></div></td></tr>
<tr><td colspan="7"><div class="skeleton-block" style="height:14px;width:100%;"></div></td></tr>
<tr><td colspan="7"><div class="skeleton-block" style="height:14px;width:100%;"></div></td></tr>
<tr><td colspan="7"><div class="skeleton-block" style="height:14px;width:100%;"></div></td></tr>
<tr><td colspan="7"><div class="skeleton-block" style="height:14px;width:100%;"></div></td></tr>
```

- [ ] **Step 3: Admin — 4 tbodies "Carregando..."**

Find all `<td colspan="7">Carregando...</td>` (or `colspan="N"`) patterns via grep. For each, replace with 4 skeleton rows as in Step 2.

Note: `admin.html` has 4 tbody placeholders (products table, stations table, units table, cancel-reasons table).

- [ ] **Step 4: Restart + verify**

Restart dev. For each modified view, reload with dev tools "Disable cache" on, throttle network to "Slow 3G" to see skeletons before data arrives. Verify skeleton shimmers then disappears when data loads. Verify 0 console errors.

- [ ] **Step 5: Commit**

```powershell
git add src/views/dashboard.html src/views/gerente.html src/views/admin.html
git commit -m "feat: skeleton loaders replace 'Carregando...' placeholders"
```

---

## Task 15: Phase 3 — Composed empty states with SVG icons

**Files:**
- Modify: `src/views/salao.html` (line 316), `cozinha-quente.html` (`grid.innerHTML = 'Nenhuma demanda ativa'` at line 454 area), `cozinha-fria.html` (line 432 area), `cozinha.html` (line 330 area), `gerente.html` (line 357 area), `dashboard.html` (empty-period render).

**Interfaces:**
- Produces: Empty `.empty-state` divs render with SVG icon (48×48, stroke 1.5), an h4 title, and a p subtitle.

- [ ] **Step 1: Define reusable emptyState markup strings**

For convenience, define the empty-state HTML strings per view context. All SVGs are inline (no external assets — vanilla HTML requirement).

**Kitchen empty state** (used in 3 kitchen views):
```html
<div class="empty-state">
  <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"></circle><path d="M16 24l6 6 12-14"></path></svg>
  <h4>Nenhuma demanda ativa</h4>
  <p>Sistema operando nominalmente.</p>
</div>
```

**Salao empty state**:
```html
<div class="empty-state">
  <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"></circle><path d="M16 24l6 6 12-14"></path></svg>
  <h4>Nenhuma demanda ativa no momento</h4>
  <p>Use o formulário acima para registrar uma nova demanda.</p>
</div>
```

**Gerente history empty state**:
```html
<div class="empty-state">
  <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="14" width="28" height="22" rx="2"></rect><path d="M16 20h16M16 26h12"></path></svg>
  <h4>Nenhuma demanda registrada ainda</h4>
  <p>Demandas aparecem aqui assim que forem criadas na cozinha ou no salão.</p>
</div>
```

**Dashboard empty-period state**:
```html
<div class="empty-state">
  <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 24h28M14 14l-4 10 4 10M34 14l4 10-4 10"></path></svg>
  <h4>Sem dados para o período selecionado</h4>
  <p>Tente outro intervalo de datas.</p>
  <button type="button" class="btn btn-ghost" onclick="document.getElementById('periodToday').click()">Voltar para hoje</button>
</div>
```

- [ ] **Step 2: Salao — replace `salao.html:316` ("Nenhuma demanda ativa no momento.")**

Read the surrounding markup. Use `edit` to swap the empty placeholder div for the Salao empty state markup above.

- [ ] **Step 3: Kitchen views — replace `grid.innerHTML = '<div class="empty-state">Nenhuma demanda ativa</div>'`**

In each of `cozinha-quente.html`, `cozinha-fria.html`, `cozinha.html`, find the JS line where `grid.innerHTML = '<div class="empty-state">...'` is assigned. Use `edit` to update the innerHTML string with the Kitchen empty-state markup.

Verify the existing `.empty-state` inline CSS in each view still applies (or, if now redundant due to theme.css `.empty-state` rule, remove the inline CSS to avoid conflicts). Per spec §7.6, admin.html does NOT get composed empty states — only the dark `Carregando...` removal happens in Task 14.

- [ ] **Step 4: Gerente — replace history empty state**

Read `gerente.html:355-360` to find the `'Nenhuma demanda registrada ainda.'` string assignment in the script. Replace with the Gerente history empty-state markup above.

- [ ] **Step 5: Dashboard — empty-period state**

Find the dashboard code path where `buildContent(data)` returns because data is empty (e.g. `if (data.total === 0) { return '<div ...>'; }`). Read the script around `:460-470` (the `'Nenhuma troca registrada no período'` empty state at line 461) and the broader KPI-area emptiness.

Replace the empty-state strings with the Dashboard empty-period markup above, scoped to applicable render functions.

- [ ] **Step 6: Restart + verify each**

Restart dev. For each view, force the empty state:
- Salão: With no demand data (clear test data via SQL `DELETE FROM demands` if needed), `GET /salao` → expect centered checkmark icon + h4 + p
- Cozinha-quente/fria/cozinha: same flow, expect "Sistema operando nominalmente"
- Gerente: empty history table → expect rectangle icon + "Nenhuma demanda registrada ainda"
- Dashboard: select date range with no data → expect "Sem dados para o período" + "Voltar para hoje" button, clicking it reloads today

- [ ] **Step 7: Commit**

```powershell
git add src/views/salao.html src/views/cozinha-quente.html src/views/cozinha-fria.html src/views/cozinha.html src/views/gerente.html src/views/dashboard.html
git commit -m "feat: composed empty states with SVG icons + suggested action"
```

---

## Task 16: Final verification — global criteria + audit delta

**Files:**
- Read-only: all views, theme.css, server.ts

**Interfaces:**
- Produces: A verification report showing all acceptance criteria from spec §9.3 are met.

- [ ] **Step 1: Verify `#ff0000` and `#4a0000` eliminated**

Run:
```powershell
Select-String -Path src\views\*.html -Pattern "#ff0000|#4a0000" -AllMatches
```
Expected: 0 matches. If any remain, identify the file/line and edit them to use `var(--c-danger-strong)` or `var(--alert-urgent-bg-dark)` respectively.

- [ ] **Step 2: Verify `alert(` and `confirm(` eliminated**

Run:
```powershell
Select-String -Path src\views\*.html -Pattern "\balert\(['""]|\bconfirm\(" -AllMatches
```
Expected: 0 matches. The `playNormalAlert` etc function names (`playNormalAlert(`) should NOT match because of the `\balert\(` boundary — verify.

If matches remain, fix via more replacements.

- [ ] **Step 3: Verify theme.css has critical blocks**

Run:
```powershell
Select-String -Path src\views\styles\theme.css -Pattern "prefers-reduced-motion", ":focus-visible", "--c-danger-strong"
```
Expected: All three patterns matched.

- [ ] **Step 4: `npx tsc --noEmit`**

Run:
```powershell
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: `npm run build`**

Run:
```powershell
npm run build
```
Expected: Success. `dist/` directory updated with compiled JS + copied views (verify `dist/views/styles/theme.css` is also copied — check `npm run build` script in package.json; if not, add a copy step).

If `dist/views/styles/theme.css` is missing from build output, update the `build` script in `package.json` to copy the styles dir (probably already handled by `cpx` or similar — verify).

- [ ] **Step 6: Webwright smoke-test all 7 views**

Open each in Playwright full-screen 1080p:
- `/salao` — register a test demand → confirm modal → ready toast → confirm retire modal → confirm
- `/cozinha-quente` — see the demand appear (audio alert fires) → PRONTO button → demand moves to ready-strip → confirm via salao retrieve → demand disappears from kitchen
- `/cozinha-fria` — same flow if a cold-side product exists
- `/gerente` — verify history table populates, calendar visible, Anular modal opens
- `/admin` — verify tab switching, delete confirm modal, no native dialogs
- `/dashboard` — load KPIs, click period buttons, open export modal
- `/cozinha` — legacy view loads, no errors

For each: check 0 console errors. Verify status colors preserved (green for cooking, orange for late, red for urgent, purple for replacement, cyan for cold-side).

- [ ] **Step 7: Invoke `impeccable` audit skill for regression score**

Use the `skill` tool to load `impeccable`. Run its `$impeccable audit` on each view. Compare to baseline recorded before Task 1 — all scores should be ≥ baseline.

- [ ] **Step 8: Run git status, prepare summary report**

Run:
```powershell
git status
git log --oneline -20
```

Display final commit list. Verify each task has a corresponding commit. Provide final summary to operator:
- 16 tasks completed
- 9 commits (Tasks 2-15 each commit; Task 16 is verification-only)
- Banned literals eliminated
- Visual diff review brief

DO NOT push or create PR unless operator explicitly requests.

---

## Notes for Implementer

- **Per-view restart cycle:** After editing any `.html`, the running dev server caches views at startup. Always kill PID on port 3000 and restart:
  ```powershell
  $port = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue)
  if ($port) { taskkill /PID $port.OwningProcess /F }
  Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized
  Start-Sleep -Seconds 5
  ```
- **Don't trust `npm run dev` for type errors.** It uses `--transpile-only`. Always run `npx tsc --noEmit` separately after `.ts` changes.
- **Per AGENTS.md silent-error gotcha:** Any new `.catch()` you add during this work must `console.error(err)` at minimum, never an empty body.
- **Per AGENTS.md buildContent gotcha:** Any new `innerHTML` assignment that builds from API data must be wrapped in try/catch with a graceful error placeholder.
- **Webwright vs Playwright MCP:** AGENTS.md says `webwright` skill is preferred. Use it for visual verification. Use Playwright MCP via native tools only when webwright can't reach a state (e.g. need to manipulate DB).
- **Audio alerts:** Webwright/Playwright won't verify audio. After Task 5 and Task 6 (kitchen), manually open `http://localhost:3000/cozinha-quente`, post a test demand via salao, and verify sound plays (computer speakers on).
- **Test data cleanup:** If Tasks 5-6 create test demands or product modifications, restore via SQL or restart the dev server (which re-seeds via `seedDatabase()` — verify this is safe — it should be idempotent per AGENTS.md).
- **Commits:** Conventional style, atomic per task. Don't commit `.js` files from `dist/`. Verify `.gitignore` excludes `dist/` (it should already).