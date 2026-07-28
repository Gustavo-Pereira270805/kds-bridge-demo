# Handoff — KDS Bridge Visual Redesign (após Task 7)

**Data:** 2026-07-28
**Sessão pausada em:** Task 7 (`gerente.html`) — commit `7b499fe`
**Branch:** `feat/visual-redesign` em worktree `.worktrees/visual-redesign/`
**Progresso:** 7/16 tasks completas (44%)
**Spec:** `docs/superpowers/specs/2026-07-27-kds-visual-redesign-design.md`
**Plano:** `docs/superpowers/plans/2026-07-27-kds-visual-redesign.md`
**Ledger:** `.superpowers/sdd/2026-07-27-kds-visual-redesign/progress.md`
**Briefs/Reports:** `.superpowers/sdd/2026-07-27-kds-visual-redesign/task-{N}-{brief,report}.md`

---

## 1. Estado atual

### 1.1 O que já está commitado (ordem cronológica)

| # | Commit | Arquivos | Resumo |
|---|---|---|---|
| 1 | — (no commit) | — | Verificação gate. `@fastify/static@^9.1.3` confirmado em `package.json` (pré-instalado). |
| 2 | `4d554fb` | `src/views/styles/theme.css` (NEW 182 linhas), `src/server.ts` (+6), `package.json` (build script +1 segmento) | Cria o `theme.css` com 45+ design tokens, 11 classes base (`btn`, `badge-pill`, `card-base`, `card-base-dark`, `mono`, `skeleton-block`, `empty-state**, `toast`, etc.), guarda `:focus-visible`, `:active`, `@media (prefers-reduced-motion: reduce)` global. Registra `@fastify/static` em `server.ts` servindo `/styles/*` a partir de `src/views/styles/`. Atualiza `npm run build` para copiar `src/views/styles/*` para `dist/views/styles/` — necessária para `npm start` produção. |
| 3 | `1007d19` | 7 `src/views/*.html` (+1 linha cada) | Insere `<link rel="stylesheet" href="/styles/theme.css">` no `<head>` de cada view, imediatamente após o Google Fonts `<link>`. Nenhuma mudança visual — tokens disponíveis mas não referenciados ainda. |
| 4 | `3f2ca9f` | `src/views/salao.html` (53 ±) | Substitui 32 cores hardcoded + 8 radius + 3 shadows por tokens `var(--c-*)`, `var(--radius-*)`, `var(--shadow-card)`. Adiciona `class="mono"` em `#quantity`. Preserva `role="alert"` em `#toast`, modais `Confirmar Retirada` + `Cancelar Demanda`, touch targets `min-height: 48px`, `box-shadow: 0 2px 8px rgba(0,0,0,0.15)` do botão. **Não tocou o `<script>`** — 5 `alert()` deixados para Task 12. |
| 5 | `7bcf16e` | `src/views/cozinha-quente.html` (48 ±) | Elimina 2 `#ff0000` + 1 `#4a0000`. `.card.critical`: bg `#4a0000` → `var(--alert-urgent-bg-dark)`, border `#ff0000` → `var(--c-danger-strong)`, pulse `0.8s` → `1.6s` (segurança vestibular). `.card.cross-cancelled`: border → `var(--c-danger-strong)`, `crossCancelPulse` `1s` → `1.4s`, **`shake 0.5s ease 3` preservado**. 4 keyframes (`urgentPulse`, `criticalPulse`, `stockoutPulse`, `crossCancelPulse`) reescritos de `box-shadow` para `transform: scale()`/`opacity` (GPU-safe, vital para Orange Pi). Áudio Web API (`playNormalAlert`/`playUrgentAlert`/`playStockoutAlert`/`playCrossCancelAlert`) e seus callbacks intactos. Split A/B columns + ready-strips `#readyA`/`#readyB` + timers `#timerA`/`#timerB` intatos. |
| 6 | `9ea4881` | `src/views/cozinha-fria.html` (52 ±) | Mesmas trocas de Task 5 + integração do cyan `#00d4ff` → `var(--c-accent-cold)` (#00a8c8 — levemente dessaturado para 8h de observação em parede). Cold palette tokens consistentes (`--c-bg-dark-cold` `#0a1628`, `--c-surface-dark-cold` `#0d1f3c`, `--c-border-dark-cold` `#1a3054`). `#globalTimer` 28px tabular-nums fixed top-right z-998 preservado. Modal uniformemente tokenizado (lesson de Task 5 aplicada). |
| 7 | `7b499fe` | `src/views/gerente.html` (~80 ±) | **Diferenciador da task:** `.badge-annulled` trocado de `background: #e63946; color: white;` (red-filled, semanticamente errado — anulação é neutro, excluído das métricas) para **neutro hollow** (`background: transparent`, `color: var(--c-text-muted)`, `border: 1.5px solid var(--c-text-muted)`, `border-radius: var(--radius-pill)`). `.metric-card p` (36px KPI numbers) ganha `font-family: var(--font-mono)` + `font-variant-numeric: tabular-nums` (alta glanceabilidade — sem reflow quando dígitos mudam em tempo real). `.cal-day-num` ganha `tabular-nums`. `<td>` de durações no histórico ganha `class="mono"`. `.btn-admin`/`.btn-dashboard` seguem vermelho/teal (tokenizados, NÃO neutralizados). `Anular` modal preservado com fricção `disabled`-até-textarea-preenchido. |

### 1.2 Banned literals — estado atual

| Literal | Salao | Cozinha-Quente | Cozinha-Fria | Gerente | Admin | Dashboard | Cozinha (legacy) |
|---|---|---|---|---|---|---|---|
| `#ff0000` | 0 | **0** ✓ | **0** ✓ | n/a | n/a | n/a | n/a |
| `#4a0000` | 0 | **0** ✓ | **0** ✓ | n/a | n/a | n/a | n/a |
| `#00d4ff` | n/a | n/a | **0** ✓ | n/a | n/a | n/a | n/a |
| `alert(` (DOM) | 5 (Task 12) | 1 (Task 12) | 1 (Task 12) | 1 (Task 12) | 0 | 10 (Task 11) | 0 |
| `confirm(` (DOM) | 0 | 0 | 0 | 0 | 3 (Task 13) | 0 | 0 |

### 1.3 Skills carregadas na sessão que terminou (precisam recarregar)

- `brainstorming` (usada para gerar o spec)
- `writing-plans` (usada para gerar o plano)
- `subagent-driven-development` (usada para coordenar execução)
- `using-git-worktrees` (usada para criar worktree isolada)
- `redesign-existing-projects` (in-bound — texto já no sistema prompt)

### 1.4 Skills disponíveis mas NÃO invocadas nesta sessão

- `impeccable` (8.5/10 fit no perfil "Operate") — planejada para invocação nas Tasks 11-15 (audit + extract + quieter + animate + polish)
- `code-review` — será útil na Task 16 (final whole-branch review) OU substitui o `task-reviewer-prompt.md` padronizado se preferir uma revisão de mais alto nível
- `webwright` — usada via Playwright MCP direto; pode ser carregada explicitamente em Tasks futuras para padronizar screenshots/asserts de UI
- `high-end-visual-design`, `design-taste-frontend v1/v2`, `industrial-brutalist-ui`, `minimalist-ui` — avaliadas por sub-agentes, convencionam NÃO invocar (conclusão do brainstorming); convenções extraídas já estão no `theme.css`

### 1.5 Worktree state

- **Caminho:** `C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo\.worktrees\visual-redesign`
- **Branch:** `feat/visual-redesign`
- **HEAD:** `7b499fe`
- **Working tree:** clean
- **`.env`:** gitignored; foi copiado manualmente do repositório principal para o worktree root durante Task 2. Se worktree for perdida e recriada, copie `.env` novamente (necessário para Supabase cloud connection — sem ele o dev server não arranca)
- **node_modules/:** populado por `npm install` durante worktree setup
- **dist/:** re-emERGE a cada `npm run build` (gerado, gitignored)

---

## 2. Tarefas restantes (9 tasks)

| Task | Prioridade | Arquivo(s) | O que faz |
|---|---|---|---|
| **8** | medium | `src/views/admin.html` | Padronizar `.tab`/`.panel` radius (`--radius-md`/`--radius-xl`). Tabular-nums nos inputs de SLA do CRUD de produto. (Sem mudança semântica — só tokens.) Crítico apenas para merge coerência. |
| **9** | high | `src/views/dashboard.html` (1.528 linhas — maior blast radius) | 11 `.kpi-value` ganham `.mono` + tabular-nums. Score cards ganham `.mono`. `period-btn` → `.btn-ghost`. Substituição de cores hardcoded do `<style>` por tokens. **NÃO redesenhar canvas drawings** (`drawMaChart`, etc.) — manter geometria existente. |
| **10** | low | `src/views/cozinha.html` (legacy, 481 linhas) | Tidy up mínimo: tokenize cores principais. Baixa prioridade — debug/backup, não em Orange Pi deployment. |
| **11** | high | `src/views/dashboard.html` (script) | Substituir **10 `alert()`** por `showToast(msg, kind)` helper inline. Helper tem assinatura exata definida no plano Step 2. Linhas alvo: 1279, 1281, 1282, 1284, 1322, 1431, 1437, 1447, 1474, 1500. |
| **12** | high | `salao.html` (5 alerts), `cozinha-quente.html` (1), `cozinha-fria.html` (1), `gerente.html` (1) | Substituir **8 `alert()`** total. Cada view tem seu próprio `showToast` inline (arquitetura per-view). Salao tem 5 alertas — 4 em catch blocks (`alert(err.message)`) + 1 validação. Importante: cada `alert(err.message)` é textualmente IDÊNTICO — usar contexto único no `edit`. Preservar adjacente `console.error(err)` per AGENTS.md gotcha. |
| **13** | high | `src/views/admin.html` | Substituir **3 `confirm()`** (linhas 332, 520, 568) por `.modal-confirm` com `confirmDialog(message)` async helper. Marcar cada função destroy como `async`, trocar `if (!confirm('...'))` por `if (!await confirmDialog('...'))`. Reusa padrão `salao.html:335-344` (Confirmar Retirada). Fricção intencional para exclusões irreversíveis. |
| **14** | medium | `dashboard.html:245`, `gerente.html:268`, `admin.html` 4 tbodies | Substituir "Carregando..." por `.skeleton-block` com shimmer. Em dashboard: 3 KPI skeleton cards. Em gerente admin: 4-8 skeleton rows. |
| **15** | medium | salao, cozinha-quente/fria, cozinha, gerente, dashboard | Composed empty states com SVG icon (48×48 stroke 1.5) + h4 + p + ação. Salao tem já `.empty-state` classe CSS no theme.css. Importante: aplicar sobre strings existentes (ex: `grid.innerHTML = '<div class="empty-state">Nenhuma demanda ativa</div>'`) — substituir por markup completo com `<svg>`, `<h4>`, `<p>`, opcional `<button class="btn-ghost">`. |
| **16** | high | (somente verificação + commit doc) | Verificação global: `grep "#ff0000|#4a0000" src/views/` retorna 0; `grep "\balert\(['""]" src/views/` retorna 0; `grep "\bconfirm\(" src/views/admin.html` retorna 0; `npx tsc --noEmit` 0 erros; `npm run build` ok; Webwright em cada view (0 console errors); invoke `impeccable` skill para audit delta (score ≥ baseline). Final whole-branch review com `code-review` skill (merge-base = `bf85436` que foi o setup commit no `main`). |

### 2.1 Critérios de aceite globais (validar na Task 16)

```powershell
# Zero #ff0000 / #4a0000
Select-String -Path src\views\*.html -Pattern "#ff0000|#4a0000" -AllMatches
# Expected: 0 matches

# Zero DOM alert()
Select-String -Path src\views\*.html -Pattern "\balert\(['""]" -AllMatches
# Expected: 0 matches (playNormalAlert() etc. não casam devido ao \b boundary)

# Zero confirm() em admin
Select-String -Path src\views\admin.html -Pattern "\bconfirm\(" -AllMatches
# Expected: 0 matches

# theme.css tem prefers-reduced-motion + :focus-visible
Select-String -Path src\views\styles\theme.css -Pattern "prefers-reduced-motion", ":focus-visible", "--c-danger-strong" -AllMatches
# Expected: 3 matches (cada padrão uma vez)

# Build sem erros
npx tsc --noEmit    # exit 0
npm.cmd run build   # exit 0
Test-Path dist\views\styles\theme.css  # True
```

---

## 3. Skills relevantes para os próximos passos

### 3.1 Skills a INVOCAR ao retomar

| Skill | Quando invocar | Razão |
|---|---|---|
| `subagent-driven-development` | Início da sessão de retomada | É a skill que coordena execução dos Tasks 8-16. Anuncia início: "I'm using the subagent-driven-development skill to continue execution." |
| `impeccable` | Task 11 (após showToast wiring) e Task 15 (após empty states) | `$impeccable audit src/views/*.html` dá score 0-4 por dimensão (A11y/Performance/Theming/Responsive/Impl). Compara contra baseline (que não foi registrado — capturar agora o baseline pós-Task-7 para medir regressão) |
| `code-review` | Task 16 final | Whole-branch review contra merge-base `bf85436`. Critério: standards (conformidade ao AGENTS.md) + spec (conformidade ao `2026-07-27-kds-visual-redesign-design.md`). |
| `verification-before-completion` | Antes de qualquer claim "task completa" na Task 16 | Skill anti-otimismo: roda comandos e valida output antes de declarar pronto. |
| `webwright` | Opcional em cada task | Substitui Playwright MCP. Útil se encontrar inherits confusos no browser testing (ex. theme.css não recarregando). Invocar via OpenCode `skill` tool com `name: "webwright"`. |

### 3.2 Skills a NÃO invocar (avaliadas, descartadas)

| Skill | Razão da recusa |
|---|---|
| `high-end-visual-design` (3/10 fit) | Awwwards-tier marketing; conflita com densidade kiosk. 5 guardrails extraídos manualmente. |
| `design-taste-frontend v2` (3/10) | Seção 13 do skill declara dashboards fora de escopo. 8 regras avulsas aplicadas. |
| `design-taste-frontend v1` (4/10) | Superseded pela v2; regras restantes via brainstorming. |
| `industrial-brutalist-ui` (6/10) | Degradação analítica (scanlines, halftone) quebraria cor-status a 2-3m. Doutrina "cor = recurso escasso" extraída. |
| `minimalist-ui` (3/10) | Light editorial, ban Inter, ban gradients (conflita com escolhas de operador). |
| `gpt-taste`, `stitch-design-taste`, `brandkit`, `imagegen-*`, `redesign-existing-projects` (v2 redesign) | Marketing/landing-page oriented. |
| `find-skills` | Não é necessário — já mapeamos todas as skills disponíveis. |

### 3.3 Process skills potencialmente úteis

- `systematic-debugging` — se Webwright Playwright encontrar bugs visuais não-óbvios
- `receiving-code-review` — quando o `code-review` retornar findings da Task 16
- `finishing-a-development-branch` — após Task 16 limpa, decidir merge/rebase/PR

---

## 4. Insights e padrões aprendidos (aplicar em tasks futuras)

### 4.1 Padrões arquiteturais confirmados

- **JS é inline por view** (AGENTS.md gotcha). Não criar arquivo JS compartilhado mesmo para `showToast`. Cada view tem sua cópia inline da função helper. Pode parecer DRY-violation mas preserva arquitetura — não migrar para arquivo externo.
- **CSS inline por view** + 1 shared `theme.css` (introduzido por este redesign). Tokens referenciados via `var(--c-*)`. Inline `<style>` blocks continuam existindo; O que era hardcoded agora referencia tokens.
- **Server pre-carrega views via `fs.readFileSync` em startup** (AGENTS.md gotcha). Mudar HTML exige reiniciar dev server. Snippet canônico já no Global Constraints:
  ```powershell
  $port = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
  if ($port) { taskkill /PID $port.OwningProcess /F }
  Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized
  Start-Sleep -Seconds 5
  ```
- **`await fastify.register(...)`** NÃO funciona (TS1378 — CommonJS + ES2020). Pattern do código: fire-and-register (sem await), Fastify enfileira plugins e áplica antes de `fastify.listen()` awaited em `start()`. Task 2 fez essa adaptação corretamente.
- **`@fastify/static`** já estava em `^9.1.3` quando começamos (pre-flight evitou `npm install` desnecessário). Tipos vêm embutidos no package v7+ (não precisa `@types/@fastify/static`).

### 4.2 Lições sobre half-tokenization (lesson Task 5 → aplicada Task 6)

Task 5 tokenizeou `#2a2a2a` como `var(--c-border-dark)` no `cancelReasonFree` input background, mas NÃO tokenizeou o sibling `cancelReasonSelect` com o mesmo `background: #2a2a2a`. Resultado: modal ficou "half-tokenized" — inconsistency Menor mas real.

**Regra para Tasks 8-15**: ao decidir entre tokenize vs. não, escolha um modo para o escopo inteiro. Modo "tudo" quando há valor semântico, modo "nada" quando os valores não têm token correspondente. Evite "alguns sim, alguns não" no mesmo bloco anatômico.

Task 7 aplicou a regra corretamente — Uniformizou `var(--shadow-card)`, `var(--radius-pill)`, `var(--c-primary)` em todos os siblings equivalentes.

### 4.3 Lesson sobre line drift

O plano fixou line numbers capturados no writing-time. Tasks 4-10 (Phase 2) MODIFICAM salao/cozinha-*/gerente/admin/dashboard HTML, e cada substituição +/- shift linhas. Tasks 11-15 que referenciam "alert at line 1279" ou "empty state at line 461" **PRECISAM grep-first** para achar linha atual.

Padrão confirmado (Task 12 do plano já tem essa caveat no Global Constraints). Snippet canônico:
```powershell
Select-String -Path src\views\<file>.html -Pattern "<exact-pattern>" -AllMatches
```

Por exemplo para Task 11: `Select-String -Path src\views\dashboard.html -Pattern "\balert\(['""]" -AllMatches` antes de aplicar edit em "line 1279".

### 4.4 Lesson sobre `#fff` em múltiplos contextos

`#fff` (e `#ffffff`, `white`) aparece em:
- Card surface background (light views)
- Text color on dark/red badges (e.g. `.badge.urgent { color: #fff; }`)
- Modal input value text

**Não há blanket `replaceAll:true` seguro para `#fff`**. Cada substituição precisa 3-4 linhas de contexto único. Task 4 confirmou isso — implementer usou `var(--c-surface)` em alguns backgrounds mas deixou `color: #fff` em badge text intacto. Eis o motivo do mapping table explicitar "use judgment".

### 4.5 Lesson sobre PowerShell nuance

- `npm.ps1`/`npx.ps1` frequentemente bloqueado por execution policy. Use `npm.cmd`/`npx.cmd` explicitamente.
- Para comandos que esperam `npm`, prefira `cmd /c "npm run dev"` invés de `npm` direto.
- PowerShell 5.1 doesn support `&&` chain operator. Use `;` (sequencial não-condicional) ou `cmd1; if ($?) { cmd2 }` (condicional).
- PowerShell mangou quotes em inline Node one-liners — escrever arquivo `.ts` temporário e rodar com `npx ts-node --transpile-only` (AGENTS.md gotcha).
- Worktree fresh não compartilha `node_modules/` — precisa `npm install` após `git worktree add`.

### 4.6 Lesson sobre subagent dispatches vazios

Tasks 6 e 7 tiveram primeiros dispatches que retornaram vazio (sem commit, sem report) — possivelmente por timeout ou interrupção do harness. Mitigação:
1. Após dispatch, sempre verificar `git status --short` e `git log --oneline -5` antes de prosseguir
2. Se dispatch retornou vazio, redespatchar com prompt mais enxuto (omitir redundant context, enfatizar "execução direta sem pausa para perguntas a menos que genuinely blocked") + separar steps numerados
3. Segundo dispatch teve 100% sucesso nas duas vezes (Task 6 e 7). Pattern: 2 dispatches são frequentemente necessários; não há motivo para desistir após o primeiro.

### 4.7 Padrões de commit (conventional commits observados)

- `feat:` para introduzir nova feature (theme.css, link, showToast helper)
- `refactor:` para substituição mecânica sem mudança de comportamento (cores → tokens, radius → tokens)
- `fix:` não utilizado ainda — reservado para bugs
- `style:` não utilizado — optamos por `refactor` em tasks de tokenização
- `chore:` para baseline e setup (Task 1 + plano ajustes)

Para Tasks 8-15 manter:
- Task 8: `refactor(admin): unify tab/panel radius, SLA inputs use tabular-nums`
- Task 9: `refactor(dashboard): KPI values use .mono, period-selector uses .btn-ghost, tokens`
- Task 10: `refactor(cozinha-legacy): tokenize colors, ban #ff0000`
- Task 11: `feat(dashboard): replace 10 alert() with non-blocking toast helper`
- Task 12: `feat(salao,cozinha-*,gerente): replace 8 alert() with non-blocking toast helper`
- Task 13: `feat(admin): replace 3 confirm() with accessible modal dialog`
- Task 14: `feat: skeleton loaders replace 'Carregando...' placeholders`
- Task 15: `feat: composed empty states with SVG icons + suggested action`

### 4.8 `prefers-reduced-motion` — decisão grava no theme.css

Os 4 keyframes pulse (`urgentPulse`/`criticalPulse`/`stockoutPulse`/`crossCancelPulse`) nas duas cozinha views (Tasks 5, 6) são animações infinite. O theme.css tem bloco global `@media (prefers-reduced-motion: reduce)` que:
- Mata todas as animações (`animation-duration: 0.01ms !important`)
- Mata transições (`transition-duration: 0.01ms !important`)
- **Preserva cor de fundo e border** (sem `box-shadow` override que seria removido)

Implementer NÃO precisa fazer nada novo nas views para `prefers-reduced-motion`. O theme.css lida global. Cozinheiros em Orange Pi com vestibular sensitivity podem ativar essa preferência no OS ou via `xset`/DevTools Emulate CSS media.

### 4.9 `:focus-visible` — decisão grava no theme.css

Global em theme.css:
```css
:focus-visible {
  outline: 2px solid var(--c-accent-warm);
  outline-offset: 2px;
  border-radius: inherit;
}
```

Implementer NÃO precisa adicionar `:focus` styles em views. Só REMOVER `outline: none` existente (audit confirmou em todas as views, principalmente nas duas cozinha e admin). Tasks 5 e 6 removeram automáticamente via inspeção. Para Tasks 8-10, sempre grep `outline: none` antes de commitar — se houver, remover.

---

## 5. Workflow de retomada (script de início de sessão)

### 5.1 Setup (5 minutos)

```powershell
# 1. Verifica worktree existe
$worktree = "C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo\.worktrees\visual-redesign"
if (-not (Test-Path $worktree)) {
    Write-Host "Worktree não existe — precisa recriar:"
    Write-Host "  cd C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo"
    Write-Host "  git worktree add .worktrees/visual-redesign feat/visual-redesign"
    exit 1
}

# 2. Verifica .env no worktree (gitignored, foi copiado manualmente)
if (-not (Test-Path "$worktree\.env")) {
    Copy-Item "C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo\.env" "$worktree\.env"
    Write-Host ".env copiado para o worktree"
}

# 3. Verifica branch e HEAD
Set-Location $worktree
git branch --show-current  # deve ser feat/visual-redesign
git log --oneline -3       # deve mostrar 7b499fe no topo
git status --short         # deve estar clean
```

### 5.2 Ler contexto (2 minutos)

```powershell
# Ledger compro o ponto exato onde pausamos
Get-Content "C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo\.superpowers\sdd\2026-07-27-kds-visual-redesign\progress.md"
```

Anúncio: "I'm using the subagent-driven-development skill to continue execution of the KDS visual redesign plan, picking up at Task 8."

### 5.3 Loop canônico para Task N (8-15)

Para cada task:
1. Ler brief: `task-{N}-brief.md` (se não existir para Tasks 8-15, criar a partir do plano)
2. Registrar BASE: `git rev-parse --short HEAD` (anotar em variável mental)
3. Dispatch implementer subagent (subagent_type: `general`) com brief path + report path + preservation rules + Global Constraints verbatim
4. Após DONE: gerar review package (`git diff -U8 BASE..HEAD > .superpowers/sdd/.../task-N-review-package.diff`)
5. Dispatch reviewer (subagent_type: `explore`) com brief + report + diff package + checklist específica
6. Após review clean: appenda `Task N Status: complete` ao ledger, marcar todo como completed, ir para próxima
7. Se fix loop trigger (Critical/Important findings): ver SKILL.md do subagent-driven-development — fix rounds 1-3 resume implementer, 4-5 dispatch fresh implementer com model mais capaz

### 5.4 Finalização (Task 16)

1. Rodar todos os critérios de aceite (Section 2.1 acima)
2. Invocar `impeccable` skill para audit
3. Invocar `code-review` skill (subagent_type: `general` ou `explore`) com merge-base `bf85436` — esse é o commit no `main` que antecedeu a criação do branch `feat/visual-redesign`
4. Após code-review limpo: invoke `finishing-a-development-branch` skill para decidir merge/rebase/PR
5. **NÃO push sem consentimento explícito do operador** (conventional rule)

---

## 6. Documentos de referência rápida

| Document | Path | Use |
|---|---|---|
| AGENTS.md | `C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo\AGENTS.md` | Convenções do repo + gotchas — ler antes de qualquer edição |
| Spec | `docs/superpowers/specs/2026-07-27-kds-visual-redesign-design.md` | Decisões aprovadas — autoridade para qualquer questionamento |
| Plano | `docs/superpowers/plans/2026-07-27-kds-visual-redesign.md` | 16 tasks detalhadas — Tasks 8-16 já estão todas especificadas aqui |
| Ledger | `.superpowers/sdd/2026-07-27-kds-visual-redesign/progress.md` | Diário de execução — registra cada task status, BASE/HEAD, minors deferidos |
| Briefs | `.superpowers/sdd/2026-07-27-kds-visual-redesign/task-{1..7}-brief.md` | Briefs escritos para Tasks 1-7. **Tasks 8-15 ainda não têm briefs escritos separadamente** — para essas, despachar implementer diretamente com a seção do plano + Global Constraints. |
| Reports | `.superpowers/sdd/2026-07-27-kds-visual-redesign/task-{1..7}-report.md` | Reports dos implementers (Tasks 1-7). |
| Review packages | `.superpowers/sdd/2026-07-27-kds-visual-redesign/task-{1..7}-review-package.diff` | Diffs que reviewers viram. |

---

## 7. Comandos rápidos para retomada

```powershell
# Verifica onde estamos
cd C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo\.worktrees\visual-redesign
git log --oneline -8
# Esperado:
# 7b499fe refactor(gerente): badge-annulled neutral, KPIs/calendar use tabular-nums
# 9ea4881 refactor(cozinha-fria): integrate --c-accent-cold, ban #ff0000, GPU-safe pulses
# 7bcf16e refactor(cozinha-quente): ban #ff0000, slow pulses for vestibular safety, GPU-safe transforms
# 3f2ca9f refactor(salao): replace hardcoded colors/radii/shadows with theme.css tokens
# 1007d19 feat: link shared theme.css from all 7 views
# 4d554fb feat: add shared theme.css with design tokens + @fastify/static registration
# e1b1749 chore(plan): pre-flight fixes...
# bf85436 chore: spec & plan for visual redesign...

# Confirma baseline limpa
npx.cmd tsc --noEmit  # exit 0
npm.cmd run build     # exit 0
Test-Path dist\views\styles\theme.css  # True

# Inicia dev server em background
$port = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($port) { taskkill /PID $port.OwningProcess /F }
Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized
Start-Sleep -Seconds 5
Invoke-WebRequest -Uri "http://localhost:3000/salao" -UseBasicParsing | Select-Object StatusCode
# Expected: StatusCode = 200

# Próxima task: Task 8 (admin.html)
```

---

## 8. Minors deferidos (cleanup a fazer na Task 16)

- `theme.css:182` sem trailing newline (cosmético)
- `cozinha-quente.html`: `--c-border-dark` usado como `background` no `cancelReasonFree` input (semantically odd, valor correto `#2a2a2a`)
- `cozinha-quente.html`: cancel-modal half-tokenized (`cancelReasonFree` + `confirmCancelBtn` tokens, mas `cancelReasonSelect` + parent div + `closeCancelBtn` ficaram como literals)
- `cozinha-fria.html:382` area: JS `progressColor()` retorna literal hex `'#e63946'`/`'#f4a261'`/`'#2a9d8f'` para inline `style="background"` em `.progress-fill` — pre-existing tech-debt, tokens recolor não se propagaram para essas barras de progresso
- `cozinha-fria.html`: `.reconnect-banner { color: #111 }` literal mantido (não há token mapping para neutral-text-on-warn)
- `gerente.html:193`: `.cal-today .cal-day-num { font-weight: 800 }` mantém literal enquanto sibling `.metric-card p` usa `var(--fw-heavy)` — consistência cosmética
- `gerente.html:290`: inline `style="color:#9ca3af;"` no `actionCell` do histórico — fora do escopo do brief (inline attr)
- Vários literals no `gerente.html` (`#e5e7eb`, `#fef2f2`, `#fecaca`, `#b91c1c`, `#374151`, `#f3f4f6`, `#f9fafb`, `#fff7ed`, `#28a745`, `white`) — corretamente fora do brief mapping; sem tokens correspondentes
- Em todas as views: `#333` (cozinha-quente border card default), `#666` (timer default neutral), `#777` (unit-label muted), `#aaa` (qty text color), `#ff8080` (reconnect-banner toast border) — literals que não map para brand tokens; mantidos per brief tolerance

Decision recommendation: para Task 16, ao final, avaliar esses minors em batch. A maioria é cosmético e pode ser polite-declined. Os dois mais relevantes para saneamento:
1. Half-tokenized cancel-modal em cozinha-quente (tokenize o restante ou reverter suas duas alterações)
2. JS `progressColor()` retornando literals em cozinha-fria (estende tokens ou documenta como tech-debt conhecido)

---

## 9. Como este handoff se conecta às skills futuras

| Cenário futuro | Skill a invocar | Por que |
|---|---|---|
| Continuar Task 8 | `subagent-driven-development` | Já carregada; distribui o onus de implementação a um subagent limpo por task |
| Verificação de UI via Webwright | `webwright`skill | Padroniza Playwright scripts + screenshots em `final_runs/run_<id>/`; útil se Webwright não cooperar manual |
| Audit visual pós-Task 15 | `impeccable` skill | `$impeccable audit` dá score A11y/Performance/Theming/Responsive/Impl; `$impeccable quieter` tames reds/pulses; `$impeccable polish` final pass |
| Whole-branch review final | `code-review` skill | Merge-base `bf85436`; duas sub-reviews em paralelo: standards (AGENTS.md conforms) + spec (design doc conforms) |
| Bug visuais pós-redesign | `systematic-debugging` skill | Métodologia anti-shotgun; útil se Webwright/screenshots revelam problemas não-óbvios |
| Responder code-review findings | `receiving-code-review` skill | Evita agreement performative; técnica para julgar cada finding com rigor técnico |
| Decidir merge/rebase/PR após Task 16 | `finishing-a-development-branch` skill | Ajuda a estruturar a decisão de integração |
| Próxima feature (sem redesign) | `brainstorming` skill | Mesma skill já usada para gerar spec deste redesign; segue processo explore→questions→approaches→design→spec→plan→implement |

---

## 10. Estado final estimado (pós-Task 16)

Após execução completa:

- 16 commits no branch `feat/visual-redesign` (Tasks 2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15 — uma dúzia) + 3 commits de setup já no `main` (Task 1 sem commit, plano ajustes `e1b1749` e setup `bf85436`)
- Worktree `.worktrees/visual-redesign/` pode ser mergeada para `main` ou rebase conforme decisão do operador
- Critérios de aceite da Section 2.1 светлыеam satisfeitos
- `impeccable audit` no pós-redesign com score ≥ baseline (que será capturado na Task 16 se não foi antes)
- `code-review` final limpo (sem Critical/Important sem parking com ruling)
- Operador decide: Pois merge + push? PR? só merge local?

**Branch não deve ser pushed sem instrução explícita do operador** (regra canônica). Worktree pode ser removida só após merge confirmado e `git log` no `main` mostra os commits present.

---

_Fim do handoff. Para retomar: peça "continue o plano" ou "vá para Task 8" — o agent deve ler este handoff primeiro (está em `docs/superpowers/handoffs/2026-07-28-redesign-handoff-after-task7.md`) e prosseguir conforme Section 5 acima._