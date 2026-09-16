# Design Spec: KDS Bridge - UI Redesign (Warm Obsidian & Touch-First)

**Date:** 2026-08-03
**Topic:** KDS UI Redesign (Color Scheme, Touch Target & Dashboard Controls)

---

## 1. Overview & Objectives

Update the visual design and interaction ergonomics across all KDS Bridge views (Kitchen, Lounge/Salão, Manager, Admin) to solve two core issues:
1. **Visual Atmosphere:** Replace the cold/bland zinc black background with a rich **Warm Obsidian & Amber Gold** dark palette (`#141218`), creating a refined fine-dining software feel without compromising operational contrast.
2. **Ergonomics & Touch Usability:** Expand operational action buttons in Kitchen and Salão to a touch-first standard (**56px height**, 16px bold typography, 3D tactile feedback) for quick, error-free operation on wall mounted touchscreens or tablets.
3. **Control Standardization:** Standardize 'Voltar' (Back) and 'Exportar' (Export) buttons on Manager/BI dashboards with glowing borders and high-contrast solid accents.

---

## 2. Color System Tokens (`theme.css`)

### Core Palette
- `--bg-dark`: `#141218` (Warm Obsidian base background)
- `--bg-surface`: `#1e1b24` (Elevated card/panel surface)
- `--bg-surface-hover`: `#2a2632` (Interactive hover surface)
- `--border-color`: `#2d2836` (Subtle warm border)
- `--border-light`: `#3f384a` (Highlighted border)

### Text Tokens
- `--text-main`: `#f3f0f5` (High contrast primary text)
- `--text-muted`: `#9a8f9e` (Secondary text)

### Accents & Status Colors
- `--accent-gold`: `#d4a574` (Primary brand accent / Warm Amber Gold)
- `--accent-gold-hover`: `#e5b887`
- `--status-ready`: `#10b981` (Emerald green - ready/complete)
- `--status-preparing`: `#f59e0b` (Warm amber - in progress)
- `--status-urgent`: `#e11d48` (Rose red - urgent/delayed)
- `--status-info`: `#3b82f6` (Cobalt blue - informational)

---

## 3. Component Ergonomics

### Touch Action Buttons (`.btn-touch`, `.btn-touch-primary`, `.btn-touch-secondary`)
- **Min Height:** `56px`
- **Typography:** `Inter 600` or `JetBrains Mono 700`, `16px`
- **Padding:** `14px 20px`
- **Tactile Effect:**
  - Default: `box-shadow: 0 4px 0 #0f0d13, 0 0 0 1px rgba(255,255,255,0.08) inset`
  - Active: `transform: translateY(2px)`, shadow reduces to `0 1px 0`
- **Target Screens:** `cozinha.html`, `salao.html`, `cozinha-quente.html`, `cozinha-fria.html`

### Dashboard Header Actions (`.btn-dash-back`, `.btn-dash-export`)
- **Min Height:** `42px`
- **Voltar (Back):** Subtle blue-tinted ghost button (`background: rgba(59,130,246,0.1)`, `border: 1px solid rgba(59,130,246,0.3)`)
- **Exportar (Export):** High-contrast emerald button with glowing aura (`background: linear-gradient(...)`, `box-shadow: 0 0 0 3px rgba(16,185,129,0.2)`)
- **Target Screens:** `dashboard.html`, `gerente.html`, `admin.html`

---

## 4. Scope & Affected Files

1. `src/views/styles/theme.css`: Replace Zinc tokens with Warm Obsidian tokens.
2. `src/views/styles/dashboard.css`: Update header, side-nav, KPI cards, and dashboard buttons.
3. `src/views/cozinha.html`: Upgrade ticket card buttons to 56px touch standard.
4. `src/views/salao.html`: Upgrade order demand form and item status buttons to 56px touch standard.
5. `src/views/gerente.html` & `src/views/dashboard.html`: Apply standardized Voltar/Exportar controls.

---

## 5. Risk Assessment & Mitigations

- **Risk:** Touch button height (56px) reducing visible cards on small kitchen displays.
  - **Mitigation:** Use flex layout auto-wrap and compact card padding so ticket count per screen is preserved.
- **Risk:** Color contrast regression on dark surfaces.
  - **Mitigation:** Verify WCAG AA contrast ratio (text `#f3f0f5` against surface `#1e1b24` is > 10:1).
