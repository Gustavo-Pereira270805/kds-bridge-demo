# Dashboard do Gerente — Fuso dos Períodos e Melhorias v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o bug de fuso horário dos períodos do dashboard (que zera o "Hoje" após as 21h) e entregar 4 melhorias aprovadas: notas filtradas por estação, deltas nos KPIs, tempo de preparo por produto correto e ajustes menores de UX/dados.

**Architecture:** Novo serviço `src/services/period.service.ts` centraliza o "dia operacional BRT" (helper Node `brDay` + expressão SQL `brDayOf`) usado por `analytics.ts` e `performance.service.ts`; o frontend passa a calcular datas com `Intl`/America/Sao_Paulo e a exportar por dia com um iterador de strings; os demais itens são incrementais no endpoint `/analytics/dashboard` e no `dashboard.html`.

**Tech Stack:** Fastify + pg (`$1`), TypeScript strict, vanilla JS em `src/views/dashboard.html` (sem framework), `npx tsc --noEmit`, Playwright Python (Firefox headless) + scripts `.py` em `outputs/dashboard-cancelamentos/`, XLSX (SheetJS) e PDF (jsPDF + html2canvas) verificados com `openpyxl`/`pymupdf`.

## Global Constraints

- Todo o código, UI, mensagens de erro, comentários e docs novos em Brazilian Portuguese (pt-BR).
- TypeScript strict mode; tipos compartilhados em `src/types.ts`; queries pg com `$1` (nunca `?`).
- **Fuso:** todo dia/hora operacional em `America/Sao_Paulo` (BRT). **Nunca** usar `created_at::date` cru nem `toISOString().split('T')[0]` para datas de negócio — em produção o banco roda em **UTC** (confirmado via SSH no container) e o bug reaparece das 21h à meia-noite BRT.
- `npx tsc --noEmit` zerado após qualquer mudança em `.ts`; mudança em `.ts` exige restart do dev server (views HTML/JS valem sem restart).
- Antes de qualquer edição: `git status` limpo de surpresas; **PROIBIDO commit, push ou deploy sem permissão explícita do usuário**. Passos de "commit" deste plano = gate de revisão local.
- Nunca `.catch(function() {})` vazio; erro visível (`showToast`) e `console.error`.
- Render que monta HTML de API deve ficar em try/catch (spinner infinito é bug).
- Dev local: `PORT=3100` (a 3000 é de outro projeto), `KDS_KIOSK_IPS=127.0.0.1,::1,::ffff:127.0.0.1`; subir Postgres com `%TEMP%\opencode\start-pg.bat` e o servidor via `Start-Process cmd -ArgumentList "/c npm run dev > ... 2>&1" -WindowStyle Minimized` (ver Handoff).
- Login de teste: `gustanpereira@gmail.com` / `Gp#270805` (admin). Só via scripts locais; nunca commitar credenciais.
- Evidências/scripts Playwright ficam em `outputs/dashboard-cancelamentos/` (gitignored). Dados de teste usam prefixo `QA-*` nas `notes`.
- Verificação final SEMPRE inclui: períodos (hoje/7d/30d/custom), filtro de estação, modo Jantar, tema claro, giração de export PDF/Excel com conteúdo conferido, e consistência agregado × detalhe de TODOS os drill-downs.

---

## File Structure

- Create: `src/services/period.service.ts` — `BR_TZ`, `brDay(offset)`, `brDayOf(column)`, `shiftDay(day, delta)`.
- Modify: `src/routes/analytics.ts` — filtros/group-bys BRT em `/dashboard` e `/heatmap-details`; range BRT; `kpis.comparison`; `prep_by_product`; (remover `qty_vs_time`).
- Modify: `src/services/performance.service.ts` — `created_at::date` → BRT em `computeDailyScores` e `getDetractorDates`.
- Modify: `src/views/dashboard.html` — `brToday()`/`listDays()`; `getExportDates`; botão "Ontem"; loops de export por dia; performance escopada por estação; `renderDelta` com unidade/cor; painel "Preparo por Produto" via backend; atualizado às HH:MM + botão atualizar; % nos motivos; taxa de zerados; ordem de entidades unificada.
- Modify: `outputs/dashboard-cancelamentos/*.py` (scripts de teste/evidência; gitignored) — novos cenários de fuso e dos itens B/C/D/F.

---

### Task 1: Fuso horário (CRÍTICO) — dia operacional BRT no backend e no frontend

**Problema confirmado:** frontend monta datas com `new Date().toISOString()` (UTC) — às 22h BRT "hoje" vira o dia seguinte; backend filtra `created_at::date` no fuso da sessão — em produção (Supabase) a sessão é **UTC** (`SHOW TimeZone` = `UTC`, confirmado via SSH no container `kds-bridge`). Resultado: de 21h à meia-noite BRT o dashboard "Hoje" mostra outro recorte (praticamente vazio) — em cima do jantar. O DOW do heatmap/sazonalidade também é UTC em produção.

**Files:**
- Create: `src/services/period.service.ts`
- Modify: `src/routes/analytics.ts` (`resolveDashboardPeriod` ~51-120; steps 3, 10, 11, 13, 15, 18, 18b; `/heatmap-details` ~345; `/performance` range ~880-905)
- Modify: `src/services/performance.service.ts` (linhas com `created_at::date`: ~140, 150, 161, 167, 172, 200, 205, 211, 217, 244, 249, 254, 260, 427, 446, 460, 477 + bloco salão/operação ~500-577)
- Modify: `src/views/dashboard.html` (~990 fallback; 1869-1876 `getExportDates`; 2034 botão Ontem; 2383 e 2455 loops por dia)
- Test: `outputs/dashboard-cancelamentos/valida_fuso.py` (novo) + extensão do `e2e_dashboard.py`

**Interfaces:**
- Produces (backend): `BR_TZ = 'America/Sao_Paulo'`; `brDay(offsetDays = 0): string` (`YYYY-MM-DD` em BRT); `brDayOf(column: string): string` → `` `(${column} AT TIME ZONE 'America/Sao_Paulo')::date` ``; `shiftDay(day: string, delta: number): string`.
- Produces (frontend): `brToday(offsetDays)` → `YYYY-MM-DD` BRT; `listDays(from, to)` → array de `YYYY-MM-DD`.

- [ ] **Step 1: Criar `src/services/period.service.ts`**

```ts
// Dia operacional do restaurante: sempre America/Sao_Paulo (BRT).
// O banco de produção (Supabase) roda em UTC — usar `created_at::date` direto
// joga o "hoje" para o dia seguinte entre 21h e 24h BRT (bug do dashboard).
export const BR_TZ = 'America/Sao_Paulo';

export function brDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BR_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g: Record<string, string> = {};
  for (const p of parts) g[p.type] = p.value;
  return `${g.year}-${g.month}-${g.day}`;
}

export function brDayOf(column: string): string {
  return `(${column} AT TIME ZONE '${BR_TZ}')::date`;
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().split('T')[0];
}
```

- [ ] **Step 2: `analytics.ts` — importar e trocar a resolução do range e os filtros**

No topo, junto dos imports: `import { BR_TZ, brDay, brDayOf, shiftDay } from '../services/period.service';` (remover import não usado se `shiftDay` ficar só na Task 3 — só importar o que usar).

Em `resolveDashboardPeriod` (~51-120):
- `range === 'week'`: `dateFrom = brDay(-7); dateTo = brDay(0);`
- `range === 'month'`: `dateFrom = brDay(-30); dateTo = brDay(0);`
- default (hoje): `dateFrom = brDay(0); dateTo = dateFrom;`
- Substituir os filtros e **apagar o hack do regex** (`dateFilter.replace(/\bcreated_at\b/g, 'd.created_at')`):

```ts
  const dateFilter = dateFrom === dateTo
    ? `${brDayOf('created_at')} = $1`
    : `${brDayOf('created_at')} >= $1 AND ${brDayOf('created_at')} <= $2`;
  const dateFilterD = dateFrom === dateTo
    ? `${brDayOf('d.created_at')} = $1`
    : `${brDayOf('d.created_at')} >= $1 AND ${brDayOf('d.created_at')} <= $2`;
```

- [ ] **Step 3: `analytics.ts` — group-bys e DOW em BRT**

Substituir em todos os steps do `/dashboard`:
- Trend (3): `created_at::date AS day` → `${brDayOf('created_at')} AS day` (2 ocorrências + `GROUP BY 1`).
- Volume (10): idem.
- Sazonalidade (11): `EXTRACT(DOW FROM created_at)` → `EXTRACT(DOW FROM created_at AT TIME ZONE '${BR_TZ}')`.
- Heatmap (13): idem para o DOW (a hora já é BRT).
- Week comparison (15): `created_at::date >= $1` / `<= $2` / `(created_at::date + $5::integer)::date` / `GROUP BY created_at::date` → expressões `brDayOf` equivalentes (atenção: dentro do UNION e do `compData`).
- Replacements (18) e replacement_details (18b): `created_at::date AS day` → `${brDayOf('created_at')} AS day`; `r.created_at::date::text` → `(${brDayOf('r.created_at')})::text`.
- `/heatmap-details` (~345): `EXTRACT(DOW FROM d.created_at)::int = $N` → `EXTRACT(DOW FROM d.created_at AT TIME ZONE '${BR_TZ}')::int = $N` (a hora já é BRT; comentário do endpoint explica que agregado e detalhe usam a MESMA expressão).
- `/performance` route (range resolution ~880-905): `toISOString().split('T')[0]` → `brDay(0)` / `brDay(-7)` / `brDay(-30)` conforme a regra existente.

- [ ] **Step 4: `performance.service.ts` — mesmo tratamento**

Trocar TODOS os `created_at::date` (inclusive nos FILTER/WHERE) por `brDayOf('created_at')` (ou `brDayOf('d.created_at')` onde há alias `d`) em `computeDailyScores` e `getDetractorDates` (blocos cozinha, salão, salão jantar, operação/geral). Exemplo:

```sql
WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2 AND sla_breached_cozinha = true
  AND status != 'annulled'
```

- [ ] **Step 5: `dashboard.html` — datas BRT no frontend**

Adicionar junto dos helpers (perto de `fmtOccDate`, ~1611):

```js
    // Dia operacional BRT — o toISOString() do browser vira o dia às 21h BRT.
    function brToday(offsetDays) {
        var ms = Date.now() + (offsetDays || 0) * 86400000;
        var parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
        var g = {};
        parts.forEach(function(x) { g[x.type] = x.value; });
        return g.year + '-' + g.month + '-' + g.day;
    }

    // Iterador de dias por string (nunca Date→toISOString, que desloca o dia).
    function listDays(from, to) {
        var days = [];
        var cur = new Date(from + 'T12:00:00Z');
        var end = new Date(to + 'T12:00:00Z');
        while (cur <= end) {
            days.push(cur.toISOString().split('T')[0]);
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
        return days.length ? days : [from];
    }
```

Aplicar:
- Botão "Ontem" (~2034): `loadDashboard({ from: brToday(-1), to: brToday(-1) });`
- `getExportDates()` (~1869-1876): `today/yesterday` → `brToday(0)`/`brToday(-1)`; `week` → `{ from: brToday(-6), to: brToday(0) }`; `month` → `{ from: brToday(-29), to: brToday(0) }`; custom inalterado.
- `exportPDF` (~2378-2390) e `exportExcel` (~2450-2460): trocar a construção de `days` por `var days = listDays(from, to);` e o `var ds = days[i].toISOString().split('T')[0];` por `var ds = days[i];` (os labels de dia usam `ds.split('-')`, inalterado).

- [ ] **Step 6: `npx tsc --noEmit` + sintaxe do HTML**

```powershell
npx tsc --noEmit   # esperado: sem saída
node "$env:TEMP\opencode\check-html-js.mjs"   # esperado: SINTAXE OK (script do Handoff)
```

- [ ] **Step 7: Reproduzir/verificar com o banco em UTC (paridade com produção)**

1) `psql -h 127.0.0.1 -U kds -d kds -c "ALTER DATABASE kds SET timezone TO 'UTC';"` e **reiniciar o dev server** (conexões do pool mantêm a sessão antiga).
2) Inserir linha de borda `QA-FUSO-1` (produto Arroz Branco, quente_a) com `created_at` = 22:30 BRT de D-2 (ou seja, 01:30 UTC de D-1) via arquivo SQL (ver Handoff para o padrão de inserção; `daily_menu_id = (SELECT id FROM daily_menus ORDER BY date DESC LIMIT 1)`).
3) `outputs/dashboard-cancelamentos/valida_fuso.py` (novo, reaproveitar o helper de login de `valida_api.py`) deve assertar:
   - `GET /api/v1/analytics/dashboard?from=<D-2 BRT>&to=<D-2 BRT>` → `produtos`/total inclui `QA-FUSO-1` (produto `Arroz Branco` com 1 ocorrência a mais que a baseline);
   - `...?from=<D-1 UTC>&to=<D-1 UTC>` → NÃO inclui a linha;
   - `GET /api/v1/analytics/heatmap-details?...&from=<D-2>&to=<D-2>&dow=<BRT DOW de D-2>&hora=22` → 1 linha (`QA-FUSO-1`); a célula equivalente no DOW UTC de D-2 → 0 linhas.
   - Com o código antigo (sem o fix) o passo 3a FALHA — é o teste que reproduz o bug.

- [ ] **Step 8: E2E do relógio falso (frontend)**

No `e2e_dashboard.py`, novo bloco: criar uma **nova página** com `page.add_init_script` substituindo `Date` por uma classe que fixa "agora" em `2026-09-16T01:30:00Z` (22:30 BRT de 15/09), fazer login, clicar "Ontem" e assertar na request `**/analytics/dashboard` que `from=2026-09-14&to=2026-09-14` (e NÃO `2026-09-15`).

```python
FAKE = """
(() => {
  const fixed = new Date('2026-09-16T01:30:00Z').getTime();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
    static now() { return fixed; }
  }
  window.Date = FakeDate;
})();
"""
```

- [ ] **Step 9: Regressão completa com o banco em UTC**

Rodar `valida_api.py`, `e2e_dashboard.py`, `e2e_jantar.py`, `verifica_chips.py` (todos com `ALTER DATABASE ... UTC` ativo). Esperado: **0 falhas** em todos. Só depois disso considerar a Task 1 concluída.

---

### Task 2: Filtro de estação nas Notas/Detratores (B)

**Decisão de design:** as notas já são calculadas POR ESTAÇÃO (cada entidade `cozinha_*` agrega só as demandas daquela estação — `getDetractorDates` já filtra `ks.code`). Então, com uma estação selecionada, a seção de Performance passa a **mostrar apenas a entidade daquela estação** (com aviso "Filtro: <estação>"), em vez de mostrar todas. Salão/Operação são agregações e não fazem sentido com estação selecionada — ficam ocultas enquanto o filtro estiver ativo.

**Files:**
- Modify: `src/views/dashboard.html` (`loadStations` ~1738-1758; `perfEntities` 1579-1583; cabeçalho da seção em `loadPerformance` ~1782)
- Modify: `src/routes/analytics.ts:869-871` — remover `station_id` do destructure/tipo do `/performance` (não é usado; evita falsa impressão)

**Interfaces:**
- Consumes: `state.stations` novo (lista `{id, code}` carregada em `loadStations`).
- Produces: `function stationEntity(): string | null` e `perfEntities()` escopada.

- [ ] **Step 1: Guardar o catálogo de estações**

Em `loadStations()`: `state.stations = stations;` (adicionar `stations: []` ao objeto `state` da linha ~594). Manter `state.jantarStationId` como está.

- [ ] **Step 2: `stationEntity()` + `perfEntities()` escopada**

```js
    var STATION_ENTITY = { quente_a: 'cozinha_quente_a', quente_b: 'cozinha_quente_b', fria: 'cozinha_fria', jantar: 'cozinha_jantar' };
    function stationEntity() {
        var sid = effectiveStationId();
        if (!sid) return null;
        var st = (state.stations || []).filter(function(s) { return s.id === sid; })[0];
        return st ? (STATION_ENTITY[st.code] || null) : null;
    }

    function perfEntities() {
        if (state.turn !== 'dinner') {
            var scoped = stationEntity();
            if (scoped) return [scoped];
        }
        return state.turn === 'dinner'
            ? ['operacao', 'cozinha_jantar', 'salao_jantar']
            : ['operacao', 'cozinha_geral', 'cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'salao'];
    }
```

Isso propaga automaticamente para cards, detratores, gráfico de evolução e embalagens de export (`exportPerformanceHtml`, `appendPerformanceExcel`) porque todos usam `perfEntities()`.

- [ ] **Step 3: Aviso no cabeçalho da seção**

Em `loadPerformance` (~1782), ao montar o `<h3>Desempenho da Equipe</h3>`, incluir badge quando `stationEntity()`:

```js
var scopeBadge = stationEntity() ? '<span class="scope-badge">Filtro: ' + esc(PERF_LABELS[stationEntity()] || '') + '</span>' : '';
```

CSS: `.scope-badge { margin-left:8px; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; background:color-mix(in srgb, var(--c-accent-cold) 18%, transparent); color:var(--c-accent-cold); border:1px solid color-mix(in srgb, var(--c-accent-cold) 45%, transparent); }`

- [ ] **Step 4: Limpeza do backend**

Em `/performance` (analytics.ts ~869-871): remover `station_id` do tipo Querystring e do destructure (o frontend não envia mais nada além de `from/to`). Conferir que não há outros usos (`grep station_id` dentro do bloco da rota).

- [ ] **Step 5: Verificar**

`npx tsc --noEmit`; no E2E: com `#stationSelect` = "Cozinha Quente A" no turno Almoço → `#performance .score-card[data-entity]` tem exatamente 1 card (`cozinha_quente_a`) e o painel de detratores correspondente; voltando para "Todas as cozinhas" → 6 cards de novo. Screenshot `evidencias/14_perf_estacao.png`.

---

### Task 3: Deltas dos KPIs (C)

Os 4 cards hero já têm o slot `k.comparison.<métrica>.delta_pct`, mas o backend nunca devolve `comparison`. Implementar o comparativo com a janela anterior de mesmo tamanho.

**Files:**
- Modify: `src/routes/analytics.ts` (após os KPIs ~404-471 e no `return` ~834)
- Modify: `src/views/dashboard.html` (`renderKpis` ~714-760; CSS `.kpi-delta`)

**Interfaces:**
- Produces: `kpis.comparison = { pedidos: {delta_pct}, sla: {delta_pct}, atrasos_cozinha: {delta_pct}, atrasos_salao: {delta_pct} }`, com `delta_pct: number | null` (`null` quando a base anterior é 0). Para `pedidos`/`atrasos` é variação relativa (%); para `sla` é **diferença em pontos percentuais**.

- [ ] **Step 1: Query da janela anterior (backend)**

Reaproveitar `resolveDashboardPeriod({ from: prevFrom, to: prevTo, station_id })` (mesma estação) — assim o filtro/parâmetro é idêntico ao período atual:

```ts
        // ── 1b. Comparativo com a janela anterior de mesmo tamanho (deltas dos KPIs) ──
        const spanDays = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
        const prevTo = shiftDay(dateFrom, -1);
        const prevFrom = shiftDay(dateFrom, -spanDays);
        const prevPeriod = resolveDashboardPeriod({ from: prevFrom, to: prevTo, station_id });
        let comparison: Record<string, { delta_pct: number | null }> = {};
        if (!('error' in prevPeriod)) {
          const [prev] = await safeQuery<{
            total_pedidos: string; dentro_sla: string; atrasos_cozinha: string; atrasos_salao: string; terminadas: string;
          }>('1b.PrevKpis',
            `SELECT
               COUNT(*)::int AS total_pedidos,
               COUNT(*) FILTER (WHERE (ready_at IS NOT NULL AND status IN ('ready','retrieved')) AND sla_breached_cozinha = false)::int AS dentro_sla,
               COUNT(*) FILTER (WHERE sla_breached_cozinha = true)::int AS atrasos_cozinha,
               COUNT(*) FILTER (WHERE sla_breached_salao = true)::int AS atrasos_salao,
               COUNT(*) FILTER (WHERE status IN ('retrieved','cancelled_salao','cancelled_cozinha'))::int AS terminadas
             FROM demands
             WHERE ${prevPeriod.dateFilter} AND status != 'annulled' ${prevPeriod.stationFilter}`,
            prevPeriod.baseParams
          );
          const rel = (cur: number, base: number) => base > 0 ? Math.round(((cur - base) / base) * 1000) / 10 : null;
          const prevTerminadas = parseInt(prev?.terminadas || '0', 10);
          const prevSlaPct = prevTerminadas > 0 ? (parseInt(prev?.dentro_sla || '0', 10) / prevTerminadas) * 100 : 0;
          comparison = {
            pedidos: { delta_pct: rel(kpis.total_pedidos, parseInt(prev?.total_pedidos || '0', 10)) },
            sla: { delta_pct: prevTerminadas > 0 ? Math.round((kpis.pct_dentro_sla - prevSlaPct) * 10) / 10 : null },
            atrasos_cozinha: { delta_pct: rel(kpis.atrasos_cozinha, parseInt(prev?.atrasos_cozinha || '0', 10)) },
            atrasos_salao: { delta_pct: rel(kpis.atrasos_salao, parseInt(prev?.atrasos_salao || '0', 10)) },
          };
        }
        kpis.comparison = comparison;
```

Nota: declarar `kpis` com `comparison` (**tipar como `Record<string, any>` ou adicionar o campo antes do return** para o TS não reclamar).

- [ ] **Step 2: Frontend — unidade e cor direcional**

Em `renderKpis` (~722-735) trocar `renderDelta` por:

```js
        var renderDelta = function(delta, unit, invert) {
            if (delta == null) return '';
            var up = delta >= 0;
            var arrow = up ? '\u2191' : '\u2193';
            var cls = invert ? (up ? 'down' : 'up') : (up ? 'up' : 'down');
            return '<span class="kpi-delta ' + cls + '" title="Comparado ao per\u00edodo anterior">' + arrow + ' ' + Math.abs(delta).toFixed(1).replace('.', ',') + (unit || '%') + '</span>';
        };
```

Nos `heroCards`, passar unidade/inversão: pedidos (`'%'`, invert `false`), sla (`' pts'`, invert `false`), atrasos_cozinha e atrasos_salao (`'%'`, invert `true` — subir atraso é ruim). Manter os acessos `k.comparison` como estão.

- [ ] **Step 3: Verificar**

API: com `from/!to` da janela com dados (linhas QA), comparar valores de `comparison` com SQL manual (script `valida_api.py`, bloco novo); garantir `null` quando a janela anterior não tem base (ex.: período custom sem dados antes). E2E: no modo "Hoje" (com QA de ontem existindo) os badges aparecem com `title` e texto `↑|↓ X,X%`/`pts`; screenshot `evidencias/15_kpi_deltas.png`.

---

### Task 4: Tempo de preparo por produto correto (D)

Hoje o painel é montado no cliente a partir de `qty_vs_time` (`ORDER BY quantity DESC LIMIT 200`) — em período cheio os tempos ficam enviesados. Agregar no servidor.

**Files:**
- Modify: `src/routes/analytics.ts` (remover step 12 ~659-666 e `qty_vs_time` do return; adicionar `prep_by_product`)
- Modify: `src/views/dashboard.html` (bloco ~1336-1361; nomear `renderPrepHtml(data)`)

**Interfaces:**
- Produces: `prep_by_product: Array<{ product_name: string; avg_min: number; sla_min: number; pedidos: number; total_qty: number }>`.

- [ ] **Step 1: Backend**

```ts
        // ── 12. Tempo médio de preparo por produto (agregado no servidor) ──
        const prepByProduct = await safeQuery<{
          product_name: string; avg_min: string; sla_min: number | null; pedidos: number; total_qty: string;
        }>('12.PrepByProduct',
          `SELECT product_name,
             ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at)) / 60)::numeric, 1) AS avg_min,
             MIN(sla_minutes) AS sla_min,
             COUNT(*)::int AS pedidos,
             SUM(quantity)::numeric(10,2) AS total_qty
           FROM demands
           WHERE ${dateFilter} AND ready_at IS NOT NULL AND status IN ('ready','retrieved') ${stationFilter}
           GROUP BY product_name
           ORDER BY avg_min DESC`,
          baseParams
        );
```

- No return: `prep_by_product: prepByProduct` e remover `qty_vs_time: qtyVsTime` + o step 12 antigo. Antes de remover, `grep -rn "qty_vs_time" src/` e confirmar que só o dashboard.html usa (o Streamlit usa SQL próprio).
- `MIN(sla_minutes)`: usa o SLA mais apertado do produto no período (documentar no comentário); substitui o “primeiro da amostra” do código antigo.

- [ ] **Step 2: Frontend**

Trocar o bloco `if (data.qty_vs_time && data.qty_vs_time.length > 2) { ... }` (`~1336`) por uma função `renderPrepHtml(data)` que consome `data.prep_by_product` (mesmo visual: `v + 'm / SLA ' + sla`, cores verde/laranja/vermelho, corte `slice(0, 12)`), chamada como:

```js
        if (data.prep_by_product && data.prep_by_product.length) {
            slaGrid.innerHTML += '<article class="panel" data-cols="6">' +
                '<header class="panel-header"><h3 class="panel-title">Tempo M\u00e9dio de Preparo por Produto</h3><p class="panel-subtitle">vs SLA esperado</p></header>' +
                '<div class="panel-body">' + renderPrepHtml(data) + '<div style="margin-top:4px;font-size:10px;color:var(--c-text-muted);">Verde = dentro do SLA | Laranja = at\u00e9 50% acima | Vermelho = estouro grave</div></div></article>';
        }
```

- [ ] **Step 3: Verificar**

30 dias (com as QA): `Frango Grelhado` tem 12/09 (45 min, SLA 20) e 14/09 (20 min, SLA 20) → média 32,5 → exibir `33m / SLA 20` (arredondado) com cor de estouro grave. Assertar no E2E (`data.prep_by_product` via `page.evaluate`) e visualmente (`evidencias/16_prep_produto.png`).

---

### Task 5: Ajustes menores (F)

**Files:** `src/views/dashboard.html` (header ~330-360; `renderKpis`; `renderCancelReasonsPanel` ~1103; `renderStockoutPanel` ~1147; `loadPerformance`).

- [ ] **Step 1: "Atualizado às HH:MM" + botão Atualizar**

Header: ao lado de `#btnExport`, `<span id="dashUpdated" class="dash-updated" aria-live="polite"></span><button id="btnRefresh" class="btn-dash-export" type="button" title="Atualizar agora">&#8635; Atualizar</button>`.
CSS: `.dash-updated { font-size:11px; color:var(--c-text-secondary); margin-right:4px; }`.
Em `loadDashboard`, no sucesso: `document.getElementById('dashUpdated').textContent = 'Atualizado \u00e0s ' + new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());`
No boot: `btnRefresh.addEventListener('click', function(){ loadDashboard(state.filter); });`

- [ ] **Step 2: % de participação nos motivos de cancelamento**

Em `renderCancelReasonsPanel`, calcular `var total = top.reduce(...) || 1;` (soma dos motivos exibidos) e incluir no cabeçalho do detalhe: `+ ' \u00b7 ' + (Math.round((v / total) * 1000) / 10) + '% dos cancelamentos'`.

- [ ] **Step 3: Zerados por taxa (toggle volume | taxa)**

- `state.stockoutSort = 'volume'` (em `state`, ~594).
- No painel "Zerados por Produto" (buildContent ~1400): dar id ao `<div class="panel-body">` → `id="stockout-panel-body"` e subtítulo `<p class="panel-subtitle">Top 10 \u00b7 clique para detalhar</p>` ganha um botão pequeno `#stockoutSortBtn` (`title="Ordenar por volume ou taxa"`), texto `Ordenar: volume` / `Ordenar: taxa`.
- `renderStockoutPanel(data, sort)`: quando `sort === 'taxa'`, ordenar por `roturas/total_demandas` desc (empate → absoluto desc); o detalhe mostra no cabeçalho `N ocorrência(s) \u00b7 P% dos pedidos do produto` (P = v/total_demandas*100).
- Clique no botão: alterna `state.stockoutSort`, atualiza o texto e re-renderiza **somente** `document.getElementById('stockout-panel-body').innerHTML = renderStockoutPanel(state.lastData, state.stockoutSort);` (não chamar buildContent — os gráficos Chart.js são recriados no loadDashboard e sumiriam).
- Cuidado: o delegate `wireDrillGrid` é do grid (`#diagnosis .bento-grid`) e sobrevive ao innerHTML parcial.

- [ ] **Step 4: Ordem das entidades unificada**

`renderPerfDetractors` (~1603) usa uma ordem local diferente de `perfEntities()`. Trocar por `perfEntities()` (mesma lista de `renderScoreCards`), mantendo o turno jantar.

- [ ] **Step 5: Verificar**

E2E: `#dashUpdated` com texto `Atualizado às \d{2}:\d{2}` após login; botão atualizar dispara nova request (listener `page.expect_request`); toggle de zerados mantém os detalhes funcionando (expandir após alternar); motivos mostram `% dos cancelamentos` no cabeçalho. Screenshots `evidencias/17_ajustes.png`.

---

### Task 6: Verificação final (obrigatória antes de qualquer commit)

**Files:** `outputs/dashboard-cancelamentos/*.py`, `evidencias/*`.

- [ ] **Step 1:** `npx tsc --noEmit` (sem saída) e checador de sintaxe dos scripts inline (§ Task 1 Step 6).
- [ ] **Step 2:** Banco local em UTC (paridade com produção): `ALTER DATABASE kds SET timezone TO 'UTC';` + restart do dev server.
- [ ] **Step 3:** `valida_api.py` + `valida_fuso.py` → 0 falhas (períodos, estação, heatmap agregado×detalhe, detalhes de cancelamentos/zerados/SLA/trocas, deltas).
- [ ] **Step 4:** `e2e_dashboard.py` (com os novos blocos: relógio falso, perf escopada, prep por produto, ajustes) + `e2e_jantar.py` + `verifica_chips.py` → 0 falhas; console sem erros JS; sem overflow horizontal.
- [ ] **Step 5:** Exports: consolidado (abas de detalhe com conteúdo) + por dia (abas prefixadas) + PDF (assinatura, páginas renderizáveis, exemplos no PDF). Conferir com `openpyxl`/`pymupdf` como já feito.
- [ ] **Step 6:** Restaurar o banco local para BRT se desejado (`ALTER DATABASE kds SET timezone TO 'America/Sao_Paulo';`) — **os testes de aceite valem com UTC**; manter UTC localmente é aceitável e mais fiel à produção. Documentar a escolha no Handoff.
- [ ] **Step 7:** Escrever o resumo final com números (checagens/ falhas) e evidências; **aguardar autorização do usuário** para commit/deploy.

### Task 7 (EXTRA, opcional — backlog do item E recusado)

Não implementar sem aprovação explícita: painel "Cancelados após início do preparo" no Diagnóstico (dados: `cooking_started`, `status cancelled_*`, ator em `demand_events`).

---

## Self-Review (feita)

- **Cobertura:** A→Task 1; B→Task 2; C→Task 3; D→Task 4; F→Task 5; verificação→Task 6; E (recusado)→Task 7 documentado.
- **Placeholders:** nenhum "TODO/implement later"; todos os passos têm código ou comando exato.
- **Consistência de tipos:** `brDay`/`brDayOf`/`shiftDay` definidos na Task 1 e usados nas Tasks 3; `prep_by_product` definido na Task 4 e consumido no mesmo passo; `perfEntities()` escopada na Task 2 antes de ser usada nas embalagens de export.
- **Riscos conhecidos:** (1) histórico de `performance_scores` de dias passados continua calculado no fuso antigo (UTC) — recomputação só acontece em mudanças do dia ou `ensureScoresForDate`; documentar no Handoff. (2) `ensureScoresForDate` só recomputa se houver < 8 linhas do dia; se necessário forçar, `DELETE FROM performance_scores WHERE date = '<hoje BRT>'` antes de validar. (3) A remoção de `qty_vs_time` do payload exige `grep` prévio para consumidores externos.

---

## Status de execução (2026-09-15)

Tasks 1-6 implementadas e **verificadas localmente** com o banco em UTC (paridade com produção). Nada commitado/deployado — aguardando autorização.

Extensão não prevista no plano (necessária): `brDayFrom` no `period.service.ts`, usado pelos chamadores de `computeDailyScores` em `demands.ts`/`admin.ts` (que passavam dia UTC), + `shift.service.ts` e o revert do jantar em `admin.ts` (mesmo bug de dia operacional).

Números finais: `valida_fuso.py` 15/15 · `valida_api.py` 0 falhas (incl. deltas conferidos por SQL) · `e2e_dashboard.py` **63/63** · `e2e_jantar.py` 4/4 · `verifica_chips.py` OK · `tsc --noEmit` limpo.
