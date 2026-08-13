# Aba "Jantar" no Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma aba/toggle **"Almoço (Geral) | Jantar"** ao dashboard nativo (`dashboard.html`) que isola as métricas do turno jantar (estação `kitchen_station_id = 'jantar'`) sem alterar o modo geral.

**Architecture:** Tudo é frontend em `src/views/dashboard.html`. O backend já está pronto: `GET /api/v1/analytics/dashboard` aceita `station_id` (filtra os 18 blocos + KPIs), e `GET /api/v1/analytics/performance` já retorna a entidade `cozinha_jantar`. A mudança reusa todo o JS existente, adicionando `state.turn` (`lunch`/`dinner`), um helper `effectiveStationId()` (que injeta o `station_id` da estação jantar no modo jantar) e um par de helpers `perfEntities()`/`PERF_LABELS` que escopam as listas de entidades de performance (5 no geral, só `cozinha_jantar` no jantar).

**Tech Stack:** HTML/CSS/JS vanilla (`dashboard.html`, IIFE com `var`/`function`/`async function`), Chart.js, jsPDF, html2canvas, XLSX. Playwright (Python, `py -m playwright`) para smoke.

## Global Constraints

- **Toda UI copy, logs, erros e commits em pt-BR.**
- **Nunca** `.catch` vazio — sempre `console.error`/`console.warn` + estado de erro visível.
- **Somente `src/views/dashboard.html`** deve ser editado (nenhuma mudança de backend, nenhum outro arquivo de view, nenhum CSS externo). O estilo do toggle reusa as classes existentes `period-pill-group`/`period-btn` de `dashboard.css`; a única regra nova (`.period-btn:disabled`) vai no `<style>` inline da própria página.
- `npx tsc --noEmit` não cobre HTML (é só sanity); `npm run build` é obrigatório antes de `npm start` em produção.
- **Commits somente com autorização explícita do usuário** (regra do projeto). Os passos "Commit" são opcionais/sob aval.
- Spec de referência: `docs/superpowers/specs/2026-08-13-dinner-dashboard-design.md`.
- Decisões fechadas (não reabrir): D1–D8 da spec (toggle in-page, escopo por estação `jantar`, modo geral inalterado, `state.turn` sem persistência, performance jantar só `cozinha_jantar`, export respeita turno).
- `git status` tem MUITO untracked pré-existente (skills, outputs, logs, AGENTS.md, opencode.json etc.) — subagentes **nunca** rodam `git add`/commit/clean nem tocam nesses arquivos; só editam `dashboard.html`.

---

### Task 1: Toggle de turno + escopo de dados do `/dashboard`

**Files:**
- Modify: `src/views/dashboard.html` (linhas ~299-314, 460, 582, 1451-1456, 1490-1491, 1666-1685)

**Interfaces:**
- Consumes: `GET /api/v1/kitchen-stations` (retorna `code` em `SELECT *`), `GET /api/v1/analytics/dashboard` (aceita `station_id`).
- Produces: `#turnSelector` com botões `data-turn="lunch"`/`data-turn="dinner"`; `state.turn` (`'lunch'` default) e `state.jantarStationId` (`null` até `loadStations()` resolver); `effectiveStationId()`; no modo `dinner`, `loadDashboard()` anexa `&station_id=<id da estação jantar>` e `#stationSelect` é ocultado.

- [ ] **Step 1: Regra CSS de desabilitado (no `<style>` inline da página)**

Localizar o fechamento do bloco `<style>` (linha 292). O trecho a ancorar:

```
        @media print { .export-report { background:#090a0c !important; } }
    </style>
```

Substituir por:

```
        @media print { .export-report { background:#090a0c !important; } }
        .period-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    </style>
```

- [ ] **Step 2: Marcação do toggle (antes do `#periodSelector`)**

Ancorar a linha 299:

```html
            <div class="period-pill-group" id="periodSelector" role="group" aria-label="Período rápido">
```

Substituir por:

```html
            <div class="period-pill-group" id="turnSelector" role="group" aria-label="Turno">
                <button class="period-btn active" data-turn="lunch" aria-pressed="true">Almoço (Geral)</button>
                <button class="period-btn" data-turn="dinner" aria-pressed="false" disabled title="Estação Jantar não encontrada">Jantar</button>
            </div>
            <div class="period-pill-group" id="periodSelector" role="group" aria-label="Período rápido">
```

- [ ] **Step 3: Estado (`state.turn` e `state.jantarStationId`)**

Ancorar a linha 582:

```js
    var state = { filter: { range: 'today' }, stationId: '', lastData: null, exporting: false };
```

Substituir por:

```js
    var state = { filter: { range: 'today' }, stationId: '', lastData: null, exporting: false, turn: 'lunch', jantarStationId: null };
```

- [ ] **Step 4: `loadStations()` guarda o id da estação jantar e habilita o botão**

Ancorar a função atual (linhas 1666-1677):

```js
    function loadStations() {
        api('/api/v1/kitchen-stations').then(function(stations) {
            var sel = document.getElementById('stationSelect');
            if (!sel) return;
            sel.innerHTML = '<option value="">Todas as cozinhas</option>';
            stations.forEach(function(s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
        }).catch(function(err) {
            console.error('Erro ao carregar estações:', err);
            var sel = document.getElementById('stationSelect');
            if (sel) sel.innerHTML = '<option value="">Todas as cozinhas (erro ao carregar)</option>';
        });
    }
```

Substituir por:

```js
    function loadStations() {
        api('/api/v1/kitchen-stations').then(function(stations) {
            state.jantarStationId = null;
            for (var i = 0; i < stations.length; i++) {
                if (stations[i].code === 'jantar') { state.jantarStationId = stations[i].id; break; }
            }
            var dinnerBtn = document.querySelector('#turnSelector .period-btn[data-turn="dinner"]');
            if (dinnerBtn) {
                dinnerBtn.disabled = !state.jantarStationId;
                dinnerBtn.title = state.jantarStationId ? '' : 'Estação Jantar não encontrada';
            }
            var sel = document.getElementById('stationSelect');
            if (!sel) return;
            sel.innerHTML = '<option value="">Todas as cozinhas</option>';
            stations.forEach(function(s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
        }).catch(function(err) {
            console.error('Erro ao carregar estações:', err);
            var sel = document.getElementById('stationSelect');
            if (sel) sel.innerHTML = '<option value="">Todas as cozinhas (erro ao carregar)</option>';
        });
    }
```

- [ ] **Step 5: Helper `effectiveStationId()`**

Ancorar a linha 1451:

```js
    function filterToParams() {
```

Substituir por:

```js
    function effectiveStationId() {
        return state.turn === 'dinner' ? state.jantarStationId : state.stationId;
    }

    function filterToParams() {
```

- [ ] **Step 6: `loadDashboard()` usa `effectiveStationId()`**

Ancorar as linhas 1490-1491:

```js
        var params = filterToParams();
        if (state.stationId) params += '&station_id=' + encodeURIComponent(state.stationId);
```

Substituir por:

```js
        var params = filterToParams();
        var sid = effectiveStationId();
        if (sid) params += '&station_id=' + encodeURIComponent(sid);
```

- [ ] **Step 7: Handler do toggle + ocultar `#stationSelect` no jantar**

Ancorar o bloco do filtro de estação (linhas 1679-1685):

```js
    var stationSelect = document.getElementById('stationSelect');
    if (stationSelect) {
        stationSelect.addEventListener('change', function() {
            state.stationId = stationSelect.value;
            loadDashboard(state.filter);
        });
    }
```

Substituir por (apenas adicionando o bloco após):

```js
    var stationSelect = document.getElementById('stationSelect');
    if (stationSelect) {
        stationSelect.addEventListener('change', function() {
            state.stationId = stationSelect.value;
            loadDashboard(state.filter);
        });
    }

    // Turno (Almoço / Jantar)
    var turnSelector = document.getElementById('turnSelector');
    if (turnSelector) {
        turnSelector.addEventListener('click', function(e) {
            var btn = e.target.closest('.period-btn');
            if (!btn || btn.disabled) return;
            var turn = btn.dataset.turn;
            if ((turn !== 'lunch' && turn !== 'dinner') || state.turn === turn) return;
            state.turn = turn;
            turnSelector.querySelectorAll('.period-btn').forEach(function(b) {
                var on = b.dataset.turn === turn;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', String(on));
            });
            if (stationSelect) stationSelect.hidden = (state.turn === 'dinner');
            loadDashboard(state.filter);
        });
    }
```

- [ ] **Step 8: Menção à Cozinha Jantar no modal de critérios**

Ancorar a linha 460:

```html
            <strong>Entidades avaliadas:</strong> Cozinha Quente A, Cozinha Quente B, Cozinha Fria, Sal&atilde;o e Cozinha Geral (m&eacute;dia das cozinhas). A nota parte de 5.0 e sofre as penalidades da tabela; &eacute; recalculada a cada mudan&ccedil;a de status das demandas do dia.
```

Substituir por:

```html
            <strong>Entidades avaliadas:</strong> Cozinha Quente A, Cozinha Quente B, Cozinha Fria, Sal&atilde;o e Cozinha Geral (m&eacute;dia das cozinhas); na aba Jantar, apenas a Cozinha Jantar. A nota parte de 5.0 e sofre as penalidades da tabela; &eacute; recalculada a cada mudan&ccedil;a de status das demandas do dia.
```

- [ ] **Step 9: Verificar no navegador**

Run: `npx tsc --noEmit` (sanity, sem TS novo). Subir o app e abrir `http://localhost:3000/dashboard`:

Expected:
- O toggle `Almoço (Geral) | Jantar` aparece à esquerda do seletor de período, com "Almoço (Geral)" ativo.
- Se a estação `jantar` existir (seed no boot garante), o botão "Jantar" fica habilitado; caso contrário, desabilitado com tooltip "Estação Jantar não encontrada".
- Clicar em "Jantar" esconde `#stationSelect` e a aba de rede mostra `GET /api/v1/analytics/dashboard?...&station_id=<id jantar>`.
- Clicar em "Almoço (Geral)" restaura `#stationSelect`.

- [ ] **Step 10: Commit (somente com autorização do usuário)**

```bash
git add src/views/dashboard.html
git commit -m "feat(jantar): toggle de turno no dashboard e escopo por estação jantar"
```

---

### Task 2: Performance escopada (`cozinha_jantar` no modo jantar)

**Files:**
- Modify: `src/views/dashboard.html` (linhas ~1211-1230, 1294-1314, 1316-1374)

**Interfaces:**
- Consumes: `state.turn` (Task 1); `GET /api/v1/analytics/performance` já retorna `cozinha_jantar`.
- Produces: `var PERF_LABELS` (mapa com 6 labels) e `function perfEntities()` (retorna `['cozinha_jantar']` no jantar, as 5 entidades no geral). `renderScoreCards`, `createPerfTrendChart` e `renderPerfDetractors` passam a usar esses helpers, sem alterar o comportamento do modo geral.

- [ ] **Step 1: Helpers `PERF_LABELS` + `perfEntities()`**

Ancorar a linha 1211:

```js
    function createPerfTrendChart(canvas, data) {
```

Substituir por:

```js
    var PERF_LABELS = { cozinha_geral: 'Cozinha Geral', cozinha_quente_a: 'Quente A', cozinha_quente_b: 'Quente B', cozinha_fria: 'Fria', salao: 'Salão', cozinha_jantar: 'Cozinha Jantar' };

    function perfEntities() {
        return state.turn === 'dinner'
            ? ['cozinha_jantar']
            : ['cozinha_geral', 'cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'salao'];
    }

    function createPerfTrendChart(canvas, data) {
```

- [ ] **Step 2: `createPerfTrendChart` usa os helpers**

Ancorar as linhas 1214-1215:

```js
        var entities = ['cozinha_geral', 'cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'salao'];
        var entityLabels = { cozinha_geral: 'Cozinha Geral', cozinha_quente_a: 'Quente A', cozinha_quente_b: 'Quente B', cozinha_fria: 'Fria', salao: 'Sal\u00e3o' };
```

Substituir por:

```js
        var entities = perfEntities();
        var entityLabels = PERF_LABELS;
```

- [ ] **Step 3: `renderScoreCards` usa os helpers**

Ancorar as linhas 1298-1299:

```js
        var order = ['cozinha_geral','cozinha_quente_a','cozinha_quente_b','cozinha_fria','salao'];
        var labels = { cozinha_geral:'Cozinha Geral', cozinha_quente_a:'Quente A', cozinha_quente_b:'Quente B', cozinha_fria:'Fria', salao:'Sal\u00E3o' };
```

Substituir por:

```js
        var order = perfEntities();
        var labels = PERF_LABELS;
```

- [ ] **Step 4: `renderPerfDetractors` usa os helpers (preservando a ordem do geral)**

Ancorar as linhas 1319-1320:

```js
        var order = ['cozinha_geral','salao','cozinha_quente_a','cozinha_quente_b','cozinha_fria'];
        var labels = { cozinha_geral:'Cozinha Geral', cozinha_quente_a:'Quente A', cozinha_quente_b:'Quente B', cozinha_fria:'Fria', salao:'Sal\u00E3o' };
```

Substituir por:

```js
        var order = state.turn === 'dinner' ? ['cozinha_jantar'] : ['cozinha_geral','salao','cozinha_quente_a','cozinha_quente_b','cozinha_fria'];
        var labels = PERF_LABELS;
```

- [ ] **Step 5: Verificar no navegador**

Run: `npx tsc --noEmit` (sanity). Abrir `http://localhost:3000/dashboard`, alternar para "Jantar":

Expected:
- A seção Performance renderiza **um único** score card com `data-entity="cozinha_jantar"` e label "Cozinha Jantar".
- O gráfico "Evolução das Notas" mostra apenas a série `cozinha_jantar`.
- Alternar de volta para "Almoço (Geral)" restaura os 5 score cards (`cozinha_geral`, `cozinha_quente_a`, `cozinha_quente_b`, `cozinha_fria`, `salao`) e os 5 painéis de detratores na ordem original (geral, salão, quente A, quente B, fria).

- [ ] **Step 6: Commit (somente com autorização do usuário)**

```bash
git add src/views/dashboard.html
git commit -m "feat(jantar): performance escopada para cozinha_jantar no modo jantar"
```

---

### Task 3: Export PDF/Excel respeita o turno

**Files:**
- Modify: `src/views/dashboard.html` (linhas ~1792-1806, 1844-1856, 1908, 1978)

**Interfaces:**
- Consumes: `perfEntities()`, `PERF_LABELS`, `effectiveStationId()` (Tasks 1-2).
- Produces: `exportPerformanceHtml` e `appendPerformanceExcel` escopados; `exportPDF`/`exportExcel` no modo por dia anexam `station_id` via `effectiveStationId()` (jantar no modo jantar).

- [ ] **Step 1: `exportPerformanceHtml` usa os helpers**

Ancorar as linhas 1794-1795:

```js
        var source = perf.averages && Object.keys(perf.averages).length ? perf.averages : (perf.current || {}), order = ['cozinha_geral','cozinha_quente_a','cozinha_quente_b','cozinha_fria','salao'];
        var labels = { cozinha_geral:'Cozinha Geral', cozinha_quente_a:'Quente A', cozinha_quente_b:'Quente B', cozinha_fria:'Fria', salao:'Salão' };
```

Substituir por:

```js
        var source = perf.averages && Object.keys(perf.averages).length ? perf.averages : (perf.current || {}), order = perfEntities();
        var labels = PERF_LABELS;
```

- [ ] **Step 2: `appendPerformanceExcel` itera `perfEntities()` (não `Object.keys`)**

Ancorar a função inteira (linhas 1844-1856):

```js
    function appendPerformanceExcel(wb, perf, prefix) {
        var labels = { cozinha_geral:'Cozinha Geral', cozinha_quente_a:'Quente A', cozinha_quente_b:'Quente B', cozinha_fria:'Fria', salao:'Salão' };
        var source = perf && (perf.averages && Object.keys(perf.averages).length ? perf.averages : perf.current) || {};
        var rows = [];
         Object.keys(source).forEach(function(entity) {
             var item = source[entity] || {};
             rows.push({ Entidade: labels[entity] || entity, Nota: Number(item.final_score || 0), Demandas: Number(item.total_demands || 0), 'Estouro SLA': Number(item.sla_breaches || 0), Cancelamentos: Number(item.cancellations || 0), Roturas: Number(item.stockouts || 0) });
         });
        if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), (prefix + 'Notas Performance').substring(0, 31));
        var detractors = [];
        Object.keys(source).forEach(function(entity) { (source[entity].detractors || []).forEach(function(d) { detractors.push({ Entidade: labels[entity] || entity, Detrator: d.label, Ocorrências: Number(d.count || 0), Desconto: Number(d.deduction || 0) }); }); });
        if (detractors.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detractors), (prefix + 'Detratores').substring(0, 31));
    }
```

Substituir por:

```js
    function appendPerformanceExcel(wb, perf, prefix) {
        var labels = PERF_LABELS;
        var source = perf && (perf.averages && Object.keys(perf.averages).length ? perf.averages : perf.current) || {};
        var entities = perfEntities();
        var rows = [];
         entities.forEach(function(entity) {
             var item = source[entity] || {};
             if (!item || typeof item.final_score === 'undefined') return;
             rows.push({ Entidade: labels[entity] || entity, Nota: Number(item.final_score || 0), Demandas: Number(item.total_demands || 0), 'Estouro SLA': Number(item.sla_breaches || 0), Cancelamentos: Number(item.cancellations || 0), Roturas: Number(item.stockouts || 0) });
         });
        if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), (prefix + 'Notas Performance').substring(0, 31));
        var detractors = [];
        entities.forEach(function(entity) { ((source[entity] || {}).detractors || []).forEach(function(d) { detractors.push({ Entidade: labels[entity] || entity, Detrator: d.label, Ocorrências: Number(d.count || 0), Desconto: Number(d.deduction || 0) }); }); });
        if (detractors.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detractors), (prefix + 'Detratores').substring(0, 31));
    }
```

- [ ] **Step 3: `exportPDF` e `exportExcel` (por dia) usam `effectiveStationId()`**

Há **duas ocorrências idênticas** (linha 1908 no `exportPDF` e linha 1978 no `exportExcel`):

```js
                    var params = 'from=' + ds + '&to=' + ds + (state.stationId ? '&station_id=' + encodeURIComponent(state.stationId) : '');
```

Substituir **as duas** por (usar replace-all no editor):

```js
                    var sid = effectiveStationId();
                    var params = 'from=' + ds + '&to=' + ds + (sid ? '&station_id=' + encodeURIComponent(sid) : '');
```

- [ ] **Step 4: Verificar no navegador**

Run: `npx tsc --noEmit` (sanity). Abrir `http://localhost:3000/dashboard`, alternar para "Jantar" e exportar em PDF e Excel (consolidado e por dia):

Expected:
- O PDF/Excel da aba Jantar mostra apenas a entidade `cozinha_jantar` na seção de performance e KPIs/blocos escopados à estação jantar.
- No modo "por dia", as requisições a `/api/v1/analytics/dashboard` carregam `&station_id=<id jantar>`.

- [ ] **Step 5: Commit (somente com autorização do usuário)**

```bash
git add src/views/dashboard.html
git commit -m "feat(jantar): export PDF/Excel do dashboard respeita o turno"
```

---

### Task 4: Verificação E2E (Playwright) e build

**Files:**
- Create: `test_webwright/dinner_dashboard_e2e.py` (script one-off, padrão dos `*.py` de raiz)

**Interfaces:**
- Consumes: app rodando em `http://localhost:3000` com banco seedado (estação `jantar` garantida pelo seed). `POST /api/v1/admin/shift/dinner` e `POST /api/v1/admin/shift/lunch` (existem).

- [ ] **Step 1: Escrever o roteiro Playwright**

```python
"""E2E da aba Jantar no dashboard — evidências em final_runs/run_dinner_dash/"""
import os, json, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("KDS_BASE", "http://localhost:3000")
OUT = "final_runs/run_dinner_dash"
os.makedirs(OUT, exist_ok=True)

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
        with urllib.request.urlopen(req, data) as r: return json.load(r)
    with urllib.request.urlopen(req) as r: return json.load(r)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1200})
    page = ctx.new_page()

    stations = api("GET", "/api/v1/kitchen-stations")
    jantar = next(s for s in stations if s["code"] == "jantar")
    jantar_id = jantar["id"]

    captured = []
    page.on("request", lambda req: captured.append(req.url) if "analytics/dashboard" in req.url else None)

    page.goto(BASE + "/dashboard")
    page.wait_for_selector("#turnSelector")
    page.screenshot(path=f"{OUT}/01_almoco_inicial.png")

    # Ativa o turno jantar (idempotente) e alterna para a aba Jantar
    api("POST", "/api/v1/admin/shift/dinner")
    page.click('#turnSelector .period-btn[data-turn="dinner"]')
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/02_jantar_aba.png")

    assert page.is_hidden("#stationSelect"), "stationSelect deveria estar oculto no modo Jantar"

    dinner_reqs = [u for u in captured if "station_id=" in u]
    assert any(jantar_id in u for u in dinner_reqs), f"dashboard sem station_id do jantar: {dinner_reqs}"
    print("OK — /dashboard escopado ao jantar:", dinner_reqs[-1])

    page.wait_for_selector("#performance .score-card", timeout=15000)
    cards = page.locator("#performance .score-card")
    entities = [cards.nth(i).get_attribute("data-entity") for i in range(cards.count())]
    assert entities == ["cozinha_jantar"], f"esperado apenas cozinha_jantar, veio {entities}"
    print("OK — performance jantar:", entities)
    page.screenshot(path=f"{OUT}/03_jantar_performance.png")

    # Volta para Almoço
    page.click('#turnSelector .period-btn[data-turn="lunch"]')
    page.wait_for_timeout(1200)
    assert page.is_visible("#stationSelect"), "stationSelect deveria reaparecer no Almoço"
    page.wait_for_selector("#performance .score-card", timeout=15000)
    lunch_cards = page.locator("#performance .score-card")
    lunch_entities = [lunch_cards.nth(i).get_attribute("data-entity") for i in range(lunch_cards.count())]
    assert set(lunch_entities) == {"cozinha_geral", "cozinha_quente_a", "cozinha_quente_b", "cozinha_fria", "salao"}, lunch_entities
    print("OK — almoço restaurado:", lunch_entities)
    page.screenshot(path=f"{OUT}/04_almoco_restaurado.png")

    # Reverte o turno para lunch
    api("POST", "/api/v1/admin/shift/lunch")

    browser.close()
    print("E2E da aba Jantar concluído. Screenshots em", OUT)
```

- [ ] **Step 2: Rodar o roteiro**

```bash
py test_webwright/dinner_dashboard_e2e.py
```

Expected: saída `OK — /dashboard escopado ao jantar`, `OK — performance jantar: ['cozinha_jantar']`, `OK — almoço restaurado`, e `E2E da aba Jantar concluído`.

- [ ] **Step 3: Validação visual com o subagente image-analyzer**

Dispachar o subagente `image-analyzer` sobre as screenshots de `final_runs/run_dinner_dash/`, pedindo verificação de:
- `02`: toggle com "Jantar" ativo, `#stationSelect` ausente/oculto no header.
- `03`: seção Performance com um único card "Cozinha Jantar".
- `04`: toggle com "Almoço (Geral)" ativo, seletor de estação visível e 5 cards de performance.

Corrigir desvios visuais e repetir os steps 1-2 conforme necessário.

- [ ] **Step 4: Regressão do modo geral**

- Abrir `/dashboard` sem tocar no turno: comportamento idêntico ao anterior (5 entidades de performance, seletor de estação funcional, nenhuma menção a `cozinha_jantar`).
- Export consolidado no modo geral continua listando as 5 entidades (sem `cozinha_jantar`).

- [ ] **Step 5: Build de produção**

```bash
npm run build
```

Expected: `dist/views/dashboard.html` atualizado; `GET /dashboard` sem erro. (Necessário antes de `npm start` em produção.)

- [ ] **Step 6: Commit (somente com autorização do usuário)**

```bash
git add test_webwright/dinner_dashboard_e2e.py
git commit -m "test(jantar): e2e da aba jantar no dashboard"
```

---

## Self-Review

- **Spec coverage:** D1 (dashboard nativo) — Task 1; D2 (toggle in-page) — Task 1; D3 (escopo por estação `jantar`) — Task 1 Step 4-6; D4 (mesmas seções filtradas) — Task 1 Step 6 (reusa `/dashboard?station_id`); D5 (`state.turn` sem persistência) — Task 1 Step 3/7; D6 (performance só `cozinha_jantar`) — Task 2; D7 (modo geral inalterado) — preservado em Task 2 Step 4 (ordem dos detratores) e Task 3 Step 2 (5 entidades via `perfEntities()`); D8 (export respeita turno) — Task 3; Edge case "estação jantar ausente" — Task 1 Step 4 (botão desabilitado). Modal de critérios — Task 1 Step 8 (opcional, incluído).
- **Placeholder scan:** nenhum "TBD"/"TODO"; todos os code steps têm blocos completos.
- **Type consistency:** `PERF_LABELS`, `perfEntities()`, `effectiveStationId()`, `state.turn`, `state.jantarStationId` usados com os mesmos nomes em todas as tasks.
