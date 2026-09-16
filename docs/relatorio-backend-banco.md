# KDS Bridge — Relatório Técnico do Backend e Banco de Dados

## 1. Visão geral

O backend é um servidor **Fastify + Socket.IO** (TypeScript, single entry `src/server.ts`). O único banco é **Postgres na nuvem (Supabase)** acessado via `pg` (`src/db/client.ts`) — o client Supabase JS é usado **somente** para JWT auth (`src/routes/auth.ts`, `src/middleware/auth.ts`), nunca para consultas.

- Pool `pg` com resolução DNS IPv6-first + fallback IPv4; SSL desabilitado para IPs locais/LAN (permite dev offline trocando `DATABASE_URL`).
- Todas as queries usam `$1` parameterização. Sem ORM — SQL direto em rotas/serviços.
- As views HTML são lidas do disco a cada request (`getView()`), com static servido via fastify-static.
- Não há DDL de schema no repositório: as tabelas vivem no Supabase e evoluem via `supabase/migrations/*.sql` (aplicadas no SQL editor) + patches idempotentes espelhados no `seedDatabase()` de `src/server.ts` (ex.: coluna `kitchen_stations.theme`).

## 2. Tabelas e relacionamentos

```
units ───────────────┐            menus ────────────────┐
 │                   │                │                 │
 │ product_units     │                │ menu_products    │
 │ (N:N product×unit)│                │ (N:N menu×product)│
 │                   │                │                 │
 └───────┐           │                └───────┐         │
         │           ▼                        ▼         │
      products ◄─── kitchen_stations      daily_menus (data + menu_id + is_override)
         │                ▲                   │
         │                │                   │ daily_menu_overrides (add/remove por data)
         │                │                   ▼
         └──── demands ──┘          (view) daily_menu_effective
                 │
                 ├── demand_events
                 └── performance_scores (entity + date)
```

### 2.1 Tabelas principais

| Tabela | Papel | Colunas-chave |
|---|---|---|
| `kitchen_stations` | Estações da cozinha | `code` (`quente_a`, `quente_b`, `fria`), `name`, `capacity`, `theme` (`dark`/`light`) |
| `products` | Itens do cardápio | `name` (UNIQUE), `category`, `active`, `sla_minutes_normal`, `sla_minutes_urgente`, `kitchen_station_id` FK |
| `units` | Unidades de medida | `code`, `label`, `active`, `featured` |
| `product_units` | N:N produto×unidade | PK `(product_id, unit_id)` |
| `menus` | Cardápios base (14) | `number` (1–14, UNIQUE), `name` |
| `menu_products` | N:N cardápio×produto | PK `(menu_id, product_id)` |
| `daily_menus` | Cardápio efetivo por data | `date` (UNIQUE), `menu_id`, `is_override`, `notes` |
| `daily_menu_overrides` | Ajustes add/remove por data | `action` (`add`/`remove`), `reason` |
| `demands` | Pedidos cozinha→salão | `status`, `priority`, `sla_minutes`, timestamps de preparo/retirada, flags de SLA/rotura/troca |
| `demand_events` | Trilha de auditoria | `event_type`, `actor` (`salao`/`cozinha`/`sistema`) |
| `performance_scores` | Notas diárias por entidade | PK `(entity, date)`; `entity` = `salao`, `cozinha_quente_a/b`, `cozinha_fria`, `cozinha_geral` |
| `cancel_reasons` | Motivos de cancelamento | `label`, `category` (`salao`/`cozinha`), `active` |
| `system_settings` | Config chave-valor | `key` (UNIQUE), `value` |

Chaves em `system_settings` (upsert idempotente no seed): `data_retention_days` (180), `pickup_tolerance_minutes` (3), `station_theme_salao`, `score_weight_*` (5 pesos de desempenho).

### 2.2 View `daily_menu_effective`

Não está no repositório (definida no Supabase). É a fonte do cardápio exibido: resolve `menu_products` do cardápio do dia **menos** overrides `remove` **mais** overrides `add` daquele `daily_menu_id`, retornando `date`, `product_id`, `name`, `category`, `default_unit` e `origin` (`base`|`manual_add`). Usada em `daily-menu.ts` e no `EXISTS` de `/products/search`.

## 3. Cardápios — lógica central

- **Rotação determinística** (`menu.service.ts`): `menu = ((dias desde REFERENCE_DATE) % 14) + 1`; `REFERENCE_DATE` vem de `REFERENCE_DATE` env (fallback `2025-01-01`).
- `computeMenuForDate(date)` (puro, não persiste):
  1. override manual na própria data vence;
  2. senão propaga sequencialmente do override manual mais recente anterior (`((overrideNumber-1+diffDias)%14)+1`);
  3. senão rotação determinística.
- `getMenuForDate(date)` persiste o resultado em `daily_menus` via upsert que **nunca sobrescreve** `is_override = true`.
- Overrides são feitos por: `PATCH /api/v1/daily-menu/today` (add/remove produto) e `PUT /api/v1/admin/daily-menu/:date` (troca de cardápio inteiro).

## 4. Produtos e unidades

- `products` recebe SLA normal/urgente e aponta para uma estação (`kitchen_station_id`) — a rota de criação de demanda **rejeita** produto sem estação.
- `product_units` define quais unidades um produto aceita; `POST /api/v1/admin/units/bind-product` substitui o conjunto inteiro (transação).
- Unidades têm soft delete (`active=false`) e ordenação por `featured`.
- CRUD de produtos (admin): POST/PUT/DELETE `/api/v1/admin/products*`, toggle ativo em `PATCH /api/v1/products/:id` (emite `product:updated` via socket).

## 5. Demandas — fluxo principal do sistema

1. **Criação** (`POST /api/v1/demands`): valida produto→estação e unidade→produto; busca/garante o cardápio do dia (`ensureTodayMenu()` → `daily_menus`); grava `demands` com SLA copiado do produto (normal/urgente) e flags de troca (`is_replacement`/`replaced_product_id`); registra evento `created`; emite sockets `demand:new`/`demand:urgent`; dispara `recomputeStationQueue()`.
2. **Fila por estação** (`queue.service.ts`): pega demandas `pending` da estação, ordena urgente-first + FIFO, e simula slots pela capacidade da estação. `cooking_started=true` = item em preparo (locked), com `expected_ready_at` = início + `sla_minutes`. Urgências podem **preemptar** itens locked não-urgentes (libera slot, recalcula). Persistência transacional.
3. **Cozinha marca pronto** (`PATCH /:id/ready`): status→`ready`, marca `ready_out_of_order` se pulou itens mais antigos, avalia SLA de preparo, recomputa fila, emite `demand:ready`.
4. **Salão retira** (`PATCH /:id/retrieve`): status→`retrieved`, avalia SLA de retirada (tolerância de `pickup_tolerance_minutes`).
5. **Cancelamentos**: `cancel-salao` (só `pending`) e `cancel-cozinha` (`pending`/`ready`), com `cancel_reason_id` opcional; se já em preparo, emite `demand:cross-cancel` para a sala oposta.
6. **Rotura de estoque** (`POST /:id/stockout`): promove `normal`→`urgent`, recalcula `sla_minutes` para o SLA urgente (ajustando `expected_ready_at` se locked), **recomputa a fila antes** de emitir `demand:stockout` (regra do AGENTS.md).
7. **Anulação** (gerente, `POST /api/v1/admin/demands/:id/annul`): status→`annulled`; excluída dos indicadores, permanece no histórico.

Cada transição grava em `demand_events` e dispara `computeDailyScores(data)` em background.

## 6. SLA, performance e limpeza

- **SLA duplo**: cozinha mede `ready_at − created_at` vs `sla_minutes` (flags `sla_breached_cozinha`); salão mede `retrieved_at − ready_at` vs tolerância (flags `sla_breached_salao`).
- **Performance** (`performance.service.ts`): nota por entidade começa em 5.0 e desconta estouros de SLA (penalidade progressiva entre `sla_min` e `sla_max`), cancelamentos e roturas, conforme os 5 pesos em `system_settings`. `cozinha_geral` = média das 3 estações. Peso de rotura para cozinha foi zerado. `PUT /api/v1/admin/settings/weights` dispara recálculo retroativo em background.
- **Cleanup** (`cleanup.service.ts`): job diário 03:00 + endpoint manual, deleta transacionalmente `demand_events`, `demands`, overrides e `daily_menus` antigos e `performance_scores` além de `data_retention_days`.

## 7. Analytics

`/api/v1/analytics/*` lê agregados de `demands` (por hora, turno, estação, produto, SLA por produto, heatmap, média móvel 7d, comparação de semanas, trocas) — o "responsável" do SLA salão é sempre o time do salão; dashboards nativo (`dashboard.html`) e Streamlit (`dashboard/`) consomem os mesmos dados via REST/psycopg2.

## 8. Relação com as telas (funcionamento prático)

Há 6 páginas servidas pelo backend (`/salao`, `/cozinha`, `/cozinha-quente`, `/cozinha-fria`, `/gerente`, `/admin`, `/dashboard`). Todas são HTML vanilla que falam com a API REST (`/api/v1/*`) para leitura/escrita inicial e com **Socket.IO** para atualização em tempo real. O padrão é: **escrever via REST → servidor persiste → servidor emite evento na sala → cliente atualiza**, sem polling (exceto reconexão).

### 8.1 Salão (`/salao`)

Sala socket: `salao` (emite `join`/`identify` na abertura e no `connect`).

- **Cabeçalho** mostra data e cardápio do dia: carrega `GET /api/v1/daily-menu/today` (o backend garante o `daily_menu_id` com `ensureTodayMenu()` e lista os produtos da view `daily_menu_effective`). Ao receber `menu:updated`, recarrega.
- **Registrar demanda** (formulário):
  1. Busca de produto com dropdown: foco mostra os itens do cardápio de hoje (com selo "HOJE"); digitação consulta `GET /api/v1/products/search?q=...` (debounce 250ms) — busca global em `products` ordenando quem está no cardápio do dia primeiro (ex.: item fora do cardápio pode ser pedido).
  2. Ao selecionar, `GET /api/v1/units/by-product/:productId` popula o seletor de unidade (vínculo `product_units`).
  3. Campos: quantidade, urgente (checkbox), troca (checkbox + select do item substituído — somente itens de hoje).
  4. `POST /api/v1/demands` envia `{product_id, quantity, unit_id, unit_label, priority, is_replacement, replaced_product_id}`. No servidor: valida estação/unidade, copia SLA do produto, grava a demanda, emite `demand:new`/`demand:urgent` nas salas `cozinha_quente`/`cozinha_fria`, `salao`, `gerente`, `cozinha` e dispara o recompute da fila (que emite `demand:queue-updated` ao terminar).
- **Lista de demandas ativas** (`pending`+`ready`): carrega `GET /api/v1/demands` (só ativas, ordenadas urgente-primeiro + FIFO), re-renderiza a cada 30s e sob atualizações por socket: `demand:new/urgent` (adiciona), `demand:ready` (atualiza cartão para verde "PRONTO" com ETA), `demand:retrieved/cancelled/annulled` (remove), `demand:stockout` (marca "ZERADO"), `demand:queue-updated` (recarrega da API).
- **Ações no cartão**:
  - `Retirar` (só em `ready`): modal de confirmação → `PATCH /api/v1/demands/:id/retrieve` → status `retrieved`, avalia SLA de retirada, emite `demand:retrieved` para todos.
  - `Cancelar` (só em `pending`): modal com motivos de `GET /api/v1/admin/cancel-reasons` (filtrados `category='salao'`) + texto livre → `PATCH /api/v1/demands/:id/cancel-salao`. Se o item já estava em preparo (`cooking_started`), o servidor emite `demand:cross-cancel` para a **cozinha da estação** (toast + som + shake no cartão).
  - `Zerou` (rotura, só em `pending`): `POST /api/v1/demands/:id/stockout` → prioridade vira `urgent`, SLA recalculado para o urgente do produto, fila recomputada **antes** do evento `demand:stockout` (regra do AGENTS.md).
- ETA por demanda: `expected_ready_at` (calculado pelo servidor no recompute da fila) exibido com contagem regressiva; "Atrasado" quando passou.

### 8.2 Cozinha (`/cozinha-quente`, `/cozinha-fria`, `/cozinha`)

Salas socket por estação: `quente_a`/`quente_b` → `cozinha_quente`; `fria` → `cozinha_fria` (mapeamento `getStationRoom()` em `demands.ts`). `cozinha.html` é a visão unificada (sala `cozinha`).

- **Inicialização**: `GET /api/v1/kitchen-stations` para mapear `code → id` das estações da tela, depois `GET /api/v1/demands` e render. Na reconexão ou a cada 5s faz `carregarDemandas()`; banner "Reconectando" quando o socket cai.
- **Renderização** (`cozinha-quente`): colunas por estação (param `?station=quente_a|quente_b`); cartões de `pending` ordenados urgente→FIFO, e faixa inferior "PRONTO PARA RETIRAR" com os itens `ready`. Classes visuais por estado: `urgent` (pulso vermelho), `critical` (urgente atrasado), `late` (normal atrasado), `cooking` (em preparo), `stockout` (borda amarela pulsante), `replacement` (selo "TROCA" + nome do item substituído via `replaced_name`).
- **Timers e barra de progresso**: contagem regressiva 1s do ETA por cartão e do timer da coluna (menor ETA pendente da estação; vermelho quando <25% restante); barra de progresso `(agora − created_at) / (expected_ready_at − created_at)`; cores por faixa (verde/amarelo/vermelho).
- **Ações**:
  - `PRONTO`: clique duplo de confirmação (3s) → `PATCH /api/v1/demands/:id/ready`. No servidor: status→`ready`, detecta `ready_out_of_order` (havia item mais antigo em preparo na estação), avalia SLA de preparo (grava `sla_breached_cozinha` + evento), recomputa fila, recalcula score do dia em background e emite `demand:ready` (salão) + `demand:queue-updated` (salão e estação).
  - `CANCELAR` (`pending` ou `ready`): modal com motivos `category='cozinha'` + observações → `PATCH /api/v1/demands/:id/cancel-cozinha`. Se em preparo, `demand:cross-cancel` vai para o **salão**.
- **Eventos recebidos**: `demand:new`/`demand:urgent` (flash branco no cartão novo + alerta sonoro — `kitchen-sounds.js` com WebAudio; urgente tem som próprio), `demand:stockout` (som de rotura), `demand:cross-cancel` (som de alarme + shake 6s + toast fixo), `demand:retrieved/cancelled/annulled` (remove cartão), `demand:queue-updated` e `kitchen:capacity-updated` (recarrega fila — capacidade alterada no admin reflete aqui).

### 8.3 Gerente (`/gerente`)

Sala socket: `gerente`. Consome os mesmos eventos das demandas (`refreshAll`) para atualizar métricas, histórico e estoque em tempo real.

- **Indicadores**: `GET /api/v1/demands/metrics` (total de hoje, tempo médio preparo, produto top) e `GET /api/v1/demands/history` (últimas 100 demandas).
- **Cardápio do dia**: `GET /api/v1/daily-menu/today`; botões para adicionar/remover item → `PATCH /api/v1/daily-menu/today` (grava em `daily_menu_overrides`, emite `menu:updated` — todas as telas recarregam) e toggle ativo de produto → `PATCH /api/v1/products/:id` (emite `product:updated`).
- **Calendário de cardápios** (14 cardápios da rotação): `GET /api/v1/daily-menu/calendar?from=&to=` (até 62 dias; rota registrada antes de `/:date`); clique numa data → `PUT /api/v1/admin/daily-menu/:date` cria override manual (`is_override=true`), que passa a ser âncora da propagação sequencial a partir daquela data.
- **Anulação de demanda**: `POST /api/v1/admin/demands/:id/annul` com motivo obrigatório → status `annulled` (sai das métricas, fica no histórico), evento `annulled`, recompute da fila se pendente, recálculo do score, emite `demand:annulled`.

### 8.4 Admin (`/admin`)

Protegido por JWT Supabase: `POST /api/v1/auth/login` (valida credenciais no Supabase Auth) e `GET /api/v1/auth/me` (`requireAuth` via Bearer token). Abas:

- **Produtos**: CRUD em `POST|PUT|DELETE /api/v1/admin/products*` (SLA normal/urgente, categoria, estação); toggle ativo em `PATCH /api/v1/products/:id` (soft: `active=false`).
- **Estações**: `PATCH /api/v1/kitchen-stations/:id` (capacidade e tema; muda capacidade → recomputa fila + `kitchen:capacity-updated`; tema → `station:theme-updated`). Tema do salão: `GET|PATCH /api/v1/station-themes/salao` (chave `station_theme_salao` em `system_settings`).
- **Cardápios**: `GET /api/v1/admin/menus`, edição de produtos por cardápio (`menu_products`), e `POST /api/v1/admin/menus/:id/set-today` (override do dia).
- **Unidades**: CRUD + `POST /api/v1/admin/units/bind-product` (substitui o conjunto de unidades do produto numa transação).
- **Motivos de cancelamento**: CRUD em `cancel_reasons`.
- **Pesos de desempenho**: `GET/PUT /api/v1/admin/settings/weights` (5 pesos em `system_settings`; PUT dispara recálculo retroativo em background de todos os `performance_scores`).
- **Limpeza**: `POST /api/v1/admin/cleanup` (DELETE transacional por retenção).
- **Ocupação da fila**: `GET /api/v1/kitchen-stations/queue-occupation` (pendentes vs capacidade por estação).

### 8.5 Dashboard

`/dashboard` consome `GET /api/v1/analytics/*` (agregados sobre `demands`: por hora, turno, estação, produto, SLA, heatmap, média móvel, comparação semanal, trocas) — dados históricos, sem socket. O `dashboard/` Streamlit (Python/psycopg2) é um painel independente sobre a mesma base.

**Resumo do fluxo de dados:** produto (SLA/estação) → cardápio do dia (rotação 14 + overrides) → demanda (cópia de SLA + status) → fila/estatísticas → eventos → scores diários. O banco é a fonte única de verdade; o socket apenas notifica os clientes após cada escrita.
