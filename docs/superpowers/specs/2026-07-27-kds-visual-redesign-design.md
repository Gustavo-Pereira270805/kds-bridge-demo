# KDS Bridge — Visual Redesign Design

**Data:** 2026-07-27
**Status:** Aprovado pelo operador
**Escopo:** 7 views (`salao`, `cozinha-quente`, `cozinha-fria`, `gerente`, `admin`, `dashboard`, `cozinha`)
**Direção:** Operacional kiosk-grade (B2B, alta legibilidade à distância, semântica de cor preservada)
**Stack:** Vanilla HTML/CSS/JS, Fastify, Socket.IO. Sem frameworks/bundlers.

---

## 1. Contexto e Justificativa

O KDS Bridge é um sistema B2B operacional para restaurantes. Tem 7 views em produção em Orange Pis wall-mounted (chromium `--kiosk`), tablets e desktops. Auditoria visual revelou:

- **Sem design tokens**: 100+ cores hardcoded espalhadas por 7 arquivos inline.
- **Divergência visual**: salão (light) e cozinha (dark) parecem produtos diferentes.
- **Vermelho puro `#ff0000`** em `.card.critical` com `0.8s infinite pulse` — risco vestibular e perigo de fadiga visual em plantões de 8h.
- **13 `alert()` + 3 `confirm()` calls** em kiosk (16 native dialogs total) — prendem a UI até input físico. Distribuição real: `dashboard.html`=10 alert, `salao.html`=1, `cozinha-quente.html`=1, `cozinha-fria.html`=1, `gerente.html`=0; `admin.html`=3 confirm.
- **8 valores diferentes de `border-radius`** sem escala.
- **Sombras `rgba(0,0,0,0.06)`** quase invisíveis em fundo `#f4f4f5`.
- **`prefers-reduced-motion`**: zero referências no código — todos os `*Pulse` rodam sem respeito ao OS.
- **`:focus-visible`**: zero referências — cozinheiros usando teclado serial no Orange Pi não têm feedback de foco.
- **Estados vazios mortos**: texto cinza solto "Nenhuma demanda ativa.".
- **`Carregando...`** texto plano em vez de skeletons.
- **`badge-annulled` reutiliza vermelho urgente** — conceitualmente errado (anulado é neutro).
- **Cozinha-fria usa cyan `#00d4ff` isolado** — não aparece em nenhuma outra tela.
- **Tipografia**: só Inter, sem mono. `tabular-nums` apenas em 4 lugares (timers das 2 cozinhas).
- **Três geometrias de botão diferentes** entre views.

A direção original "operacional kiosk-grade" já estava correta em intuição; este redesign poliu o que faltava: tokens compartilhados, tokens de movimento, accesibilidade, e unificação de componentes base.

## 2. Decisões do Operador (brainstorming)

| Decisão | Valor |
|---|---|
| Escopo | Todos os 7 views |
| Arquitetura CSS | Extrair `src/views/styles/theme.css` + `@fastify/static` em `server.ts` |
| Direção estética | Operacional kiosk-grade (high contrast, dense, glanceable) |
| Tipografia | Manter Inter + adicionar JetBrains Mono para dados numéricos |
| Correções pontuais | Eliminar `#ff0000`, recolorir `badge-annulled`, substituir `alert()` por toasts, `prefers-reduced-motion`, `:focus-visible` + `:active`, skeleton loaders, empty states, tabular-nums, unificar radius, sombras tinted, integrar cyan como acento "frio" |
| Heatmap do dashboard | Manter comportamento atual (números só no hover) |
| Abordagem de execução | Tokens-first: fase 1 (theme.css + fastify-static + refatoração mecânica), fase 2 (mudanças visuais por view), fase 3 (mudanças comportamentais por view) |

## 3. Skills de UI Analisadas

5 skills de UI foram analisadas por sub-agentes em paralelo. Síntese:

| Skill | Fit | Ação |
|---|---|---|
| `impeccable` | 8.5/10 — Modo `Operate` + `detect.mjs` para verificação estática | **INVOKE durante implementação** |
| `high-end-visual-design` | 3/10 — Awwwards marketing; conflita com densidade kiosk | 5 guardrails extraídos (GPU-safe animation, blur-only-on-fixed, z-index discipline, eyebrow KPI labels, layered shadow) |
| `design-taste-frontend v2` | 3/10 — Declara dashboards "fora de escopo" na seção 13 | 8 regras avulsas extraídas |
| `design-taste-frontend v1` | 4/10 — Tem `Cockpit Mode` + "Dashboard Hardening" | SKIP invocation; regras avulsas |
| `industrial-brutalist-ui` | 6/10 — Tactical telemetry alinha; degradação analítica quebra cor-status | Doutrina "cor = recurso escasso" extraída |
| `minimalist-ui` | 3/10 — Light editorial, ban Inter, ban gradients | Padrão `<kbd>` chip, doutrina "cor = semântica apenas" |

**Skills NÃO invocadas**: `high-end-visual-design`, `design-taste-frontend v2`, `design-taste-frontend-v1`, `industrial-brutalist-ui`, `minimalist-ui`, `gpt-taste`, `stitch-design-taste`, `brandkit`, `imagegen-*`, `customize-opencode`.

**Skill INVOCADA durante implementação**: `impeccable` (audit + extract + quieter + animate + polish).

## 4. Arquitetura

### 4.1 Server changes (`src/server.ts`)

Instalar `@fastify/static` e registrar `src/views/styles/` como diretório público servido em `/styles/*`:

```typescript
import fastifyStatic from '@fastify/static';
// Em server.ts, antes das rotas de views:
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'views', 'styles'),
  prefix: '/styles/',
});
```

As 7 views recebem no `<head>`:
```html
<link rel="stylesheet" href="/styles/theme.css">
<!-- depois o inline <style> existente continua -->
```

Recomendação: adicionar pré-load com `<link rel="preload" as="style">` para reduzir FOUT no kiosk.

### 4.2 `src/views/styles/theme.css` (~120-150 linhas)

```css
/* === Font import === */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

:root {
  /* === Color === */
  --c-primary: #1d3557;
  --c-primary-tint: #457b9d;
  --c-accent-warm: #2a9d8f;     /* teal — cooking/ok */
  --c-accent-cold: #00a8c8;     /* cyan desaturated — cozinha-fria */
  --c-warn: #f4a261;            /* orange — late/stockout */
  --c-danger: #e63946;          /* red — urgent/cancel */
  --c-danger-strong: #c81d25;   /* #ff0000 banido */
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
  --radius-sm: 4px;    /* inputs internos, badges quadrados */
  --radius-md: 8px;    /* botões, badges internos */
  --radius-lg: 12px;   /* kitchen cards */
  --radius-xl: 14px;   /* light cards, panels */
  --radius-pill: 999px;/* badges pill, tags */

  /* === Shadow — tinted, layered (replaces rgba(0,0,0,0.06)) === */
  --shadow-card: 0 1px 0 rgba(255,255,255,0.04) inset,
                 0 6px 18px -8px rgba(29,53,87,0.18);
  --shadow-card-hover: 0 1px 0 rgba(255,255,255,0.06) inset,
                       0 12px 32px -10px rgba(29,53,87,0.28);
  --shadow-card-dark: 0 1px 0 rgba(255,255,255,0.04) inset,
                      0 6px 18px -8px rgba(0,0,0,0.55);
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

  /* === Z-index scale (no arbitrary 9999) === */
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
.btn-secondary { background: var(--c-surface); color: var(--c-text);
                 border: 1px solid var(--c-border-light); }
.btn-danger { background: var(--c-danger); color: var(--c-text-invert); }
.btn-ghost { background: transparent; color: var(--c-primary);
             padding: 8px 16px; }

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
                   stroke: var(--c-text-muted); stroke-width: 1.5; }
.empty-state h4 { font-size: 14px; font-weight: var(--fw-semi);
                  color: var(--c-text); margin: 0; }
.empty-state p { font-size: 13px; margin: 0; max-width: 320px; }

/* === Toast (replace 13 alert() + 3 confirm() calls) === */
.toast { position: fixed; right: var(--sp-5); top: var(--sp-5);
         background: var(--c-surface); padding: var(--sp-3) var(--sp-4);
         border-radius: var(--radius-md); box-shadow: var(--shadow-elevated);
         z-index: var(--z-toast); max-width: 360px;
         transition: opacity var(--t-base) var(--ease-out);
         /* `role="alert"` vai no markup, não no CSS */ }
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
  .card.critical, .card.cross-cancelled, .card.urgent, .card.stockout,
  .badge.ready-badge, .col-timer, .card-timer {
    /* estado visual preservado (cor de fundo / borda)
       animação removida */
    animation: none !important;
  }
  .skeleton-block { animation: none;
                    background: var(--c-border-light); }
}
```

## 5. Componentes Base & Casos por View

| Componente | Token/base | Onde reaplica |
|---|---|---|
| `.btn` (único) | `padding: 12px 24px; font-size: 14px; border-radius: var(--radius-md); transition: var(--t-base)` | Todas as 7 views — substitui 3 geometrias inconsistentes |
| `.badge-pill` | `border-radius: var(--radius-pill)` | Unifica `.badge` (20px salão), `.badge-annulled` (999px gerente), pills admin (20px) |
| `.card-base` (light) | Veja §4.2 | salão, gerente, admin, dashboard |
| `.card-base-dark` (kitchen) | Veja §4.2. **Preserva** border-left 4-6px (sinal de status primário) | cozinha-quente, cozinha-fria, cozinha (legacy) |
| `.mono` | `var(--font-mono) + tabular-nums` | card-timer, col-timer, #globalTimer, KPI values, qty, scores, SLA inputs, datas calendário, durações histórico |
| `.empty-state` | icon SVG stroked 1.5 + h4 14px + p 13px max-320px | Todas as 7 views em seus pontos de lista vazia |
| `.skeleton-block` | shimmer 1.5s | dashboard:245, gerente:268, salao:245, admin CRUD tbodies |
| `.toast` | 3 variantes (info/warn/error). Helper `showToast(msg, kind)` em cada view | Substitui os 17 `alert()` |

## 6. Mudanças Comportamentais Globais

### 6.1 `prefers-reduced-motion`

Bloco global no fim de `theme.css` (em §4.2). Mata todos os `*Pulse`, `*shake`, `*flashIn` infinitos — mas **preserva o estado visual** (cor de fundo, border-color). Decisão importante: a semântica de urgência é dada pela cor, não só pela animação.

### 6.2 `:focus-visible`

Global em `theme.css`: anel teal 2px. Mouse-click não dispara (evita ring em toque). Cozinheiros usando teclado serial no Orange Pi ganham feedback.

### 6.3 `:active` pressed feedback

Global em `theme.css`: `transform: translateY(1px)` em 40ms. Substitui o `transform: translateY(0)` que só existia em `salao.html:57` e `admin.html:69`.

### 6.4 `backdrop-filter` restrito a `position: fixed`/`sticky`

Aplica-se apenas em `.reconnect-banner` (kitchen), `.modal-backdrop`, `.top-header` (salao). Nunca em cards scrolláveis — Orange Pi framerate.

### 6.5 Animação GPU-safe

Auditar `cozinha-quente.html:72-83` e trocar keyframes que animam `box-shadow` (caro) por `transform: scale(1.01) + opacity`. Manter o efeito visual, mudar só a engine.

### 6.6 Substituir 13 `alert()` + 3 `confirm()`

**`alert()` → `.toast` (13 calls total):**

| View | Qtde | Linhas | Substituição |
|---|---|---|---|
| `dashboard.html` | 10 | 1279, 1281, 1282, 1284, 1322, 1431, 1437, 1447, 1474, 1500 | `.toast-error` para erros de fetch/validation (ex: "Biblioteca XLSX não carregada", "Datas inválidas") |
| `salao.html` | 1 | 804 | `.toast-warn` para "Selecione um produto para continuar." |
| `cozinha-quente.html` | 1 | 626 | `.toast-error` para "Erro ao cancelar demanda" (não-blocker em kiosk) |
| `cozinha-fria.html` | 1 | 607 | `.toast-error` para fetch failure (não-blocker em kiosk) |
| `gerente.html` | 0 | — | — |
| `admin.html` | 0 | — | — |
| `cozinha.html` | 0 | — | — |

**`confirm()` → `.modal` de confirmação (3 calls, todas em admin.html):**

| View | Linha | Substituição |
|---|---|---|
| `admin.html` | 332, 520, 568 | Modal `.modal-confirm` reusando o padrão `salao.html:335-344` (Confirmar Retirada). Fricção intencional para exclusões irreversíveis. |

Helper inline em cada view (mantém arquitetura atual — JS é inline por view). Pattern:

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

### 6.7 Skeleton loaders substituindo "Carregando..."

- `dashboard.html:245` `<div id="loading" class="loading">Carregando dados...</div>` → 3 `.skeleton-block` simulando KPI cards
- `gerente.html:268` `<td colspan="7">Carregando histórico...</td>` → 8 `.skeleton-block` em linhas
- `salao.html:645` `<option value="">Carregando...</option>` mantém (dentro de select — skeleton não se aplica)
- `admin.html` `<td colspan="7">Carregando...</td>` em 4 tbodies → `.skeleton-block` em linhas

### 6.8 Empty states compostos

| View | Local | Novo estado |
|---|---|---|
| `cozinha-quente.html:316`, `cozinha-fria.html:432`, `cozinha.html:330` | grid vazio | ✓ icon + "Nenhuma demanda ativa" + "Sistema operando nominalmente" |
| `salao.html:316` | lista de demandas ativas | ✓ icon + "Nenhuma demanda ativa no momento" + (sem ação — formulário já está visível) |
| `gerente.html:357` | histórico vazio | 📜 icon + "Nenhuma demanda registrada ainda" + "Demandas aparecem assim que forem criadas" |
| `dashboard.html` (período sem dados) | painel de KPIs | 📊 icon + "Sem dados para o período selecionado" + botão `.btn-ghost` "Trocar período" |
| `admin.html` (tabelas CRUD vazias) | tbody | (manter estado vazio discreto, sem ícone — é CRUD administrativo) |

### 6.9 Tabular-nums em todos os elementos numéricos

- `dashboard.html:49` `.kpi-value` → adicionar `font-variant-numeric: tabular-nums` (ou `.mono`)
- `gerente.html:55` `.metric-card p` (font-size 36px) → tabular-nums
- `salao.html` qty fields, contadores de demandas ativas, timers → tabular-nums
- `admin.html` SLA inputs (`sla_minutes_normal`, `sla_minutes_urgente`) → tabular-nums
- `gerente.html` datas do calendário, durações na tabela histórico → tabular-nums

### 6.10 Recolorir `badge-annulled` (gerente)

Trocar `gerente.html:201-207`:
```css
/* ANTES */
.badge-annulled { background: #e63946; color: white; }
/* DEPOIS */
.badge-annulled { background: transparent; color: var(--c-text-muted);
                  border: 1.5px solid var(--c-text-muted);
                  border-radius: var(--radius-pill); }
```
Anulação é estado neutro (excluído das métricas), não perigo. A `tr.row-annulled { opacity: 0.55; text-decoration: line-through; }` fica preservada.

## 7. Mudanças Específicas por View

### 7.1 `salao.html` (~893 linhas)

- Substituir 5 `alert()` por `.toast`.
- Skeleton em `#productList` (245).
- Empty state composto em 316.
- Tabular-nums em qty + contadores.
- Header com *eyebrow tag* antes do título (ex: "PEDIDO — MESA X").
- **Preservar**: modal `Confirmar Retirada` e `Cancelar Demanda` (fricção intencional — `cancel_reason_id` vem da API).
- **Preservar**: botões `min-height: 48px` e `padding: 14px 28px` (tablet touch).
- **Preservar**: `role="alert"` no `#toast`.

### 7.2 `cozinha-quente.html` (~793 linhas)

- Trocar `.card.critical (#ff0000/#4a0000 + 0.8s infinite pulse)` → `--c-danger-strong + --alert-urgent-bg-dark` (sem animação por padrão; estado preservado).
- Trocar `.card.cross-cancelled (#ff0000 + crossCancelPulse infinite)` → `--c-danger-strong` border; **preservar** `shake 0.5s ease 3` (3 ciclos = OK vestibular).
- `prefers-reduced-motion` mata `urgentPulse`/`stockoutPulse`/`criticalPulse`/`crossCancelPulse` infinitos.
- **Preservar**: audio alerts (Web Audio at 700Hz/880Hz).
- **Preservar**: split A/B columns + ready-strips `#readyA`/`#readyB`.
- Adicionar `:focus-visible` nos botões PRONTO/CANCELAR.
- Manter `#timerA`/`#timerB` na dimensão atual (22px tabular).
- GPU-safe: trocar `box-shadow` pulsing por `transform: scale(1.01)` + `opacity`.

### 7.3 `cozinha-fria.html` (~768 linhas)

- Mesmas trocas de cozinha-quente.
- Integrar cyan `#00d4ff` (h1 only) → `--c-accent-cold` (#00a8c8 desaturated).
- Estender `--c-accent-cold` para border-bottom do header.
- Preparar para uso futuro na dashboard (filtros de station, badges de cozinha_fria).
- **Preservar**: `#globalTimer` 28px top-right fixed.

### 7.4 `cozinha.html` (legacy, 481 linhas)

- Aplicar tokens + tema dark igual às outras duas.
- **Decisão**: manter no ar (debug/backup) — não desabilitar a rota `/cozinha`.
- Não tem `demand:cross-cancel` handler — deixar como está.
- Prioridade: baixa.

### 7.5 `gerente.html` (647 linhas)

- Recolorir `.badge-annulled` (ver §6.10).
- Skeleton na tabela histórico (268).
- Empty state composto em 357.
- Tabular-nums em `.metric-card p` (55), datas do calendário, durações histórico.
- **Preservar**: `.btn-admin`/`.btn-dashboard` no header.
- **Preservar**: modal `Anular` com textarea + botão disabled até preenchido (fricção intencional).

### 7.6 `admin.html` (588 linhas)

- Padronizar `.tab`/`.panel` radius para `--radius-md`/`--radius-xl`.
- Tabular-nums nos inputs de SLA.
- Skeleton nos 4 tbodies vazios (`Carregando...`).
- **Decisão**: Não adicionar empty states compostos nas tabelas CRUD (é admin — estado vazio discreto é correto).
- Sem `/styles/theme.css` linkado a nada de novo além do global.

### 7.7 `dashboard.html` (1528 linhas)

- 11 KPI cards: adicionar `.mono` (tabular-nums) nos `.kpi-value` (49).
- Botões de period-selector padronizados com `.btn-ghost`.
- Score cards (entity performance 0-5) ganham `.mono`.
- **Heatmap**: MANTER comportamento atual (números só no hover). Decisão do operador.
- Canvas drawings (15+ charts) **não redesenhados**. Ajuste de font-family/size nos textos drawn só se trivial via `ctx.font = '14px "JetBrains Mono"'`. Caso contrário manter.
- 10 `alert()` (todas as linhas: 1279, 1281, 1282, 1284, 1322, 1431, 1437, 1447, 1474, 1500) viram `.toast-error` ou `.toast-warn` conforme a natureza (validação de form vs erro de execução).
- Não há `confirm()` no dashboard — as 3 chamadas existentes estão todas em `admin.html` e viram `.modal` conforme §6.6.
- Empty state composto para "Sem dados no período" no painel de KPIs.

## 8. Padding — implementação por fases

### Fase 1 — Tokens (afeta todas as views mas sem mudança visual perceptível)
1. `npm install @fastify/static` + tipos.
2. Criar `src/views/styles/theme.css`.
3. Registrar `@fastify/static` em `src/server.ts` (prefix `/styles/`).
4. Adicionar `<link rel="stylesheet" href="/styles/theme.css">` no `<head>` das 7 views.
5. Adicionar `<link href="..." rel="preload" as="style">` para JetBrains Mono.
6. `npx tsc --noEmit` — deve passar.
7. `npm run dev` e verificar visualmente via Playwright/Webwright que **nada mudou** (tokens ainda não referenciados no CSS inline).

### Fase 2 — Refatoração visual (por view, na ordem abaixo)
1. **salao.html** — botões para `.btn`, badges para `.badge-pill`, cards para `.card-base`, sombras para tokens.
2. **cozinha-quente.html** — cards-dark para `.card-base-dark`, eliminar `#ff0000`, tabular-nums em timers (já OK), `:focus-visible`.
3. **cozinha-fria.html** — idem + integrar `--c-accent-cold`.
4. **gerente.html** — recolorir `.badge-annulled`, tabular-nums nas KPI cards.
5. **admin.html** — padronizar `.tab`/`.panel` radius, tabular-nums SLA inputs.
6. **dashboard.html** — `.mono` em 11 KPI values + score cards, `.btn-ghost` em period-selector.
7. **cozinha.html (legacy)** — tidy up minimo, baixa prioridade.

### Fase 3 — Comportamento (por view, mesma ordem)
1. Substituir `alert()` por `.toast` em todas as 7 views (helper inline `showToast`).
2. Skeleton loaders substituindo "Carregando...".
3. Empty states compostos com SVG icons.
4. `prefers-reduced-motion` já vem do theme.css — só validar que está funcionando.
5. `:focus-visible` e `:active` já vêm do theme.css — validar.

## 9. Verificação & Critérios de Aceite

### 9.1 Baseline (antes de começar)

```bash
node .agents/skills/impeccable/detect.mjs src/views/*.html > /tmp/impeccable-baseline.txt
npx tsc --noEmit
```

Registrar scores A11y/Performance/Theming/Responsive/Implementation de cada view.

### 9.2 Durante (após cada view)

- `npx tsc --noEmit` (server.ts mudou)
- `$impeccable audit <view.html>` — score deve subir, não descer
- Webwright testes no fluxo correspondente:
  - **Salao**: `POST /api/v1/demands` flui — modal Confirmar Retirada abre sem travar
  - **Cozinha-quente**: view kiosk full-screen; click PRONTO dispara `demand:ready`; toast no cross-cancel funciona
  - **Dashboard**: load KPIs via `/api/v1/analytics/dashboard`; 0 console errors (vendor CDN scripts carregam)
  - **Gerente**: histórico carrega com skeleton, anular modal não perde friction
  - **Admin**: tabs funcionam, CRUD de produto cria/altera/exclui

### 9.3 Aceite global (no fim)

- `rg "#ff0000|#4a0000" src/views/` retorna 0 resultados
- `rg "\balert\(['""]" src/views/` retorna 0 resultados (exceto em strings literais ou comentários que documentam o banimento — aceitável)
- `rg "\bconfirm\(" src/views/admin.html` retorna 0 resultados  
- `rg "prefers-reduced-motion" src/views/styles/theme.css` ≥ 1 resultado
- `rg ":focus-visible" src/views/styles/theme.css` ≥ 1 resultado
- `grep -c "border-radius: var(--radius-" src/views/*.html` dezenas de substituições (vs `border-radius: 20px` hardcoded)
- `npm run build` sem erros
- `$impeccable audit` em todas views — score total ≥ baseline
- Cores de status (verde/laranja/vermelho/roxo/cyan) **preservadas** em todos os cards e timers. Teste manual: criar demanda urgente, zerar demanda, cancelar, anular — verificar que cada estado mantém seu color-signal.
- `npm run dev` + Webwright em cada view — 0 console errors
- Audio alerts da cozinha-quente **funcionam** após mudanças (Web Audio API intacta) — `playNormalAlert`, `playUrgentAlert`, `playStockoutAlert`, `playCrossCancelAlert` invocados sem regressão.

## 10. Riscos & Mitigações

| Risco | Mitigação |
|---|---|
| `ts-node-dev` respawn não recarrega `views` (cache em `views` map) | Após mudar HTML, matar PID em `:3000` e reiniciar `npm run dev` |
| `@fastify/static` pode afetar rotas dinâmicas existentes | Registrar `@fastify/static` **antes** das rotas `/api/v1/*`. Prefix `/styles/` não conflita com rotas existentes |
| Google Fonts CDN bloqueado por rede de restaurante | `--font-mono` fallback:
`ui-monospace, 'SF Mono', Consolas, monospace` — sistema operacional fornece mono |
| Orange Pi GPU não aguenta `backdrop-filter` em modals latentes | Restringir `backdrop-filter` a `position: fixed` only — já planejado |
| Erro de TypeScript ao importar `@fastify/static` | Instalar também `@types/@fastify/static` se necessário; tipagem de plugin é padrão |
| `prefers-reduced-motion: reduce` esconder demais o estado crítico | Bloco `@media` preserva cor de fundo/borda — animação some mas semântica não |
| Webwright não cobre o áudio da cozinha | Áudio verificado manualmente após implementação, com console log |
| Modificar dashboard.html (1528 linhas) — maior blast radius | Fazer só Fase 2 na passagem 1; não tocar JS de canvas drawing |

## 11. Fora de Escopo

- Não redesenhar canvas drawings (`drawMaChart`, `drawQueueHourChart`, etc.) — manter geometria e cores existentes dos gráficos.
- Não migrar CSS para Tailwind/SCSS — manter vanilla CSS + tokens.
- Não criar `src/` de framework JS (React/Vue) — manter vanilla JS inline.
- Não tocar em `/dashboard` Python/Streamlit (é sidecar separado).
- Não adicionar favicon/branding — é B2B ferramenta, não marca.
- Não adicionar dark mode toggle — views já têm tema fixo por função.
- Não trocar a fonte Inter por Geist/IBM Plex (decisão do operador).
- Não adicionar i18n/RTL — só pt-BR.

## 12. Notas de Manutenção Futura

- Todas as novas views devem `<link rel="stylesheet" href="/styles/theme.css">` antes do inline `<style>`.
- Sempre referenciar tokens (`var(--c-*)`, `var(--sp-*)`) no CSS inline — nunca hardcoded.
- Novos status devem adicionar `--c-status-X` no `theme.css`, não na view.
- Animações infinitas fora de `prefers-reduced-motion: reduce` só com justificativa em comentário no CSS.
- `alert()` e `confirm()` — proibidos; usar `.toast` e `.modal` respectivamente.
- Estados vazios — sempre usar `.empty-state` com ícone + título + subtítulo (ou ação).
- Novos KPIs numéricos — sempre `.mono` para tabular-nums.

## 13. Skills Inovocadas Durante Implementação

- `impeccable` — invocar via `skill` tool para `$impeccable audit`, `$impeccable quieter`, `$impeccable animate`, `$impeccable polish` durante as fases 2 e 3.

## 14. Skills Consultadas mas NÃO Inovocadas (com razão)

- `high-end-visual-design` — alvo marketing Awwwards; 5 guardrails foram extraídos manualmente.
- `design-taste-frontend v2` — seção 13 declara dashboards fora de escopo; 8 regras avulsas aplicadas.
- `design-taste-frontend-v1` — superseded pela v2; 2 regras extras aplicadas.
- `industrial-brutalist-ui` — degradação analítica quebra cor-status; doutrina "cor = recurso escasso" aplicada.
- `minimalist-ui` — light editorial ban Inter; só doutrina "cor = semântica apenas" aplicada.

## 15. Após Concluir

- Commit atómico por view (7 commits) + 1 commit para `theme.css` + `server.ts`.
- Verificar com `git diff` que nenhum `alert()`, `#ff0000` ou `border-radius: 20px` hardcoded restou.
- Não gerar PR automaticamente — só quando explicitamente requested.