# Histórico Real por Evento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O painel de histórico do gerente passa a mostrar uma linha por demanda do dia com sequencial `#001` e expansão do passo a passo real (criada, zerada, pronta, retirada, SLA, cancelada, anulada, jantar), com filtro por dia + busca e exportação CSV do dia.

**Architecture:** Reaproveita a tabela `demand_events` existente como fonte única; o endpoint `GET /api/v1/demands/history` passa a aceitar `?date=&q=` e retornar demandas do dia BRT com `daily_seq` calculado via `ROW_NUMBER()` mais `events[]` aninhados; o `gerente.html` renderiza tabela agrupada expansível e gera o CSV no cliente a partir dos dados em tela.

**Tech Stack:** Fastify + pg (`$1` params), vanilla HTML/CSS/JS em `src/views/gerente.html`, `demand_events.service.ts`, Playwright via skill `webwright` (`outputs/historico-real/`), `npx tsc --noEmit`, `npx ts-node --transpile-only` para scripts temporários.

## Global Constraints

- Todo o código, UI, mensagens de erro, comentários e docs novos em Brazilian Portuguese (pt-BR).
- TypeScript strict mode; interfaces compartilhadas vivem em `src/types.ts`; queries pg usam `$1` (nunca `?`).
- HTML/CSS/JS de views são lidos do disco a cada request em dev (sem restart); mudança em `.ts` exige restart do dev server e `npx tsc --noEmit` zerado.
- RBAC: rota `/api/v1/demands/history` segue no hook global autenticado; sem `preHandler` novo (gerente/admin/salão/cozinha autenticados podem ler, como hoje).
- Socket: nunca remover `io.use` nem as salas por papel em `src/socket/handlers.ts`.
- Nunca usar `.catch(function() {})` vazio; sempre logar e mostrar estado de erro na UI.
- `buildContent`/render de tabela sempre em try/catch com estado de erro visível (sem spinner infinito).
- PowerShell mangla `node -e` inline: usar arquivo `.ts` temporário + `npx ts-node --transpile-only`.
- Porta 3000 pode estar presa: `taskkill /PID <pid> /F` antes de subir dev com `Start-Process cmd -ArgumentList "/c npm run dev"`.
- PROIBIDO commit, push ou deploy sem permissão explícita do usuário nesta feature. Passos de "commit" abaixo significam apenas gate de revisão local.
- Fuso do dia é sempre `America/Sao_Paulo` (BRT), como `/cancelled-cozinha` já faz.

---

## File Structure

- Modify: `src/routes/demands.ts:617-627` — estende `GET /history` com `?date=&q=`, `daily_seq` e `events[]`.
- Modify: `src/types.ts:116-174` — adiciona `DemandHistoryRow` e `DemandHistoryEvent` (sem quebrar `Demand`/`DemandEvent`).
- Modify: `src/views/gerente.html:282-294,429-453` — barra dia+busca+exportar, tabela `# | Produto | Qtd/Un | Status | Criada em | +`, linha expansível timeline, CSV cliente.
- Create (temporário, remover no fim): `_tmp_history_check.ts` — checagem TDD da query via ts-node.
- Create (evidência): `outputs/historico-real/plan.md`, `outputs/historico-real/final_runs/run_<id>/final_script.py` + screenshots + log (padrão webwright).

---

### Task 1: Backend — `/history` com `daily_seq` + `events[]` + `?date=&q=`

**Files:**
- Modify: `src/routes/demands.ts:617-627`
- Modify: `src/types.ts:154-173`
- Test: `_tmp_history_check.ts` (criar na raiz, remover ao final)

**Interfaces:**
- Consumes: `query<T>(text, params)` de `src/db/client.ts:71-78`; `Demand`, `DemandEvent`, `DemandEventType` de `src/types.ts`.
- Produces: `GET /api/v1/demands/history?date=YYYY-MM-DD&q=texto` retorna `DemandHistoryRow[]`; `DemandHistoryRow = Demand & { daily_seq: number; replaced_name: string | null; events: DemandHistoryEvent[] }`; `DemandHistoryEvent = { event_type: DemandEventType; actor: string | null; notes: string | null; created_at: string }`.

- [ ] **Step 1: Escrever o teste falhando (`_tmp_history_check.ts`)**

```ts
// _tmp_history_check.ts — roda com: npx ts-node --transpile-only _tmp_history_check.ts
import './src/db/client';
import { query } from './src/db/client';

async function main(): Promise<void> {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const res = await fetch(`http://localhost:3000/api/v1/demands/history?date=${date}&q=`);
  if (!res.ok) throw new Error('history falhou: ' + res.status);
  const rows = await res.json() as any[];
  if (!Array.isArray(rows)) throw new Error('history não retornou array');
  const first = rows[0];
  if (first && (typeof first.daily_seq !== 'number' || !Array.isArray(first.events))) {
    throw new Error('formato antigo: sem daily_seq/events');
  }
  const created = (first?.events || []).filter((e: any) => e.event_type === 'created').length;
  if (rows.length > 0 && created === 0) throw new Error('sem evento created sintetizado');
  console.log(`OK history: ${rows.length} demandas em ${date}`);
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU (esperado no RED):', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar o teste e ver falhar (RED)**

Run: `npx ts-node --transpile-only _tmp_history_check.ts`
Expected: FAIL com `formato antigo: sem daily_seq/events` (prova que testa o formato novo).

- [ ] **Step 3: Implementação mínima no backend**

Em `src/types.ts`, após `DemandEvent`, adicionar:

```ts
export interface DemandHistoryEvent {
  event_type: DemandEventType;
  actor: 'salao' | 'cozinha' | 'sistema' | null;
  notes: string | null;
  created_at: string;
}
export interface DemandHistoryRow extends Demand {
  daily_seq: number;
  events: DemandHistoryEvent[];
}
```

Em `src/routes/demands.ts`, substituir o bloco `fastify.get('/history', ...)` atual por:

```ts
fastify.get('/history', async (request, reply) => {
  try {
    const q = request.query as { date?: string; q?: string };
    let day: string;
    if (q.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
        return reply.code(400).send({ error: 'Data inválida. Use o formato YYYY-MM-DD' });
      }
      day = q.date;
    } else {
      const [today] = await query<{ day: string }>(
        `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS day`
      );
      day = today.day;
    }
    const rawQ = (q.q || '').trim();
    const seqQ = rawQ.replace(/^#/, '').trim();
    const seqNum = /^[0-9]+$/.test(seqQ) ? parseInt(seqQ, 10) : null;

    const ranked = await query<Demand & { daily_seq: number }>(
      `WITH ranked AS (
         SELECT d.*,
           ROW_NUMBER() OVER (
             PARTITION BY (d.created_at AT TIME ZONE 'America/Sao_Paulo')::date
             ORDER BY d.created_at, d.id
           ) AS daily_seq
         FROM demands d
         WHERE (d.created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
       )
       SELECT r.*, rp.name AS replaced_name
       FROM ranked r
       LEFT JOIN products rp ON rp.id = r.replaced_product_id
       ORDER BY r.created_at ASC`,
      [day]
    );
    if (ranked.length === 0) return [];
    const ids = ranked.map((d) => d.id);
    const events = await query<{ demand_id: string; event_type: DemandEventType; actor: 'salao' | 'cozinha' | 'sistema' | null; notes: string | null; created_at: string }>(
      `SELECT e.demand_id, e.event_type, e.actor, e.notes, e.created_at
       FROM demand_events e
       WHERE e.demand_id = ANY($1::uuid[])
       ORDER BY e.created_at ASC`,
      [ids]
    );
    const byDemand = new Map<string, DemandHistoryEvent[]>();
    for (const e of events) {
      const list = byDemand.get(e.demand_id) || [];
      list.push({ event_type: e.event_type, actor: e.actor, notes: e.notes, created_at: e.created_at });
      byDemand.set(e.demand_id, list);
    }
    let rows = ranked.map((d) => {
      const evs = byDemand.get(d.id) || [];
      if (!evs.some((e) => e.event_type === 'created')) {
        evs.unshift({ event_type: 'created', actor: 'salao', notes: null, created_at: (d as Demand).created_at });
      }
      return { ...d, daily_seq: Number((d as { daily_seq: number }).daily_seq), events: evs };
    });
    if (seqNum !== null) {
      rows = rows.filter((r) => r.daily_seq === seqNum || r.product_name.toLowerCase().includes(rawQ.toLowerCase()));
    } else if (rawQ) {
      const needle = rawQ.toLowerCase();
      rows = rows.filter((r) => r.product_name.toLowerCase().includes(needle));
    }
    return rows.slice(0, 200);
  } catch (error) {
    request.log.error(error);
    reply.code(500).send({ error: 'Erro ao buscar histórico' });
  }
});
```

Regras aplicadas: validação `YYYY-MM-DD` como `admin.ts:454`; dia default BRT como `/cancelled-cozinha`; `ROW_NUMBER()` particionado pelo dia BRT ordenado por `created_at, id`; `ANY($1::uuid[])` parametrizado; síntese de `created` só na leitura quando ausente; limite 200.

- [ ] **Step 4: Rodar teste + typecheck (GREEN)**

Run: `npx ts-node --transpile-only _tmp_history_check.ts`
Expected: PASS com `OK history: N demandas em YYYY-MM-DD`.

Run: `npx tsc --noEmit`
Expected: saída vazia, exit 0.

- [ ] **Step 5: Gate de revisão (SEM commit)**

Run: `git status --short` e `git diff --stat`
Expected: apenas `src/routes/demands.ts`, `src/types.ts` e `_tmp_history_check.ts` alterados. Não commitar, não dar push, não fazer deploy. Aguardar Task 2.

---

### Task 2: Painel gerente — agrupado expansível + dia + busca

**Files:**
- Modify: `src/views/gerente.html:282-294` (barra + thead)
- Modify: `src/views/gerente.html:429-453` (fetchHistory/render)
- Test: dev local `http://localhost:3000/gerente` + webwright na Task 4

**Interfaces:**
- Consumes: `GET /api/v1/demands/history?date=&q=` da Task 1; `formatTime`, `statusMap`, `esc`, `escAttr` já existentes no `gerente.html:365-393`.
- Produces: `fetchHistory()` lê `#historyDate` + `#historySearch`, renderiza linhas colapsadas com `data-seq`, expansão `history-detail-<id>` com timeline; sem quebrar modal de anulação nem sockets `829-832`.

- [ ] **Step 1: Escrever o teste falhando (checklist manual executável)**

Criar `outputs/historico-real/plan.md` com:

```markdown
# Critical Points
- [ ] CP1: /gerente mostra coluna # com sequencial do dia (#001...) na tabela de histórico
- [ ] CP2: clicar na linha expande a timeline (criada → pronta → retirada, mais zerada/SLA/cancelada quando houver)
- [ ] CP3: filtro por dia + busca por número (#007) e por produto funcionam
- [ ] CP4: demandas antigas sem evento created exibem "criada" sintetizada (sem erro de console)
- [ ] CP5: exportar dia baixa historico_YYYY-MM-DD.csv com uma linha por evento
```

Este é o RED: nenhum CP passa antes da Task 2.

- [ ] **Step 2: Confirmar RED no navegador**

Run: abrir `http://localhost:3000/gerente`, inspecionar tabela de histórico.
Expected: sem coluna `#`, sem expansão, sem barra dia/busca/exportar (CP1–CP5 desmarcados).

- [ ] **Step 3: Implementação mínima no frontend**

3a. Substituir o bloco da seção histórico por (manter `id="historyTableBody"`):

```html
<div class="section">
    <h2>Histórico de Demandas</h2>
    <div class="history-controls" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <input type="date" id="historyDate" aria-label="Dia do histórico">
        <input type="search" id="historySearch" placeholder="Buscar #007 ou produto..." aria-label="Buscar no histórico" style="flex:1;min-width:180px;">
        <button type="button" id="historyExport" class="btn-dashboard">Exportar dia</button>
    </div>
    <p id="historyError" style="display:none;color:#b91c1c;"></p>
    <table>
        <thead><tr><th>#</th><th>Produto</th><th>Qtd</th><th>Unidade</th><th>Status</th><th>Criada em</th><th></th></tr></thead>
        <tbody id="historyTableBody"></tbody>
    </table>
</div>
```

3b. Substituir `fetchHistory()` por versão com dia+busca+expansão (try/catch obrigatório, nunca spinner infinito):

```js
var EVENT_LABELS = { created: 'criada', marked_ready: 'pronta', retrieved: 'retirada pelo salão', cancelled_salao: 'cancelada (salão)', cancelled_cozinha: 'cancelada (cozinha)', stockout_reported: 'zerada', sla_breach_cozinha: 'SLA cozinha estourado', sla_breach_salao: 'SLA salão estourado', annulled: 'anulada', shift_transfer: 'transferência jantar' };
var ACTOR_LABELS = { salao: 'salão', cozinha: 'cozinha', sistema: 'sistema' };
function pad3(n) { return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
function historyDay() {
    var el = document.getElementById('historyDate');
    if (el && el.value) return el.value;
    var now = new Date();
    return now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
}
function fetchHistory() {
    var day = historyDay();
    var searchEl = document.getElementById('historySearch');
    var q = searchEl ? searchEl.value.trim() : '';
    var errEl = document.getElementById('historyError');
    if (errEl) errEl.style.display = 'none';
    api('/api/v1/demands/history?date=' + encodeURIComponent(day) + '&q=' + encodeURIComponent(q)).then(function(demands) {
        lastDemands = demands || [];
        lastHistoryDay = day;
        renderHistory(lastDemands);
    }).catch(function(err) {
        console.error(err);
        var tbody = document.getElementById('historyTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="color:#b91c1c;">Erro ao carregar histórico: ' + esc(err.message) + '</td></tr>';
        if (errEl) { errEl.textContent = 'Erro ao carregar histórico: ' + err.message; errEl.style.display = 'block'; }
    });
}
function renderHistory(demands) {
    var tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    try {
        if (!demands.length) {
            tbody.innerHTML = '<div class="empty-state"><h4>Nenhuma demanda neste dia</h4><p>Ajuste o dia ou a busca acima.</p></div>';
            return;
        }
        tbody.innerHTML = demands.map(function(d) {
            var isAnnulled = d.status === 'annulled';
            var statusCell = isAnnulled ? '<td class="cell-status"><span class="badge-annulled">ANULADA</span></td>' : '<td>' + (statusMap[d.status] || d.status) + '</td>';
            var actionCell = isAnnulled ? '<td class="cell-actions"><span style="color:#9ca3af;">—</span></td>' : '<td><button type="button" class="btn-annul" data-id="' + d.id + '">Anular</button></td>';
            var main = '<tr class="history-row" data-id="' + d.id + '" tabindex="0" style="cursor:pointer;"><td class="mono">#' + pad3(d.daily_seq) + '</td><td><strong>' + esc(d.product_name) + '</strong></td><td>' + d.quantity + '</td><td>' + esc(d.unit_label || '') + '</td>' + statusCell + '<td class="mono">' + formatTime(d.created_at) + '</td>' + actionCell + '</tr>';
            var steps = (d.events || []).map(function(e) {
                return '<li><span class="mono">' + formatTime(e.created_at) + '</span> <strong>' + esc(EVENT_LABELS[e.event_type] || e.event_type) + '</strong> <span>· ' + esc(ACTOR_LABELS[e.actor] || '—') + '</span>' + (e.notes ? '<br><small>' + esc(e.notes) + '</small>' : '') + '</li>';
            }).join('');
            var detail = '<tr class="history-detail" id="history-detail-' + d.id + '" style="display:none;"><td colspan="7"><ul style="list-style:none;padding:8px 0;margin:0;display:grid;gap:6px;">' + steps + '</ul></td></tr>';
            return main + detail;
        }).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="7" style="color:#b91c1c;">Erro ao exibir histórico.</td></tr>';
    }
}
```

3c. No bloco de listeners (perto de `historyTableBody:676`), adicionar sem remover o listener do `btn-annul`:

```js
historyTableBody.addEventListener('click', function(e) {
    if (e.target.closest('.btn-annul')) return;
    var row = e.target.closest('.history-row');
    if (!row || !row.dataset.id) return;
    var detail = document.getElementById('history-detail-' + row.dataset.id);
    if (detail) detail.style.display = detail.style.display === 'none' ? '' : 'none';
});
var historyDate = document.getElementById('historyDate');
if (historyDate && !historyDate.value) historyDate.value = historyDay();
if (historyDate) historyDate.addEventListener('change', fetchHistory);
var historySearch = document.getElementById('historySearch');
if (historySearch) { var t = null; historySearch.addEventListener('input', function() { if (t) clearTimeout(t); t = setTimeout(fetchHistory, 300); }); }
```

Manter `refreshAll()` e todos os `socket.on('demand:*', ...)` existentes.

- [ ] **Step 4: Rodar e verificar (GREEN parcial)**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: abrir `http://localhost:3000/gerente`, conferir CP1–CP4 visualmente, com console aberto sem erros.
Expected: coluna `#`, expansão por clique, dia+busca funcionais.

- [ ] **Step 5: Gate de revisão (SEM commit)**

Run: `git diff --stat`
Expected: só `src/views/gerente.html` além da Task 1. Não commitar. Aguardar Task 3.

---

### Task 3: Exportação CSV do dia (cliente, sem dependência nova)

**Files:**
- Modify: `src/views/gerente.html` (função `exportHistoryCsv` + listener `#historyExport`)
- Test: clique em Exportar + abrir CSV no Excel/Sheets

**Interfaces:**
- Consumes: `lastDemands` + `lastHistoryDay` da Task 2 (adicionar `var lastHistoryDay = '';` junto a `var lastDemands = [];`).
- Produces: download `historico_YYYY-MM-DD.csv` com cabeçalho `#;produto;qtd;un;status_atual;criada_em;evento;hora_evento;ator;detalhe`, separador `;`, BOM `\uFEFF`, aspas duplicadas em campos com `;`/`"`/quebra.

- [ ] **Step 1: Escrever o teste falhando**

Teste manual: com o dia carregado, clicar em `Exportar dia`.
Expected no RED: nada acontece (função ainda não existe).

- [ ] **Step 2: Confirmar RED**

Run: clicar em `Exportar dia` no dev local.
Expected: nenhum download (prova da ausência).

- [ ] **Step 3: Implementação mínima**

```js
function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportHistoryCsv() {
    try {
        if (!lastDemands.length) { showToast('Nada para exportar neste dia.', 'warn'); return; }
        var lines = ['#;produto;qtd;un;status_atual;criada_em;evento;hora_evento;ator;detalhe'];
        lastDemands.forEach(function(d) {
            (d.events || []).forEach(function(e) {
                lines.push([
                    '#' + pad3(d.daily_seq), d.product_name, d.quantity, d.unit_label || '',
                    (statusMap[d.status] || d.status), formatTime(d.created_at),
                    (EVENT_LABELS[e.event_type] || e.event_type), formatTime(e.created_at),
                    (ACTOR_LABELS[e.actor] || '—'), (e.notes || '').replace(/\r?\n/g, ' ')
                ].map(csvCell).join(';'));
            });
        });
        var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'historico_' + lastHistoryDay + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 500);
    } catch (err) { console.error(err); showToast('Erro ao exportar: ' + err.message, 'error'); }
}
var historyExport = document.getElementById('historyExport');
if (historyExport) historyExport.addEventListener('click', exportHistoryCsv);
```

- [ ] **Step 4: Verificar (GREEN)**

Run: clicar em Exportar, abrir o CSV.
Expected: `historico_YYYY-MM-DD.csv` abre no Excel PT-BR com colunas separadas e uma linha por evento; `#007` filtra a demanda inteira.

- [ ] **Step 5: Gate de revisão (SEM commit)**

Run: `git status --short`
Expected: sem arquivos novos além de `_tmp_history_check.ts` e `outputs/`; nada commitado.

---

### Task 4: Validação final webwright + typecheck (evidência antes de chamar o usuário)

**Files:**
- Create: `outputs/historico-real/plan.md` (da Task 2)
- Create: `outputs/historico-real/final_runs/run_<id>/final_script.py`, `screenshots/`, `final_script_log.txt`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: dev local rodando + login de teste `test_admin_pis_1788392701765@gmail.com` / `Teste123456!` (via `security.js`/`kdsGuard`).
- Produces: todos os CPs de `plan.md` marcados com screenshot + linha de log como prova.

- [ ] **Step 1: Escrever o plano webwright**

`outputs/historico-real/plan.md` da Task 2 Step 1 (5 CPs acima).

- [ ] **Step 2: Explorar seletores (scratch, um comando por vez)**

Run (heredoc Playwright, viewport `1280x1800`, Firefox): carregar `/login`, logar, ir a `/gerente`, imprimir snapshot ARIA de `#historyDate`, `#historySearch`, `#historyExport`, `#historyTableBody .history-row`.
Expected: seletores estáveis confirmados antes do script final.

- [ ] **Step 3: Autoria do `final_script.py` instrumentado**

Script final em `outputs/historico-real/final_runs/run_<id>/final_script.py`: reseta o log, escreve `step N action:` por interação relevante, salva screenshot por CP (`final_execution_<n>_<acao>.png`), imprime o datum final (nº de demandas/eventos do dia) no log.

- [ ] **Step 4: Execução + self-verify (obrigatório)**

Run: `python final_runs/run_<id>/final_script.py` e ler cada PNG com `Read`.
Expected: CP1–CP5 todos com evidência inequívoca (nº visível, timeline expandida legível, busca filtrando, CSV baixado). Se qualquer CP falhar, corrigir código, novo `run_<id+1>` e re-verificar. Sem "parece ok".

Run: `npx tsc --noEmit`
Expected: exit 0, sem erros.

- [ ] **Step 5: Limpeza + handoff SEM commit/push/deploy**

Run: `Remove-Item _tmp_history_check.ts` (após GREEN) e `git status --short`.
Expected: apenas `src/routes/demands.ts`, `src/types.ts`, `src/views/gerente.html`, `docs/superpowers/plans/2026-09-06-historico-real.md`, `outputs/historico-real/` modificados/ novos, tudo ainda local. Chamar o usuário para avaliar no dev local e autorizar (ou não) commit + deploy em mensagem separada.

---

## Self-Review

1. **Spec coverage:** sequencial do dia (Task 1 `daily_seq`), linha por demanda + expansão por evento criada/zerada/pronta/retirada/SLA/cancelada/anulada/jantar (Tasks 1–2), dia + busca `#`/produto (Tasks 1–2), exportação CSV do dia (Task 3), webwright + tsc + sem subir sem ok (Task 4 + Global). Cobertura total.
2. **Placeholder scan:** nenhum `TBD/TODO`, nenhum "similar à Task N" — códigos SQL/TS/JS completos e comandos exatos em cada passo. Corrigido inline.
3. **Type consistency:** `DemandHistoryRow`/`DemandHistoryEvent` definidos uma vez na Task 1 e reutilizados nas Tasks 2–3 (`daily_seq`, `events`, `EVENT_LABELS`, `lastDemands`, `lastHistoryDay` com os mesmos nomes em todos os passos).
