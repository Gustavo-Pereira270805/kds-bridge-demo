# KDS Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved light/dark theme system across the KDS manager views, complete token migration in all views, and verify the result with build checks and Webwright screenshots.

**Architecture:** `theme.css` remains the single token source. Manager pages set `data-theme` before loading CSS, load the shared `/scripts/theme.js`, and expose one synchronized toggle through `localStorage`. Dashboard charts read CSS variables and rebuild after `kds-theme-change`; kitchen and salão pages remain single-theme.

**Tech Stack:** Fastify, TypeScript, vanilla HTML/CSS/JavaScript, Chart.js, Playwright/Webwright.

## Global Constraints

- Dark is the default theme; light is selected with `localStorage.kds-theme`.
- `gerente.html`, `dashboard.html`, and `admin.html` have the toggle; kitchen and salão views do not.
- Existing functional flows remain unchanged.
- No commit or push without explicit user approval.

### Task 1: Shared Theme Infrastructure

**Files:**
- Modify: `src/views/styles/theme.css`
- Create: `src/views/scripts/theme.js`
- Modify: `src/server.ts`
- Modify: `package.json`

- [ ] Add dark/light semantic tokens, touch shadows, toggle styles, static script route, and build copy rule.
- [ ] Verify `npm run build`, `GET /styles/theme.css`, and `GET /scripts/theme.js`.

### Task 2: Manager View Toggles

**Files:**
- Modify: `src/views/gerente.html`
- Modify: `src/views/dashboard.html`
- Modify: `src/views/admin.html`

- [ ] Add anti-flash setup, shared script, toggle markup, and synchronized label state.
- [ ] Replace manager-view hardcoded surface/text colors with semantic tokens.
- [ ] Preserve navigation and form behavior.

### Task 3: Dashboard Charts and Responsive Styles

**Files:**
- Modify: `src/views/styles/dashboard.css`
- Modify: `src/views/dashboard.html`

- [ ] Complete dark/light dashboard surfaces, navigation, controls, modal, and print styles.
- [ ] Rebuild Chart.js instances with theme-aware CSS-variable palettes after toggle.

### Task 4: Single-Theme Operational Views

**Files:**
- Modify: `src/views/cozinha.html`
- Modify: `src/views/cozinha-quente.html`
- Modify: `src/views/cozinha-fria.html`
- Modify: `src/views/salao.html`

- [ ] Fix visible 3D relief and 56px touch actions.
- [ ] Migrate remaining inline colors to existing tokens without adding toggles.

### Task 5: Verification and Visual Audit

**Files:**
- Create/update: `outputs/final_runs/` Webwright artifacts only

- [ ] Run build and hardcoded-color checks.
- [ ] Use Webwright/Playwright to verify default dark, toggle persistence, cross-tab storage sync, chart redraw, and route availability.
- [ ] Capture desktop and touch screenshots for all seven routes in applicable themes; read the screenshots and fix visual regressions.
