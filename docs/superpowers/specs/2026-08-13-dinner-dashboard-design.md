# Aba "Jantar" no dashboard — Design (spec)

> Documento de design para a **Fase 2** do Modo Jantar: uma aba dedicada **"Jantar"** no dashboard nativo (`src/views/dashboard.html`) com métricas separadas do turno noturno. Preenche a lacuna deixada pela spec `2026-08-13-dinner-shift-design.md` (decisões D4/D9: "Aba Jantar = fase 2").

## 1. Contexto do projeto

KDS Bridge: comunicação cozinha–salão, backend **Fastify + Socket.IO + pg** (TS), views **HTML/JS vanilla** em `src/views/` (sem framework, sem bundler). Tudo em **pt-BR**. Views são lidas do disco a cada request — edições live no dev sem restart; produção exige `npm run build`.

O **backend de métricas do jantar já está pronto** (fase 1 concluída):
- `src/services/performance.service.ts` mapeia `jantar → cozinha_jantar` (`entityFromStationCode`), e `cozinha_geral` continua a média apenas de Quente A + Quente B + Fria.
- `src/routes/analytics.ts` lista `cozinha_jantar` em `/performance` (`entities`, `:733`).
- `GET /api/v1/analytics/dashboard` já aceita filtro `station_id` (`:308-310`).

O **frontend** (`dashboard.html`) hoje ignora `cozinha_jantar` (5 arrays de entidades hardcoded: `:1214`, `:1298`, `:1319`, `:1794`, `:1845`) e não tem aba nem filtro de turno. Esta spec adiciona a aba sem tocar no backend.

## 2. Visão de negócio (cliente)

O gerente precisa **isolar a leitura das métricas do jantar**: hoje o dashboard mistura tudo, e o turno noturno (operado por um único cozinheiro na Cozinha Jantar) poluiria a análise do almoço. Com a aba **Jantar**, o gerente alterna entre a visão geral (almoço) e a visão do turno noturno, sem que uma contamine a outra.

## 3. Decisões alinhadas com o usuário

| # | Decisão | Escolha |
|---|---|---|
| D1 | Onde | **Dashboard nativo** (`dashboard.html`), não o Streamlit |
| D2 | Formato | **Aba dedicada "Jantar"** via toggle in-page (não mesclada no painel geral) |
| D3 | Delimitação da "métrica do jantar" | **Por estação** (`kitchen_station_id = 'jantar'`) — a transferência da fase 1 já move pendências para a estação jantar e demandas novas do jantar nascem lá |
| D4 | Conteúdo da aba | **Mesmas seções** do painel atual (KPIs + tendência + SLA + diagnóstico + performance), filtradas para a estação jantar |
| D5 | Implementação | **Toggle `Almoço (Geral) \| Jantar`** in-page, reusando todo o JS existente; `state.turn` sem persistência (default `lunch`) |
| D6 | Performance no modo Jantar | Renderiza **apenas `cozinha_jantar`** (score card + tendência + detratores). O salão (compartilhado entre turnos) fica **fora** da aba Jantar; continua visível só no modo Geral |
| D7 | Modo Geral | **Inalterado** — as 5 entidades atuais (geral, quente A/B, fria, salão). `cozinha_jantar` NÃO entra no painel geral |
| D8 | Export (PDF/Excel) | Respeita o turno: no modo Jantar exporta KPIs/gráficos do jantar e performance `cozinha_jantar` |

## 4. UX / comportamento

- Novo toggle de turno no topo do dashboard, ao lado do seletor de período (`#periodSelector`, `dashboard.html:299-304`), no mesmo estilo visual dos `period-btn`:
  - `Almoço (Geral)` — default, comportamento idêntico ao atual.
  - `Jantar` — escopos descritos abaixo.
- Estado `state.turn` ∈ `{ 'lunch', 'dinner' }`, default `'lunch'`, **sem persistência** (reseta no reload).
- No modo **Jantar**:
  - O filtro de estação `#stationSelect` (`:312-314`) é **oculto** (o jantar é uma única estação; filtrar por outra não faz sentido).
  - O seletor de período (`range`/`from`/`to`) continua **ativo e compartilhado** entre os modos (mesmo intervalo).
  - Alternar de turno **recarrega** `loadDashboard()` + `loadPerformance()` com o novo escopo.

## 5. Fluxo de dados

### 5.1 KPIs + blocos analíticos (`/dashboard`)

- Modo `lunch`: `GET /api/v1/analytics/dashboard` como hoje (`filterToParams()` + `station_id` se o usuário escolher no `#stationSelect`).
- Modo `dinner`: mesma chamada acrescentando `station_id = <id da estação 'jantar'>`.
  - O id vem de `loadStations()` (`dashboard.html:1666-1677`), que já busca `GET /api/v1/kitchen-stations`; localizar a estação por `code === 'jantar'`.
  - O filtro `station_id` já percorre os 18 blocos do `/dashboard` (`:308-310`), então KPIs, tendência, SLA, diagnóstico etc. ficam automaticamente escopados ao jantar (inclusive métricas de retirada do salão calculadas **sobre as demandas do jantar**).

### 5.2 Performance (`/performance`)

- Sem mudança de endpoint: `GET /api/v1/analytics/performance` já retorna `cozinha_jantar` (`:733`) com `current`, `history`, `averages`, `detractor_dates`, `weights`.
- Modo `lunch`: renderiza as 5 entidades atuais (inalterado).
- Modo `dinner`: renderiza **somente `cozinha_jantar`** — score card, gráfico de tendência, detratores e linhas de export.

## 6. Mudanças de código

Somente `src/views/dashboard.html` (nenhuma mudança de backend).

1. **Toggle de turno** (`#turnSelector`) no topo, junto ao `#periodSelector`; CSS reutiliza o padrão dos `period-btn` (ou classes utilitárias de `theme.css`).
2. **`state.turn`** + handler de clique nos botões do toggle → seta `state.turn`, esconde/mostra `#stationSelect`, recarrega dashboard + performance.
3. **`loadDashboard()` / `filterToParams()`** (`:1451-1456`, `:1499`): no modo `dinner`, anexar `station_id` do jantar (ignorando `state.stationId` do select). Precisa de acesso ao id da estação jantar (armazenar de `loadStations()`, ex. `state.jantarStationId`).
4. **`#stationSelect`**: ocultar no modo `dinner`; restaurar no `lunch`.
5. **Performance escopada**: passar um parâmetro "escopo" (lista de entidades) para `renderScoreCards` (`:1294`), `createPerfTrendChart` (`:1214`), `renderPerfDetractors` (`:1316`) e às funções de export (`exportPerformanceHtml` `:1794`, `appendPerformanceExcel` `:1845`); no modo `dinner` usam `['cozinha_jantar']` (e o label correspondente), no `lunch` mantêm as listas atuais.
6. **Labels**: adicionar o label `cozinha_jantar → 'Cozinha Jantar'` onde o modo jantar renderizar (mesmo padrão dos labels atuais em `:1299`, `:1320`, `:1215`, `:1795`). O texto do modal de critérios (`:459-461`) pode ganhar menção à "Cozinha Jantar", mas não é obrigatório.
7. **Export PDF/Excel** (`:1858-2031`): respeitar `state.turn` — no modo jantar, aplicar `station_id` e performance `cozinha_jantar`.

## 7. Edge cases

- **Estação jantar ausente** (não deve ocorrer — `seedDatabase` garante): toggle "Jantar" fica desabilitado e mostra um estado de erro discreto, em vez de falhar silenciosamente.
- **Período sem demandas do jantar**: seções mostram zeros/vazio (mesmo comportamento das seções atuais quando vazias).
- **Datas anteriores à ativação do turno**: `cozinha_jantar` retorna `final_score` default 5.0 / 0 demandas (retroativo, conforme caso de borda 10 da spec da fase 1).
- **Alternância rápida de turno**: recarregar sempre a partir do intervalo/`state.turn` atuais (sem cache entre modos).

## 8. Testes

- `npx tsc --noEmit` (não há TS novo, mas sanity).
- Smoke Playwright (`py -m playwright`): abrir `/dashboard`, alternar para "Jantar", verificar:
  - `#stationSelect` oculto;
  - requisições de `/dashboard` com `station_id` do jantar e KPIs coerentes (ex.: só demandas da estação jantar);
  - seção de performance renderiza só `cozinha_jantar`;
  - alternar de volta para "Almoço" restaura `#stationSelect` e as 5 entidades.
- Regressão: modo Geral idêntico ao comportamento anterior (arrays de entidades não alterados para o geral).
- Export PDF/Excel no modo Jantar com escopo correto.

## 9. Fora de escopo

- Dashboard Streamlit (`dashboard/`) — permanece sem consciência do turno jantar.
- Quebrar a nota do `salao` por turno (o salão é compartilhado; não há como separar sem mudança de modelo).
- Persistência do turno selecionado entre sessões.
- Métricas de jantar "por horário" (o escopo é por estação, decisão D3).
