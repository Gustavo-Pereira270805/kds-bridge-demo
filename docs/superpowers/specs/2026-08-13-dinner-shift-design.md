# Modo Jantar (Turno Noturno) — Design (spec)

> Documento de design para a introdução do **Modo Jantar** no KDS Bridge: turno noturno operado por um único cozinheiro na cozinha quente, com transição manual pelo gerente, cardápio noturno, tela dedicada e isolamento total de métricas em relação às estações do almoço.

## 1. Contexto do projeto

KDS Bridge: comunicação cozinha–salão, backend **Fastify + Socket.IO + pg** (TS), views **HTML/JS vanilla** em `src/views/` (sem framework, sem bundler). Tudo em **pt-BR**. Views são lidas do disco a cada request (`server.ts:getView()`) — edições live no dev sem restart; produção exige `npm run build` (`copyfiles src/views -> dist/views`).

Comandos: `npm run dev` (não typechecka) · `npx tsc --noEmit` · `npm run build` · `npm start`.

Schema vive no **Supabase cloud Postgres**; migrações são arquivos SQL em `supabase/migrations/` aplicados via SQL Editor, e `seedDatabase()` (`server.ts:117-271`) espelha patches críticos para DBs existentes convergirem.

## 2. Visão de negócio (cliente)

- **Gatilho manual**: o gerente ativa o Modo Jantar por botão (entre 15h e 16h, conforme fluxo de clientes — sem horário fixo).
- **Isolamento crucial**: um único cozinheiro assume o turno. O desempenho (tempo de preparo, SLAs) dele **não pode se misturar nem prejudicar** as estatísticas das estações do almoço (Quente A, Quente B e Fria). O jantar é a entidade **"Cozinha Jantar"**.
- **Período de transição**: durante a virada, itens do almoço que zerarem passam a ser trocados por itens do cardápio do jantar ("tilápia do almoço" → "tilápia do jantar"). Sem tracking de estoque — apenas disponibilidade de itens no salão.
- **Cardápio noturno**: estrutura similar ao almoço, mas itens do contexto noturno.

## 3. Decisões alinhadas com o usuário

| # | Decisão | Escolha |
|---|---|---|
| D1 | Estrutura do cardápio do jantar | **Menu fixo único**: o "cardápio do jantar" é o conjunto de **produtos ativos com `kitchen_station_id = 'jantar'`** — sem nova linha em `menus` (evita mexer no CHECK `number BETWEEN 1 AND 14` da rotação do almoço) |
| D2 | Abordagem técnica da transição | **Via `daily_menu_overrides`**: o botão insere `action='add'` de todos os produtos jantar no cardápio efetivo do dia. Sem mudança de `UNIQUE(date)` em `daily_menus` |
| D3 | Cardápio do salão pós-transição | **Itens do almoço permanecem** (não há `remove` em massa) + itens do jantar entram. Dropdown do salão hierarquiza: jantar no topo (tag `JANTAR`), almoço do dia abaixo (tag `ALMOÇO`) |
| D4 | Isolamento de métricas | `cozinha_jantar` é entidade própria; `cozinha_geral` **continua sendo a média apenas** de Quente A + Quente B + Fria. Demandas do jantar entram na nota do `salao` (mesma equipe). **"Aba Jantar" do dashboard = fase 2** (decisão pendente com o cliente — fora desta spec) |
| D5 | Ciclo de vida do turno | **Só ativar; reseta no dia seguinte**: estado em `system_settings` comparado com `CURRENT_DATE`. Sem botão de desativar |
| D6 | Demandas ativas na transição | **Transferir para a Cozinha Jantar**: todas as demandas `pending` (qualquer estação, de hoje) passam para `kitchen_station_id = 'jantar'`, e **cada transferência é registrada** em `demand_events` (novo tipo `shift_transfer`) |
| D7 | Tela da cozinha | **Reutiliza `cozinha-quente.html`** (a cozinha física noturna é a quente). `?station=jantar` é suportado E a tela **transiciona automaticamente na mesma janela** quando o gerente ativa o turno (via socket). Layout passa a coluna única + mudança sutil de paleta |
| D8 | Paleta noturna | **Variante CSS por `[data-station="jantar"]`** em `theme.css` (fundo azulado escuro + acento frio/âmbar), sem novos endpoints de tema |
| D9 | Escopo | Núcleo da feature agora; "Aba Jantar" do dashboard em spec separada (fase 2) |

## 4. Banco de Dados

### 4.1 Nova migration `supabase/migrations/2026-08-13-dinner-shift.sql`

```sql
-- Estação jantar: um cozinheiro (capacity 1), tema dark
INSERT INTO kitchen_stations (code, name, capacity, theme)
VALUES ('jantar', 'Cozinha Jantar', 1, 'dark')
ON CONFLICT (code) DO NOTHING;

-- Estado do turno: data em que o jantar foi ativado ('' = inativo)
INSERT INTO system_settings (key, value)
VALUES ('shift_dinner_active_date', '')
ON CONFLICT (key) DO NOTHING;

-- Novo tipo de evento: transferência de demanda para o turno jantar
DO $$
BEGIN
  ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
  ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
    CHECK (event_type IN (
      'created', 'marked_ready', 'retrieved',
      'cancelled_salao', 'cancelled_cozinha',
      'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
      'annulled', 'shift_transfer'
    ));
END $$;
```

**Sem mudanças** em `daily_menus` (overrides approach), `performance_scores` (`entity` é `VARCHAR(30)` sem CHECK — `cozinha_jantar` cabe) e `daily_menu_effective` (itens jantar entram via overrides `add`, já suportados pela view).

### 4.2 Espelho em `seedDatabase()` (server.ts)

Conforme AGENTS.md, espelhar a migration para DBs existentes convergirem:
1. `INSERT INTO kitchen_stations (code, name, capacity, theme) VALUES ('jantar','Cozinha Jantar',1,'dark') ON CONFLICT (code) DO NOTHING;`
2. `INSERT INTO system_settings (key, value) VALUES ('shift_dinner_active_date','') ON CONFLICT (key) DO NOTHING;`
3. Patch do CHECK de `demand_events` (mesmo bloco `DO $$` da migration, idempotente).

## 5. Backend

### 5.1 `src/routes/shift.ts` (novo)

- `GET /api/v1/shift/status` → `{ shift: 'lunch' | 'dinner' }`:
  ```sql
  SELECT value FROM system_settings WHERE key = 'shift_dinner_active_date'
  ```
  `shift = (value === CURRENT_DATE::text) ? 'dinner' : 'lunch'` — reset implícito na virada do dia, sem job.
- Registrado em `server.ts` junto às demais rotas (`/api/v1`).

### 5.2 `src/routes/admin.ts` — `POST /api/v1/admin/shift/dinner`

Fluxo (transacional na parte de DB):

1. **BEGIN**
2. Resolve `daily_menu_id` de hoje via `ensureTodayMenu()` (`menu.service.ts`) e o id da estação `jantar` (`kitchen_stations WHERE code='jantar'`).
3. **Overrides** (idempotente): para cada produto ativo com `kitchen_station_id = jantar`, upsert em `daily_menu_overrides` `(daily_menu_id, product_id, action='add', reason='Turno jantar ativado')` — `ON CONFLICT (daily_menu_id, product_id) DO NOTHING`. Re-clique do endpoint re-sincroniza produtos jantar criados depois.
4. **Transferência de demandas ativas**: primeiro `SELECT DISTINCT kitchen_station_id FROM demands WHERE status = 'pending' AND created_at::date = CURRENT_DATE AND kitchen_station_id <> $jantar` (estações de origem, para o recompute pós-commit); depois `UPDATE demands SET kitchen_station_id = $jantar WHERE ... RETURNING id`.
5. **Registro do evento** (uma linha por demanda transferida): `INSERT INTO demand_events (demand_id, event_type, actor, notes) VALUES (..., 'shift_transfer', 'sistema', 'Transferida para a Cozinha Jantar na ativação do turno jantar')`.
6. Seta `system_settings` `shift_dinner_active_date = CURRENT_DATE::text`.
7. **COMMIT**
8. Pós-commit: `recomputeStationQueue(jantarId)` + `recomputeStationQueue(...)` para cada estação de origem afetada (tiveram pendências removidas); `computeDailyScores(today)`.
9. **Emissões socket** (após o recompute — regra do AGENTS.md):
   - `fastify.io.emit('menu:updated', ...)` — broadcast (salão recarrega cardápio; gerente recarrega cardápio/calendário)
   - `fastify.io.emit('shift:updated', { shift: 'dinner' })` — broadcast (salão liga o badge; gerente atualiza o botão; **cozinha-quente transiciona na mesma janela**)
   - `fastify.io.emit('demand:queue-updated', ...)` — broadcast (filas recalculadas)
10. Resposta: `{ shift: 'dinner', added_products: n, transferred_demands: n, pending_lunch_demands: n }`.

Nota: `pending_lunch_demands` (contagem pré-transferência) é retornada no payload para o gerente exibir no modal/toast; a transferência **não é bloqueada** por pendências.

### 5.3 `src/routes/daily-menu.ts` — `GET /today`

- Envelope ganha `shift: 'lunch' | 'dinner'` (mesma lógica de `GET /shift/status`).
- Produtos enriquecidos com a estação (para as tags ALMOÇO/JANTAR no salão e no gerente):
  ```sql
  SELECT dme.*, ks.code AS station_code
  FROM daily_menu_effective dme
  JOIN products p ON p.id = dme.product_id
  LEFT JOIN kitchen_stations ks ON ks.id = p.kitchen_station_id
  WHERE dme.daily_menu_id = $1
  ORDER BY (ks.code = 'jantar') DESC, category, name
  ```
  (ordenação já deixa o jantar no topo — o frontend também reordena como defesa).

### 5.4 `src/routes/products.ts` — `GET /search`

- Ganha `station_code` no SELECT (mesmo LEFT JOIN) e ordena:
  ```sql
  ORDER BY (ks.code = 'jantar') DESC, in_today_menu DESC, name
  ```

### 5.5 `src/services/performance.service.ts`

1. `entityFromStationCode()` (L73-77): adicionar `jantar → 'cozinha_jantar'` **antes** do fallback (hoje cairia errado em `cozinha_fria`).
2. `computeDailyScores()`: o loop por `kitchen_stations` cobre `jantar` automaticamente após o mapeamento. A consulta de `cozinha_geral` **não muda** — já filtra `entity IN ('cozinha_quente_a','cozinha_quente_b','cozinha_fria')` (isolamento garantido).
3. `ensureScoresForDate()`: critério de "completo" muda de `>= 5` para `>= 6` linhas (3 estações almoço + jantar + salão + geral). Datas antigas recalculam sob demanda.
4. `getDetractorDates()`: garantir o mapeamento entity→code para `cozinha_jantar` → `ks.code = 'jantar'` (branch de estações).

### 5.6 `src/routes/analytics.ts` — `GET /performance`

- Adicionar `'cozinha_jantar'` à lista de entidades retornadas (após `cozinha_fria`), para o score aparecer no dashboard atual. A "Aba Jantar" dedicada fica para a fase 2.

### 5.7 Sockets

- `src/routes/demands.ts` `getStationRoom()` (L10-13): `jantar → 'cozinha_jantar'` (antes do fallback `cozinha_quente`).
- `src/socket/handlers.ts` `VALID_ROOMS` (L3-9): adicionar `'cozinha_jantar'`.
- `queue.service.ts`: **sem mudanças** (opera por station/capacity).

### 5.8 `src/types.ts`

- `DailyMenuEffective` (L74-82): `station_code?: string`.
- `ProductSearchRow`: `station_code?: string`.
- `DemandEventType` (L138-147): `'shift_transfer'`.
- Novos tipos: `ShiftStatus { shift: 'lunch' | 'dinner' }` e `StartDinnerResponse { shift, added_products, transferred_demands, pending_lunch_demands }`.

## 6. Frontend

### 6.1 `src/views/cozinha-quente.html` — transição automática na mesma janela

- **Param**: `?station=quente_a|quente_b|jantar` define `baseStation` (default `quente_a`).
- **Estação efetiva**: `effectiveStation = (shift === 'dinner') ? 'jantar' : baseStation` — no load, busca `GET /api/v1/shift/status`; em `shift:updated` (socket), atualiza na hora **sem recarregar a página**.
- **Transição automática** (evento `shift:updated {shift:'dinner'}`):
  1. `document.documentElement.dataset.station = 'jantar'` e `document.body.dataset.station = 'jantar'` (liga a paleta noturna via CSS);
  2. esconde as colunas A/B e mostra o **layout de coluna única** (padrão da cozinha-fria: um grid full-width + um timer global), título vira **"COZINHA JANTAR"**;
  3. `socket.emit('join', 'cozinha_jantar')`;
  4. refetch `/demands` e re-render (filtro por `kitchen_station_id === stationIds.jantar`).
- **Volta ao almoço**: implícita — no próximo dia o load inicial (`GET /shift/status`) retorna `lunch` e a tela volta ao `baseStation`/layout de 2 colunas.
- `stationIds`: resolver também `jantar` no fetch `/kitchen-stations` (L404-412 atual).
- Fluxos PRONTO (2 toques) e CANCELAR (modal motivos `cozinha`) permanecem idênticos.
- `KDSStationTheme.load/watch` passam a usar `effectiveStation` (estação `jantar` tem `theme='dark'` no seed).
- A tela mantém `join('cozinha_quente')` também — eventos do almoço continuam chegando, mas o render filtra por `effectiveStation`, então nada vaza para a fila do jantar.

### 6.2 `src/views/styles/theme.css` — paleta noturna

- Variante `[data-station="jantar"]` (em `html`/`body`), usando **tokens** e não cores fixas:
  - fundo: azulado escuro (ex.: deep slate/indigo, próximos da paleta Zinc atual — definir em tokens `--c-bg-*` sobrescritos no escopo);
  - acento principal "pronto" troca o verde (`--c-accent-warm`) pelo **âmbar dourado existente** (`--c-accent-gold: #d4a574`), já token do theme — identidade noturna sem cor nova;
  - badge/título "JANTAR" com o acento noturno.
- Sem novos arquivos de CSS; escopado a `data-station` para não afetar as demais telas.

### 6.3 `src/views/salao.html`

- **Badge de turno**: quando `shift === 'dinner'`, exibir "Turno Jantar ativo" próximo ao header do cardápio (dados do próprio `GET /daily-menu/today`).
- **Dropdown hierarquizado** (lista inicial = itens de hoje; busca tipada = todos):
  - itens com `station_code === 'jantar'` **no topo** com badge `JANTAR`;
  - demais itens de hoje com badge `ALMOÇO` (quando shift dinner) ou `HOJE` (shift lunch);
  - itens fora do cardápio sem badge (apenas na busca).
- Trocas: o dropdown de "item substituído" (`populateReplacedProducts`) já usa os itens de hoje — após a transição incluirá os itens jantar (e os itens do almoço continuam listados, permitindo trocar "tilápia do almoço" por "tilápia do jantar").
- `menu:updated` já dispara `loadProducts()` — nenhum listener novo é necessário para recarregar o cardápio; `shift:updated` atualiza o badge sem refetch completo.

### 6.4 `src/views/gerente.html`

- **Botão "Iniciar Turno Jantar"** no header (junto ao `themeToggle`, L239-247 atual):
  - estado inicial via `GET /api/v1/shift/status`; ativo → botão desabilitado com texto "Turno Jantar ativo";
  - clique → **modal de confirmação** com o impacto: "N itens do cardápio jantar serão adicionados ao cardápio efetivo" e, se houver, "X demandas pendentes serão transferidas para a Cozinha Jantar" (contagens do próprio `POST`, exibidas no toast após a chamada — o modal confirma a intenção, o toast reporta o resultado real);
  - `POST /api/v1/admin/shift/dinner` → toast de sucesso + refresh (cardápio, histórico, métricas);
  - erro: toast de erro (gotcha: nunca `.catch` vazio).
- Ouve `shift:updated` para refletir ativação vinda de outra aba.
- **Cardápio do Dia**: itens com `station_code === 'jantar'` ganham badge "Jantar" na lista (`fetchProducts`).

## 7. Casos de borda

1. **Produto jantar criado após a transição**: re-clique do endpoint re-sincroniza (upsert por produto, idempotente). O botão desabilitado no frontend não impede — a rota permanece aberta.
2. **Override `remove` manual** de um item jantar via `PATCH /daily-menu/today`: continua funcionando (a view respeita `NOT EXISTS ... action='remove'`).
3. **Rotação do almoço intacta**: overrides não tocam `daily_menus.menu_id`; `REFERENCE_DATE` segue valendo para os 14 cardápios.
4. **Demandas `ready` na transição**: NÃO são transferidas (já cozidas, aguardando retirada no salão) — apenas `pending`. O salão continua retirando normalmente.
5. **Transferência e métricas**: demandas transferidas passam a contar para `cozinha_jantar` no cálculo diário (o `kitchen_station_id` é lido no momento do cálculo) — comportamento desejado, com rastro em `demand_events` (`shift_transfer`).
6. **Tela quente A/B após a transição**: a fila das estações do almoço esvazia via recompute + `demand:queue-updated`; o kiosk passa ao modo jantar automaticamente.
7. **Cleanup**: `daily_menu_overrides`/`daily_menus` são limpos por data — o turno jantar não deixa lixo retroativo.
8. **Dupla ativação**: re-clique no mesmo dia é no-op parcial (só re-sync de overrides); em outro dia, sobrescreve a setting e repete o fluxo.
9. **Salão busca produto**: itens jantar aparecem na busca mesmo sem transição (todos os produtos ativos são buscáveis hoje) — a transição só os promove ao topo e ao cardápio efetivo.
10. **Datas passadas**: `ensureScoresForDate` recalcula dias com < 6 linhas sob demanda (dashboard antigo ganha a entidade jantar retroativamente com 0 demandas).

## 8. Padrões visuais (obrigatório)

- Reutilizar **tokens** de `theme.css` (paleta Zinc, Inter + JetBrains Mono, escala de raio/espaçamento) — nunca cores hardcoded; a variante jantar sobrescreve tokens no escopo `[data-station="jantar"]`.
- Seguir `REVISAO_UI_KDS.md` e o padrão das telas kiosk existentes (coluna única idêntica à cozinha-fria; botões `btn-touch`; estados vazio/loading com `.empty-state`/`.skeleton-block`).
- Views em **ES5 estrito**: `var`/`function()`, sem template literals/arrow/`let` (gotcha do codebase, ver spec de sons §7).
- Re-attach de listeners: guardar handler no elemento (`el._ch`) antes de `removeEventListener` (gotcha).

## 9. Plano de verificação

1. `npx tsc --noEmit` — sem erros.
2. `npm run dev` em background (`Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`); conferir porta 3000 (`taskkill` se instância antiga).
3. **Fluxo Playwright** (padrão `test_webwright/` / skill webwright), registrando screenshots em `final_runs/`:
   a. Seed: criar produto "Tilápia Jantar" com estação jantar (via admin UI ou API).
   b. `/gerente`: botão visível → clicar → modal → confirmar.
   c. `/salao`: badge "Turno Jantar ativo"; dropdown com "Tilápia Jantar" no topo (tag JANTAR) e item do almoço abaixo (tag ALMOÇO); registrar troca tilápia almoço → tilápia jantar.
   d. `/cozinha-quente`: **sem reload manual**, a mesma janela deve virar "COZINHA JANTAR" (coluna única, paleta noturna) com a demanda jantar na fila.
   e. PRONTO na Cozinha Jantar → salão retira → verificar `demand_events` com `shift_transfer` e `performance_scores` com linha `cozinha_jantar` (e `cozinha_geral` sem contaminação).
4. **Validação visual das screenshots** com o subagente `image-analyzer` (`.opencode/agent/image-analyzer.md`): conferir título, layout de coluna única, paleta noturna, badges/tags e alinhamento com os padrões visuais (`REVISAO_UI_KDS.md`).
5. Regressões: criar demanda de estação fria e conferir que `/cozinha-fria` continua funcionando e não recebe eventos do jantar; rotação do almoço (calendário) inalterada.
6. `npm run build` — views copiadas para `dist/views`; `npm start` serve sem erro.
7. Guardrails: `git status` mostra apenas os arquivos previstos (§10).

## 10. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/2026-08-13-dinner-shift.sql` | **novo** — migration §4.1 |
| `src/server.ts` | espelho da migration em `seedDatabase()`; registrar rota `shift` |
| `src/routes/shift.ts` | **novo** — `GET /api/v1/shift/status` |
| `src/routes/admin.ts` | `POST /api/v1/admin/shift/dinner` |
| `src/routes/daily-menu.ts` | `/today`: `shift` + `station_code` + ordenação |
| `src/routes/products.ts` | `/search`: `station_code` + ordenação |
| `src/routes/demands.ts` | `getStationRoom` → `cozinha_jantar` |
| `src/routes/analytics.ts` | `/performance`: entidade `cozinha_jantar` |
| `src/socket/handlers.ts` | `VALID_ROOMS` += `cozinha_jantar` |
| `src/services/performance.service.ts` | mapeamento entity, `ensureScoresForDate` ≥6, detractor dates |
| `src/types.ts` | tipos novos (§5.8) |
| `src/views/cozinha-quente.html` | modo jantar + transição automática + layout coluna única |
| `src/views/styles/theme.css` | variante `[data-station="jantar"]` |
| `src/views/salao.html` | badge turno + hierarquia/tags no dropdown |
| `src/views/gerente.html` | botão + modal + badge no cardápio |
| `docs/superpowers/specs/2026-08-13-dinner-shift-design.md` | este documento |

**Fora do escopo (fase 2)**: "Aba Jantar" no dashboard (dados após ativação do menu jantar / demandas do jantar), definição pendente com o cliente.

## 11. Definição de pronto

- [ ] Migration aplicável via SQL Editor + espelho idempotente em `seedDatabase()`.
- [ ] `POST /api/v1/admin/shift/dinner` transfere pendências (com `shift_transfer` registrado), injeta overrides e emite `menu:updated` + `shift:updated` + `demand:queue-updated` (após recompute).
- [ ] `GET /api/v1/shift/status` e `/daily-menu/today` refletem o turno; reset implícito na virada do dia.
- [ ] Salão hierarquiza dropdown com tags JANTAR/ALMOÇO e exibe badge de turno.
- [ ] Kiosk quente transiciona automaticamente para COZINHA JANTAR (mesma janela), com coluna única e paleta noturna; volta ao almoço no dia seguinte.
- [ ] `cozinha_jantar` isolada em `performance_scores`; `cozinha_geral` sem contaminação; `ensureScoresForDate` ≥6.
- [ ] `npx tsc --noEmit` OK; fluxo Playwright + validação visual via image-analyzer OK; `npm run build` OK.
- [ ] Nenhum arquivo fora da lista §10 alterado; nenhum commit sem aval do usuário.

## 12. Referências

- `AGENTS.md` — arquitetura, gotchas, comandos.
- `REVISAO_UI_KDS.md` — padrões visuais e design tokens.
- `src/views/styles/theme.css` — tokens (Zinc, Inter + JetBrains Mono).
- Specs anteriores: `docs/superpowers/specs/2026-08-12-kitchen-sounds-redesign-design.md` (formato e gotchas ES5), `2026-08-04-performance-station-scoring-design.md` (métricas).
- Subagente de validação visual: `.opencode/agent/image-analyzer.md`.
