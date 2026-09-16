# KDS UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the KDS Bridge visual theme to Warm Obsidian & Amber Gold (`#141218`) and upgrade Kitchen/Salão action buttons to 56px touch standards.

**Architecture:** Modifies centralized CSS custom properties in `theme.css` and `dashboard.css`, then updates HTML structure/classes across 5 views (`cozinha.html`, `salao.html`, `gerente.html`, `dashboard.html`, `admin.html`).

**Tech Stack:** Vanilla CSS3 (CSS Variables, Flexbox/Grid), Fastify HTML views, Playwright for visual inspection.

## Global Constraints
- Primary Background: `#141218`
- Surface Background: `#1e1b24`
- Primary Accent: `#d4a574` (Amber Gold)
- Touch Button Min Height: `56px` (Touch target 16px bold)
- Dashboard Action Controls: Voltar (ghost aura) & Exportar (emerald glow)

---

### Task 1: Update Design Tokens in `theme.css`

**Files:**
- Modify: `src/views/styles/theme.css`

- [ ] **Step 1: Replace Zinc color variables with Warm Obsidian tokens**

```css
:root {
  --bg-dark: #141218;
  --bg-surface: #1e1b24;
  --bg-surface-hover: #2a2632;
  --border-color: #2d2836;
  --border-light: #3f384a;

  --text-main: #f3f0f5;
  --text-muted: #9a8f9e;

  --accent-gold: #d4a574;
  --accent-gold-hover: #e5b887;
  --accent-primary: #d4a574;
}
```

- [ ] **Step 2: Add touch button class utilities in `theme.css`**

```css
.btn-touch {
  min-height: 56px;
  padding: 14px 20px;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 1rem;
  font-weight: 700;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.12s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.btn-touch-primary {
  background: linear-gradient(180deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 4px 0 #047857, 0 1px 0 rgba(255,255,255,0.1) inset;
}

.btn-touch-primary:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #047857, 0 1px 0 rgba(255,255,255,0.1) inset;
}

.btn-touch-secondary {
  background: #1e1b24;
  color: #f3f0f5;
  border: 1px solid #3f384a;
  box-shadow: 0 4px 0 #141218;
}

.btn-touch-secondary:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #141218;
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Success with 0 errors.

---

### Task 2: Standardize Dashboard Header & Actions in `dashboard.css`

**Files:**
- Modify: `src/views/styles/dashboard.css`

- [ ] **Step 1: Update `.dash-header` and action button styles**

```css
.btn-dash-back {
  background: rgba(59, 130, 246, 0.1);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.35);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-dash-back:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: #60a5fa;
  color: #dbeafe;
}

.btn-dash-export {
  background: linear-gradient(180deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
  transition: all 0.15s ease;
}

.btn-dash-export:hover {
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.3);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success with 0 errors.

---

### Task 3: Apply Touch 56px Buttons to Kitchen View (`cozinha.html`)

**Files:**
- Modify: `src/views/cozinha.html`

- [ ] **Step 1: Upgrade Ticket Card Action Buttons**

Replace `.btn-pronto` and `.btn-anular` with `.btn-touch .btn-touch-primary` and `.btn-touch .btn-touch-secondary` with `56px` height and bold text (`PRONTO`, `CANCELAR`).

- [ ] **Step 2: Verify view rendering**

Run: `curl http://localhost:3000/cozinha`
Expected: Status 200 containing `.btn-touch-primary`.

---

### Task 4: Apply Touch 56px Buttons to Salão View (`salao.html`)

**Files:**
- Modify: `src/views/salao.html`

- [ ] **Step 1: Upgrade Order Form Submit Button & Demand Cards**

Apply `.btn-touch .btn-touch-primary` to the demand submission button (`+ ENVIAR PEDIDO PARA A COZINHA`) with 56px height.

- [ ] **Step 2: Verify view rendering**

Run: `curl http://localhost:3000/salao`
Expected: Status 200 containing `.btn-touch-primary`.

---

### Task 5: Standardize Actions in Manager & Dashboard Views

**Files:**
- Modify: `src/views/gerente.html`
- Modify: `src/views/dashboard.html`

- [ ] **Step 1: Apply `.btn-dash-back` and `.btn-dash-export` in `gerente.html` and `dashboard.html`**

Update top-bar buttons to use the standardized classes and glowing borders.

- [ ] **Step 2: Verify build & views**

Run: `npm run build`
Expected: Success.

---

### Task 6: Visual Inspection with Webwright / Playwright

**Files:**
- Run screenshot capture script to update `outputs/screenshots/review_*.png`.

- [ ] **Step 1: Capture and verify screenshots**

Confirm Warm Obsidian theme and 56px touch buttons look visually cohesive across all views.
