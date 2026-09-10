# Observações do salão (runtime, sem DB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atendente do salão anexa observação curta (máx. 50 chars) à demanda na criação; cozinheiros veem faixa de alto contraste no card em todas as cozinhas e temas, com letreiro se transbordar; nada persiste no DB.

**Architecture:** Novo `src/services/observation.service.ts` (Map em memória). `POST /demands` valida e guarda; `GET /` e `/cancelled-cozinha` mesclam; transições terminais limpam. Salão ganha checkbox+input+contador; 3 HTMLs de cozinha ganham `.obs-strip` com mesmas cores fixas.

**Tech Stack:** TypeScript strict (Fastify), vanilla HTML/CSS/JS views, Socket.IO, Playwright via Python313 + Chromium.

## Global Constraints

- Todo texto de UI, erro e commit em pt-BR.
- TypeScript strict; `npx tsc --noEmit` limpo após qualquer mudança em `src/**/*.ts`.
- SQL só com placeholders `$1` (pg); esta feature NÃO cria migration nem coluna.
- Nunca `.catch(function() {})` vazio — sempre `console.error` + estado de erro na UI.
- PowerShell: sem `node -e` inline (arquivo `.mjs`/`.py`); `curl.exe -d` só com `-d @arquivo`; sem `Content-Type` quando não há corpo.
- Servidor dev em background via `Start-Process` + poll `/health` (nunca `Start-Job`).
- Demandas de teste: criar no mesmo dia com `notes: 'WW-...'` e anular após via `POST /api/v1/admin/demands/:id/annul`.
- `observation` nunca entra no INSERT nem em nenhum UPDATE do `demands`.

---

### Task 1: Serviço em memória + tipos

**Files:**
- Create: `src/services/observation.service.ts`
- Modify: `src/types.ts:206-215` (`CreateDemandBody`), `src/types.ts:116-153` (`Demand`)

**Interfaces:**
- Consumes: nada (novo módulo isolado).
- Produces: `setObservation(id: string, text: string): void`, `getObservation(id: string): string | undefined`, `clearObservation(id: string): void` — usados pela Task 2.

- [ ] **Step 1: Criar o serviço**

```typescript
// Guarda as observações do salão somente em runtime (sem DB).
// Restart do servidor apaga tudo — comportamento esperado (ver spec).
const observations = new Map<string, string>();

export function setObservation(id: string, text: string): void {
  if (!id || !text) return;
  observations.set(id, text);
}

export function getObservation(id: string): string | undefined {
  if (!id) return undefined;
  return observations.get(id);
}

export function clearObservation(id: string): void {
  if (!id) return;
  observations.delete(id);
}
```

- [ ] **Step 2: Estender os tipos** — em `CreateDemandBody`, após `notes?: string;`, adicionar `observation?: string;`. Na interface `Demand`, após `notes: string | null;` (linha 128), adicionar `observation?: string | null;` com comentário `// Runtime (nunca vem do banco — mesclado via observation.service)`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (sem erros).

- [ ] **Step 4: Commit**

```bash
git add src/services/observation.service.ts src/types.ts
git commit -m "feat: serviço de observações em memória + tipos"
```

---

### Task 2: API — POST valida/guarda, GETs mesclam, transições limpam

**Files:**
- Modify: `src/routes/demands.ts` (POST `/` schema + handler, GET `/`, GET `/cancelled-cozinha`, PATCH `/:id/retrieve`, PATCH `/:id/cancel-salao`, PATCH `/:id/cancel-cozinha`)
- Modify: `src/routes/admin.ts` (POST `/demands/:id/annul` e POST `/demands/:id/annul-step` — limpar após UPDATE confirmado)

**Interfaces:**
- Consumes: `setObservation/getObservation/clearObservation` da Task 1.
- Produces: campo `observation` nos JSONs de demanda (criação, listagens, eventos socket que carregam o objeto).

- [ ] **Step 1: Schema do POST** — em `demands.ts:97-114`, adicionar à `properties` do body: `observation: { type: 'string', maxLength: 50 }`.

- [ ] **Step 2: Validar no handler do POST** — desestruturar `observation` junto aos demais campos (após `notes = null`). Antes do INSERT, normalizar:

```typescript
const observationText = typeof observation === 'string' ? observation.trim() : '';
if (observationText.length > 50) {
  return reply.code(400).send({ error: 'Observação com no máximo 50 caracteres' });
}
```

NÃO incluir no INSERT (lista de colunas permanece igual). Após o INSERT e antes dos `emit`s, se `observationText` não-vazio: `setObservation(newDemand.id, observationText);` e anexar ao objeto emitido/respondido:

```typescript
const created = observationText
  ? { ...newDemand, observation: observationText }
  : newDemand;
```

Usar `created` no `reply.code(201).send(created)` e nos 4 `emit`s (`room`, `salao`, `gerente`, `cozinha`).

- [ ] **Step 3: Mesclar nos GETs** — em `GET /` (após `const demands = await query...`), antes do `return`:

```typescript
for (const d of demands) {
  const obs = getObservation(d.id);
  if (obs) d.observation = obs;
}
```

Idem em `GET /cancelled-cozinha` (variável `rows`).

- [ ] **Step 4: Limpar nas transições** — após cada UPDATE confirmado: em `retrieve` (após `retrievedRows` ok), em `cancel-salao` (após `cancelled` ok), em `cancel-cozinha` (após `cancelled` ok): `clearObservation(id);`. Em `admin.ts` nas duas rotas de annul, após o UPDATE bem-sucedido: `clearObservation(id);` (importar de `../services/observation.service`). Regra: limpeza DEPOIS da persistência confirmada, nunca antes.

- [ ] **Step 5: Typecheck + teste funcional via harness** — `npx tsc --noEmit` PASS. Escrever `scripts/tmp-obs-check.mjs` (apagar após): cria demanda com `observation: 'WW sem cebola'` via `POST /api/v1/demands`, confere `observation` na resposta; `GET /api/v1/demands` contém; `PATCH retrieve` + `GET` não contém; POST com 51 chars → 400. Anular a demanda de teste ao final.

- [ ] **Step 6: Commit**

```bash
git add src/routes/demands.ts src/routes/admin.ts
git commit -m "feat: observações do salão na API (runtime, sem DB)"
```

---

### Task 3: Salão — checkbox, caixa de texto, contador, envio, lista

**Files:**
- Modify: `src/views/salao.html` (CSS ~linhas 29-63/288-289, form linhas 325-335, JS submit 1049-1126, `renderDemands` 588-619)

**Interfaces:**
- Consumes: `POST /demands` com `observation` da Task 2.
- Produces: nada (ponta de entrada).

- [ ] **Step 1: HTML do form** — após o bloco Urgente/Troca (linha 325-328), inserir:

```html
<div style="margin-bottom: var(--sp-4);">
    <label style="margin-bottom: var(--sp-2);"><input type="checkbox" id="hasObservation"> Observação</label>
    <input type="text" id="observationInput" maxlength="50" disabled placeholder="Ex.: sem cebola, ponto mal passado" style="margin-bottom: 4px;">
    <small id="obsCounter" style="font-size: 11px; color: var(--c-text-muted);">0/50</small>
</div>
```

- [ ] **Step 2: JS toggle + contador** — junto aos listeners (após o bloco `isReplacementEl`, ~linha 1047):

```javascript
var hasObsEl = document.getElementById('hasObservation');
var obsInputEl = document.getElementById('observationInput');
var obsCounterEl = document.getElementById('obsCounter');
if (hasObsEl && obsInputEl) hasObsEl.addEventListener('change', function() {
    obsInputEl.disabled = !this.checked;
    if (this.checked) { obsInputEl.focus(); }
    else { obsInputEl.value = ''; if (obsCounterEl) obsCounterEl.textContent = '0/50'; }
});
if (obsInputEl) obsInputEl.addEventListener('input', function() {
    if (obsCounterEl) obsCounterEl.textContent = String(obsInputEl.value.length) + '/50';
});
```

- [ ] **Step 3: Envio + reset** — no `payload` do submit (~linha 1063-1069), após `priority`: ler `hasObservation`/`observationInput`; se marcado e trim não-vazio, `payload.observation = texto`. No reset de sucesso (após `isUrgent`), desmarcar `hasObservation`, limpar `observationInput`, reabilitar `disabled`, zerar contador `0/50`.

- [ ] **Step 4: Lista exibe a faixa (sem letreiro)** — em `renderDemands`, no card ativo, após a linha do nome: `var obsHtml = d.observation ? '<div class="obs-strip"><span class="obs-tag">OBS</span><span class="obs-text obs-static">' + esc(d.observation) + '</span></div>' : '';` e incluir após o nome. CSS mínimo no `<style>` do salão (reutiliza as mesmas cores fixas da Task 4; `.obs-static` com `text-overflow: ellipsis; overflow: hidden; white-space: nowrap;`).

- [ ] **Step 5: Commit**

```bash
git add src/views/salao.html
git commit -m "feat: salão anexa observação à demanda (checkbox + contador)"
```

---

### Task 4: Cozinha-quente (piloto) — faixa + letreiro nos 3 visuais

**Files:**
- Modify: `src/views/cozinha-quente.html` (`<style>`, `renderGrid` card pendente ~linhas 604-655, JS pós-render)

**Interfaces:**
- Consumes: `d.observation` nos objetos de demanda (Task 2).
- Produces: padrão `.obs-strip` a replicar na Task 5.

- [ ] **Step 1: CSS (cores FIXAS, iguais nos 3 visuais)** — no `<style>`, junto aos badges:

```css
.obs-strip {
    display: flex; align-items: center; gap: 8px;
    background: #f59e0b; border: 1px solid #b45309; border-radius: 8px;
    padding: 8px 10px; margin-top: 8px; overflow: hidden;
}
.obs-tag {
    flex: none; background: #1c1005; color: #fbbf24;
    font-size: 11px; font-weight: 800; letter-spacing: 0.6px;
    padding: 2px 8px; border-radius: 999px;
}
.obs-text {
    flex: 1; min-width: 0; color: #1c1005;
    font-size: 15px; font-weight: 700; line-height: 1.35;
    white-space: nowrap; overflow: hidden;
}
.obs-text.marquee { animation: obsMarquee 6s linear infinite; }
@keyframes obsMarquee {
    0% { transform: translateX(0); }
    15% { transform: translateX(0); }
    85% { transform: translateX(calc(-100% + 120px)); }
    100% { transform: translateX(calc(-100% + 120px)); }
}
@media (prefers-reduced-motion: reduce) { .obs-text.marquee { animation: none; } }
```

Nada de `data-theme`/`data-shift` aqui: as cores são literais de propósito.

- [ ] **Step 2: Render no card** — em `renderGrid`, após `replacedInfo` (~linha 624), declarar `const obsHtml = d.observation ? `<div class="obs-strip"><span class="obs-tag">OBS</span><span class="obs-text">${esc(d.observation)}</span></div>` : '';` e incluir `${obsHtml}` logo após `${replacedInfo}` no template (posição fixa: sempre abaixo do nome do produto).

- [ ] **Step 3: Letreiro por overflow** — ao final de `renderGrid` (após montar `grid.innerHTML`, antes do `setInterval`), medir e marcar:

```javascript
grid.querySelectorAll('.obs-text').forEach(function(el) {
    if (el.scrollWidth > el.clientWidth + 2) el.classList.add('marquee');
});
```

- [ ] **Step 4: Validar no navegador (dev local)** — subir dev (`Start-Process` + poll `/health`), criar demanda com obs de 50 chars via harness, abrir `/cozinha-quente` com `?theme` claro/escuro e turno jantar (3 combos), screenshot + leitura visual: faixa âmbar legível, posição fixa, letreiro rolando só no texto longo. Corrigir e repetir até ok.

- [ ] **Step 5: Commit**

```bash
git add src/views/cozinha-quente.html
git commit -m "feat: faixa de observação nos cards da cozinha quente (+jantar)"
```

---

### Task 5: Replicar em cozinha.html e cozinha-fria.html

**Files:**
- Modify: `src/views/cozinha.html` (render ~linhas 352-427), `src/views/cozinha-fria.html` (render ~linhas 450-535)

**Interfaces:**
- Consumes: padrão `.obs-strip` da Task 4 (copiar CSS e trechos — mesma cor/posição/comportamento).
- Produces: paridade visual nas 3 cozinhas.

- [ ] **Step 1: cozinha.html** — mesmo CSS do Step 1 da Task 4; mesmo `obsHtml` após o nome/bloco de substituição; mesma medição de overflow pós-render.

- [ ] **Step 2: cozinha-fria.html** — idem Step 1.

- [ ] **Step 3: Validar as 3 cozinhas × 3 visuais** — matriz completa (quente/fria/geral × escuro/claro/jantar = 9 screenshots em `outputs/obs-salao/`): faixa presente quando há obs, ausente quando não há, sem quebra de layout, sem regressão nos badges existentes.

- [ ] **Step 4: Commit**

```bash
git add src/views/cozinha.html src/views/cozinha-fria.html
git commit -m "feat: faixa de observação nas cozinhas geral e fria"
```

---

### Task 6: Validação E2E + edge cases (tudo verde antes do deploy)

**Files:** só harnesses temporários (apagar após) + `outputs/obs-salao/` (evidência).

- [ ] **Step 1: `tsc` + regressão API** — `npx tsc --noEmit` PASS. Harness `.mjs`: criar SEM obs (card sem faixa, resposta sem campo); COM obs (socket `demand:new` contém); obs só-espaços → ignorada; 51 chars → 400; XSS `<script>alert(1)</script>` → resposta contém literal e cozinha renderiza escapado; F5 cozinha → obs volta via GET; `ready` mantém obs; `retrieve` → GET não contém; anular demandas `WW-`.

- [ ] **Step 2: WebWright todas as telas** — roteiro `outputs/obs-salao/run_obs.py` (Python313 + Chromium, 1280x1800, sem full_page): salão (checkbox desabilitado→habilita, contador conta, envio com obs mostra faixa na lista) + 9 combos cozinha×tema (screenshots nomeados `quente-dark.png`, `fria-light.png`, `geral-dinner.png` etc.) + conferência visual de contraste/posição/letreiro.

- [ ] **Step 3: Auditoria final** — `git status`/`git diff` revisados (sem segredos, sem `notes` tocado, sem migration); confirma que `observation` não aparece em nenhum SQL.

- [ ] **Step 4: Push + deploy** — `git push origin main`, Oracle: `git pull` + `docker compose up -d --build`, poll `/health`, spot-check `/salao` + 1 cozinha em produção; anular resíduos de teste.

## Self-Review

1. **Spec coverage:** §3.1→Task 1; §3.2→Task 2 (POST/GETs/limpeza); §3.3→Task 3; §3.4→Tasks 4-5 (cores fixas, posição, letreiro, reduced-motion, esc, ready-strip sem obs); §4→sem tarefa (nenhum evento novo — coberto na Task 2); §6→Tasks 2+6; §7→Task 6; §8→aditivo, sem migração de telas antigas.
2. **Placeholders:** nenhum TBD/TODO; códigos prontos em cada step; comandos exatos.
3. **Tipos:** `observation?: string` (criação) e `observation?: string | null` (Demand) usados com o mesmo nome em API, socket e views.
