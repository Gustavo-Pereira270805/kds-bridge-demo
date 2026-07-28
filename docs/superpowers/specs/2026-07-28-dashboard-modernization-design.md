# KDS Bridge — Dashboard Modernization Design

**Data:** 2026-07-28
**Status:** Aprovado pelo operador
**Escopo:** 1 view (`src/views/dashboard.html` + novo `src/views/styles/dashboard.css` + extensões em `src/views/styles/theme.css`)
**Direção:** Soft-modern premium (Linear / Stripe / Vercel), 12-col bento grid, side nav expansível
**Stack:** Vanilla HTML/CSS/JS, Fastify, Socket.IO, Chart.js v4.5 + chartjs-plugin-zoom v2.2 (ambos via CDN)
**Continuação de:** `docs/superpowers/specs/2026-07-27-kds-visual-redesign-design.md` (system-wide tokens, toasts, skeletons, empty states, prefers-reduced-motion, :focus-visible). Este spec **não duplica** aquele trabalho — refere-o onde aplicável e foca apenas nas mudanças específicas do dashboard.

---

## 1. Contexto e Justificativa

`src/views/dashboard.html` (1548 linhas, 93KB) é a view analítica do KDS Bridge, consumida por gerentes em desktop. Auditoria visual revelou:

- **18 painéis** renderizados a partir de um único endpoint `/api/v1/analytics/dashboard` com 18 datasets, sem agrupamento temático — a página é um "muro" de cards.
- **4 linguagens visuais misturadas** (HTML bars, SVG donuts, HTML heatmap, canvas 2D) sem gramática unificada.
- **~600 linhas de código canvas 2D hand-rolled** para 4 charts (Moving Average, Queue por Hora, Comparativo, Performance Trend) — sem tooltips, sem zoom, sem responsividade automática.
- **11 KPI cards em uma única linha** — números pequenos, sem hierarquia, sem status visual.
- **Cores hardcoded** (`#1d3557`, `#2a9d8f`, `#e63946`, `#f4a261`) em dezenas de template strings JS, ignorando os tokens já existentes em `theme.css`.
- **Bug conhecido**: linha 481, botão "Voltar para hoje" morto (chama `getElementById('periodToday').click()` mas o ID não existe).
- **Falta de section nav**: gerente precisa scrollar manualmente por uma página muito longa para encontrar um painel.
- **Header não sticky**: filtros ficam fora de alcance ao scrollar.
- **Auto-refresh agressivo**: qualquer evento Socket.IO recarrega o dashboard inteiro, mesmo quando o período é histórico (sem sentido).

O spec de 2026-07-27 já tratou o system-wide (tokens, toasts, skeletons, empty states, `prefers-reduced-motion`, `:focus-visible`). Este spec foca exclusivamente no **layout**, na **apresentação visual** e na **interatividade** da view de dashboard — uma continuação natural do trabalho de design system.

A direção **soft-modern premium** foi escolhida pelo operador: cards com sombras suaves em camadas, tipografia semi-bold generosa, paleta restrita (navy + teal + accent), muito espaço em branco, hierarquia tipográfica clara. Inspiração: Linear, Stripe, Vercel.

---

## 2. Decisões do Operador (brainstorming)

| Decisão | Valor |
|---|---|
| Escopo | Apenas `dashboard.html` + `dashboard.css` (novo) + extensões em `theme.css` |
| Direção estética | Soft-modern premium (Linear / Stripe / Vercel) |
| Chart library | Chart.js v4.5 + chartjs-plugin-zoom v2.2 via CDN |
| Organização dos 18 painéis | Agrupar em 5 seções temáticas com eyebrow + título |
| Layout dos 11 KPIs | 4 hero (grandes, com sparkline e borda colorida por status) + 7 secondary (menores, em grid 7-col) |
| Layout das seções | Bento grid: cada painel declara `data-cols="N"` (1–12) em CSS grid 12-col, gutter 24px |
| Side nav | Icon rail expansível (64px collapsed → 240px on hover) com 6 itens + âncora "Topo" |
| Filtro de Chart.js | 6 charts no total: 4 migrados (canvas → Chart.js), 2 novos (HTML bars → Chart.js line com area fill); demais ~12 painéis continuam custom (HTML bars estáticos, SVG donuts, heatmap) |
| Migração | Faseada em 9 commits atômicos, sistema funcional entre fases |

---

## 3. Skills de UI Analisadas

5 skills de UI foram analisadas. Síntese (continuação do trabalho iniciado em 2026-07-27 §3):

| Skill | Fit | Ação |
|---|---|---|
| `impeccable` | 8.5/10 | **INVOKE durante implementação** — modo `Operate` + `detect.mjs` para verificação |
| `high-end-visual-design` | 4/10 (revisado para este spec) | 4 guardrails aplicados: GPU-safe animation, eyebrow KPI labels, layered shadow, z-index discipline |
| `design-taste-frontend v2` | 5/10 | §13 declara dashboards fora de escopo, mas `Bento` + `Hardening` seções aplicam; 5 regras avulsas |
| `design-taste-frontend v1` | 4/10 | `Cockpit Mode` + `Dashboard Hardening` extraídos; 2 regras extras |
| `industrial-brutalist-ui` | 4/10 | Doutrina "cor = recurso escasso" — KPIs hero com borda colorida apenas em status; demais navy-only |
| `minimalist-ui` | 3/10 | Light editorial ban Inter; só doutrina "cor = semântica apenas" aplicada |

**Skills NÃO invocadas**: `gpt-taste`, `stitch-design-taste`, `brandkit`, `imagegen-*`, `customize-opencode`, `webwright` (usado como ferramenta de teste, não como skill de design).

**Skill INVOCADA durante implementação**: `impeccable` (`$impeccable audit`, `$impeccable quieter`, `$impeccable animate`, `$impeccable polish`).

---

## 4. Arquitetura

### 4.1 Estrutura de arquivos

```
src/
  views/
    dashboard.html              ← reescrito: novo buildContent(), novo loadPerformance(),
                                  novo skeleton loaders, novo side nav, novo header sticky,
                                  nova estrutura de 5 seções
    styles/
      theme.css                 ← estendido: ~150 linhas adicionadas (tokens novos,
                                  utility classes novas: .bento-grid, .side-nav,
                                  .kpi-card-hero, .kpi-card-secondary, .section-header,
                                  .panel)
      dashboard.css             ← NOVO: ~400 linhas (side nav completo, Chart.js
                                  tooltip overrides, sparkline styling, scroll
                                  behavior, animations, print stylesheet)
  server.ts                     ← INALTERADO
  routes/
    analytics.ts                ← INALTERADO (mesmos endpoints, mesmos shapes)
  services/
    performance.service.ts      ← INALTERADO
```

### 4.2 Page skeleton (DOM)

```html
<body>
  <header class="sticky-top">           <!-- 56px altura, backdrop-filter blur(8px) -->
    <div class="header-inner">
      <!-- período buttons + date range + estação + export + voltar -->
    </div>
  </header>

  <div class="layout">                  <!-- grid: side-nav | main -->
    <aside class="side-nav">            <!-- 64px collapsed, 240px on hover -->
      <nav aria-label="Seções do dashboard">
        <ul role="list">
          <li><a href="#top">...</a></li>             <!-- Topo -->
          <li><a href="#overview">...</a></li>        <!-- Visão Geral -->
          <li><a href="#demand">...</a></li>          <!-- Demanda -->
          <li><a href="#sla">...</a></li>             <!-- SLA e Tempos -->
          <li><a href="#diagnosis">...</a></li>       <!-- Diagnóstico -->
          <li><a href="#performance">...</a></li>     <!-- Performance -->
        </ul>
      </nav>
    </aside>

    <main class="dashboard-main">
      <a id="top"></a>

      <section class="kpi-strip">
        <div class="kpi-hero-grid">     <!-- 4 hero cards, 3 cols cada = 12 -->
          <!-- renderKpis() hero output -->
        </div>
        <div class="kpi-secondary-grid"> <!-- 7 secondary cards, 1.71 cols cada = 12 -->
          <!-- renderKpis() secondary output -->
        </div>
      </section>

      <section id="overview" class="dashboard-section" aria-labelledby="section-title-overview">
        <header class="section-header">
          <span class="section-eyebrow">VISÃO GERAL</span>
          <h2 id="section-title-overview" class="section-title">Estado do restaurante</h2>
          <p class="section-description">Volume, fluxo e urgências em tempo real.</p>
        </header>
        <div class="bento-grid">
          <!-- painéis: data-cols="12" Funil, data-cols="3" Status, data-cols="3" Origem, data-cols="6" Comparativo -->
        </div>
      </section>

      <section id="demand" class="dashboard-section" aria-labelledby="section-title-demand">
        <header class="section-header">
          <span class="section-eyebrow">DEMANDA</span>
          <h2 id="section-title-demand" class="section-title">Quando e o que sai</h2>
          <p class="section-description">Heatmap de operação, volume e mix de produtos.</p>
        </header>
        <div class="bento-grid">
          <!-- painéis: data-cols="12" Heatmap, data-cols="7" Volume MA, data-cols="5" Sazonalidade, data-cols="12" Produtos -->
        </div>
      </section>

      <section id="sla" class="dashboard-section" aria-labelledby="section-title-sla">
        <header class="section-header">
          <span class="section-eyebrow">SLA E TEMPOS</span>
          <h2 id="section-title-sla" class="section-title">Eficiência operacional</h2>
          <p class="section-description">Cumprimento de SLA, velocidade e filas.</p>
        </header>
        <div class="bento-grid">
          <!-- 7 painéis: Velocidade, Retirada, Pareto SLA, Preparo, Fila, Fila por Hora, Ocupação -->
        </div>
      </section>

      <section id="diagnosis" class="dashboard-section" aria-labelledby="section-title-diagnosis">
        <header class="section-header">
          <span class="section-eyebrow">DIAGNÓSTICO</span>
          <h2 id="section-title-diagnosis" class="section-title">Problemas e exceções</h2>
          <p class="section-description">Cancelamentos, roturas e trocas.</p>
        </header>
        <div class="bento-grid">
          <!-- 3 painéis: Cancelamentos, Zerados, Trocas -->
        </div>
      </section>

      <section id="performance" class="dashboard-section" aria-labelledby="section-title-performance">
        <header class="section-header">
          <span class="section-eyebrow">PERFORMANCE</span>
          <h2 id="section-title-performance" class="section-title">Notas e detratores</h2>
          <p class="section-description">Avaliação 0-5 por entidade.</p>
        </header>
        <div class="bento-grid">
          <!-- 5 score cards + trend chart + detratores panel -->
        </div>
      </section>
    </main>
  </div>

  <div class="socket-banner hidden" id="socketBanner">...</div>
  <div id="toast-container" aria-live="polite"></div>

  <!-- Modais (drill-down) -->
  <div class="modal-overlay" id="modalFunil" role="dialog" aria-modal="true" hidden>...</div>
  <div class="modal-overlay" id="modalProdutos" role="dialog" aria-modal="true" hidden>...</div>
  <div class="modal-overlay" id="modalTrocas" role="dialog" aria-modal="true" hidden>...</div>
  <div class="modal-overlay" id="modalAjuda" role="dialog" aria-modal="true" hidden>...</div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.2.0" defer></script>
  <script>...</script>  <!-- buildContent(), loadPerformance(), renderKpis(), etc. -->
</body>
```

### 4.3 CSS Grid (bento)

Cada `.bento-grid` é `display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px;` (gutter `--sp-5`).

Cada filho direto declara `data-cols="N"` mapeado para `grid-column: span N`. Painéis com altura customizada (ex: heatmap) usam `data-rows="N"` → `grid-row: span N` (rows de 180px default, 280px para charts full-width).

Exceções responsivas:
- `<1024px`: cada painel vira `data-cols="12"` (full-width stacked)
- `<768px`: panels sem altura mínima; side nav some; vira tab strip horizontal abaixo do header

### 4.4 Tokens novos em `theme.css`

Adições (não remoção de tokens existentes):

```css
:root {
  /* Chart.js palette mirror */
  --c-chart-1: #457b9d;  /* primary-tint */
  --c-chart-2: #2a9d8f;  /* accent-warm */
  --c-chart-3: #f4a261;  /* warn */
  --c-chart-4: #8e7cc3;  /* replacement */
  --c-chart-5: #00a8c8;  /* accent-cold */
  --c-chart-6: #e63946;  /* danger */
  --c-chart-7: #1d3557;  /* primary */

  /* KPI status borders */
  --kpi-status-ok: var(--c-accent-warm);
  --kpi-status-warn: var(--c-warn);
  --kpi-status-danger: var(--c-danger);
  --kpi-status-neutral: var(--c-primary-tint);

  /* Layout tokens */
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
}

/* Side nav base */
.side-nav {
  position: sticky; top: var(--header-height);
  width: var(--side-nav-collapsed);
  height: calc(100vh - var(--header-height));
  background: var(--c-surface);
  border-right: 1px solid var(--c-border-light);
  transition: width var(--t-base) var(--ease-out);
  overflow-x: hidden;
  overflow-y: auto;
  z-index: var(--z-sticky);
}
.side-nav:hover, .side-nav:focus-within { width: var(--side-nav-expanded); }

.side-nav ul { list-style: none; padding: var(--sp-3) 0; margin: 0; }
.side-nav a {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  color: var(--c-text-muted);
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: background var(--t-fast) var(--ease-out),
              color var(--t-fast) var(--ease-out);
  white-space: nowrap;
}
.side-nav a:hover { background: rgba(29,53,87,.04); color: var(--c-text); }
.side-nav a[aria-current="true"] {
  color: var(--c-primary);
  border-left-color: var(--c-accent-warm);
  background: rgba(42,157,143,.04);
}
.side-nav .icon { width: 24px; height: 24px; flex-shrink: 0; }
.side-nav .label { font-size: 13px; font-weight: var(--fw-medium); opacity: 0; transition: opacity var(--t-fast) var(--ease-out); }
.side-nav:hover .label, .side-nav:focus-within .label { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .side-nav { transition: none; } }

/* Bento grid */
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
@media (max-width: 1024px) { .bento-grid > [data-cols] { grid-column: span 12; } }

/* Section header */
.section-header { margin-bottom: var(--sp-6); scroll-margin-top: calc(var(--header-height) + 16px); }
.dashboard-section { margin-top: var(--section-spacing); scroll-margin-top: calc(var(--header-height) + 16px); }
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

/* KPI hero */
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
}
.kpi-card-hero:hover { box-shadow: var(--shadow-card-hover); transform: translateY(-2px); }
.kpi-card-hero.status-danger { border-left-color: var(--kpi-status-danger); background: var(--alert-urgent-bg-light); }
.kpi-card-hero.status-warn { border-left-color: var(--kpi-status-warn); }
.kpi-card-hero.status-ok { border-left-color: var(--kpi-status-ok); background: var(--alert-ok-bg-light); }
.kpi-card-hero .kpi-eyebrow { font-size: 11px; font-weight: var(--fw-heavy); letter-spacing: 1.2px; text-transform: uppercase; color: var(--c-text-muted); display: flex; justify-content: space-between; }
.kpi-card-hero .kpi-value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 36px; font-weight: var(--fw-medium); color: var(--c-text); line-height: 1; }
.kpi-card-hero .kpi-sparkline { flex: 1; min-height: 0; }
.kpi-card-hero .kpi-delta { font-size: 11px; font-weight: var(--fw-semi); padding: 2px 8px; border-radius: var(--radius-pill); }
.kpi-card-hero .kpi-delta.up { background: rgba(42,157,143,.12); color: var(--c-accent-warm); }
.kpi-card-hero .kpi-delta.down { background: rgba(230,57,70,.12); color: var(--c-danger); }

/* KPI secondary */
.kpi-card-secondary {
  background: var(--c-surface);
  border-radius: var(--radius-md);
  padding: var(--sp-3) var(--sp-4);
  height: var(--kpi-secondary-height);
  display: flex; flex-direction: column; gap: var(--sp-1);
  transition: box-shadow var(--t-base) var(--ease-out);
  box-shadow: 0 1px 3px rgba(29,53,87,.06);
}
.kpi-card-secondary:hover { box-shadow: var(--shadow-card); }
.kpi-card-secondary .kpi-eyebrow { font-size: 11px; font-weight: var(--fw-heavy); letter-spacing: 1.2px; text-transform: uppercase; color: var(--c-text-muted); }
.kpi-card-secondary .kpi-value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 20px; font-weight: var(--fw-medium); color: var(--c-text); line-height: 1; }

/* Panel base */
.panel {
  background: var(--c-surface);
  border-radius: var(--radius-xl);
  padding: var(--sp-5) var(--sp-6);
  box-shadow: var(--shadow-card);
  transition: box-shadow var(--t-base) var(--ease-out);
  display: flex; flex-direction: column; min-height: 0;
}
.panel:hover { box-shadow: var(--shadow-card-hover); }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-4); }
.panel-title { font-size: 14px; font-weight: var(--fw-semi); color: var(--c-text); margin: 0; }
.panel-subtitle { font-size: 12px; color: var(--c-text-muted); margin: 0; }
.panel-body { flex: 1; min-height: 0; }
```

### 4.5 Chart.js — configurações globais

Aplicadas em `initCharts()` chamado uma vez no início de `buildContent()`:

```javascript
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
};

const SERIES_COLORS = [
  PALETTE.primaryTint, PALETTE.accentWarm, PALETTE.warn,
  PALETTE.replacement, PALETTE.accentCold, PALETTE.danger, PALETTE.primary
];

function applyChartDefaults() {
  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.font.weight = 500;
  Chart.defaults.color = PALETTE.textMuted;
  Chart.defaults.borderColor = PALETTE.border;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Chart.defaults.plugins.tooltip.backgroundColor = PALETTE.textMuted;
  Chart.defaults.plugins.tooltip.titleColor = '#f4f4f5';
  Chart.defaults.plugins.tooltip.bodyColor = '#f4f4f5';
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
  Chart.defaults.animation = {
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
    easing: 'easeOutCubic',
  };
}

const ZOOM_CONFIG = {
  pan: { enabled: true, mode: 'x' },
  zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
  limits: { x: { minRange: 4 } },
};
```

### 4.6 Bug conhecido a corrigir

**Arquivo**: `src/views/dashboard.html` linha 481
**Problema**: `document.getElementById('periodToday').click()` — o ID `periodToday` não existe; o botão tem `data-range="today"`.
**Solução (Fase 6)**: substituir por `document.querySelector('#periodSelector .period-btn[data-range="today"]').click()`.

---

## 5. Componentes

### 5.1 Header sticky (56px)

```html
<header class="sticky-top">
  <div class="header-inner">
    <h1 class="header-title">Dashboard</h1>

    <div class="period-pill-group" role="group" aria-label="Período rápido">
      <button class="period-btn" data-range="today">Hoje</button>
      <button class="period-btn" data-range="yesterday">Ontem</button>
      <button class="period-btn" data-range="week">7d</button>
      <button class="period-btn" data-range="month">30d</button>
    </div>

    <div class="date-range">
      <input type="date" id="dateFrom" aria-label="Data inicial" />
      <span>→</span>
      <input type="date" id="dateTo" aria-label="Data final" />
      <button class="btn-secondary" id="btnApplyDates">Aplicar</button>
    </div>

    <select id="stationSelect" aria-label="Estação">
      <option value="">Todas as estações</option>
      <!-- options populadas via fetch -->
    </select>

    <button class="btn-primary" id="btnExport" disabled>
      <svg class="icon">...</svg> Export
    </button>

    <a href="/gerente" class="btn-ghost">← Voltar</a>

    <span class="last-updated" id="lastUpdated" hidden>Atualizado <span class="mono">Xs</span> atrás</span>
  </div>
</header>
```

CSS:
```css
.sticky-top {
  position: sticky; top: 0; z-index: var(--z-sticky);
  height: var(--header-height);
  background: rgba(244,244,245,.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--c-border-light);
}
.header-inner {
  max-width: var(--grid-max-width);
  height: 100%;
  margin: 0 auto;
  padding: 0 var(--sp-7);
  display: flex; align-items: center; gap: var(--sp-4);
}
```

### 5.2 Side nav (icon rail expansível)

6 itens:
1. **Topo** (`#top`) — ícone `home` (24×24 stroke 1.5)
2. **Visão Geral** (`#overview`) — ícone `grid`
3. **Demanda** (`#demand`) — ícone `trending-up`
4. **SLA e Tempos** (`#sla`) — ícone `clock`
5. **Diagnóstico** (`#diagnosis`) — ícone `alert-triangle`
6. **Performance** (`#performance`) — ícone `star`

SVGs inline (24×24, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `fill="none"`, `stroke-width="1.5"`, `stroke-linecap="round"`, `stroke-linejoin="round"`). Padrão: outline icons estilo Heroicons.

Active state via `IntersectionObserver` com `threshold: 0.4`:
```javascript
const sections = ['top', 'overview', 'demand', 'sla', 'diagnosis', 'performance']
  .map(id => document.getElementById(id))
  .filter(Boolean);
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id;
      document.querySelectorAll('.side-nav a').forEach(a => {
        a.setAttribute('aria-current', a.getAttribute('href') === '#' + id ? 'true' : 'false');
      });
    }
  });
}, { threshold: 0.4, rootMargin: '-56px 0px -50% 0px' });
sections.forEach(s => observer.observe(s));
```

### 5.3 KPI hero (4 cards)

Cada hero card é um `<button class="kpi-card-hero" data-status="danger|warn|ok|neutral">` (button para drill-down via Enter/Space).

| Card | Eyebrow | Valor | Status threshold (calculado em JS) |
|---|---|---|---|
| Pedidos | "VOLUME TOTAL" | `kpis.total_pedidos` | sempre `neutral` |
| % Dentro SLA | "QUALIDADE" | `kpis.pct_dentro_sla`% | sempre `neutral` |
| Atrasos Cozinha | "PROBLEMA COZINHA" | `kpis.atrasos_cozinha` | >5%: danger; >0%: warn; =0: ok |
| Atrasos Salão | "PROBLEMA SALÃO" | `kpis.atrasos_salao` | >5%: danger; >0%: warn; =0: ok |

Delta é calculado comparando `kpis` atual com `kpis` do `week_comparison` (campo `comparison.{card}.delta_pct`). Seta ↑/↓ + cor verde/vermelho conforme sinal.

Sparkline: Chart.js mini bar+line, 14 pontos (extraídos de `trend` ou recalculados). Config:
```javascript
new Chart(ctx, {
  type: 'bar',
  data: { labels: dates14d, datasets: [
    { type: 'bar', data: values14d, backgroundColor: 'rgba(69,123,157,.5)', borderWidth: 0 },
    { type: 'line', data: ma7, borderColor: PALETTE.primary, borderWidth: 2, pointRadius: 0 }
  ]},
  options: { plugins: { legend: { display: false }, tooltip: { enabled: false }, zoom: undefined },
             scales: { x: { display: false }, y: { display: false } } }
});
```

### 5.4 KPI secondary (7 cards)

Cada um é um `<div class="kpi-card-secondary">` (não clicável).

| Card | Eyebrow | Valor | Format |
|---|---|---|---|
| Zerados | "ROTURAS" | `kpis.zerados` | int |
| Cancelados | "CANCELADOS" | `kpis.cancelados` | int |
| % Urgentes | "PRESSÃO" | `kpis.pct_urgentes`% | % com 1 decimal |
| Urgentes | "URGENTES" | `kpis.urgentes` | int |
| Tempo Médio Cozinha | "COZINHA (MIN)" | `kpis.tempo_medio_cozinha_min` | min com 1 decimal |
| Tempo Retirada | "RETIRADA (MIN)" | `kpis.tempo_medio_retirada_min` | min com 1 decimal |
| Ocupação Média | "OCUPAÇÃO" | média de `occupancy_by_shift[].pct_ociosa` | % com 1 decimal |

### 5.5 Bento panel (genérico)

Todos os 18 painéis herdam de `.panel` (ver §4.4). Estrutura:
```html
<article class="panel" data-cols="N" data-rows="N">
  <header class="panel-header">
    <div>
      <h3 class="panel-title">{título}</h3>
      <p class="panel-subtitle">{subtítulo opcional}</p>
    </div>
    <div class="panel-actions"><!-- toggle, button --></div>
  </header>
  <div class="panel-body">
    {conteúdo específico}
  </div>
</article>
```

### 5.6 Charts Chart.js (6 charts: 4 migrados + 2 novos)

**4 charts migrados** (canvas 2D hand-rolled → Chart.js):

| Chart | Seção | data-cols | Tipo Chart.js | Datasets | Origem |
|---|---|---|---|---|---|
| Comparativo Atual vs Período Anterior | Visão Geral | 6 | `bar` (grouped) + `line` | 3 bars (entregues/cancelados/atrasos) + 1 line (volume) | `drawComparisonChart()` |
| Volume MA 7 dias | Demanda | 7 | `bar` + `line` | 1 bar (volume diário) + 1 line (MA 7d) | `drawMaChart()` |
| Tempo de Fila por Estação × Hora | SLA | 12 | `line` (multi) | N lines (uma por estação) | `drawQueueHourChart()` |
| Trend Performance 30d | Performance | 12 | `line` (multi) | 5 lines (uma por entidade) | `drawPerfTrendChart()` |

**2 charts novos** (HTML bars estáticos → Chart.js, upgrade visual):

| Chart | Seção | data-cols | Tipo Chart.js | Datasets | Origem |
|---|---|---|---|---|---|
| Velocidade Cozinha por Hora | SLA | 6 | `line` (area fill) | 1 line com `fill: { target: 'origin', above: 'rgba(42,157,143,.3)' }` | HTML bars estáticos (linha 552 do código atual) |
| Tempo de Retirada por Hora | SLA | 6 | `line` (area fill) | 1 line com fill primary-tint | HTML bars estáticos (linha 567 do código atual) |

**Total**: 6 charts Chart.js. Os 4 migrados substituem o canvas hand-rolled (~600 linhas removidas); os 2 novos substituem HTML bars por linhas com area fill e tooltips interativos (upgrade visual mas zero novo código canvas).

Todos os 6 com `ZOOM_CONFIG` (ver §4.5) + botão "Reset zoom" no canto superior direito do canvas, visível apenas quando há zoom ativo:
```html
<button class="chart-reset-zoom" hidden>↺ Reset</button>
```

### 5.7 Modais de drill-down

3 modais:
- **#modalFunil**: tabela com demandas no status selecionado
- **#modalProdutos**: top 20 demandas do produto selecionado
- **#modalTrocas**: tabela completa de trocas (sem limite de top)

Todos compartilham:
```html
<div class="modal-overlay" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header class="modal-header">
      <h2 id="modal-title" class="modal-title">{título}</h2>
      <button class="modal-close" aria-label="Fechar">×</button>
    </header>
    <div class="modal-body">{conteúdo}</div>
  </div>
</div>
```

Focus trap (Tab cicla dentro do modal), Esc fecha, click no overlay fecha.

### 5.8 Modal de ajuda (keyboard shortcuts)

Mostrado por `?`. Conteúdo: tabela de atalhos.

---

## 6. Seções (5 seções, 18 painéis)

### 6.1 Visão Geral (`#overview`)

Eyebrow: `VISÃO GERAL` · Título: "Estado do restaurante" · Descrição: "Volume, fluxo e urgências em tempo real."

| # | Painel | data-cols | data-rows | Visualização |
|---|---|---|---|---|
| 1 | Funil de Demandas | 12 | 2 | HTML/SVG: 4 etapas + canceled lateral, altura 220px |
| 2 | Status das Demandas | 3 | 1 | SVG donut, 5 fatias (pending/ready/retrieved/canceladas_salao/canceladas_cozinha) |
| 3 | Origem das Urgências | 3 | 1 | SVG donut, 4 fatias (manual/auto/sla_breach/stockout) |
| 4 | Comparativo Atual vs Período Anterior | 6 | 2 | **Chart.js** grouped bar + line, zoom plugin |

Drill-down:
- KPI hero "Pedidos" → anchor `#overview` + highlight do funil (1s pulse na borda teal)
- KPI hero "Atrasos Cozinha/Salão" → anchor `#sla` + highlight
- Click em etapa do funil → modalFunil com lista filtrada por status
- Click em fatia do donut Status → filtra funil (sem modal)

### 6.2 Demanda (`#demand`)

Eyebrow: `DEMANDA` · Título: "Quando e o que sai" · Descrição: "Heatmap de operação, volume e mix de produtos."

| # | Painel | data-cols | data-rows | Visualização |
|---|---|---|---|---|
| 5 | Heatmap Hora × Dia da Semana | 12 | 2 | HTML grid 7×24, colorização HSL via `--c-primary-tint`, hover mostra valor |
| 6 | Volume MA 7 dias | 7 | 2 | **Chart.js** bar + line, zoom plugin |
| 7 | Sazonalidade por Dia da Semana | 5 | 1 | HTML bars horizontais, 7 dias |
| 8 | Produtos Mais Demandados | 12 | 2 | HTML bars horizontais, top 12 |

Drill-down:
- Click em célula do heatmap → tooltip "Seg 14h — 23 pedidos" + link "ver demandas deste horário" (abre modal com lista)
- Click em barra de "Produtos" → modalProdutos com top 20 demandas do produto

### 6.3 SLA e Tempos (`#sla`)

Eyebrow: `SLA E TEMPOS` · Título: "Eficiência operacional" · Descrição: "Cumprimento de SLA, velocidade e filas."

| # | Painel | data-cols | data-rows | Visualização |
|---|---|---|---|---|
| 9 | Velocidade da Cozinha por Hora | 6 | 2 | **Chart.js** line com area fill teal, zoom (NOVO Chart.js) |
| 10 | Tempo de Retirada por Hora | 6 | 2 | **Chart.js** line com area fill primary-tint, zoom (NOVO Chart.js) |
| 11 | SLA por Produto (Pareto de Estouros) | 6 | 2 | HTML stacked bars horizontais (dentro SLA teal + fora SLA danger) |
| 12 | Tempo Médio de Preparo por Produto | 6 | 2 | HTML bars horizontais navy + linha tracejada do SLA esperado warn |
| 13 | Tempo de Fila por Estação | 4 | 1 | HTML stacked bars horizontais (cooking teal + queue warn) |
| 14 | Tempo de Fila por Estação × Hora | 4 | 2 | **Chart.js** multi-line (uma por estação), zoom (MIGRADO) |
| 15 | Ocupação por Turno | 4 | 1 | HTML bars horizontais (4 turnos), linha tracejada em 100% |

Layout em 3 rows:
- Row 1: Velocidade (6) + Retirada (6)
- Row 2: Pareto SLA (6) + Preparo (6)
- Row 3: Fila (4) + Fila por Hora (4) + Ocupação (4)

Drill-down:
- Click em barra de Pareto SLA → anchor `#sla` painel "Preparo" + highlight (drill lateral)

### 6.4 Diagnóstico (`#diagnosis`)

Eyebrow: `DIAGNÓSTICO` · Título: "Problemas e exceções" · Descrição: "Cancelamentos, roturas e trocas."

| # | Painel | data-cols | data-rows | Visualização |
|---|---|---|---|---|
| 15 | Motivos de Cancelamento | 4 | 2 | HTML bars horizontais danger, top 10 |
| 16 | Zerados por Produto | 4 | 2 | HTML bars horizontais warn, top 10 |
| 17 | Trocas de Itens do Cardápio | 4 | 2 | Tabela compacta (original → substituição, qtd), cor replacement |

Drill-down:
- Click em barra de "Motivos" → modal com lista de demandas canceladas por aquele motivo
- Click em barra de "Zerados" → modal com lista de demandas zeradas
- Click em linha de "Trocas" → modalTrocas com tabela completa

### 6.5 Performance da Equipe (`#performance`)

Eyebrow: `PERFORMANCE` · Título: "Notas e detratores" · Descrição: "Avaliação 0-5 por entidade."

| # | Painel | data-cols | data-rows | Visualização |
|---|---|---|---|---|
| 18a | Score: Cozinha Geral | 2.4 (12/5) | 2 | Card grande: entity name + nota 48px mono + cor por faixa + delta + botão "ver detratores" |
| 18b | Score: Quente A | 2.4 | 2 | idem |
| 18c | Score: Quente B | 2.4 | 2 | idem |
| 18d | Score: Fria | 2.4 | 2 | idem |
| 18e | Score: Salão | 2.4 | 2 | idem |
| 19 | Trend de Performance (30d) | 12 | 2 | **Chart.js** multi-line (5 séries), zoom plugin |
| 20 | Detratores | 12 | 0 (condicional) | Tabela: timestamp, tipo, entidade, nota. Aparece inline quando score é clicado. |

Faixas de cor para nota:
- 5.0–4.5: `var(--c-accent-warm)` (teal) — "great"
- 4.4–3.5: `var(--c-primary-tint)` (steel blue) — "good"
- 3.4–2.5: `var(--c-warn)` (laranja) — "warn"
- <2.5: `var(--c-danger)` (vermelho) — "bad"

Drill-down:
- Click no score card → toggle do painel Detratores abaixo (in-place expand, sem modal)

---

## 7. Comportamento

### 7.1 Socket.IO — auto-refresh refinado

```javascript
const DEBOUNCE_MS = 30000;
let pendingReload = null;

socket.on('demand:new', scheduleReloadIfLive);
socket.on('demand:urgent', scheduleReloadIfLive);
socket.on('demand:ready', scheduleReloadIfLive);
socket.on('demand:retrieved', scheduleReloadIfLive);
socket.on('demand:cancelled', scheduleReloadIfLive);
socket.on('demand:annulled', scheduleReloadIfLive);
socket.on('demand:stockout', scheduleReloadIfLive);

function scheduleReloadIfLive() {
  const isLive = currentRange === 'today' && !customRange;
  if (isLive) {
    // Período ao vivo: reload imediato, mas com badge "atualizado agora"
    showLastUpdated();
    scheduleReload(0);
  } else {
    // Período histórico: badge apenas, sem reload
    showLastUpdated();
  }
}

function scheduleReload(delayMs) {
  clearTimeout(pendingReload);
  pendingReload = setTimeout(() => {
    reloadDashboard();
    pendingReload = null;
  }, delayMs);
}
```

### 7.2 Drill-down flows

Todos os drill-downs definidos em §5.3, §6.1-6.5. Resumo:

| Origem | Ação | Tipo |
|---|---|---|
| KPI hero "Pedidos" | Anchor + highlight funil | Navegação |
| KPI hero "% Dentro SLA" | Anchor + highlight SLA Pareto | Navegação |
| KPI hero "Atrasos Cozinha" | Anchor + highlight Velocidade | Navegação |
| KPI hero "Atrasos Salão" | Anchor + highlight Retirada | Navegação |
| Etapa do funil | Modal com lista filtrada | Modal |
| Fatia do donut Status | Filtra funil | Inline |
| Célula do heatmap | Tooltip + modal opcional | Tooltip/Modal |
| Barra de "Produtos" | Modal top 20 demandas do produto | Modal |
| Barra de "Pareto SLA" | Anchor + highlight Preparo | Navegação |
| Barra de "Motivos" | Modal lista cancelados por motivo | Modal |
| Barra de "Zerados" | Modal lista zerados | Modal |
| Linha de "Trocas" | Modal tabela completa | Modal |
| Score card Performance | Toggle inline Detratores | Inline |

### 7.3 Keyboard shortcuts

| Atalho | Ação | Conflito evitado por |
|---|---|---|
| `g` + `o` | Anchor Visão Geral | `g` não inicia nada se foco em input |
| `g` + `d` | Anchor Demanda | idem |
| `g` + `s` | Anchor SLA | idem |
| `g` + `n` | Anchor Diagnóstico (de "neGative") | idem |
| `g` + `p` | Anchor Performance | idem |
| `g` + `t` | Anchor Topo | idem |
| `r` | Refresh manual | idem |
| `e` | Abre modal Export | idem |
| `?` | Abre modal Ajuda | idem |
| `Esc` | Fecha modal/banner | global |

Implementação: listener global de `keydown` no `document`, com flag `pendingG` que expira em 1500ms.

### 7.4 Last-updated badge

Aparece no header quando o socket recebe evento:
- Esconde se < 5s atrás (reload frequente é esperado em horário de pico)
- Mostra "Xs" se 5-59s
- Mostra "Xm" se 1-59min
- Some após reload (mostra "agora" brevemente)

### 7.5 prefers-reduced-motion

Já tratado no `theme.css` (spec anterior). Adições específicas deste spec:
- `Chart.defaults.animation = { duration: 0 }` se `prefers-reduced-motion: reduce`
- Side nav: `transition: none` no `@media (prefers-reduced-motion: reduce)`
- Reset zoom button: sem fadeIn
- Hover translateY: removido (já tratado no theme.css)

---

## 8. Edge States

### 8.1 Loading

**Primeiro load** (Fase 5+):
- 4 hero cards com `.skeleton-block` no lugar de valor + sparkline
- 7 secondary cards com `.skeleton-block` no lugar de valor
- Cada chart com `.skeleton-block` na altura do canvas (180-280px)
- Cada painel de texto com `.skeleton-block` em 2-3 linhas

**Subsequent loads** (mudança de filtro):
- Skeleton apenas nos painéis que mudam (KPIs + charts)
- Demais painéis mantêm dados anteriores com overlay sutil de opacidade 0.6

**Chart.js skeleton**:
```html
<canvas class="chart-canvas" hidden></canvas>
<div class="skeleton-block" style="height: 180px"></div>
```
Quando `chart.update()` completa, esconde skeleton e mostra canvas com fadeIn 200ms.

### 8.2 Empty state global

Aparece quando `kpis.total_pedidos === 0` E todos os 17 outros datasets estão vazios. Substitui KPI strip + 5 seções por:

```html
<div class="empty-state-global">
  <svg class="empty-icon"><!-- chart-bar 64x64 --></svg>
  <h2>Sem dados para o período selecionado</h2>
  <p>Tente outro intervalo de datas ou verifique se há demandas registradas.</p>
  <button class="btn-primary" onclick="document.querySelector('[data-range=today]').click()">
    Voltar para hoje
  </button>
</div>
```

### 8.3 Empty state por painel

Para painéis individuais com `length === 0`:
```html
<div class="empty-state">
  <svg class="empty-icon"><!-- generic --></svg>
  <h4>Sem dados</h4>
</div>
```

### 8.4 Error states

| Falha | UX |
|---|---|
| Fetch inicial falha | Card full-width com ícone, mensagem, "Tentar novamente" + "Voltar" |
| Fetch subsequente falha | Toast.error 12s, mantém dados antigos |
| Chart.js render falha | Empty state no canvas com mensagem, console.error técnico |
| Socket.IO disconnect | Banner amarelo abaixo do header, "tentando reconectar..." |
| Socket.IO reconnect | Banner some, toast.info 3s "Conexão restabelecida" |

### 8.5 Print

```css
@media print {
  .sticky-top, .side-nav, .btn-export, .toast, .modal-overlay,
  .socket-banner, .chart-reset-zoom, .last-updated, .panel-actions {
    display: none !important;
  }
  .panel { break-inside: avoid; box-shadow: none; border: 1px solid var(--c-border-light); }
  body { background: white; }
}
```

---

## 9. Acessibilidade

### 9.1 ARIA map

| Elemento | ARIA |
|---|---|
| `<header class="sticky-top">` | `role="banner"` |
| `<aside class="side-nav">` | sem role (já é landmark via tag) |
| `<nav>` dentro do aside | `aria-label="Seções do dashboard"` |
| `<main>` | sem role (landmark via tag) |
| Cada `<section>` | `aria-labelledby="section-title-X"` |
| `<h1 class="header-title">` | único por página |
| `<h2 class="section-title">` | um por seção |
| `<h3 class="panel-title">` | um por painel |
| Side nav links | `aria-current="true"` no ativo, `aria-current="false"` nos demais |
| KPI hero | `<button>` com `aria-label="Pedidos: 1247, mais 12% vs período anterior"` |
| KPI secondary | `<div>` com `aria-label="..."` (não interativo) |
| Filtros | `<label>` apropriado, `aria-describedby` para help text |
| Charts | `<canvas tabindex="0" role="img" aria-label="Gráfico de...">` + `<p class="sr-only">` com texto alternativo |
| Toasts | `aria-live="polite"` (info/warn) ou `"assertive"` (error) |
| Socket banner | `role="status" aria-live="polite"` |
| Modais | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` no título |
| Botão fechar modal | `aria-label="Fechar"` |
| Período buttons | `aria-pressed="true"` no selecionado |

### 9.2 Focus management

- Side nav: Tab percorre itens, seta ↑↓ também (opcional)
- Header: Tab na ordem visual (período → range → estação → export → voltar)
- KPIs: Tab percorre 4 hero, depois 7 secondary
- Painéis clicáveis: Tab navega, Enter/Space ativa
- Charts: Tab no canvas, Enter para "Reset zoom" se visível
- Modal aberto: focus trap (Tab cicla), Esc fecha, focus volta ao elemento que abriu
- Modal fechado: focus volta ao origin

### 9.3 Contraste (verificado)

| Combinação | Ratio | Status |
|---|---|---|
| `#1e1e1e` em `#ffffff` | 16.5:1 | AAA |
| `#6b7280` em `#ffffff` | 5.7:1 | AA |
| `#457b9d` em `#ffffff` | 5.0:1 | AA (texto 14px+) |
| `#2a9d8f` em `#ffffff` | 3.8:1 | AA large only (não usar em texto <18px) |
| `#e63946` em `#ffffff` | 4.5:1 | AA |
| `#f4a261` em `#ffffff` | 2.8:1 | **NÃO passa** — usar sempre com texto preto ou bg escuro |
| `#1e1e1e` em `#f4a261` | 8.5:1 | AAA (alternativa para texto em laranja) |

Para qualquer uso de laranja em fundo claro, o texto deve ser preto (não branco).

### 9.4 Lighthouse target

- Performance: ≥ 90
- Accessibility: ≥ 95
- Best Practices: ≥ 90
- SEO: ≥ 80 (best-effort, dashboard é backoffice)

---

## 10. Implementação por Fases (9 fases, 9 commits)

### Checkpoints webwright (a cada 2-3 fases ou mudança grande)

| Após fase | Tipo de mudança | O que testar no webwright |
|---|---|---|
| Fase 3 | Side nav (primeira grande mudança visível) | Scroll, active state, hover-expand, click-to-anchor, 3 screenshots em seções diferentes |
| Fase 5 | KPI strip (segunda grande mudança) | 4 hero + 7 secondary, sparklines, bordas coloridas, screenshot full-page 1920×1080 |
| Fase 7 | Chart.js migration (mudança técnica grande) | 6 charts renderizam, zoom funciona, reset zoom, tooltips estilizados, screenshot |
| Fase 9 | Final (aceitação completo) | Todos os 13 fluxos da §11 |

### Fase 1 — Foundation tokens + Chart.js CDN prep
- Adiciona ~150 linhas em `theme.css` (tokens novos + utility classes de §4.4)
- Adiciona 2 `<script>` tags no `<head>` de `dashboard.html` (Chart.js + plugin, ambos com `defer` + `preconnect`)
- Sem mudança visual
- Validação: `npx tsc --noEmit` (deve passar — sem TS changes), reload do dashboard deve mostrar exatamente igual ao baseline
- Commit: `feat(dashboard): foundation tokens + Chart.js CDN prep`

### Fase 2 — Layout skeleton + dashboard.css
- Cria `src/views/styles/dashboard.css` com styles de side nav, bento grid, panel, KPI cards, header sticky
- Adiciona `<link rel="stylesheet" href="/styles/dashboard.css">` no head de `dashboard.html`
- Modifica DOM: envolve header em `<header class="sticky-top">`, adiciona `<aside class="side-nav">` vazio, adiciona `<main class="dashboard-main">` com 5 seções vazias
- Mantém `#content` antigo dentro de section "legacy" temporária (não é renderizado, fica para debug)
- Sem mudança visual (containers invisíveis)
- Validação: dashboard continua visualmente idêntico
- Commit: `feat(dashboard): layout skeleton with new containers`

### Fase 3 — Side nav funcional
- Adiciona 6 itens ao side nav com SVGs inline
- Adiciona `IntersectionObserver` (script inline ou função) para active state
- Adiciona click-to-scroll com `scrollIntoView({ behavior: 'smooth' })`
- CSS: hover-expand em 200ms ease-out
- Teste manual: scroll pela página, side nav acompanha; click em item vai até a seção
- **Checkpoint webwright #1**: tirar 3 screenshots em 3 seções, validar active state correto
- Commit: `feat(dashboard): sticky side nav with section tracking`

### Fase 4 — Header sticky modernizado
- Refatora DOM do header para estrutura de §5.1
- Aplica CSS de pill group para período buttons, inputs limpos
- `backdrop-filter: blur(8px)` + `border-bottom`
- Mantém comportamento idêntico de filtros
- Validação: filtros funcionam idênticos; ao scrollar, header continua visível
- Commit: `feat(dashboard): sticky header with soft-modern filters`

### Fase 5 — KPI strip modernizada
- Reescreve `renderKpis()` em `dashboard.html`:
  - 4 hero cards com sparkline (Chart.js mini)
  - 7 secondary cards em grid 7-col
  - Bordas coloridas por status (§5.3)
  - Delta badges com seta
- Adiciona `renderSparkline(canvasEl, dataArray)` (Chart.js mini, sem zoom)
- Adiciona função `applyChartDefaults()` e cache `PALETTE` (preparação para Fase 7)
- **Checkpoint webwright #2**: full-page screenshot 1920×1080, validar visualmente que:
  - 4 hero cards visíveis, com sparklines renderizadas
  - 7 secondary cards visíveis em grid
  - Bordas coloridas aparecem nos hero "Atrasos Cozinha/Salão" quando >0
  - Sem console errors
- Commit: `feat(dashboard): 4 hero + 7 secondary KPI layout with sparklines`

### Fase 6 — Bento sections
- Refatora `buildContent()` para renderizar 5 seções (em vez de um único `#content`)
- Adiciona section headers (eyebrow + title + description) de §6
- Refatora cada função de render para retornar HTML com `data-cols="N"`
- Atribuição dos 18 painéis conforme §6.1-6.5
- Corrige bug da linha 481: `document.querySelector('#periodSelector .period-btn[data-range="today"]').click()` no empty state
- Validação: todas as 18 visões renderizam; section headers visíveis; bento grid responsivo
- Commit: `feat(dashboard): bento sections with 5 thematic groupings`

### Fase 7 — Chart.js migration
- Cria funções factory em `dashboard.html` para os 6 charts (4 migrados + 2 novos)
- Substitui `drawMaChart()`, `drawQueueHourChart()`, `drawComparisonChart()`, `drawPerfTrendChart()` (4 canvas hand-rolled) pelas factories Chart.js
- Cria 2 novos charts Chart.js (`createVelocidadeChart()`, `createRetiradaChart()`) substituindo HTML bars estáticos
- Aplica `ZOOM_CONFIG` em todos os 6
- Adiciona botão "Reset zoom" em cada chart (hidden por default, mostra quando há zoom ativo)
- Remove ~600 linhas de código canvas hand-rolled
- Validação: charts renderizam com tooltips; zoom in/out funciona; reset zoom aparece e funciona
- **Checkpoint webwright #3**: screenshot de cada chart, teste de zoom in um chart
- Commit: `feat(dashboard): migrate 4 + create 2 (6 total) Chart.js charts + zoom plugin`

### Fase 8 — Interatividade e edge cases
- Drill-down: implementa 9 fluxos (KPIs hero + funil etapa + heatmap célula + produtos + Pareto + motivos + zerados + trocas + score card)
- 3 modais de drill-down (Funil, Produtos, Trocas) — compartilham estrutura de §5.7
- Modal de ajuda (keyboard shortcuts)
- Empty states: global (§8.2) + por painel (§8.3)
- Error states: fetch inicial (§8.4), fetch subsequente, chart.js
- Skeleton loaders: KPIs (4 hero + 7 secondary), charts (6 Chart.js), painéis de texto (~12)
- Socket.IO refinamento: debounce 30s, sem reload em período histórico
- Botão manual de refresh no header (ao lado de Export)
- Banner de socket disconnect
- Toast helper (substitui os 10 `alert()` finais, herança do spec anterior)
- Last-updated badge
- Validação: drill-downs abrem modais; modais fecham com Esc; empty state aparece em período vazio; error state aparece em falha
- Commit: `feat(dashboard): drill-down modals, empty/error states, socket resilience`

### Fase 9 — Acessibilidade e polish
- ARIA labels em todos os elementos (§9.1)
- Focus management: ordem, focus trap em modais, focus visible (já tratado pelo theme.css)
- Keyboard shortcuts: 9 atalhos (§7.3)
- `Chart.defaults.animation = { duration: 0 }` quando `prefers-reduced-motion: reduce`
- Print stylesheet (§8.5)
- Lighthouse audit + correções até atingir targets (§9.4)
- Verificação manual de contraste (§9.3)
- Verificação de tab order
- **Checkpoint webwright #4 (final)**: 13 fluxos críticos da §11, screenshots de 3 viewports (1920×1080, 1366×768, 768×1024), 0 console errors
- Commit: `feat(dashboard): a11y polish, keyboard shortcuts, lighthouse cleanup`

---

## 11. Verificação e Critérios de Aceite

### 11.1 Comandos de verificação

```bash
# Type check (deve passar — não há mudanças TS)
npx tsc --noEmit

# Build
npm run build

# Sanity grep — nada hardcoded deve sobrar no JS
rg "#[0-9a-fA-F]{3,6}" src/views/dashboard.html | rg -v "var\(--"   # esperado: ~0
rg "border-radius: [0-9]+px" src/views/dashboard.html                # esperado: ~0
rg "alert\(['\"]" src/views/dashboard.html                            # esperado: 0
rg "ctx\.fillText" src/views/dashboard.html                           # esperado: 0

# Impeccable score (deve subir vs baseline)
node .agents/skills/impeccable/detect.mjs src/views/dashboard.html

# Visual regression (webwright)
# 3 viewports: 1920×1080, 1366×768, 768×1024
```

### 11.2 Critérios funcionais

- [ ] Todas as 11 KPIs originais continuam visíveis (4 hero + 7 secondary)
- [ ] Todos os 18 painéis originais continuam visíveis
- [ ] Filtros (período + range custom + estação) funcionam idênticos ao baseline
- [ ] Export PDF/Excel funciona idêntico ao baseline
- [ ] Socket.IO auto-refresh funciona (com debounce 30s, sem reload em período histórico)
- [ ] Todos os 12 drill-downs funcionam
- [ ] Empty state global aparece quando apropriado
- [ ] Empty state por painel aparece quando dataset é vazio
- [ ] Error states aparecem em falha de rede
- [ ] Botão "Voltar para hoje" (que estava morto) agora funciona
- [ ] Side nav: 6 itens, hover-expand, active state via IntersectionObserver
- [ ] Header sticky: visível ao scrollar, backdrop-filter funciona
- [ ] Keyboard shortcuts: 9 atalhos funcionando, modal de ajuda abre com `?`
- [ ] 6 charts Chart.js (4 migrados + 2 novos) com zoom plugin funcional

### 11.3 Critérios visuais

- [ ] Nenhum hex hardcoded no JS de renderização (todos via `getComputedStyle(...).getPropertyValue('--c-X')`)
- [ ] Sombras tinted (navy-tint), não pretas
- [ ] Tipografia mono (JetBrains Mono + tabular-nums) em todos os números
- [ ] Eyebrow + section title em cada uma das 5 seções
- [ ] Side nav com hover-expand funcional e pill teal no item ativo
- [ ] Header sticky com backdrop-filter
- [ ] Sparklines renderizadas nos 4 hero KPIs
- [ ] Chart.js tooltips estilizados (bg dark, padding 12, radius 8)
- [ ] Reset zoom button aparece em cada chart quando há zoom ativo
- [ ] Bordas coloridas nos 4 hero KPIs por status

### 11.4 Critérios técnicos

- [ ] `npx tsc --noEmit` passa
- [ ] `npm run build` sem erros
- [ ] 0 console errors no browser (verificado via webwright `console_messages`)
- [ ] 0 network failures 4xx/5xx (exceto 401 esperados em auth)
- [ ] Lighthouse Performance ≥ 90
- [ ] Lighthouse Accessibility ≥ 95
- [ ] Lighthouse Best Practices ≥ 90
- [ ] Lighthouse SEO ≥ 80
- [ ] HTML final < 250KB
- [ ] Total transferido (HTML + CSS + JS + Chart.js + plugin + fonts) < 350KB

### 11.5 Critérios de compatibilidade

- [ ] URL `/dashboard` inalterada
- [ ] API response shapes (`/api/v1/analytics/dashboard`, `/api/v1/analytics/performance`) inalteradas
- [ ] Outros 6 views (salao, cozinha-quente, cozinha-fria, cozinha, gerente, admin) inalterados
- [ ] Nenhuma migration de DB
- [ ] Nenhuma mudança em `server.ts`
- [ ] Nenhuma mudança em `src/routes/analytics.ts`
- [ ] Nenhuma mudança em `src/services/performance.service.ts`

### 11.6 Fluxos críticos (webwright)

1. **Load inicial**: GET `/dashboard` → 0 console errors, header sticky + side nav + KPI strip + seções renderizam, TTI < 3s
2. **Side nav navigation**: hover expand, click scroll, IntersectionObserver active state
3. **Filtro de período**: 4 botões + date range custom (com cap 31d) + estação
4. **Drill-down de KPIs**: 4 hero com destinos corretos
5. **Drill-down de painel (modal)**: funil etapa, produtos, trocas, motivos, zerados — 5 modais
6. **Charts (Chart.js)**: hover tooltip, scroll zoom, drag pan, reset zoom button
7. **Performance section**: 5 score cards, click expande Detratores inline, trend chart
8. **Socket.IO refresh**: POST demanda → badge "atualizado", reload em 30s para "Hoje", sem reload para "Ontem"
9. **Empty state**: período vazio → empty state global
10. **Error state**: rede cai → banner socket + toast.error em fetch
11. **Export**: PDF consolidado, PDF por dia, Excel consolidado, Excel por dia
12. **Acessibilidade**: Lighthouse ≥ 95, Tab order, focus visível, reduced-motion
13. **Responsivo**: 1920×1080 (full), 1366×768 (laptop), 1024×768 (tablet), 768×1024 (tablet portrait com nav tab strip), <768 (mobile)

---

## 12. Out of Scope

- Dark mode (considerado para futuro)
- Migrar outros 6 views (apenas dashboard)
- Redesign do export PDF/Excel (mantém o atual — já funciona)
- Adicionar novos KPIs ou painéis além dos 18 atuais
- Adicionar i18n / multi-idioma (continua pt-BR)
- Trocar Inter por outra fonte (decisão do operador)
- Migrar JS para React/Vue/Svelte (continua vanilla inline)
- Self-host Chart.js (continua via CDN)
- Adicionar testes automatizados com Playwright Test (webwright é suficiente)
- Persistência de preferências de filtro no localStorage
- Compartilhamento de URL com filtros (query string stateful)
- Imprimir via Ctrl+P (já coberto indiretamente pelo export PDF)
- Animações de entrada dos painéis (entram com opacity 0 → 1 ao carregar — fora de escopo desta iteração)

---

## 13. Riscos & Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Refator de `buildContent()` quebrar render | Alta | Alto (página inteira) | Fase 6 mantém função antiga por 1 commit, refatora em sub-passos, remove no fim |
| Chart.js bundle 85KB impacta first load | Média | Médio | `<link rel="preconnect">` + `defer` + FCP medido no webwright |
| HTML crescendo de 1548 para 2400+ linhas | Alta | Baixo | Extrair `dashboard.css` (Fase 2). JS continua inline por enquanto. Se passar de 3000 linhas, extrair `dashboard.js` em iteração futura |
| Webwright não captura drill-down modais | Média | Médio | Manual test desses fluxos (Playwright headless) |
| Cliente Supabase cold start demorar > 2s | Baixa | Baixo | Skeleton loaders cobrem o delay visualmente |
| 11 KPIs refatorados quebrarem contagem | Baixa | Alto | Comparar com baseline: `SELECT COUNT(*) FROM demands WHERE created_at >= $1` antes/depois |
| Bug linha 481 não corrigido confundir implementação | Baixa | Baixo | Já documentado em §4.6, corrigido na Fase 6 |
| Contraste de teal/laranja em texto <18px | Baixa | Médio | Verificado em §9.3, uso restrito a badges grandes |
| `prefers-reduced-motion: reduce` esconder demais | Baixa | Baixo | Estado visual preservado (cor de fundo/borda); só animação some (já tratado no theme.css) |
| `backdrop-filter` em Orange Pi GPU fraca | N/A | N/A | Dashboard é desktop (gerente em escritório), não kiosk |
| Impeccable score cair em vez de subir | Média | Médio | Rodar detect.mjs no baseline (Fase 0) e após cada fase para detectar regressão cedo |

---

## 14. Notas de Manutenção Futura

- Todos os novos componentes devem referenciar tokens (`var(--c-*)`, `var(--sp-*)`, `var(--radius-*)`) — nunca hardcoded.
- Novos status devem adicionar `--kpi-status-X` em `theme.css`, não em `dashboard.css`.
- Novos charts devem usar `applyChartDefaults()` + `ZOOM_CONFIG` para consistência.
- Novas seções devem seguir o padrão `id="X" class="dashboard-section" aria-labelledby="section-title-X"` + section header com eyebrow + title + description.
- Novos painéis devem herdar `.panel` e declarar `data-cols="N"` + `data-rows="N"`.
- Drill-downs devem usar `aria-current` no side nav (não manipular URL via `pushState` — fora de escopo).
- Animações infinitas fora de `prefers-reduced-motion: reduce` só com justificativa em comentário no CSS.
- `alert()` e `confirm()` proibidos; usar `.toast` e `.modal`.
- Estados vazios sempre via `.empty-state` (theme.css) ou `.empty-state-global` (dashboard.css).
- Novos KPIs numéricos: classe `.kpi-card-hero` ou `.kpi-card-secondary` + `font-family: var(--font-mono)` + `font-variant-numeric: tabular-nums`.
- Se Chart.js ficar legado (v5+ breaking changes): atualizar via `applyChartDefaults()` + revisar `createComparativoChart()` etc.

---

## 15. Entrega Final

- 9 commits atômicos em branch feature (`feature/dashboard-modernization`)
- Tag `v2.6-dashboard-redesign` ao final
- Mensagem de commit final: `feat(dashboard): complete visual redesign — bento grid, side nav, Chart.js, soft-modern premium (closes v2.6)`
- Aguardar aprovação do usuário antes de merge
- Não mergear automaticamente

---

## 16. Skills Invocadas Durante Implementação

- `impeccable` — invocar via `skill` tool para `$impeccable audit`, `$impeccable quieter`, `$impeccable animate`, `$impeccable polish` durante as Fases 6, 7, 8, 9
- `webwright` — invocar via `skill` tool para checkpoints após Fases 3, 5, 7, 9
- `verification-before-completion` — usar antes de declarar Fase 9 completa

## 17. Skills Consultadas mas NÃO Invocadas (com razão)

- `high-end-visual-design` — alvo marketing Awwwards; 4 guardrails avulsos aplicados (eyebrow KPI, layered shadow, GPU-safe animation, z-index discipline)
- `design-taste-frontend v2` — §13 declara dashboards fora de escopo; `Bento` + `Hardening` seções contribuem com 5 regras aplicadas
- `design-taste-frontend-v1` — superseded por v2; 2 regras extras aplicadas
- `industrial-brutalist-ui` — degradação analítica quebra cor-status; só doutrina "cor = recurso escasso" aplicada
- `minimalist-ui` — light editorial ban Inter; só doutrina "cor = semântica apenas" aplicada
- `gpt-taste`, `stitch-design-taste`, `brandkit`, `imagegen-*` — irrelevantes para redesign de dashboard
- `customize-opencode` — não estamos editando opencode
- `brainstorming` — já usada para chegar a este spec
- `writing-skills`, `find-skills`, `dispatching-parallel-agents`, `using-git-worktrees`, `subagent-driven-development`, `executing-plans`, `finishing-a-development-branch`, `test-driven-development` — não aplicáveis a esta iteração
- `receiving-code-review`, `requesting-code-review`, `code-review` — podem ser invocados se o usuário pedir review
- `using-superpowers` — já carregada, sempre aplicada
