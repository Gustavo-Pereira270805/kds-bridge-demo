# Dashboard Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform `src/views/dashboard.html` (1548 → ~2400 lines) from a flat grid of 18 panels into a 5-section bento layout with a collapsible side nav, sticky header, 4 hero + 7 secondary KPIs with sparklines, and 6 Chart.js charts with zoom — without changing the API, DB, server, or other views.

**Architecture:** Vanilla HTML/CSS/JS continues (no framework migration). Chart.js v4.5.0 + chartjs-plugin-zoom v2.2.0 via CDN. New shared CSS file `src/views/styles/dashboard.css` (side nav, bento grid, KPI cards, panel, header sticky). `theme.css` extended with new tokens + utility classes. `dashboard.html` rewritten in 9 atomic phases (each a commit, system functional between phases). Webwright checkpoints after phases 3, 5, 7, 9.

**Tech Stack:** HTML5, CSS3 (CSS Grid + custom properties), vanilla ES6 JS, Chart.js v4.5.0, chartjs-plugin-zoom v2.2.0, IntersectionObserver, Socket.IO (unchanged).

**Reference spec:** `docs/superpowers/specs/2026-07-28-dashboard-modernization-design.md` — every code snippet below is a snippet; the spec has the full reference implementation, especially §4 (CSS tokens), §5 (components), §6 (sections/panels), §8 (edge states), §9 (a11y).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/views/dashboard.html` | **Modify** (rewritten) | Page structure, KPIs, sections, charts, modals, socket, keyboard shortcuts, accessibility. Grows from 1548 → ~2400 lines. |
| `src/views/styles/theme.css` | **Modify** (extend) | Add Chart.js palette tokens, KPI status tokens, layout tokens, utility classes (`.bento-grid`, `.side-nav`, `.kpi-card-hero`, `.kpi-card-secondary`, `.section-header`, `.panel`, `.section-eyebrow`, `.section-title`, `.section-description`). Grows from 182 → ~330 lines. |
| `src/views/styles/dashboard.css` | **Create** (new) | Side nav full styling (collapsed/expanded/active), header sticky layout, bento grid responsive, KPI card hover states, panel hover, Chart.js reset zoom button, sparkline container, chart canvas skeleton, print stylesheet. ~400 lines. |
| `src/server.ts` | **NO CHANGE** | |
| `src/routes/analytics.ts` | **NO CHANGE** | |
| `src/services/performance.service.ts` | **NO CHANGE** | |
| `supabase_schema.sql` | **NO CHANGE** | |
| `src/views/{salao,cozinha,cozinha-quente,cozinha-fria,gerente,admin}.html` | **NO CHANGE** | |

---

## Global Constraints

These are project-wide non-negotiables, copied verbatim from `AGENTS.md` and the spec. Every task implicitly must satisfy all of them.

1. **TypeScript strict mode** is on. All interfaces in `src/types.ts`. New code that touches the server must pass `npx tsc --noEmit` — but this plan only touches `dashboard.html` and CSS, so no TS changes.
2. **Routes** are Fastify plugins with a prefix. **Routes do not change in this plan.**
3. **All DB queries** use `$1` PostgreSQL parameterization. **No DB changes in this plan.**
4. **API endpoint shapes** consumed by `dashboard.html` (under `/api/v1/analytics/*`) **must not change.** The new `buildContent()` and chart factories consume the same response shapes.
5. **Socket.IO events** listened: `demand:new`, `demand:urgent`, `demand:ready`, `demand:retrieved`, `demand:cancelled`, `demand:annulled`, `demand:stockout` (extended from 5 to 7 in Phase 8).
6. **`prefers-reduced-motion: reduce`** must be respected. The `theme.css` global already handles most cases; Chart.js animation must be set to 0 when active.
7. **`:focus-visible`** ring is already global in `theme.css`. Don't override it.
8. **Toast helper** is the global `.toast` class from `theme.css` + `showToast(msg, kind)` helper (created in Phase 8). No new `alert()` or `confirm()` calls.
9. **Skeleton loaders** use `.skeleton-block` from `theme.css`. No new "Carregando..." text.
10. **Empty states** use `.empty-state` (small) from `theme.css` or `.empty-state-global` (created in Phase 8).
11. **Hex colors are forbidden in JS template strings.** All colors via `getComputedStyle(document.documentElement).getPropertyValue('--c-X')`.
12. **`border-radius: NNpx`** is forbidden in inline CSS — always use `var(--radius-X)`.
13. **Hardcoded color hex** is forbidden in CSS — always use `var(--c-X)`.
14. **Webwright checkpoints** mandatory after phases 3, 5, 7, 9. Use the `webwright` skill (`/skill webwright`).
15. **Server restart required** after any HTML/CSS change (the server caches views at startup in `src/server.ts` line 51-58 per AGENTS.md). Use `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized` to run in background.
16. **Type-check after every phase** that touches server code (none in this plan) — but always run `npx tsc --noEmit` as a sanity check.
17. **No automated test suite** (per AGENTS.md) — verification is via webwright + manual visual review + Lighthouse.

---

## Checkpoints (Webwright)

| After | What to verify | Skill command |
|---|---|---|
| Phase 3 | Side nav scroll/active/hover-expand/click-anchor; 3 screenshots in 3 sections | `/skill webwright` |
| Phase 5 | KPI strip 4 hero + 7 secondary, sparklines, status borders; full-page 1920×1080 | `/skill webwright` |
| Phase 7 | 6 Chart.js charts, zoom in/out, reset zoom, tooltips; 1 zoom test | `/skill webwright` |
| Phase 9 | All 13 critical flows from spec §11.6; 3 viewports (1920×1080, 1366×768, 768×1024); 0 console errors | `/skill webwright` |

---

# Phase 1 — Foundation tokens + Chart.js CDN prep

**Goal:** Add new tokens and utility classes to `theme.css`. Add Chart.js + plugin CDN script tags to `dashboard.html`. No visual change.

**Spec reference:** §4.4 (theme.css additions), §4.5 (Chart.js setup), §10 Fase 1.

## Task 1.1: Add layout tokens to `theme.css`

**Files:**
- Modify: `src/views/styles/theme.css:8-78` (inside `:root` block, add new tokens at the end before `}`)

**Interfaces:**
- Consumes: existing `:root` block
- Produces: 14 new CSS variables (palette + layout + spacing)

- [ ] **Step 1: Open `src/views/styles/theme.css`**

- [ ] **Step 2: Add Chart.js palette tokens**

Find the end of the `:root` block (just before the closing `}` on line 78). Add these tokens (copy verbatim from spec §4.4):

```css
  /* === Chart.js palette mirror === */
  --c-chart-1: #457b9d;  /* primary-tint */
  --c-chart-2: #2a9d8f;  /* accent-warm */
  --c-chart-3: #f4a261;  /* warn */
  --c-chart-4: #8e7cc3;  /* replacement */
  --c-chart-5: #00a8c8;  /* accent-cold */
  --c-chart-6: #e63946;  /* danger */
  --c-chart-7: #1d3557;  /* primary */

  /* === KPI status borders === */
  --kpi-status-ok: var(--c-accent-warm);
  --kpi-status-warn: var(--c-warn);
  --kpi-status-danger: var(--c-danger);
  --kpi-status-neutral: var(--c-primary-tint);

  /* === Layout tokens === */
  --header-height: 56px;
  --side-nav-collapsed: 64px;
  --side-nav-expanded: 240px;
  --grid-max-width: 1440px;
  --grid-gutter: 24px;
  --section-spacing: 40px;
  --bento-gap: 20px;
  --bento-row-height: 180px;
  --bento-row-height-chart: 280px;
  --kpi-hero-height: 140px;
  --kpi-secondary-height: 96px;
```

- [ ] **Step 3: Verify with `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: passes (no TS changes; just sanity check).

- [ ] **Step 4: Commit**

```bash
git add src/views/styles/theme.css
git commit -m "feat(dashboard): add Chart.js palette + layout tokens"
```

## Task 1.2: Add Chart.js + plugin CDN script tags to `dashboard.html`

**Files:**
- Modify: `src/views/dashboard.html:8` (inside `<head>`, after the `<link rel="stylesheet" href="/styles/theme.css">` line)

**Interfaces:**
- Consumes: existing `<head>` structure
- Produces: 3 new HTML elements (preconnect + 2 script tags with `defer`)

- [ ] **Step 1: Open `src/views/dashboard.html`**

- [ ] **Step 2: Add preconnect + 2 script tags**

Find the line that says `<link rel="stylesheet" href="/styles/theme.css">` (around line 8). Right after it, add:

```html
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js" defer></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.2.0" defer></script>
```

- [ ] **Step 3: Restart the dev server and verify zero visual change**

Run: `Start-Process cmd -ArgumentList "/c taskkill /F /IM node.exe /T; npm run dev" -WindowStyle Minimized`
Then wait 5 seconds, navigate to `http://localhost:3000/dashboard`.
Expected: page renders identically to before. Open DevTools Network tab → 2 successful requests to `cdn.jsdelivr.net` (Chart.js + plugin).

- [ ] **Step 4: Commit**

```bash
git add src/views/dashboard.html
git commit -m "feat(dashboard): add Chart.js + plugin via CDN"
```

## Task 1.3: Verify no visual regression

- [ ] **Step 1: Reload `/dashboard` in browser and compare to baseline**

Expected: pixel-identical to the state before this phase. The CDN scripts load (Network tab shows them) but no chart is created yet, so they have no effect.

- [ ] **Step 2: Commit (if any cleanup) or end phase**

If anything changed accidentally, commit as `fix(dashboard): visual parity after Phase 1 foundation`.
Otherwise: phase complete. Move to Phase 2.

---

# Phase 2 — Layout skeleton + `dashboard.css`

**Goal:** Create the new CSS file and add empty layout containers (`<header>`, `<aside>`, `<main>` with 5 sections) to `dashboard.html`. No visible change.

**Spec reference:** §4.2 (DOM structure), §4.4 (dashboard.css), §10 Fase 2.

## Task 2.1: Create `src/views/styles/dashboard.css`

**Files:**
- Create: `src/views/styles/dashboard.css`

**Interfaces:**
- Consumes: tokens from `theme.css`
- Produces: ~400 lines of layout CSS

- [ ] **Step 1: Create the file with empty header**

```bash
New-Item -ItemType File -Path "src/views/styles/dashboard.css" -Force
```

Add to it (top of file):

```css
/* KDS Bridge — dashboard-specific styles. Linked by dashboard.html after
   theme.css. Contains: layout containers, side nav, header sticky,
   bento grid, KPI cards, panel, chart reset zoom, print stylesheet.
   All colors/spacing/radius reference theme.css tokens — never hardcoded. */
```

- [ ] **Step 2: Add layout + bento grid CSS**

Append the following to `dashboard.css`:

```css
/* === Page layout === */
body { background: var(--c-bg-light); }

.layout {
  display: grid;
  grid-template-columns: var(--side-nav-collapsed) 1fr;
  min-height: calc(100vh - var(--header-height));
}

.dashboard-main {
  max-width: var(--grid-max-width);
  margin: 0 auto;
  padding: 0 var(--sp-7);
  min-width: 0;
}

/* === Bento grid (12-col) === */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--bento-gap);
}
.bento-grid > [data-cols="3"] { grid-column: span 3; }
.bento-grid > [data-cols="4"] { grid-column: span 4; }
.bento-grid > [data-cols="5"] { grid-column: span 5; }
.bento-grid > [data-cols="6"] { grid-column: span 6; }
.bento-grid > [data-cols="7"] { grid-column: span 7; }
.bento-grid > [data-cols="8"] { grid-column: span 8; }
.bento-grid > [data-cols="12"] { grid-column: span 12; }

@media (max-width: 1024px) {
  .bento-grid > [data-cols] { grid-column: span 12; }
}

/* === Section header === */
.dashboard-section {
  margin-top: var(--section-spacing);
  scroll-margin-top: calc(var(--header-height) + 16px);
}
.section-header { margin-bottom: var(--sp-6); }
.section-eyebrow {
  display: block;
  font-size: 11px; font-weight: var(--fw-heavy);
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--c-primary-tint);
  margin-bottom: var(--sp-2);
}
.section-title {
  font-size: 24px; font-weight: var(--fw-bold);
  color: var(--c-primary);
  margin: 0 0 var(--sp-1);
}
.section-description {
  font-size: 13px; color: var(--c-text-muted);
  margin: 0;
}
```

- [ ] **Step 3: Add side nav CSS (collapsed state only, expanded in Phase 3)**

Append:

```css
/* === Side nav (collapsed state) === */
.side-nav {
  position: sticky;
  top: var(--header-height);
  width: var(--side-nav-collapsed);
  height: calc(100vh - var(--header-height));
  background: var(--c-surface);
  border-right: 1px solid var(--c-border-light);
  overflow-x: hidden;
  overflow-y: auto;
  z-index: var(--z-sticky);
  transition: width var(--t-base) var(--ease-out);
}
.side-nav ul { list-style: none; padding: var(--sp-3) 0; margin: 0; }
.side-nav a {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  color: var(--c-text-muted);
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: background var(--t-fast) var(--ease-out),
              color var(--t-fast) var(--ease-out),
              border-left-color var(--t-fast) var(--ease-out);
  white-space: nowrap;
}
.side-nav a:hover {
  background: rgba(29,53,87,.04);
  color: var(--c-text);
}
.side-nav a[aria-current="true"] {
  color: var(--c-primary);
  border-left-color: var(--c-accent-warm);
  background: rgba(42,157,143,.04);
}
.side-nav .icon {
  width: 24px; height: 24px;
  flex-shrink: 0;
  stroke: currentColor; fill: none;
  stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
}
.side-nav .label {
  font-size: 13px; font-weight: var(--fw-medium);
  opacity: 0;
  transition: opacity var(--t-fast) var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .side-nav, .side-nav .label, .side-nav a { transition: none; }
}
```

- [ ] **Step 4: Add header sticky CSS**

Append:

```css
/* === Sticky header === */
.sticky-top {
  position: sticky; top: 0; z-index: var(--z-sticky);
  height: var(--header-height);
  background: rgba(244,244,245,.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--c-border-light);
}
.header-inner {
  max-width: var(--grid-max-width);
  height: 100%;
  margin: 0 auto;
  padding: 0 var(--sp-7);
  display: flex; align-items: center; gap: var(--sp-4);
}
.header-title {
  font-size: 18px; font-weight: var(--fw-bold);
  color: var(--c-primary);
  margin: 0; margin-right: var(--sp-4);
  white-space: nowrap;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/views/styles/dashboard.css
git commit -m "feat(dashboard): create dashboard.css with layout, bento, side nav, header"
```

## Task 2.2: Add layout skeleton to `dashboard.html`

**Files:**
- Modify: `src/views/dashboard.html` — wrap header in `<header class="sticky-top">`, add `<div class="layout">` with `<aside class="side-nav">` and `<main class="dashboard-main">`, add 5 empty `<section>` elements

**Interfaces:**
- Consumes: existing `<body>` and content
- Produces: new outer DOM structure

- [ ] **Step 1: Link the new CSS**

In `<head>`, after the `<link rel="stylesheet" href="/styles/theme.css">` line, add:

```html
    <link rel="stylesheet" href="/styles/dashboard.css">
```

- [ ] **Step 2: Wrap the existing header**

Find the existing header element. Wrap it:

BEFORE:
```html
<header class="header">
  ...
</header>
```

AFTER:
```html
<header class="sticky-top">
  <div class="header-inner">
    <h1 class="header-title">Dashboard</h1>
    ... existing header content ...
  </div>
</header>
```

- [ ] **Step 3: Wrap the main content area**

Find the existing main content. Wrap it in the layout grid:

BEFORE:
```html
<div id="content">
  ... existing content ...
</div>
```

AFTER:
```html
<div class="layout">
  <aside class="side-nav" id="sideNav">
    <!-- populated in Phase 3 -->
  </aside>
  <main class="dashboard-main">
    <a id="top"></a>
    <section class="kpi-strip" id="kpiStrip">
      <!-- populated in Phase 5 -->
    </section>
    <section id="overview" class="dashboard-section" aria-labelledby="section-title-overview">
      <header class="section-header">
        <span class="section-eyebrow">VISÃO GERAL</span>
        <h2 id="section-title-overview" class="section-title">Estado do restaurante</h2>
        <p class="section-description">Volume, fluxo e urgências em tempo real.</p>
      </header>
      <div class="bento-grid"><!-- populated in Phase 6 --></div>
    </section>
    <section id="demand" class="dashboard-section" aria-labelledby="section-title-demand">
      <header class="section-header">
        <span class="section-eyebrow">DEMANDA</span>
        <h2 id="section-title-demand" class="section-title">Quando e o que sai</h2>
        <p class="section-description">Heatmap de operação, volume e mix de produtos.</p>
      </header>
      <div class="bento-grid"><!-- populated in Phase 6 --></div>
    </section>
    <section id="sla" class="dashboard-section" aria-labelledby="section-title-sla">
      <header class="section-header">
        <span class="section-eyebrow">SLA E TEMPOS</span>
        <h2 id="section-title-sla" class="section-title">Eficiência operacional</h2>
        <p class="section-description">Cumprimento de SLA, velocidade e filas.</p>
      </header>
      <div class="bento-grid"><!-- populated in Phase 6 --></div>
    </section>
    <section id="diagnosis" class="dashboard-section" aria-labelledby="section-title-diagnosis">
      <header class="section-header">
        <span class="section-eyebrow">DIAGNÓSTICO</span>
        <h2 id="section-title-diagnosis" class="section-title">Problemas e exceções</h2>
        <p class="section-description">Cancelamentos, roturas e trocas.</p>
      </header>
      <div class="bento-grid"><!-- populated in Phase 6 --></div>
    </section>
    <section id="performance" class="dashboard-section" aria-labelledby="section-title-performance">
      <header class="section-header">
        <span class="section-eyebrow">PERFORMANCE</span>
        <h2 id="section-title-performance" class="section-title">Notas e detratores</h2>
        <p class="section-description">Avaliação 0-5 por entidade.</p>
      </header>
      <div class="bento-grid"><!-- populated in Phase 6 --></div>
    </section>
  </main>
</div>
```

- [ ] **Step 4: Keep `#content` as legacy for now**

Do NOT delete `<div id="content">` yet. Wrap it in a hidden container:

After the 5 sections, before `</main>`, add:
```html
    <div id="legacyContent" hidden>
      ... move the original #content here, unchanged ...
    </div>
```

- [ ] **Step 5: Restart server and verify zero visual change**

Run: `Start-Process cmd -ArgumentList "/c taskkill /F /IM node.exe /T; npm run dev" -WindowStyle Minimized`
Wait 5s, reload `/dashboard`. Expected: visually identical to baseline (the new containers are empty / hidden).

- [ ] **Step 6: Verify 0 console errors**

Open DevTools Console. Expected: 0 errors (the Chart.js CDN scripts load successfully, no charts created yet, no errors).

- [ ] **Step 7: Commit**

```bash
git add src/views/dashboard.html
git commit -m "feat(dashboard): layout skeleton with empty side nav + 5 sections"
```

---

# Phase 3 — Side nav funcional

**Goal:** Add 6 nav items with SVGs, IntersectionObserver for active state, click-to-anchor. **CHECKPOINT WEBWRIGHT #1**.

**Spec reference:** §5.2 (side nav), §7.1 (active state observer), §10 Fase 3.

## Task 3.1: Add side nav HTML with 6 items

**Files:**
- Modify: `src/views/dashboard.html` — populate the `<aside class="side-nav">` element

- [ ] **Step 1: Find the empty `<aside class="side-nav" id="sideNav">`**

- [ ] **Step 2: Replace with the populated side nav**

```html
<aside class="side-nav" id="sideNav">
  <nav aria-label="Seções do dashboard">
    <ul role="list">
      <li>
        <a href="#top" data-section="top" aria-current="false">
          <svg class="icon" viewBox="0 0 24 24"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          <span class="label">Topo</span>
        </a>
      </li>
      <li>
        <a href="#overview" data-section="overview" aria-current="false">
          <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          <span class="label">Visão Geral</span>
        </a>
      </li>
      <li>
        <a href="#demand" data-section="demand" aria-current="false">
          <svg class="icon" viewBox="0 0 24 24"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
          <span class="label">Demanda</span>
        </a>
      </li>
      <li>
        <a href="#sla" data-section="sla" aria-current="false">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="label">SLA e Tempos</span>
        </a>
      </li>
      <li>
        <a href="#diagnosis" data-section="diagnosis" aria-current="false">
          <svg class="icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span class="label">Diagnóstico</span>
        </a>
      </li>
      <li>
        <a href="#performance" data-section="performance" aria-current="false">
          <svg class="icon" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span class="label">Performance</span>
        </a>
      </li>
    </ul>
  </nav>
</aside>
```

- [ ] **Step 3: Restart server, navigate to `/dashboard`**

Expected: side nav visible à esquerda, 64px wide, 6 ícones verticais. Hover expande para 240px com labels visíveis.

## Task 3.2: Add IntersectionObserver for active state

**Files:**
- Modify: `src/views/dashboard.html` — add a `<script>` at the end of the body (or merge with existing script block)

- [ ] **Step 1: Find the end of the existing `<script>` block in `dashboard.html`**

- [ ] **Step 2: Add the side nav JS at the end of the script (before the closing `</script>`)**

```javascript
// === Side nav: active state via IntersectionObserver ===
(function initSideNav() {
  const sectionIds = ['top', 'overview', 'demand', 'sla', 'diagnosis', 'performance'];
  const sections = sectionIds
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const navLinks = document.querySelectorAll('.side-nav a[data-section]');
  function setActive(activeId) {
    navLinks.forEach(a => {
      a.setAttribute('aria-current', a.getAttribute('data-section') === activeId ? 'true' : 'false');
    });
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) setActive(entry.target.id);
    });
  }, { threshold: 0.4, rootMargin: '-56px 0px -50% 0px' });
  sections.forEach(s => observer.observe(s));
  navLinks.forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('data-section');
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActive(id);
      }
    });
  });
})();
```

- [ ] **Step 3: Restart server, navigate to `/dashboard`**

Expected: ao scrollar manualmente, a pill teal se move entre os itens do side nav conforme a seção visível. Click em item rola smooth até a seção.

## Task 3.3: Webwright checkpoint #1

- [ ] **Step 1: Load `/skill webwright` skill**

- [ ] **Step 2: Run 3 screenshots — one in Visão Geral, one in Demanda, one in Performance**

Verify in each screenshot:
- Side nav visible à esquerda, 64px wide
- Item correspondente à seção visível tem borda esquerda teal + texto em `--c-primary`
- Outros itens com texto muted + borda transparente
- Section header (eyebrow + title + description) visível

- [ ] **Step 3: Test hover-expand**

Hover on the side nav, wait 200ms, screenshot. Verify: side nav expande para 240px com labels visíveis.

- [ ] **Step 4: Commit checkpoint evidence**

```bash
git add final_runs/run_*/  # or wherever webwright saved screenshots
git commit -m "test(dashboard): webwright checkpoint 1 - side nav" --allow-empty
```

- [ ] **Step 5: Commit phase 3 code (if not already)**

```bash
git add src/views/dashboard.html
git commit -m "feat(dashboard): side nav with 6 items + IntersectionObserver active state"
```

---

# Phase 4 — Header sticky modernizado

**Goal:** Apply soft-modern styling to the existing header. Filter UX is modernized (pill group for período, clean date inputs, modernized select, modernized export button). Behavior identical to before.

**Spec reference:** §5.1 (header DOM), §10 Fase 4.

## Task 4.1: Add header utility CSS to `dashboard.css`

**Files:**
- Modify: `src/views/styles/dashboard.css` — append header utility styles

- [ ] **Step 1: Append to `dashboard.css`**

```css
/* === Period pill group === */
.period-pill-group {
  display: inline-flex;
  background: var(--c-surface);
  border: 1px solid var(--c-border-light);
  border-radius: var(--radius-pill);
  padding: 3px;
  gap: 2px;
}
.period-btn {
  background: transparent;
  border: 0;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: var(--fw-medium);
  color: var(--c-text-muted);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background var(--t-fast) var(--ease-out),
              color var(--t-fast) var(--ease-out);
}
.period-btn:hover { background: rgba(29,53,87,.06); color: var(--c-text); }
.period-btn[aria-pressed="true"] {
  background: var(--c-primary);
  color: var(--c-text-invert);
}

/* === Date range === */
.date-range {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  font-size: 13px;
}
.date-range input[type="date"],
.station-select {
  height: 36px;
  padding: 0 var(--sp-3);
  font-size: 13px;
  font-family: var(--font-sans);
  color: var(--c-text);
  background: var(--c-surface);
  border: 1px solid var(--c-border-light);
  border-radius: var(--radius-md);
  transition: border-color var(--t-fast) var(--ease-out);
}
.date-range input[type="date"]:focus,
.station-select:focus {
  border-color: var(--c-primary-tint);
  outline: 0;
}
.date-range > span { color: var(--c-text-muted); }
.btn-apply {
  height: 36px;
  padding: 0 var(--sp-4);
  font-size: 13px;
  font-weight: var(--fw-semi);
  background: var(--c-primary);
  color: var(--c-text-invert);
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: filter var(--t-fast) var(--ease-out);
}
.btn-apply:hover { filter: brightness(1.1); }

/* === Last updated badge === */
.last-updated {
  font-size: 12px;
  color: var(--c-text-muted);
  display: inline-flex; align-items: center; gap: var(--sp-1);
}
.last-updated .dot {
  width: 8px; height: 8px;
  background: var(--c-accent-warm);
  border-radius: 50%;
  display: inline-block;
}
```

- [ ] **Step 2: Restart server and verify**

Reload `/dashboard`. Expected: período buttons em pill group, date inputs limpos, estação select clean. Comportamento idêntico.

## Task 4.2: Apply `aria-pressed` to period buttons

**Files:**
- Modify: `src/views/dashboard.html` — find the existing period button handler

- [ ] **Step 1: Find the existing click handler for `.period-btn`**

Look for code like `$('.period-btn').on('click', ...)` or `addEventListener('click', ...)` on period buttons.

- [ ] **Step 2: Add `aria-pressed` update to the handler**

Inside the existing click handler for period buttons, after setting the active class, add:

```javascript
document.querySelectorAll('.period-btn').forEach(b => {
  b.setAttribute('aria-pressed', b === this ? 'true' : 'false');
});
```

(Adjust `this` to match the actual element reference in the existing handler.)

- [ ] **Step 3: Set initial `aria-pressed` on the default active button**

In the same script block where the default period is set (e.g., `'today'`), add:

```javascript
document.querySelector('.period-btn[data-range="today"]').setAttribute('aria-pressed', 'true');
```

- [ ] **Step 4: Verify keyboard accessibility**

Tab to a period button, press Space. Expected: button activates (same as click), `aria-pressed` updates.

- [ ] **Step 5: Commit**

```bash
git add src/views/dashboard.html src/views/styles/dashboard.css
git commit -m "feat(dashboard): modernized header with pill group + clean inputs"
```

---

# Phase 5 — KPI strip modernizada

**Goal:** Replace the 11 single-row KPI cards with 4 hero + 7 secondary layout. Add sparklines to hero cards. Apply status borders. **CHECKPOINT WEBWRIGHT #2**.

**Spec reference:** §4.4 (.kpi-card-hero, .kpi-card-secondary), §5.3 (hero), §5.4 (secondary), §10 Fase 5.

## Task 5.1: Add KPI card CSS to `dashboard.css`

**Files:**
- Modify: `src/views/styles/dashboard.css` — append KPI card styles

- [ ] **Step 1: Append to `dashboard.css`**

```css
/* === KPI strip === */
.kpi-strip { margin-top: var(--sp-7); }
.kpi-hero-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--bento-gap);
  margin-bottom: var(--bento-gap);
}
.kpi-secondary-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--bento-gap);
}
@media (max-width: 1024px) {
  .kpi-hero-grid { grid-template-columns: repeat(2, 1fr); }
  .kpi-secondary-grid { grid-template-columns: repeat(4, 1fr); }
}
@media (max-width: 768px) {
  .kpi-secondary-grid { grid-template-columns: repeat(2, 1fr); }
}

/* === KPI hero card === */
.kpi-card-hero {
  background: var(--c-surface);
  border-radius: var(--radius-xl);
  padding: var(--sp-5) var(--sp-6);
  box-shadow: var(--shadow-card);
  border-left: 4px solid var(--kpi-status-neutral);
  height: var(--kpi-hero-height);
  display: flex; flex-direction: column; gap: var(--sp-2);
  transition: box-shadow var(--t-base) var(--ease-out),
              transform var(--t-base) var(--ease-out);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  width: 100%;
}
.kpi-card-hero:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .kpi-card-hero { transition: none; }
  .kpi-card-hero:hover { transform: none; }
}
.kpi-card-hero.status-danger {
  border-left-color: var(--kpi-status-danger);
  background: var(--alert-urgent-bg-light);
}
.kpi-card-hero.status-warn {
  border-left-color: var(--kpi-status-warn);
}
.kpi-card-hero.status-ok {
  border-left-color: var(--kpi-status-ok);
  background: var(--alert-ok-bg-light);
}
.kpi-card-hero .kpi-eyebrow {
  font-size: 11px; font-weight: var(--fw-heavy);
  letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--c-text-muted);
  display: flex; justify-content: space-between; align-items: center;
}
.kpi-card-hero .kpi-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 36px; font-weight: var(--fw-medium);
  color: var(--c-text);
  line-height: 1;
}
.kpi-card-hero .kpi-sparkline {
  flex: 1; min-height: 0; position: relative;
}
.kpi-card-hero .kpi-sparkline canvas {
  position: absolute; inset: 0;
  width: 100% !important; height: 100% !important;
}
.kpi-delta {
  font-size: 11px; font-weight: var(--fw-semi);
  padding: 2px 8px; border-radius: var(--radius-pill);
  font-family: var(--font-sans);
}
.kpi-delta.up {
  background: rgba(42,157,143,.12);
  color: var(--c-accent-warm);
}
.kpi-delta.down {
  background: rgba(230,57,70,.12);
  color: var(--c-danger);
}

/* === KPI secondary card === */
.kpi-card-secondary {
  background: var(--c-surface);
  border-radius: var(--radius-md);
  padding: var(--sp-3) var(--sp-4);
  height: var(--kpi-secondary-height);
  display: flex; flex-direction: column; gap: var(--sp-1);
  box-shadow: 0 1px 3px rgba(29,53,87,.06);
  transition: box-shadow var(--t-base) var(--ease-out);
}
.kpi-card-secondary:hover { box-shadow: var(--shadow-card); }
.kpi-card-secondary .kpi-eyebrow {
  font-size: 11px; font-weight: var(--fw-heavy);
  letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--c-text-muted);
}
.kpi-card-secondary .kpi-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 20px; font-weight: var(--fw-medium);
  color: var(--c-text);
  line-height: 1;
}
```

- [ ] **Step 2: Verify CSS is valid**

Reload `/dashboard`. Expected: no CSS errors in console.

## Task 5.2: Add PALETTE and `applyChartDefaults` to `dashboard.html`

**Files:**
- Modify: `src/views/dashboard.html` — add JS at the top of the existing `<script>` block

- [ ] **Step 1: Find the top of the `<script>` block in `dashboard.html`**

- [ ] **Step 2: Add the PALETTE + applyChartDefaults at the top**

```javascript
// === Chart.js setup (used by KPI sparklines and Phase 7 charts) ===
const PALETTE = {
  primary: getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim(),
  primaryTint: getComputedStyle(document.documentElement).getPropertyValue('--c-primary-tint').trim(),
  accentWarm: getComputedStyle(document.documentElement).getPropertyValue('--c-accent-warm').trim(),
  accentCold: getComputedStyle(document.documentElement).getPropertyValue('--c-accent-cold').trim(),
  warn: getComputedStyle(document.documentElement).getPropertyValue('--c-warn').trim(),
  danger: getComputedStyle(document.documentElement).getPropertyValue('--c-danger').trim(),
  replacement: getComputedStyle(document.documentElement).getPropertyValue('--c-replacement').trim(),
  textMuted: getComputedStyle(document.documentElement).getPropertyValue('--c-text-muted').trim(),
  border: getComputedStyle(document.documentElement).getPropertyValue('--c-border-light').trim(),
  text: getComputedStyle(document.documentElement).getPropertyValue('--c-text').trim(),
  textInvert: getComputedStyle(document.documentElement).getPropertyValue('--c-text-invert').trim(),
};
const SERIES_COLORS = [PALETTE.primaryTint, PALETTE.accentWarm, PALETTE.warn, PALETTE.replacement, PALETTE.accentCold, PALETTE.danger, PALETTE.primary];

function applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.font.weight = 500;
  Chart.defaults.color = PALETTE.textMuted;
  Chart.defaults.borderColor = PALETTE.border;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Chart.defaults.plugins.tooltip.backgroundColor = PALETTE.text;
  Chart.defaults.plugins.tooltip.titleColor = PALETTE.textInvert;
  Chart.defaults.plugins.tooltip.bodyColor = PALETTE.textInvert;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxWidth = 8;
  Chart.defaults.plugins.tooltip.boxHeight = 8;
  Chart.defaults.plugins.tooltip.boxPadding = 6;
  Chart.defaults.plugins.tooltip.titleFont = { weight: 700, size: 12 };
  Chart.defaults.plugins.tooltip.bodyFont = { weight: 500, size: 12 };
  Chart.defaults.plugins.tooltip.caretSize = 6;
  Chart.defaults.elements.line.tension = 0.35;
  Chart.defaults.elements.line.borderWidth = 2.5;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.hoverBorderWidth = 2;
  Chart.defaults.elements.point.hoverBackgroundColor = '#ffffff';
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.bar.borderSkipped = false;
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Chart.defaults.animation = { duration: reducedMotion ? 0 : 600, easing: 'easeOutCubic' };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyChartDefaults);
} else {
  applyChartDefaults();
}
```

## Task 5.3: Rewrite `renderKpis()` for hero + secondary

**Files:**
- Modify: `src/views/dashboard.html` — find and rewrite the `renderKpis(data)` function

**Interfaces:**
- Consumes: `data.kpis` object from `/api/v1/analytics/dashboard` response
- Produces: HTML string with 4 hero + 7 secondary cards, populated in `#kpiStrip`

- [ ] **Step 1: Find the existing `renderKpis()` function in `dashboard.html`**

- [ ] **Step 2: Replace its body with the new implementation**

```javascript
function renderKpis(data) {
  const k = data.kpis || {};
  const totalPedidos = k.total_pedidos || 0;
  const atrasosCozinha = k.atrasos_cozinha || 0;
  const atrasosSalao = k.atrasos_salao || 0;

  const statusForAtrasos = (count) => {
    const pct = totalPedidos > 0 ? (count / totalPedidos) * 100 : 0;
    if (pct > 5) return 'danger';
    if (count > 0) return 'warn';
    return 'ok';
  };

  const heroCards = [
    { key: 'pedidos', eyebrow: 'VOLUME TOTAL', value: totalPedidos.toLocaleString('pt-BR'), delta: k.comparison?.pedidos?.delta_pct, status: 'neutral', target: '#overview' },
    { key: 'sla', eyebrow: 'QUALIDADE', value: (k.pct_dentro_sla || 0).toFixed(1) + '%', delta: k.comparison?.sla?.delta_pct, status: 'neutral', target: '#sla' },
    { key: 'atrasos-cozinha', eyebrow: 'PROBLEMA COZINHA', value: atrasosCozinha.toLocaleString('pt-BR'), delta: k.comparison?.atrasos_cozinha?.delta_pct, status: statusForAtrasos(atrasosCozinha), target: '#sla' },
    { key: 'atrasos-salao', eyebrow: 'PROBLEMA SALÃO', value: atrasosSalao.toLocaleString('pt-BR'), delta: k.comparison?.atrasos_salao?.delta_pct, status: statusForAtrasos(atrasosSalao), target: '#sla' },
  ];

  const occMedia = (data.occupancy_by_shift || []).length > 0
    ? data.occupancy_by_shift.reduce((acc, s) => acc + (s.pct_ociosa || 0), 0) / data.occupancy_by_shift.length
    : 0;
  const secondaryCards = [
    { key: 'zerados', label: 'ROTURAS', value: (k.zerados || 0).toLocaleString('pt-BR') },
    { key: 'cancelados', label: 'CANCELADOS', value: (k.cancelados || 0).toLocaleString('pt-BR') },
    { key: 'pct-urgentes', label: 'PRESSÃO', value: (k.pct_urgentes || 0).toFixed(1) + '%' },
    { key: 'urgentes', label: 'URGENTES', value: (k.urgentes || 0).toLocaleString('pt-BR') },
    { key: 'tempo-cozinha', label: 'COZINHA (MIN)', value: (k.tempo_medio_cozinha_min || 0).toFixed(1) },
    { key: 'tempo-retirada', label: 'RETIRADA (MIN)', value: (k.tempo_medio_retirada_min || 0).toFixed(1) },
    { key: 'ocupacao', label: 'OCUPAÇÃO', value: occMedia.toFixed(1) + '%' },
  ];

  const renderDelta = (delta) => {
    if (delta == null) return '';
    const up = delta >= 0;
    const arrow = up ? '↑' : '↓';
    return `<span class="kpi-delta ${up ? 'up' : 'down'}">${arrow} ${Math.abs(delta).toFixed(1)}%</span>`;
  };

  const heroHTML = heroCards.map(c => `
    <button class="kpi-card-hero status-${c.status}" data-target="${c.target}" aria-label="${c.eyebrow}: ${c.value}">
      <div class="kpi-eyebrow"><span>${c.eyebrow}</span>${renderDelta(c.delta)}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sparkline" data-sparkline-key="${c.key}"></div>
    </button>
  `).join('');

  const secondaryHTML = secondaryCards.map(c => `
    <div class="kpi-card-secondary" aria-label="${c.label}: ${c.value}">
      <div class="kpi-eyebrow">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
    </div>
  `).join('');

  return `
    <div class="kpi-hero-grid">${heroHTML}</div>
    <div class="kpi-secondary-grid">${secondaryHTML}</div>
  `;
}
```

- [ ] **Step 3: Find where `renderKpis()` is called**

It's called from inside `buildContent()` (or a similar function). Make sure the result goes to `#kpiStrip` (the new container from Phase 2):

```javascript
document.getElementById('kpiStrip').innerHTML = renderKpis(data);
```

- [ ] **Step 4: Add sparkline rendering after KPI HTML is in DOM**

After `#kpiStrip` is populated, render sparklines for each `.kpi-sparkline` element. Append this code right after the assignment:

```javascript
document.querySelectorAll('.kpi-sparkline[data-sparkline-key]').forEach(el => {
  const key = el.getAttribute('data-sparkline-key');
  const trend = (data.trend || []).slice(-14).map(t => t.total || 0);
  if (trend.length < 2) return;
  const labels = trend.map((_, i) => i);
  const ma7 = trend.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = trend.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const canvas = document.createElement('canvas');
  el.appendChild(canvas);
  if (typeof Chart === 'undefined') return;
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { type: 'bar', data: trend, backgroundColor: 'rgba(69,123,157,.5)', borderWidth: 0 },
        { type: 'line', data: ma7, borderColor: PALETTE.primary, borderWidth: 2, pointRadius: 0, fill: false }
      ]
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
});
```

- [ ] **Step 5: Wire up drill-down for hero KPI buttons**

After sparklines are rendered, add:

```javascript
document.querySelectorAll('.kpi-card-hero').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-target');
    if (!target) return;
    const el = document.querySelector(target);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const firstPanel = el.querySelector('.panel');
      if (firstPanel) {
        firstPanel.style.transition = 'box-shadow 200ms ease-out';
        firstPanel.style.boxShadow = '0 0 0 3px var(--c-accent-warm)';
        setTimeout(() => { firstPanel.style.boxShadow = ''; }, 1200);
      }
    }
  });
});
```

- [ ] **Step 6: Restart server, reload `/dashboard`**

Expected: 4 hero cards no topo (grandes, com sparkline), 7 secondary abaixo. Status borders nos hero "Atrasos Cozinha" e "Atrasos Salão" se houver dados. Click em hero rola até a seção alvo.

## Task 5.4: Webwright checkpoint #2

- [ ] **Step 1: Load `/skill webwright` skill**

- [ ] **Step 2: Full-page screenshot 1920×1080**

Verify in screenshot:
- 4 hero cards no topo, com sparkline (mini bar+line) visível em cada
- 7 secondary cards abaixo em grid 7-col
- Hero "Atrasos Cozinha" e "Atrasos Salão" com borda colorida (danger/warn/ok conforme dados)
- 0 console errors

- [ ] **Step 3: Test drill-down**

Click no hero "Atrasos Cozinha", wait 1.5s, screenshot. Verify: página scrollou para `#sla` e primeiro painel teve pulse teal.

- [ ] **Step 4: Commit checkpoint**

```bash
git add src/views/dashboard.html
git commit -m "test(dashboard): webwright checkpoint 2 - KPI strip" --allow-empty
```

- [ ] **Step 5: Commit phase 5 code**

```bash
git add src/views/dashboard.html src/views/styles/dashboard.css
git commit -m "feat(dashboard): 4 hero + 7 secondary KPI layout with sparklines"
```

---

# Phase 6 — Bento sections

**Goal:** Refactor `buildContent()` to render 18 panels distributed across the 5 sections (Visão Geral, Demanda, SLA, Diagnóstico, Performance). Each panel declared with `data-cols="N"` and uses `.panel` class. Fix the bug in linha 481.

**Spec reference:** §5.5 (panel base), §6 (seções), §10 Fase 6.

## Task 6.1: Add panel CSS to `dashboard.css`

**Files:**
- Modify: `src/views/styles/dashboard.css` — append panel styles

- [ ] **Step 1: Append to `dashboard.css`**

```css
/* === Panel base === */
.panel {
  background: var(--c-surface);
  border-radius: var(--radius-xl);
  padding: var(--sp-5) var(--sp-6);
  box-shadow: var(--shadow-card);
  transition: box-shadow var(--t-base) var(--ease-out);
  display: flex; flex-direction: column; min-height: 0;
  overflow: hidden;
}
.panel:hover { box-shadow: var(--shadow-card-hover); }
@media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
.panel-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: var(--sp-4); gap: var(--sp-3);
}
.panel-title {
  font-size: 14px; font-weight: var(--fw-semi);
  color: var(--c-text); margin: 0;
}
.panel-subtitle {
  font-size: 12px; color: var(--c-text-muted);
  margin: 2px 0 0;
}
.panel-body { flex: 1; min-height: 0; }
.panel-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; }
.panel-clickable { cursor: pointer; }

/* === Panel heights === */
.panel-tall { min-height: 360px; }
.panel-chart { min-height: 360px; }
```

## Task 6.2: Refactor `buildContent()` to render 5 sections

**Files:**
- Modify: `src/views/dashboard.html` — find the existing `buildContent(data)` function

**Interfaces:**
- Consumes: full `/api/v1/analytics/dashboard` response
- Produces: HTML injected into 5 `<section>` `.bento-grid` containers from Phase 2

- [ ] **Step 1: Find the existing `buildContent(data)` function**

- [ ] **Step 2: Replace its body with the new 5-section render**

```javascript
function buildContent(data) {
  document.querySelectorAll('section.dashboard-section .bento-grid').forEach(g => { g.innerHTML = ''; });

  // === Section 1: Visão Geral ===
  document.querySelector('#overview .bento-grid').innerHTML = `
    <article class="panel panel-tall" data-cols="12">
      <header class="panel-header"><h3 class="panel-title">Funil de Demandas</h3></header>
      <div class="panel-body">${renderFunnel(data.funnel || {})}</div>
    </article>
    <article class="panel" data-cols="3">
      <header class="panel-header"><h3 class="panel-title">Status das Demandas</h3></header>
      <div class="panel-body">${renderDonutStatus(data.status_donut || [])}</div>
    </article>
    <article class="panel" data-cols="3">
      <header class="panel-header"><h3 class="panel-title">Origem das Urgências</h3></header>
      <div class="panel-body">${renderDonutOrigem(data.origem_urgencias || [])}</div>
    </article>
    <article class="panel panel-chart" data-cols="6">
      <header class="panel-header">
        <h3 class="panel-title">Comparativo Atual vs Período Anterior</h3>
      </header>
      <div class="panel-body" id="chart-comparativo"></div>
    </article>
  `;

  // === Section 2: Demanda ===
  document.querySelector('#demand .bento-grid').innerHTML = `
    <article class="panel panel-tall" data-cols="12">
      <header class="panel-header">
        <div>
          <h3 class="panel-title">Heatmap Hora × Dia da Semana</h3>
          <p class="panel-subtitle">Passe o mouse para ver o volume</p>
        </div>
      </header>
      <div class="panel-body">${renderHeatmap(data.heatmap || [])}</div>
    </article>
    <article class="panel panel-chart" data-cols="7">
      <header class="panel-header">
        <h3 class="panel-title">Volume MA 7 dias</h3>
      </header>
      <div class="panel-body" id="chart-volume-ma"></div>
    </article>
    <article class="panel" data-cols="5">
      <header class="panel-header"><h3 class="panel-title">Sazonalidade por Dia</h3></header>
      <div class="panel-body">${renderSazonalidade(data.weekday_seasonality || [])}</div>
    </article>
    <article class="panel" data-cols="12">
      <header class="panel-header">
        <h3 class="panel-title">Produtos Mais Demandados</h3>
        <p class="panel-subtitle">Top 12</p>
      </header>
      <div class="panel-body">${renderProdutos(data.produtos || [])}</div>
    </article>
  `;

  // === Section 3: SLA e Tempos ===
  document.querySelector('#sla .bento-grid').innerHTML = `
    <article class="panel panel-chart" data-cols="6">
      <header class="panel-header"><h3 class="panel-title">Velocidade da Cozinha por Hora</h3></header>
      <div class="panel-body" id="chart-velocidade"></div>
    </article>
    <article class="panel panel-chart" data-cols="6">
      <header class="panel-header"><h3 class="panel-title">Tempo de Retirada por Hora</h3></header>
      <div class="panel-body" id="chart-retirada"></div>
    </article>
    <article class="panel" data-cols="6">
      <header class="panel-header">
        <h3 class="panel-title">SLA por Produto</h3>
        <p class="panel-subtitle">Pareto de estouros</p>
      </header>
      <div class="panel-body">${renderSlaPareto(data.sla_by_product || [])}</div>
    </article>
    <article class="panel" data-cols="6">
      <header class="panel-header">
        <h3 class="panel-title">Tempo Médio de Preparo</h3>
        <p class="panel-subtitle">Por produto vs SLA</p>
      </header>
      <div class="panel-body">${renderPreparo(data.qty_vs_time || [])}</div>
    </article>
    <article class="panel" data-cols="4">
      <header class="panel-header"><h3 class="panel-title">Tempo de Fila por Estação</h3></header>
      <div class="panel-body">${renderFilaEstacao(data.queue_time_by_station || [])}</div>
    </article>
    <article class="panel panel-chart" data-cols="4">
      <header class="panel-header"><h3 class="panel-title">Fila por Estação × Hora</h3></header>
      <div class="panel-body" id="chart-fila-hora"></div>
    </article>
    <article class="panel" data-cols="4">
      <header class="panel-header"><h3 class="panel-title">Ocupação por Turno</h3></header>
      <div class="panel-body">${renderOcupacao(data.occupancy_by_shift || [])}</div>
    </article>
  `;

  // === Section 4: Diagnóstico ===
  document.querySelector('#diagnosis .bento-grid').innerHTML = `
    <article class="panel" data-cols="4">
      <header class="panel-header">
        <h3 class="panel-title">Motivos de Cancelamento</h3>
        <p class="panel-subtitle">Top 10</p>
      </header>
      <div class="panel-body">${renderCancelReasons(data.cancel_reasons || [])}</div>
    </article>
    <article class="panel" data-cols="4">
      <header class="panel-header">
        <h3 class="panel-title">Zerados por Produto</h3>
        <p class="panel-subtitle">Top 10</p>
      </header>
      <div class="panel-body">${renderZerados(data.scatter_roturas || [])}</div>
    </article>
    <article class="panel" data-cols="4">
      <header class="panel-header">
        <h3 class="panel-title">Trocas de Itens do Cardápio</h3>
      </header>
      <div class="panel-body">${renderReplacements(data.replacements || [])}</div>
    </article>
  `;

  // === Section 5: Performance (loaded by loadPerformance below) ===
  document.querySelector('#performance .bento-grid').innerHTML = `
    <article class="panel" data-cols="12" id="performance-scores">
      <div class="panel-body" style="display:flex;align-items:center;justify-content:center;color:var(--c-text-muted);">Carregando notas…</div>
    </article>
  `;
}
```

- [ ] **Step 3: Verify render functions exist or create them**

The functions `renderFunnel`, `renderDonutStatus`, `renderDonutOrigem`, `renderHeatmap`, `renderSazonalidade`, `renderProdutos`, `renderSlaPareto`, `renderPreparo`, `renderFilaEstacao`, `renderOcupacao`, `renderCancelReasons`, `renderZerados`, `renderReplacements` may already exist in the current `dashboard.html`. **Do not modify them** — they should work as-is inside the new panel containers. If a function is missing, refer to spec §6 for the panel content and create it with the same visual style as the current dashboard (preserve all existing HTML/CSS for these panels — just wrap them in the panel class).

- [ ] **Step 4: Fix bug on linha 481**

Find the line that says `document.getElementById('periodToday').click()` (or similar). Replace with:

```javascript
const todayBtn = document.querySelector('#periodSelector .period-btn[data-range="today"]');
if (todayBtn) todayBtn.click();
```

- [ ] **Step 5: Update the legacy `#content` to be hidden**

If `#content` was being used, ensure it's hidden (it should be from Phase 2 wrap).

- [ ] **Step 6: Restart server, reload `/dashboard`**

Expected: 5 sections visíveis com eyebrow + title + description. Panels distribuídos nos bento grids. Charts (ainda como placeholders) onde seriam. Performance section mostra "Carregando notas…" até Phase 7+ quando `loadPerformance()` é chamado.

- [ ] **Step 7: Commit**

```bash
git add src/views/dashboard.html src/views/styles/dashboard.css
git commit -m "feat(dashboard): bento sections with 5 thematic groupings (18 panels)"
```

---

# Phase 7 — Chart.js migration (4 migrated + 2 new)

**Goal:** Replace 4 canvas hand-rolled functions with Chart.js factories. Add 2 new Chart.js charts (Velocidade, Retirada) replacing HTML bars. Add zoom plugin to all 6. Add Reset zoom button. **CHECKPOINT WEBWRIGHT #3**.

**Spec reference:** §4.5 (Chart.js config), §5.6 (6 charts), §10 Fase 7.

## Task 7.1: Add 6 chart factory functions to `dashboard.html`

**Files:**
- Modify: `src/views/dashboard.html` — add chart factory functions and `ZOOM_CONFIG` + `createChartWithZoom` helper

**Interfaces:**
- Consumes: data from `data.*` (trend, week_comparison, etc.) and the 6 chart container divs (`#chart-comparativo`, `#chart-volume-ma`, `#chart-fila-hora`, `#chart-velocidade`, `#chart-retirada`)
- Produces: 6 `new Chart(canvas, config)` instances with zoom plugin

- [ ] **Step 1: Add the `ZOOM_CONFIG` constant near the top of the script (after PALETTE)**

```javascript
const ZOOM_CONFIG = {
  pan: { enabled: true, mode: 'x' },
  zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
  limits: { x: { minRange: 4 } },
};
```

- [ ] **Step 2: Add a helper to create a chart with zoom + reset button**

```javascript
function createChartWithZoom(canvas, config) {
  config.options = config.options || {};
  config.options.plugins = config.options.plugins || {};
  config.options.plugins.zoom = ZOOM_CONFIG;
  const chart = new Chart(canvas, config);
  const container = canvas.parentElement;
  container.style.position = 'relative';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'chart-reset-zoom';
  resetBtn.textContent = '↺ Reset';
  resetBtn.hidden = true;
  container.appendChild(resetBtn);
  resetBtn.addEventListener('click', () => chart.resetZoom());
  return chart;
}
```

- [ ] **Step 3: Add the 6 chart factory functions**

```javascript
function createComparativoChart(canvas, data) {
  const wc = data.week_comparison || [];
  const labels = wc.map(d => d.day);
  return createChartWithZoom(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { type: 'bar', label: 'Entregues', data: wc.map(d => d.entregues || 0), backgroundColor: PALETTE.accentWarm, stack: 'a' },
        { type: 'bar', label: 'Cancelados', data: wc.map(d => d.cancelados || 0), backgroundColor: PALETTE.danger, stack: 'a' },
        { type: 'bar', label: 'Atrasos', data: wc.map(d => d.atrasos || 0), backgroundColor: PALETTE.warn, stack: 'a' },
        { type: 'line', label: 'Volume total', data: wc.map(d => d.total || 0), borderColor: PALETTE.primary, backgroundColor: 'transparent', yAxisID: 'y1' }
      ]
    },
    options: {
      scales: {
        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'demandas' } },
        y1: { position: 'right', beginAtZero: true, grid: { display: false } }
      }
    }
  });
}

function createVolumeMAChart(canvas, data) {
  const trend = (data.trend || []).slice(-30);
  const labels = trend.map(t => t.day);
  const values = trend.map(t => t.total || 0);
  const ma7 = values.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = values.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  return createChartWithZoom(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { type: 'bar', label: 'Volume diário', data: values, backgroundColor: 'rgba(69,123,157,.5)', borderWidth: 0 },
        { type: 'line', label: 'MA 7d', data: ma7, borderColor: PALETTE.primary, borderWidth: 2, pointRadius: 0, fill: false }
      ]
    },
    options: { scales: { y: { beginAtZero: true } } }
  });
}

function createFilaHoraChart(canvas, data) {
  const qh = data.queue_time_by_hour || [];
  if (qh.length === 0) return null;
  const labels = Array.from({ length: 24 }, (_, i) => i + 'h');
  const stationNames = [...new Set(qh.map(d => d.station_name))];
  const datasets = stationNames.map((name, i) => ({
    label: name,
    data: labels.map((_, h) => {
      const row = qh.find(d => d.station_name === name && d.hour === h);
      return row ? row.avg_queue_min || 0 : 0;
    }),
    borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: 2,
  }));
  return createChartWithZoom(canvas, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'min fila' } } } }
  });
}

function createVelocidadeChart(canvas, data) {
  const sh = data.speed_by_hour || [];
  const labels = sh.map(d => d.hour + 'h');
  const values = sh.map(d => d.avg_time_min || 0);
  return createChartWithZoom(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Tempo médio (min)',
        data: values,
        borderColor: PALETTE.accentWarm,
        backgroundColor: 'rgba(42,157,143,.3)',
        fill: { target: 'origin', above: 'rgba(42,157,143,.3)' },
        borderWidth: 2,
      }]
    },
    options: { scales: { y: { beginAtZero: true } } }
  });
}

function createRetiradaChart(canvas, data) {
  const ph = data.pickup_by_hour || [];
  const labels = ph.map(d => d.hour + 'h');
  const values = ph.map(d => d.avg_pickup_min || 0);
  return createChartWithZoom(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Tempo médio (min)',
        data: values,
        borderColor: PALETTE.primaryTint,
        backgroundColor: 'rgba(69,123,157,.3)',
        fill: { target: 'origin', above: 'rgba(69,123,157,.3)' },
        borderWidth: 2,
      }]
    },
    options: { scales: { y: { beginAtZero: true } } }
  });
}

function createPerfTrendChart(canvas, data) {
  const history = data.history || [];
  const labels = history.map(d => d.date);
  const entities = [...new Set(history.flatMap(d => Object.keys(d.scores || {})))];
  const datasets = entities.map((entity, i) => ({
    label: entity,
    data: history.map(d => (d.scores || {})[entity] || null),
    borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: 2,
  }));
  return createChartWithZoom(canvas, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: { scales: { y: { min: 0, max: 5 } } }
  });
}
```

- [ ] **Step 4: Wire charts into `buildContent()` — at the end of the function, after the innerHTML assignments**

```javascript
if (typeof Chart !== 'undefined') {
  const c1 = document.getElementById('chart-comparativo');
  if (c1) { const canvas = document.createElement('canvas'); c1.appendChild(canvas); createComparativoChart(canvas, data); }
  const c2 = document.getElementById('chart-volume-ma');
  if (c2) { const canvas = document.createElement('canvas'); c2.appendChild(canvas); createVolumeMAChart(canvas, data); }
  const c3 = document.getElementById('chart-fila-hora');
  if (c3) { const canvas = document.createElement('canvas'); c3.appendChild(canvas); createFilaHoraChart(canvas, data); }
  const c4 = document.getElementById('chart-velocidade');
  if (c4) { const canvas = document.createElement('canvas'); c4.appendChild(canvas); createVelocidadeChart(canvas, data); }
  const c5 = document.getElementById('chart-retirada');
  if (c5) { const canvas = document.createElement('canvas'); c5.appendChild(canvas); createRetiradaChart(canvas, data); }
}
```

- [ ] **Step 5: Remove the 4 old canvas drawing functions**

Find and delete these functions (if they exist):
- `drawMaChart()`
- `drawQueueHourChart()`
- `drawComparisonChart()`
- `drawPerfTrendChart()`

And any callers of them (search for `drawMaChart(`, etc., and remove the calls).

- [ ] **Step 6: Add reset zoom button CSS to `dashboard.css`**

```css
.chart-reset-zoom {
  position: absolute;
  top: 8px; right: 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border-light);
  border-radius: var(--radius-md);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: var(--fw-semi);
  color: var(--c-text);
  cursor: pointer;
  z-index: 1;
  box-shadow: 0 1px 3px rgba(29,53,87,.1);
}
.chart-reset-zoom:hover { background: var(--c-bg-light); }
```

- [ ] **Step 7: Wire `createPerfTrendChart` into `loadPerformance()`**

Find the existing `loadPerformance()` function. After it populates score cards, find the trend chart container and create the chart.

- [ ] **Step 8: Restart server, reload `/dashboard`**

Expected: 6 charts render with tooltips on hover. Zoom with scroll wheel works. Reset zoom button appears after zooming and resets when clicked.

## Task 7.2: Webwright checkpoint #3

- [ ] **Step 1: Load `/skill webwright` skill**

- [ ] **Step 2: Screenshot 1 chart (Comparativo)**

Hover on a bar, wait, screenshot. Verify: tooltip styled (dark bg, white text, padding 12, radius 8).

- [ ] **Step 3: Test zoom**

Scroll wheel on the chart 5 times, wait, screenshot. Verify: chart zoomed in (fewer x-axis labels visible), Reset zoom button appears at top-right of the chart.

- [ ] **Step 4: Click Reset zoom, verify chart returns to full range**

- [ ] **Step 5: Commit checkpoint**

```bash
git add src/views/dashboard.html
git commit -m "test(dashboard): webwright checkpoint 3 - Chart.js" --allow-empty
```

- [ ] **Step 6: Commit phase 7 code**

```bash
git add src/views/dashboard.html src/views/styles/dashboard.css
git commit -m "feat(dashboard): migrate 4 + create 2 (6 total) Chart.js charts + zoom plugin"
```

---

# Phase 8 — Interatividade e edge cases

**Goal:** Add 12 drill-down flows, 3 modals, empty states (global + per-panel), error states, skeleton loaders, refined socket behavior, last-updated badge, toast helper.

**Spec reference:** §7 (behavior), §8 (edge states), §10 Fase 8.

## Task 8.1: Add skeleton + empty + error CSS to `dashboard.css`

**Files:**
- Modify: `src/views/styles/dashboard.css` — append edge state styles

- [ ] **Step 1: Append to `dashboard.css`**

```css
/* === Skeleton blocks for chart containers === */
.chart-container {
  position: relative;
  min-height: 280px;
}
.chart-container .skeleton-block {
  position: absolute; inset: 0;
  border-radius: var(--radius-md);
}
.chart-container canvas {
  position: absolute; inset: 0;
  width: 100% !important; height: 100% !important;
}

/* === Empty state global === */
.empty-state-global {
  text-align: center;
  padding: var(--sp-8) var(--sp-5);
  background: var(--c-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  display: flex; flex-direction: column;
  align-items: center; gap: var(--sp-3);
  margin-top: var(--sp-7);
}
.empty-state-global .empty-icon {
  width: 64px; height: 64px;
  stroke: var(--c-text-muted); fill: none;
  stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
}
.empty-state-global h2 {
  font-size: 18px; font-weight: var(--fw-bold);
  color: var(--c-text); margin: 0;
}
.empty-state-global p {
  font-size: 14px; color: var(--c-text-muted);
  margin: 0; max-width: 400px;
}

/* === Modal === */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(15,15,15,.5);
  display: flex; align-items: center; justify-content: center;
  z-index: var(--z-modal);
  padding: var(--sp-5);
}
.modal-overlay[hidden] { display: none; }
.modal-card {
  background: var(--c-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated);
  max-width: 720px; width: 100%;
  max-height: 80vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: var(--sp-5) var(--sp-6);
  border-bottom: 1px solid var(--c-border-light);
}
.modal-title {
  font-size: 16px; font-weight: var(--fw-semi);
  color: var(--c-text); margin: 0;
}
.modal-close {
  background: transparent; border: 0;
  font-size: 24px; line-height: 1;
  color: var(--c-text-muted);
  cursor: pointer;
  padding: 0; width: 32px; height: 32px;
  border-radius: var(--radius-md);
}
.modal-close:hover { background: var(--c-bg-light); }
.modal-body {
  padding: var(--sp-5) var(--sp-6);
  overflow-y: auto;
  flex: 1;
}

/* === Socket banner === */
.socket-banner {
  position: fixed; top: var(--header-height); left: 0; right: 0;
  background: var(--alert-warn-bg-light);
  border-bottom: 2px solid var(--c-warn);
  padding: var(--sp-2) var(--sp-5);
  font-size: 13px;
  color: var(--c-text);
  z-index: calc(var(--z-sticky) - 1);
  text-align: center;
}
.socket-banner[hidden] { display: none; }

/* === Print === */
@media print {
  .sticky-top, .side-nav, .btn-export, .toast, .modal-overlay,
  .socket-banner, .chart-reset-zoom, .last-updated, .panel-actions {
    display: none !important;
  }
  .panel { break-inside: avoid; box-shadow: none; border: 1px solid var(--c-border-light); }
  body { background: white; }
}
```

## Task 8.2: Add toast helper

**Files:**
- Modify: `src/views/dashboard.html` — add `showToast` function near top of script

- [ ] **Step 1: Add the helper**

```javascript
function showToast(msg, kind) {
  kind = kind || 'info';
  const container = document.getElementById('toastContainer') || (() => {
    const c = document.createElement('div');
    c.id = 'toastContainer';
    c.setAttribute('aria-live', 'polite');
    c.style.cssText = 'position:fixed;top:64px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(c);
    return c;
  })();
  const t = document.createElement('div');
  t.className = 'toast toast-' + kind;
  t.setAttribute('role', 'alert');
  t.textContent = msg;
  container.appendChild(t);
  const duration = (kind === 'error') ? 12000 : 4000;
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
  }, duration);
}
```

- [ ] **Step 2: Replace remaining `alert()` calls with `showToast`**

Run: `rg "alert\(" src/views/dashboard.html`
For each match, replace `alert(...)` with appropriate `showToast(..., 'warn'|'error')`.

## Task 8.3: Add 3 modals to `dashboard.html`

**Files:**
- Modify: `src/views/dashboard.html` — add modals before `</body>`

- [ ] **Step 1: Add modal HTML**

```html
<div class="modal-overlay" id="modalFunil" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-funil-title">
    <header class="modal-header">
      <h2 id="modal-funil-title" class="modal-title">Demandas</h2>
      <button class="modal-close" aria-label="Fechar" data-modal-close>×</button>
    </header>
    <div class="modal-body" id="modal-funil-body">Carregando…</div>
  </div>
</div>

<div class="modal-overlay" id="modalProdutos" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-produtos-title">
    <header class="modal-header">
      <h2 id="modal-produtos-title" class="modal-title">Demandas do produto</h2>
      <button class="modal-close" aria-label="Fechar" data-modal-close>×</button>
    </header>
    <div class="modal-body" id="modal-produtos-body">Carregando…</div>
  </div>
</div>

<div class="modal-overlay" id="modalTrocas" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-trocas-title">
    <header class="modal-header">
      <h2 id="modal-trocas-title" class="modal-title">Trocas de Cardápio</h2>
      <button class="modal-close" aria-label="Fechar" data-modal-close>×</button>
    </header>
    <div class="modal-body" id="modal-trocas-body">Carregando…</div>
  </div>
</div>

<div class="socket-banner" id="socketBanner" hidden>
  Conexão em tempo real perdida — tentando reconectar…
</div>
```

- [ ] **Step 2: Add modal helpers (open/close, focus management, Esc)**

```javascript
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal._previousFocus = document.activeElement;
  modal.hidden = false;
  const firstFocusable = modal.querySelector('button, [tabindex]:not([tabindex="-1"])');
  if (firstFocusable) firstFocusable.focus();
  document.body.style.overflow = 'hidden';
  modal.addEventListener('click', modal._outsideClick = (e) => {
    if (e.target === modal) closeModal(id);
  });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  if (modal._outsideClick) {
    modal.removeEventListener('click', modal._outsideClick);
    modal._outsideClick = null;
  }
  if (modal._previousFocus) {
    modal._previousFocus.focus();
    modal._previousFocus = null;
  }
}

document.querySelectorAll('[data-modal-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modal = btn.closest('.modal-overlay');
    if (modal) closeModal(modal.id);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not([hidden])').forEach(m => closeModal(m.id));
  }
});
```

## Task 8.4: Wire drill-downs (sample: funnel → modal)

**Files:**
- Modify: `src/views/dashboard.html` — add drill-down handlers

- [ ] **Step 1: Funnel stage click → modalFunil**

After `buildContent()` populates the funnel, add click handler to each stage. The funnel stage elements must have `data-funnel-stage="<status>"` attribute (add this to the funnel render function if not already there). After `buildContent()` runs:

```javascript
document.querySelectorAll('[data-funnel-stage]').forEach(stage => {
  stage.addEventListener('click', () => {
    const status = stage.getAttribute('data-funnel-stage');
    openModal('modalFunil');
    document.getElementById('modal-funil-title').textContent = `Demandas — ${status}`;
    document.getElementById('modal-funil-body').textContent = 'Carregando…';
    fetch(`/api/v1/demands?status=${encodeURIComponent(status)}&range=${currentRange}`)
      .then(r => r.json())
      .then(d => {
        document.getElementById('modal-funil-body').innerHTML = renderDemandsTable(d.demands || []);
      })
      .catch(err => {
        document.getElementById('modal-funil-body').innerHTML = '<p>Erro ao carregar.</p>';
        showToast('Falha ao buscar demandas', 'error');
      });
  });
});
```

- [ ] **Step 2: Add `renderDemandsTable()` helper**

```javascript
function renderDemandsTable(demands) {
  if (demands.length === 0) return '<p>Nenhuma demanda encontrada.</p>';
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="border-bottom:1px solid var(--c-border-light);text-align:left;">
        <th style="padding:8px 4px;">#</th>
        <th style="padding:8px 4px;">Produto</th>
        <th style="padding:8px 4px;">Mesa</th>
        <th style="padding:8px 4px;">Criada</th>
        <th style="padding:8px 4px;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${demands.slice(0, 50).map(d => `
        <tr style="border-bottom:1px solid var(--c-border-light);">
          <td style="padding:8px 4px;font-family:var(--font-mono);">${d.id}</td>
          <td style="padding:8px 4px;">${d.product_name || '—'}</td>
          <td style="padding:8px 4px;">${d.table_number || '—'}</td>
          <td style="padding:8px 4px;font-family:var(--font-mono);">${new Date(d.created_at).toLocaleString('pt-BR')}</td>
          <td style="padding:8px 4px;">${d.status}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ${demands.length > 50 ? '<p style="margin-top:12px;font-size:12px;color:var(--c-text-muted);">Mostrando 50 de ' + demands.length + '.</p>' : ''}`;
}
```

- [ ] **Step 3: Implement remaining 10 drill-downs**

Repeat the pattern above for: products (modalProdutos), motivos, zerados, trocas (modalTrocas), heatmap cell, Pareto SLA. The spec §7.2 table lists all 12 flows. Each follows the same `openModal` → fetch → render pattern.

## Task 8.5: Empty state global

**Files:**
- Modify: `src/views/dashboard.html` — add empty state render in `loadDashboard()`

- [ ] **Step 1: Find the fetch callback in `loadDashboard()` (or equivalent)**

- [ ] **Step 2: After the data is received, check if it's empty**

```javascript
const isEmpty = !data.kpis || (data.kpis.total_pedidos === 0 &&
  (!data.produtos || data.produtos.length === 0) &&
  (!data.funnel || data.funnel.created === 0));

if (isEmpty) {
  document.querySelectorAll('section.dashboard-section, .kpi-strip').forEach(s => s.hidden = true);
  document.querySelector('.dashboard-main').insertAdjacentHTML('beforeend', `
    <div class="empty-state-global">
      <svg class="empty-icon" viewBox="0 0 24 24">
        <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>
      </svg>
      <h2>Sem dados para o período selecionado</h2>
      <p>Tente outro intervalo de datas ou verifique se há demandas registradas.</p>
      <button class="btn-primary" id="btnEmptyBackToToday">Voltar para hoje</button>
    </div>
  `);
  document.getElementById('btnEmptyBackToToday').addEventListener('click', () => {
    document.querySelector('#periodSelector .period-btn[data-range="today"]').click();
  });
} else {
  document.querySelectorAll('section.dashboard-section, .kpi-strip').forEach(s => s.hidden = false);
  const empty = document.querySelector('.empty-state-global');
  if (empty) empty.remove();
  buildContent(data);
}
```

## Task 8.6: Skeleton loaders on initial load

**Files:**
- Modify: `src/views/dashboard.html` — add skeleton rendering

- [ ] **Step 1: Add a `renderKpiSkeleton()` function**

```javascript
function renderKpiSkeleton() {
  return `
    <div class="kpi-hero-grid">
      ${Array(4).fill('<div class="kpi-card-hero" style="border-left-color:var(--c-border-light);"><div class="kpi-eyebrow"><div class="skeleton-block" style="width:80px;height:12px;"></div></div><div class="skeleton-block" style="width:60%;height:32px;margin:8px 0;"></div><div class="kpi-sparkline"><div class="skeleton-block" style="width:100%;height:100%;"></div></div></div>').join('')}
    </div>
    <div class="kpi-secondary-grid">
      ${Array(7).fill('<div class="kpi-card-secondary"><div class="kpi-eyebrow"><div class="skeleton-block" style="width:60px;height:10px;"></div></div><div class="skeleton-block" style="width:50%;height:18px;margin:6px 0;"></div></div>').join('')}
    </div>
  `;
}
```

- [ ] **Step 2: Call `renderKpiSkeleton()` before the fetch**

```javascript
document.getElementById('kpiStrip').innerHTML = renderKpiSkeleton();
fetch(`/api/v1/analytics/dashboard?${params}`).then(...)
```

- [ ] **Step 3: Add skeleton blocks to chart containers before chart creation**

In the chart wiring block (Task 7.1 Step 4), add skeleton block to each chart container before creating the canvas:

```javascript
const chartContainers = ['chart-comparativo', 'chart-volume-ma', 'chart-fila-hora', 'chart-velocidade', 'chart-retirada'];
chartContainers.forEach(id => {
  const el = document.getElementById(id);
  if (el && !el.querySelector('canvas')) {
    el.classList.add('chart-container');
    if (!el.querySelector('.skeleton-block')) el.innerHTML = '<div class="skeleton-block"></div>';
  }
});
```

The skeleton is removed when the canvas is added and the chart renders.

## Task 8.7: Refine Socket.IO behavior

**Files:**
- Modify: `src/views/dashboard.html` — find and refactor the socket event handlers

- [ ] **Step 1: Find existing socket event handlers**

Look for `socket.on('demand:new', ...)` and similar.

- [ ] **Step 2: Replace with debounced, period-aware behavior**

```javascript
const DEBOUNCE_MS = 30000;
let pendingReload = null;

function isLiveRange() {
  return currentRange === 'today' && !customDateRange;
}

function scheduleReload() {
  clearTimeout(pendingReload);
  if (isLiveRange()) {
    pendingReload = setTimeout(() => {
      loadDashboard();
      pendingReload = null;
    }, DEBOUNCE_MS);
  }
}

function showLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  el.hidden = false;
  el.querySelector('.mono').textContent = 'agora';
  setTimeout(() => {
    if (!el.hidden) el.querySelector('.mono').textContent = '1s';
  }, 1000);
}

['demand:new', 'demand:urgent', 'demand:ready', 'demand:retrieved', 'demand:cancelled', 'demand:annulled', 'demand:stockout'].forEach(event => {
  socket.on(event, () => {
    showLastUpdated();
    scheduleReload();
  });
});

socket.on('disconnect', () => {
  const banner = document.getElementById('socketBanner');
  if (banner) banner.hidden = false;
});
socket.on('connect', () => {
  const banner = document.getElementById('socketBanner');
  if (banner) banner.hidden = true;
  showToast('Conexão restabelecida', 'info');
});
```

- [ ] **Step 3: Add the `#lastUpdated` element to the header inner HTML**

In Phase 4's header, after the back link, add:

```html
<span class="last-updated" id="lastUpdated" aria-live="polite" hidden>
  <span class="dot"></span>
  Atualizado <span class="mono">agora</span>
</span>
```

## Task 8.8: Error handling on fetch

**Files:**
- Modify: `src/views/dashboard.html` — wrap fetches in try/catch

- [ ] **Step 1: Find the main `/api/v1/analytics/dashboard` fetch**

- [ ] **Step 2: Wrap in try/catch with error state**

```javascript
async function loadDashboard() {
  try {
    const response = await fetch(`/api/v1/analytics/dashboard?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderDashboard(data);
  } catch (err) {
    console.error('Dashboard load failed:', err);
    if (!document.getElementById('kpiStrip').innerHTML.trim() || document.getElementById('kpiStrip').querySelector('.skeleton-block')) {
      document.querySelector('.dashboard-main').insertAdjacentHTML('afterbegin', `
        <div class="empty-state-global">
          <svg class="empty-icon" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h2>Não foi possível carregar o dashboard</h2>
          <p>${err.message || 'Erro desconhecido'}</p>
          <button class="btn-primary" onclick="loadDashboard()">Tentar novamente</button>
          <a href="/gerente" class="btn-ghost">Voltar para /gerente</a>
        </div>
      `);
    } else {
      showToast('Falha ao atualizar — mostrando dados anteriores', 'error');
    }
  }
}
```

- [ ] **Step 3: Restart, reload, verify error path**

Temporarily stop the server, reload `/dashboard`. Expected: error state visible. Restart server, click "Tentar novamente". Expected: dashboard loads.

- [ ] **Step 4: Commit**

```bash
git add src/views/dashboard.html src/views/styles/dashboard.css
git commit -m "feat(dashboard): drill-down modals, empty/error states, socket resilience, skeletons"
```

---

# Phase 9 — Acessibilidade e polish

**Goal:** Add ARIA labels, focus management, keyboard shortcuts, prefers-reduced-motion for Chart.js, Lighthouse cleanup. **CHECKPOINT WEBWRIGHT #4 (FINAL)**.

**Spec reference:** §9 (a11y), §7.3 (keyboard shortcuts), §10 Fase 9.

## Task 9.1: Add ARIA labels to chart canvases

**Files:**
- Modify: `src/views/dashboard.html` — add ARIA in chart factory functions

- [ ] **Step 1: Modify `createChartWithZoom` to add ARIA**

After the `const chart = new Chart(canvas, config);` line, add:

```javascript
canvas.setAttribute('tabindex', '0');
canvas.setAttribute('role', 'img');
const datasetCount = (config.data && config.data.datasets) ? config.data.datasets.length : 0;
canvas.setAttribute('aria-label', `${config.type} chart with ${datasetCount} datasets`);
```

## Task 9.2: Add keyboard shortcuts

**Files:**
- Modify: `src/views/dashboard.html` — add keydown listener

- [ ] **Step 1: Add the keyboard handler (place after the side nav IIFE)**

```javascript
// === Keyboard shortcuts ===
let pendingG = null;
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (pendingG && Date.now() - pendingG < 1500) {
    const map = { o: 'overview', d: 'demand', s: 'sla', n: 'diagnosis', p: 'performance', t: 'top' };
    const target = map[e.key.toLowerCase()];
    if (target) {
      e.preventDefault();
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
    pendingG = null;
    return;
  }
  if (e.key.toLowerCase() === 'g') {
    pendingG = Date.now();
    return;
  }
  if (e.key.toLowerCase() === 'r') {
    e.preventDefault();
    loadDashboard();
  }
  if (e.key.toLowerCase() === 'e') {
    e.preventDefault();
    document.getElementById('btnExport')?.click();
  }
  if (e.key === '?') {
    e.preventDefault();
    showShortcutsHelp();
  }
});

function showShortcutsHelp() {
  const existing = document.getElementById('modalAjuda');
  if (existing) { openModal('modalAjuda'); return; }
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'modalAjuda';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-ajuda-title">
      <header class="modal-header">
        <h2 id="modal-ajuda-title" class="modal-title">Atalhos de teclado</h2>
        <button class="modal-close" aria-label="Fechar" data-modal-close>×</button>
      </header>
      <div class="modal-body">
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>g</kbd> + <kbd>o</kbd></td><td>Ir para Visão Geral</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>g</kbd> + <kbd>d</kbd></td><td>Ir para Demanda</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>g</kbd> + <kbd>s</kbd></td><td>Ir para SLA</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>g</kbd> + <kbd>n</kbd></td><td>Ir para Diagnóstico</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>g</kbd> + <kbd>p</kbd></td><td>Ir para Performance</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>g</kbd> + <kbd>t</kbd></td><td>Voltar ao topo</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>r</kbd></td><td>Atualizar manualmente</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>e</kbd></td><td>Abrir export</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>?</kbd></td><td>Esta ajuda</td></tr>
          <tr><td style="padding:6px;font-family:var(--font-mono);"><kbd>Esc</kbd></td><td>Fechar modal</td></tr>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('[data-modal-close]').addEventListener('click', () => closeModal('modalAjuda'));
  openModal('modalAjuda');
}
```

- [ ] **Step 2: Verify keyboard shortcuts**

Press `?` on `/dashboard`. Expected: modal de ajuda abre. Press `g` then `o`. Expected: page scrolls to Visão Geral. Press `Esc`. Expected: modal closes.

## Task 9.3: Verify prefers-reduced-motion for Chart.js

Already handled in `applyChartDefaults()` (Task 5.2). Verify by:

- [ ] **Step 1: Open browser DevTools → Rendering → Emulate CSS media feature → prefers-reduced-motion: reduce**

- [ ] **Step 2: Reload `/dashboard`**

Expected: charts render without animation. Side nav transitions removed. Hover translateY removed.

- [ ] **Step 3: Reset to no-preference and verify animations return**

## Task 9.4: Verify print stylesheet

Already added in Task 8.1 (`@media print` block). Verify by:

- [ ] **Step 1: Open browser print preview (Ctrl+P) on `/dashboard`**

Expected: side nav, header chrome, modals, banners, reset zoom buttons are hidden. Only panels visible. No panel breaks across pages.

## Task 9.5: Webwright checkpoint #4 (FINAL)

- [ ] **Step 1: Load `/skill webwright` skill**

- [ ] **Step 2: Run all 13 critical flows from spec §11.6**

Verify each:
1. Load inicial (0 console errors, TTI < 3s)
2. Side nav navigation (hover, click, active state)
3. Filtro de período (4 botões + range custom + estação)
4. Drill-down de KPIs (4 hero, destinos corretos)
5. Drill-down de painel (3 modais: funil, produtos, trocas)
6. Charts (hover, zoom, reset)
7. Performance (5 score cards, detratores toggle, trend chart)
8. Socket.IO refresh (badge, debounce)
9. Empty state (período vazio)
10. Error state (network failure)
11. Export (PDF e Excel)
12. Acessibilidade (Lighthouse ≥ 95)
13. Responsivo (3 viewports: 1920×1080, 1366×768, 768×1024)

- [ ] **Step 3: Take 3 screenshots (1920×1080, 1366×768, 768×1024)**

- [ ] **Step 4: Verify 0 console errors in all viewports**

- [ ] **Step 5: Run final sanity grep**

```bash
rg "#[0-9a-fA-F]{3,6}" src/views/dashboard.html | rg -v "var\(--"   # expected ~0
rg "border-radius: [0-9]+px" src/views/dashboard.html                # expected ~0
rg "alert\(['\"]" src/views/dashboard.html                            # expected 0
rg "ctx\.fillText" src/views/dashboard.html                           # expected 0
```

- [ ] **Step 6: Commit checkpoint evidence**

```bash
git add final_runs/run_*/
git commit -m "test(dashboard): webwright checkpoint 4 (final) - 13 critical flows" --allow-empty
```

- [ ] **Step 7: Commit phase 9 code**

```bash
git add src/views/dashboard.html src/views/styles/dashboard.css src/views/styles/theme.css
git commit -m "feat(dashboard): a11y polish, keyboard shortcuts, lighthouse cleanup"
```

## Task 9.6: Final tag and merge preparation

- [ ] **Step 1: Verify all 9 phase commits are present**

Run: `git log --oneline | head -20`
Expected: 9 phase commits + 4 webwright checkpoint commits + the spec commit from brainstorming.

- [ ] **Step 2: Run final acceptance commands**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Tag the release**

```bash
git tag v2.6-dashboard-redesign
```

- [ ] **Step 4: Wait for user approval before merge**

Do NOT merge automatically. Present the 9 commits + screenshots to the user and ask for go/no-go on merge.
