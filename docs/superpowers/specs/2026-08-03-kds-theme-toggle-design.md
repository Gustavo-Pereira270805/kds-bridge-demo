# Design Spec: Aplicação Completa do Tema + Toggle Claro/Escuro (KDS Bridge)

**Date:** 2026-08-03
**Topic:** KDS UI Theming (Complete token migration + light/dark toggle for manager screens)

---

## 1. Overview & Objectives

The KDS Bridge system (restaurant kitchen display + manager BI) received a partial
"Warm Obsidian & Amber Gold" redesign earlier. This spec completes that work and
adds a user-controlled light/dark theme toggle on the manager screens.

**Goals:**
1. Make `theme.css` the single source of truth for all colors/tokens across all 7 views.
2. Apply the Warm Obsidian dark theme fully to `gerente.html` and `dashboard.html`
   (currently only their topbars are dark; body content remains light).
3. Clean up remaining hardcoded colors (`#hex`, `rgb()`) across all views.
4. Add a synchronized light/dark toggle (dark default) to `gerente.html`,
   `dashboard.html`, and `admin.html`.
5. Keep `salao.html`, `cozinha.html`, `cozinha-quente.html`, `cozinha-fria.html`
   single-theme (no toggle) — but still migrate them to tokens and fix touch buttons
   where the earlier work was incomplete.
6. Make Chart.js charts swap palette when the theme changes.

**Non-goals:**
- No auth/user-profile theming.
- No change to functional flows (demand creation, kitchen ops, BI export).
- No React/framework migration.

---

## 2. Current State (Files & Gaps)

### 2.1 View inventory (`src/views/`)

| File | Current theme state | Gaps |
|------|--------------------|------|
| `admin.html` | Fully dark Warm Obsidian (tokens) | Some inline hardcodes remain (`#f9fafb`, `#1d3557`, `#2a9d8f`, `#e63946`, `#999`) |
| `cozinha.html` | Dark, tokens; touch buttons done | Button 3D relief invisible (shadow color == bg color) |
| `cozinha-quente.html` | Dark, tokens | `.ready-btn`/`.cancel-btn` still legacy CSS (44px, flat) |
| `cozinha-fria.html` | Dark, tokens | Same as above |
| `salao.html` | Light Clean White | Has some tokens but keeps hardcodes; stays light by design |
| `gerente.html` | Dark topbar only; body light | Body (cards, table, calendar, product list) needs full dark migration |
| `dashboard.html` | Dark topbar only; body light | KPI cards, panels, funnel, heatmap, donut need full dark migration |

### 2.2 Styles inventory

- `src/views/styles/theme.css` — global tokens (`:root`), base classes (`.btn`, `.btn-touch-*`,
  `.btn-dash-*`, `.card-base`, `.toast`, etc.). Already has Warm Obsidian tokens.
- `src/views/styles/dashboard.css` — layout for dashboard (side-nav, sticky header,
  bento grid, KPI hero, panels, modal, print, chart-reset).

All 7 HTML views load `/styles/theme.css`; `dashboard.html` additionally loads
`/styles/dashboard.css`.

### 2.3 Known defect (to fix)

In `cozinha.html`, `.card .actions button` uses `box-shadow: 0 4px 0 var(--c-bg-dark)`
and the page background is also `var(--c-bg-dark)` (`#141218`), so the 3D relief is
invisible. Fix: shadow must use a darker/lighter contrasting color (e.g.
`#0b0a0e` or `rgba(0,0,0,0.55)`).

---

## 3. Architecture: Theme System

### 3.1 Theme attribute & defaults

- Theme is set via `data-theme` attribute on the `<html>` element:
  - `data-theme="dark"` → Warm Obsidian + Amber Gold (DEFAULT for new users)
  - `data-theme="light"` → Clean White + Warm Amber accent
- Default: `localStorage.getItem('kds-theme') || 'dark'`.
- No `data-theme` attribute → CSS must assume dark (defensive default).

### 3.2 Anti-flash script (head)

Every view that supports the toggle (`gerente.html`, `dashboard.html`, `admin.html`)
gets this inline script in `<head>` BEFORE the CSS links so the page renders with the
correct theme immediately (no FOUC):

```html
<script>
  document.documentElement.setAttribute('data-theme', localStorage.getItem('kds-theme') || 'dark');
</script>
```

### 3.3 New shared script file: `src/views/scripts/theme.js`

A new JS file served as static asset. To keep the existing `/styles/` static serving
pattern, add a static route for `/scripts/` (or serve from the same `fastifyStatic`
root that serves views/styles — see section 5.2).

Contents:

```js
(function () {
  var STORAGE_KEY = 'kds-theme';
  var THEMES = ['dark', 'light'];

  function getCurrent() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  function apply(theme) {
    if (THEMES.indexOf(theme) === -1) theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    // notify charts (see section 6)
    document.dispatchEvent(new CustomEvent('kds-theme-change', { detail: { theme: theme } }));
    return theme;
  }

  function toggle() {
    var next = getCurrent() === 'dark' ? 'light' : 'dark';
    return apply(next);
  }

  // Cross-tab sync: choice propagates to all open tabs of the same origin.
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      var t = e.newValue || 'dark';
      if (THEMES.indexOf(t) === -1) t = 'dark';
      document.documentElement.setAttribute('data-theme', t);
      document.dispatchEvent(new CustomEvent('kds-theme-change', { detail: { theme: t } }));
    }
  });

  window.KDSTheme = { apply: apply, toggle: toggle, getCurrent: getCurrent, THEMES: THEMES };
})();
```

### 3.4 CSS structure

In `theme.css`:

- Keep all existing token names (unchanged names, so existing component CSS keeps working).
- Define dark values under `:root` (or `:root[data-theme="dark"]`).
- Define light values under `:root[data-theme="light"]` (and also plain `:root` for dark
  as fallback so views without the attribute still render dark).
- New semantic token groups needed:
  - Backgrounds: `--c-bg-light`, `--c-bg-dark`, `--c-bg-dark-cold` (existing) + NEW
    `--c-bg-page` (body background that flips), `--c-bg-panel` (card background that flips).
  - Surfaces: existing `--c-surface`, `--c-surface-dark` + NEW `--c-surface-panel`.
  - Text: existing + NEW `--c-text-body`, `--c-text-secondary`.
  - Borders: existing + NEW `--c-border-default`.
  - Shadows: NEW `--shadow-btn-3d-dark` / `--shadow-btn-3d-light` for touch buttons.

**Migration rule:** replace every hardcoded color in HTML views with the closest
semantic token. The resulting CSS must contain ZERO `#hex`/`rgb()` colors except:
  - gradients intentionally fixed (e.g., `--c-accent-warm` gradient stays emerald),
  - chart palette values (section 6),
  - `--c-accent-gold`-based brand colors (defined only in theme.css tokens).

---

## 4. Token Values (Exact)

### 4.1 Dark theme (`:root`, `:root[data-theme="dark"]`)

```
--c-primary: #141218
--c-primary-tint: #2a2632
--c-accent-warm: #10b981
--c-accent-cold: #0ea5e9
--c-accent-gold: #d4a574
--c-warn: #f59e0b
--c-danger: #e11d48
--c-danger-strong: #be123c
--c-replacement: #8b5cf6

--c-bg-light: #f4f3f6            (kept name; used by light-adjacent small elements)
--c-bg-dark: #141218
--c-bg-dark-cold: #141218
--c-bg-page: #141218             (NEW — body background)
--c-bg-panel: #1e1b24            (NEW — card/panel background)
--c-surface: #ffffff             (kept; used by white-on-dark exceptions)
--c-surface-dark: #1e1b24
--c-surface-dark-cold: #1e1b24
--c-surface-panel: #1e1b24       (NEW — alias of surface-dark for flipped contexts)

--c-text: #141218                (kept for light-context uses)
--c-text-muted: #9a8f9e
--c-text-invert: #f3f0f5
--c-text-invert-muted: #9a8f9e
--c-text-body: #f3f0f5           (NEW — body text in dark)
--c-text-secondary: #9a8f9e      (NEW — secondary text in dark)

--c-border-light: #e4e2e6        (kept)
--c-border-dark: #2d2836
--c-border-dark-cold: #2d2836
--c-border-default: #2d2836      (NEW — default border in dark)
--header-bg: rgba(30, 27, 36, 0.94)   (NEW — sticky header background, dark)

--alert-urgent-bg-dark: #4c0519
--alert-urgent-bg-light: #fff1f2
--alert-warn-bg-dark: #451a03
--alert-warn-bg-light: #fffbeb
--alert-ok-bg-dark: #022c22
--alert-ok-bg-light: #ecfdf5
--alert-replacement-bg-dark: #2e1065
--alert-replacement-bg-light: #f5f3ff

--c-chart-1: #d4a574
--c-chart-2: #9a8f9e
--c-chart-3: #10b981
--c-chart-4: #f59e0b
--c-chart-5: #e11d48
--c-chart-6: #8b5cf6
--c-chart-7: #0ea5e9

--shadow-btn-3d-dark: 0 4px 0 rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.08) inset
--shadow-btn-3d-light: 0 4px 0 rgba(0,0,0,0.20), 0 1px 0 rgba(255,255,255,0.40) inset
```

### 4.2 Light theme (`:root[data-theme="light"]`)

```
--c-primary: #a87c4a              (warm amber-dark for primary actions on light)
--c-primary-tint: #d8c3a3
--c-accent-warm: #0e9f6e          (darker emerald for contrast on white)
--c-accent-cold: #0b7fb8
--c-accent-gold: #a87c4a
--c-warn: #b45309
--c-danger: #be123c
--c-danger-strong: #9f1239
--c-replacement: #7c3aed

--c-bg-light: #faf8f5
--c-bg-dark: #faf8f5
--c-bg-dark-cold: #faf8f5
--c-bg-page: #faf8f5
--c-bg-panel: #ffffff
--c-surface: #ffffff
--c-surface-dark: #ffffff
--c-surface-dark-cold: #ffffff
--c-surface-panel: #ffffff

--c-text: #2b1f17
--c-text-muted: #7a6e63
--c-text-invert: #2b1f17
--c-text-invert-muted: #7a6e63
--c-text-body: #2b1f17
--c-text-secondary: #7a6e63

--c-border-light: #e7e3da
--c-border-dark: #d8d2c6
--c-border-dark-cold: #d8d2c6
--c-border-default: #d8d2c6
--header-bg: rgba(255, 255, 255, 0.94)   (NEW — sticky header background, light)

--alert-urgent-bg-dark: #ffe4e6
--alert-urgent-bg-light: #fff1f2
--alert-warn-bg-dark: #fef3c7
--alert-warn-bg-light: #fffbeb
--alert-ok-bg-dark: #d1fae5
--alert-ok-bg-light: #ecfdf5
--alert-replacement-bg-dark: #ede9fe
--alert-replacement-bg-light: #f5f3ff

--c-chart-1: #8a5a22              (darker gold for light bg)
--c-chart-2: #6b5f55
--c-chart-3: #0e9f6e
--c-chart-4: #b45309
--c-chart-5: #be123c
--c-chart-6: #7c3aed
--c-chart-7: #0b7fb8

--shadow-btn-3d-dark: 0 4px 0 rgba(0,0,0,0.20)
--shadow-btn-3d-light: 0 4px 0 rgba(0,0,0,0.20)
```

Note: `--c-chart-*` values are ALSO used by Chart.js instances (see section 6) — keep
the two sources in sync when editing.

---

## 5. Per-File Implementation Details

### 5.1 `src/views/styles/theme.css`

- Add `:root[data-theme="light"] { ... }` block with all overrides from section 4.2.
- Add NEW semantic tokens (`--c-bg-page`, `--c-bg-panel`, `--c-surface-panel`,
  `--c-text-body`, `--c-text-secondary`, `--c-border-default`, `--shadow-btn-3d-*`)
  to the dark `:root` block.
- Update `.btn-touch-primary`/`.btn-touch-secondary`/`.btn-touch-danger` to use
  `var(--shadow-btn-3d-dark)` and (for light) `var(--shadow-btn-3d-light)` via:
  ```css
  .btn-touch-primary { box-shadow: var(--shadow-btn-3d-dark); }
  :root[data-theme="light"] .btn-touch-primary { box-shadow: var(--shadow-btn-3d-light); }
  ```
- Update base `body` rule: `background: var(--c-bg-page); color: var(--c-text-body);`.

### 5.2 Server static route (`src/server.ts`)

- The app already registers `fastifyStatic` for `/styles/` (check registration at
  `src/server.ts:43`). Extend (or add a second registration) so `/scripts/theme.js`
  is served from `src/views/scripts/`.
- Keep `getView(filename)` dynamic loading intact (no boot-time caching).

### 5.3 `src/views/styles/dashboard.css`

- Replace any hardcoded light colors with tokens:
  - `body { background: var(--c-bg-page); color: var(--c-text-body); }`
  - `.sticky-top` → `background: var(--header-bg);`
  - KPI hero/secondary strips, panels, charts, modals, print — switch to
    `--c-bg-panel`, `--c-surface-panel`, `--c-text-body`, `--c-text-secondary`,
    `--c-border-default`.
- Side-nav (both themes, fixed decision): background `var(--c-bg-panel)` in dark /
  `var(--c-bg-light)` in light; nav labels `var(--c-text-invert)` in dark /
  `var(--c-text-body)` in light; active/current link accent `var(--c-accent-gold)`.

### 5.4 `gerente.html`

- Add anti-flash script in `<head>` (section 3.2).
- Migrate body: `background-color: var(--c-bg-page); color: var(--c-text-body);`
- `.metric-card` → `background: var(--c-surface-panel); border-color: var(--c-border-default);`
- `h3`/`p` in metric cards → `var(--c-text-secondary)` / `var(--c-text-body)`.
- `table` → `background: var(--c-surface-panel); border-color: var(--c-border-default);`
  `th` → `background: var(--c-bg-panel); color: var(--c-text-secondary);`
  `td` border → `var(--c-border-default);` hover → `var(--c-bg-light)`.
- `.product-list`, `.calendar-card`, `.cal-nav-btn`, `.section h2` → tokens.
- Keep `.btn-admin` (emerald gradient glow) and `.btn-dashboard` (blue aura) as-is
  (they already match the design).
- Add toggle button (section 7) + load `theme.js`.

### 5.5 `dashboard.html`

- Add anti-flash script in `<head>` (section 3.2).
- Migrate body: `background: var(--c-bg-page); color: var(--c-text-body);`
- `.header` stays dark in dark theme; in light theme becomes `--c-bg-panel`
  with `--c-border-default` bottom border.
- `.kpi-card`, `.panel`, `.panel-full`, `.bar-track`, `.funnel-*`, `.heatmap-*`,
  `.week-bar-wrap`, `.donut-*`, `.table-*`, `.modal-card`, `.score-*` → tokens.
- `.section-title` → `color: var(--c-text-body); border-bottom-color: var(--c-border-default);`
- Add toggle button (section 7) + load `theme.js`.
- Chart instances: read `data-theme` at creation; on `kds-theme-change`, destroy &
  re-render or update colors (section 6).

### 5.6 `admin.html`

- Add anti-flash script in `<head>` (section 3.2).
- Keep the dark override block (already present at `admin.html:131-158`) — but move
  the hardcoded values to tokens where possible:
  - `input, select { background: #141218; ... }` → `var(--c-bg-page)`.
  - Inline hardcodes in JS-rendered rows (`#f9fafb`, `#1d3557`, `#2a9d8f`,
    `#e63946`, `#999`) → use tokens via CSS classes instead of inline styles:
    create utility classes `.status-ok { color: var(--c-accent-warm); }`,
    `.status-danger { color: var(--c-danger); }`, `.chip-salao`, `.chip-cozinha`
    in the admin `<style>` block, and replace inline `style="color:#..."` with classes.
- Add toggle button in the header (section 7) + load `theme.js`.

### 5.7 `cozinha-quente.html` & `cozinha-fria.html`

- Replace `.card .actions button` legacy CSS with the `.btn-touch` classes from
  `theme.css` (matching what `cozinha.html` already has):
  - `.ready-btn` → `class="ready-btn btn-touch btn-touch-primary"`
  - `.cancel-btn` → `class="cancel-btn btn-touch btn-touch-secondary"`
- Ensure `min-height: 56px`, font-size 16px, uppercase, 3D relief via
  `var(--shadow-btn-3d-dark)`.
- Keep `confirm-pending` (amber) state styles; adapt to use tokens
  (`background: var(--c-warn); color: var(--c-primary);`).

### 5.8 `cozinha.html`

- Fix invisible relief:
  ```css
  .card .actions button { box-shadow: var(--shadow-btn-3d-dark); }
  .card .actions .ready-btn { box-shadow: 0 4px 0 #047857; }
  ```
- Replace `#180a0a`, `#2d0a0a`, `#1a1306` card variants with tokenized versions:
  - `late` → `var(--alert-urgent-bg-dark)` + overlay,
  - `critical` → `var(--alert-urgent-bg-dark)` + stronger border,
  - `stockout` → `var(--alert-warn-bg-dark)`.

### 5.9 `salao.html`

- Stays light. Just migrate remaining hardcodes to tokens:
  - `.demand-card` → `background: var(--c-surface-panel); border-color: var(--c-border-light);`
  - `.demand-card.pending { border-left-color: var(--c-text); }` →
    `border-left-color: var(--c-accent-gold);`
  - `.retrieve-btn`/`.cancel-btn` in `.demand-card .actions` already updated to
    48px+ touch; keep.
  - `form button[type="submit"]` gradient stays emerald (already token-based).
  - `.badge.urgent`, `.badge.normal`, `.badge.ready-badge`, `.badge.stockout-badge` → tokens.
- No toggle, no anti-flash script.

---

## 6. Chart.js Theme-Aware Palette

`dashboard.html` uses Chart.js v4 (`chart.umd.min.js` via CDN) with zoom plugin.
Charts are created in JS. Required behavior:

1. At creation, read `document.documentElement.getAttribute('data-theme')` (fallback
   `'dark'`) and build the palette:
   ```js
   function chartPalette() {
     var theme = (document.documentElement.getAttribute('data-theme') || 'dark');
     var rs = getComputedStyle(document.documentElement);
     var pick = function (n) { return rs.getPropertyValue(n).trim() || '#888'; };
     return {
       gold: pick('--c-chart-1'), muted: pick('--c-chart-2'),
       emerald: pick('--c-chart-3'), amber: pick('--c-chart-4'),
       rose: pick('--c-chart-5'), violet: pick('--c-chart-6'),
       sky: pick('--c-chart-7'),
       text: pick(theme === 'dark' ? '--c-text-invert' : '--c-text'),
       grid: pick('--c-border-default')
     };
   }
   ```
2. Configure each Chart instance with `borderColor: pal.grid`, `ticks.color: pal.text`,
   and series colors from `pal.*`.
3. On `window.addEventListener('kds-theme-change', ...)`: destroy each chart and
   re-create it with the new palette (simplest, avoids Chart.js update quirks).
   Track chart instances in an array `window.__kdsCharts`.
4. Chart legend labels also use `pal.text`.

---

## 7. Toggle Button UI (Exact)

Shared markup (identical in the 3 views; classes defined once in `theme.css`):

```html
<button type="button" id="themeToggle" class="btn-theme-toggle" aria-pressed="false"
        title="Alternar tema (Escuro/Claro)" onclick="window.KDSTheme && KDSTheme.toggle()">
  <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
  </svg>
  <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
  </svg>
  <span class="theme-toggle-label" data-l10n></span>
</button>
```

CSS (in `theme.css`):

```css
.btn-theme-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 42px; padding: 8px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--c-border-default);
  background: color-mix(in srgb, var(--c-bg-panel) 60%, transparent);
  color: var(--c-text-body);
  font-size: 0.85rem; font-weight: var(--fw-semi);
  cursor: pointer; font-family: inherit;
  transition: all var(--t-fast) var(--ease-out);
}
.btn-theme-toggle:hover { border-color: var(--c-accent-gold); color: var(--c-accent-gold); }
.btn-theme-toggle .theme-icon { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.btn-theme-toggle .theme-icon-sun { display: none; }
:root[data-theme="light"] .btn-theme-toggle .theme-icon-sun { display: block; }
:root[data-theme="light"] .btn-theme-toggle .theme-icon-moon { display: none; }
```

Label text: initialized once via a small inline script after `theme.js`:

```js
(function () {
  var lbl = document.querySelector('.theme-toggle-label');
  function refresh() {
    var t = window.KDSTheme && KDSTheme.getCurrent();
    if (lbl) lbl.textContent = t === 'light' ? 'Tema: Claro' : 'Tema: Escuro';
    var btn = document.getElementById('themeToggle');
    if (btn) btn.setAttribute('aria-pressed', String(t === 'light'));
  }
  refresh();
  document.addEventListener('kds-theme-change', refresh);
})();
```

Placement:
- `gerente.html`: in `.header`, right side, before the `.btn-admin` link.
- `dashboard.html`: in the topbar `.header-inner`, right side, before the
  `Voltar`/`Exportar` group.
- `admin.html`: in the header bar, next to the `← Voltar ao Painel` link.

---

## 8. Verification & Acceptance

1. **Build:** `npm run build` passes (tsc + copyfiles).
2. **Static routes:** `GET /styles/theme.css` returns 200; `GET /scripts/theme.js`
   returns 200.
3. **Dark default:** open `http://localhost:3000/gerente` with clean localStorage →
   page renders dark immediately (no light flash). Same for `/dashboard`, `/admin`.
4. **Toggle:** click the toggle on `/gerente` → switches to light; refresh → stays
   light; open `/dashboard` in a new tab → it opens light (sync via storage event).
5. **No hardcodes:** grep across `src/views/*.html` for `#[0-9a-fA-F]{3,6}` and
   `rgb(` — only allowed occurrences are inside `theme.css` tokens and Chart
   palette references; HTML files must be clean (or have only gradient/backdrop
   exceptions listed in section 3.4).
6. **Kitchen views unchanged functionally:** `cozinha.html`, `cozinha-quente.html`,
   `cozinha-fria.html` still dark; buttons 56px with visible 3D relief.
7. **Salão light:** `salao.html` remains light; cards use tokens; no toggle present.
8. **Charts:** on `/dashboard`, toggle theme → all charts re-render with the new
   palette (labels, grid, series colors); no console errors.
9. **Contrast (light):** text `#2b1f17` on `#ffffff` ≥ 4.5:1 (AA); accent gold
   `#a87c4a` on white ≥ 3:1 for large/UI text.
10. **Screenshot audit:** capture `audit_desktop/*.png` and `audit_touch/*.png`
    for all 7 routes in both themes; visually confirm no broken contrast,
    overlapping controls, or misplaced toggle.

---

## 10. Risks & Mitigations

- **Chart.js re-render flicker:** destroy+recreate is simplest; acceptable trade-off.
  If flicker bothers, use `chart.data.datasets[].backgroundColor` updates + `chart.update()`.
- **FOUC on first load:** prevented by anti-flash script in `<head>` (section 3.2).
- **Hardcode drift:** grep verification in step 5 of section 8 is a hard gate.
- **`color-mix()` support:** avoided entirely — explicit `--header-bg` tokens per
  theme are used instead (section 4).
- **admin inline styles in JS strings:** replacing them requires editing template
  literal rows in `admin.html` JS; must re-test each tab (Produtos, Cozinhas,
  Cardápios, Unidades, Motivos, Critérios).
