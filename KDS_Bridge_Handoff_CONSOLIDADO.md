# KDS Bridge — Handoff Consolidado

> Documento único gerado a partir de 6 handoffs (v1.0 → v2.4), removendo redundâncias e histórico obsoleto, mantendo tudo que é necessário para dar continuidade ao projeto.
> Estado do sistema refletido aqui: **v2.5 (implementado + corrigido)**. Atualizado em 23/07/2026 com duas rodadas de correções de bugs pós-implementação.
> O plano detalhado de implementação está em `PLANO_MUDANCAS_CLIENTE.md`. As seções marcadas com **[v2.5]** descrevem funcionalidades implementadas em 22/07/2026 e corrigidas em 23/07/2026.

---

## 1. O que é o projeto

**KDS Bridge** (Kitchen Display System) é um sistema web de comunicação em tempo real entre salão e cozinha de um restaurante self-service, substituindo a comunicação verbal. O garçom registra uma demanda (produto + quantidade + unidade + urgência), ela aparece instantaneamente na tela da cozinha correta, com SLA visual, barra de progresso e alerta sonoro. Tudo fica registrado para histórico e análise.

**Três funcionalidades centrais (inalteradas desde v1.0):**
- Fila de demandas em tempo real salão ↔ cozinha via Socket.IO
- 14 cardápios rotativos pré-configurados, com ajuste manual diário pelo gerente
- Histórico completo de demandas + painel analítico

**Fora do escopo (decisão original, ainda válida salvo indicação em contrário):** integração com PDV/caixa, controle de estoque de ingredientes, notificações push mobile, app nativo, múltiplos níveis hierárquicos de usuário.

**Stack atual:** TypeScript (Fastify + Socket.IO) + PostgreSQL + HTML/CSS/JS vanilla (sem frameworks/bundlers no frontend).

---

## 2. Evolução do projeto (contexto histórico relevante)

O projeto passou por mudanças de stack importantes. Um agente continuando o trabalho **não deve reintroduzir** as abordagens abandonadas:

| Componente | v1.0 (demo) | v2.0 (produção inicial) | v2.3/v2.4 (atual) | v2.5 (planejado) |
|---|---|---|---|---|---|
| Banco de dados | SQLite local | PostgreSQL via Supabase (cloud) | **PostgreSQL local** (`127.0.0.1:5432`), auth `trust` | — |
| Interface operacional | HTML puro | Retool (low-code) | **HTML/CSS/JS vanilla** | HTML/CSS/JS vanilla + busca de produtos + check "Troca" |
| Deploy | localhost | Railway | Procfile aponta para Heroku | — |
| Autenticação | Sem login | Supabase Auth (JWT) para gerente | Middleware `auth.ts` valida JWT Supabase | — |
| Analytics | Sem painel | Streamlit (Python) | `dashboard.html` nativo (v2.4) | + date picker, export PDF/Excel, filtro por cozinha |
| Motor de fila | FIFO simples | — | Greedy slots c/ cooking_started | + SLA ajustado no zerou (v2.5) |
| Cancelamento | — | — | Motivos pré-definidos (v2.4) | + cross-cancel alert (v2.5) |
| Cardápio | — | — | Rotação determinística 14 menus | + calendário interativo c/ override (v2.5) |
| Gestão de erros | — | — | — | Status "anulado" sem impacto em métricas (v2.5) |

**Por que voltou a rodar PostgreSQL local:** o projeto Supabase (`gyhrbtvodalafsvcwygq`) foi pausado e, ao ser retomado, o DNS passou a publicar **somente registro AAAA (IPv6)**, sem registro A (IPv4). O `getaddrinfo` do Windows não resolve hosts IPv6-only, quebrando a conexão. Solução implementada em `src/db/client.ts` (mantida mesmo após voltar a usar Postgres local, pois permite alternar entre os dois sem mudar código):
1. Se o host já é um IP, usa direto (sem DNS).
2. Se é hostname, resolve via `dns.resolve6()` do Node (funciona), com fallback para `dns.resolve4()`.
3. Conecta ao IP resolvido, usando `servername` no SSL para bater com o certificado.
4. Detecta IPs locais (`127.0.0.1`, `::1`, `192.168.*`, `10.*`, `172.*`) e desabilita SSL automaticamente; para hosts remotos (Supabase), habilita SSL com SNI.

Para restaurar a conexão com Supabase quando o IPv4 voltar: só trocar `DATABASE_URL` no `.env` — o `client.ts` já trata os dois casos.

`SUPABASE_URL` / `SUPABASE_ANON_KEY` no `.env` hoje servem **apenas** para validação de JWT no middleware de auth, não para o banco de dados.

**PostgreSQL local:** instalado em `C:\Program Files\PostgreSQL\18`, serviço `postgresql-x64-18` precisa estar rodando. `pg_hba.conf` foi alterado para `trust` em conexões locais (127.0.0.1 e ::1), eliminando a necessidade de senha em desenvolvimento — **não usar essa configuração em produção real**.

---

## 3. Estrutura de diretórios (atual)

```
src/
├── server.ts               # Ponto de entrada — inicializa tudo, faz seed automático idempotente
├── types.ts                 # Interfaces TypeScript + augment do Fastify (io)
├── seed-prod.ts              # Seed standalone (node dist/seed-prod.js)
├── db/
│   ├── client.ts             # Pool PostgreSQL com resolução DNS IPv6/IPv4 (ver §2)
│   ├── migrations.ts         # Placeholder — schema real vive em supabase_schema.sql
│   └── seed.ts                # Seed legado (defasado vs server.ts)
├── middleware/
│   └── auth.ts                # Validação de JWT Supabase
├── routes/
│   ├── demands.ts             # CRUD demandas + cancel-salao/cozinha + ready/retrieve/stockout
│   ├── products.ts            # Listagem + toggle active
│   ├── daily-menu.ts          # Cardápio do dia + overrides
│   ├── kitchen-stations.ts    # CRUD estações + capacidade + queue-occupation
│   ├── admin.ts                # CRUD: produtos, menus, unidades, cancel_reasons
│   ├── analytics.ts            # Endpoints de analytics + dashboard completo
│   ├── auth.ts                  # Login + me
│   └── units.ts                  # Listagem unidades + por produto
├── services/
│   ├── queue.service.ts       # Motor de fila (greedy scheduling c/ capacity + cooking_started)
│   ├── sla.service.ts          # Avaliação SLA cozinha + retirada
│   ├── demand-events.service.ts # Audit trail
│   ├── menu.service.ts          # Rotação automática de cardápios (14 menus)
│   └── performance.service.ts   # [v2.4] Score de desempenho diário 0-5 por entidade
├── socket/
│   └── handlers.ts             # Rooms: salao, cozinha_quente, cozinha_fria, gerente
└── views/                        # HTML/CSS/JS inline, sem frameworks
    ├── salao.html               # Tela do garçom
    ├── cozinha-quente.html      # Cozinha quente (2 colunas A/B)
    ├── cozinha-fria.html        # Cozinha fria (grid)
    ├── cozinha.html              # Visão unificada legada (todas estações, sem filtro)
    ├── gerente.html               # Painel operacional
    ├── admin.html                  # CRUD completo (tabs: Produtos, Cozinhas, Cardápios, Unidades, Motivos Cancelamento)
    └── dashboard.html               # Dashboard analítico principal (v2.4)

dashboard/                       # App Python/Streamlit independente — analytics legado, ainda funcional
├── app.py
├── db.py                          # Conecta ao mesmo PostgreSQL
└── pages/
    ├── 1_Demandas.py
    ├── 2_Horarios.py
    ├── 3_Produtos.py
    ├── 4_Cardapios.py
    ├── 5_SLA.py
    └── 6_Cancelamentos_e_Roturas.py

supabase_schema.sql               # Schema real do banco — fonte da verdade (não migrations.ts)
Cadastro_Restaurante_KDS.xlsx     # Planilha para o cliente cadastrar produtos/cardápios/unidades
PLANO_MUDANCAS_CLIENTE.md         # [v2.5] Plano detalhado de implementação das mudanças do cliente
Procfile                            # Deploy Heroku: web: node dist/server.js
orange-pi-autostart.sh              # Auto-start do servidor no boot do Orange Pi
dist/                                # Build output (npm run build) — inclui views/ copiado
```

### URLs (views)

| URL | Tela | Perfil |
|---|---|---|
| `/salao` | Garçom — registrar demandas | Sem login |
| `/cozinha-quente` | Cozinha Quente A/B (2 colunas) | Sem login |
| `/cozinha-fria` | Cozinha Fria (grid) | Sem login |
| `/cozinha` | Visão unificada legada (todas estações, fallback) | Sem login |
| `/gerente` | Métricas + cardápio + histórico | Gerente |
| `/admin` | CRUD completo | Gerente |
| `/dashboard` | Dashboard analítico | Gerente |

---

## 4. Banco de dados — PostgreSQL

### 4.1 Conexão local (desenvolvimento atual)

```
postgresql://postgres:postgres@127.0.0.1:5432/postgres
```

- Serviço `postgresql-x64-18` precisa estar rodando (`Start-Service -Name "postgresql-x64-18"` como Admin)
- Schema aplicado via `psql -f supabase_schema.sql`
- Seed automático e idempotente ao iniciar `server.ts` (verifica `COUNT` antes de inserir)
- Pool: lazy initialization (só cria na primeira query), max 10 conexões, idle timeout 30s, connection timeout 10s (v2.3) / 5s (v2.0, valor antigo)

### 4.2 Tabelas (13)

| Tabela | Função | Colunas-chave adicionais relevantes |
|---|---|---|
| `products` | Produtos/pratos | `kitchen_station_id`, `sla_minutes_normal`, `sla_minutes_urgente` (SLA duplo — ver §4.4), `active` |
| `product_units` | Vínculo N:N produto ↔ unidade — lista do que é válido pedir daquele produto | `product_id`, `unit_id` — **todo produto precisa de ao menos 1 linha aqui** ou o select do salão fica vazio |
| `kitchen_stations` | 3 estações: `quente_a`, `quente_b`, `fria` | `capacity` (nº de "cozinheiros"/vagas simultâneas), ajustável pelo gerente em tempo real |
| `units` | Unidades de medida (kg, porções, travessa_g, bacia, tigela, etc.) | Gerente pode adicionar novas sem deploy |
| `menus` | 14 cardápios numerados (imutáveis no dia a dia) | |
| `menu_products` | Produtos de cada cardápio | |
| `daily_menus` | Cardápio ativo em cada data (rotação automática) | `is_override` |
| `daily_menu_overrides` | Adições/remoções manuais no cardápio do dia, sem afetar rotação de outros dias | `action` (`add`/`remove`) |
| `demands` | Ciclo de vida completo de cada demanda | ver §4.3 |
| `demand_events` | Audit trail (created, ready, retrieved, cancelled, sla_breach, stockout) | `actor` (`salao`/`cozinha`/`sistema`) |
| `cancel_reasons` | **v2.4** — motivos pré-definidos de cancelamento | `category` (`salao`/`cozinha`), `active` |
| `performance_scores` | **v2.4** — notas diárias de desempenho 0-5 por entidade (cozinha_quente_a, cozinha_quente_b, cozinha_fria, salao, cozinha_geral) | `final_score`, `sla_breach_deduction`, `cancellation_deduction`, `stockout_deduction`, `slow_item_deduction` |
| `system_settings` | Configurações globais | ex.: `pickup_tolerance_minutes`, pesos de score, **[v2.5]** `data_retention_days` |

### 4.3 Colunas relevantes em `demands`

- `quantity` — `NUMERIC(10,2)` 
- `unit_id`, `unit_label` (snapshot, igual a `product_name`)
- `kitchen_station_id`, `sla_minutes` (snapshot do produto no momento da criação — mudar o SLA do produto depois não reescreve demandas antigas)
- `status`: `pending | ready | retrieved | cancelled_salao | cancelled_cozinha | annulled` **[v2.5: +annulled]**
- `ready_at`, `retrieved_at`, `cancelled_at`, `cancel_reason` (texto) + `cancel_reason_id` (FK para `cancel_reasons`, v2.4)
- `stockout_reported`, `stockout_reported_at`
- `expected_ready_at` (calculado pelo motor de fila)
- `cooking_started`, `cooking_started_at` — trava de "já em preparo" (ver §6)
- `sla_breached_cozinha` / `sla_breach_minutes_cozinha`, `sla_breached_salao` / `sla_breach_minutes_salao`
- **[v2.5]** `is_replacement BOOLEAN` — se a demanda é uma troca de item do cardápio
- **[v2.5]** `replaced_product_id UUID` — FK → products, item do cardápio que foi substituído
- **[v2.5]** `ready_out_of_order BOOLEAN` — se o item foi marcado pronto antes de outro que iniciou antes
- **[v2.5]** `annulled_at TIMESTAMPTZ`, `annulled_by TEXT`, `annul_reason TEXT` — auditoria de anulação

### 4.4 SLA duplo por produto (decisão v2.2, substituiu SLA único da v2.1)

Um cozinheiro consegue acelerar um prato até certo ponto, mas o sistema não deve inventar um tempo impossível — por isso `sla_minutes_normal` e `sla_minutes_urgente` são colunas separadas em `products` (`sla_minutes_urgente` pode ser igual ao normal se o prato não aceita ser acelerado; **nunca forçar um valor menor arbitrário**). Na criação da demanda, o backend resolve `slaMinutes = priority === 'urgent' ? sla_minutes_urgente : sla_minutes_normal` e grava o snapshot em `demands.sla_minutes`.

### 4.5 Unidades por produto (decisão v2.2)

Não existe "unidade padrão" fixa por produto — o salão sempre escolhe entre as unidades **válidas** daquele produto (tabela `product_units`), evitando erro de digitação/escolha (ex.: pedir "litro" de um prato que só se mede em travessa). Validação feita na camada de aplicação (não FK/trigger) para dar mensagem de erro melhor ao frontend:

```typescript
const [valid] = await query(
  'SELECT 1 FROM product_units WHERE product_id = $1 AND unit_id = $2',
  [productId, unitId]
)
if (!valid) return reply.code(400).send({ error: 'Esta unidade não é válida para este produto' })
```

---

## 5. Ciclo de vida da demanda

```
[PENDENTE] ──(cozinha marca pronto)──► [PRONTA] ──(salão retira)──► [RETIRADA]
    │                                      │
    ├──(salão cancela)──► [CANCELADA_SALAO]│
    │                                      ├──(cozinha cancela)──► [CANCELADA_COZINHA]
    └──(cozinha cancela)──► [CANCELADA_COZINHA]

    [PENDENTE] ──(salão reporta zerou)──► prioridade escala para 'urgent', SLA ajustado

    [QUALQUER ESTADO] ──(gerente anula)──► [ANULADA]
        └─ mantém registro mas zera impacto em métricas (v2.5)
```

**Por que existe o estado intermediário "Pronta" além de "Retirada":** é o que permite atribuir responsabilidade de atraso tanto à cozinha (demorou pra cozinhar) quanto ao salão (demorou pra buscar depois de pronto).

### Transições e endpoints

| Transição | Quem | Endpoint |
|---|---|---|
| pending → ready | cozinha | `PATCH /api/v1/demands/:id/ready` |
| ready → retrieved | salão | `PATCH /api/v1/demands/:id/retrieve` |
| pending → cancelled_salao | salão | `PATCH /api/v1/demands/:id/cancel-salao` |
| pending/ready → cancelled_cozinha | cozinha | `PATCH /api/v1/demands/:id/cancel-cozinha` |
| — → stockout (zerou) | salão | `POST /api/v1/demands/:id/stockout` |
| **[v2.5]** qualquer → annulled | gerente | `POST /api/v1/admin/demands/:id/annul` |

`cancel-salao` e `cancel-cozinha` aceitam `cancel_reason_id` no body (v2.4), resolvem o label e salvam tanto o texto (`cancel_reason`) quanto a FK (`cancel_reason_id`).

**Cozinha Quente A e B** são duas filas/capacidades **independentes**, exibidas na mesma tela física (mesmo Orange Pi/URL, layout dividido ao meio) — a separação é só de renderização, não de comunicação em tempo real (ambas ficam na mesma room `cozinha_quente`, filtrando por `kitchen_station_id` no cliente).

---

## 6. Motor de fila (`queue.service.ts`)

Algoritmo greedy de máquinas paralelas, chamado após: criação de demanda, ready, cancelamento (qualquer lado), mudança de capacidade, stockout.

**Regra central:** uma demanda só fica "travada" (`cooking_started = true`) no exato instante em que a vaga que ela ocupa está livre **agora** — antes disso ela é só uma previsão de fila e pode ser ultrapassada por prioridade. Isso permite que uma demanda urgente fure a fila sem "descozer" um prato que o cozinheiro já começou a fazer.

Passo a passo:
1. Busca demandas `pending` da estação, ordenadas por `created_at`.
2. Separa em `locked` (já com `cooking_started = true`, mantêm o `expected_ready_at` que já têm — nunca competem por vaga) e `waiting`.
3. Ordena `waiting`: urgente primeiro, depois FIFO por `created_at`.
4. Monta array de `slots` — um por vaga já travada (com seu horário fixo) + o restante da capacidade preenchido com "agora".
5. Para cada demanda `waiting`, pega a vaga que libera mais cedo (`Math.min` dos slots); se essa vaga era "agora" → a demanda trava (`cooking_started = true`, `cooking_started_at = now()`); se era uma vaga futura → só atualiza `expected_ready_at`, continua destravável.
6. `expected_ready_at = start + sla_minutes * 60_000`.
7. Tudo dentro de uma transação (`BEGIN`/`COMMIT`/`ROLLBACK`, `client.release()` sempre em `finally`).

**Zerou escala prioridade (v2.2, aprimorado v2.5):** ao reportar `stockout` numa demanda `pending`, o sistema promove-a para `priority = 'urgent'` automaticamente. **[v2.5]** Além disso, o `sla_minutes` é recalculado: se o ETA atual > `sla_minutes_urgente` do produto, reduz para o SLA urgente; se ETA atual ≤ SLA urgente, mantém. Isso evita que um item zerado mantenha o SLA mais longo do item normal.

---

## 7. Socket.IO — Eventos e rooms

### Rooms

| Room | Quem entra |
|---|---|
| `salao` | salao.html |
| `cozinha_quente` | cozinha-quente.html |
| `cozinha_fria` | cozinha-fria.html |
| `gerente` | gerente.html, dashboard.html |

Fluxo de conexão: cliente conecta → recebe `socket.id` → emite `join` ou `identify` com o nome da sala → servidor adiciona à room correspondente.

### Eventos emitidos pelo servidor

| Evento | Quem recebe | Quando |
|---|---|---|
| `demand:new` | todos (broadcast) | Demanda normal criada |
| `demand:urgent` | todos (broadcast) | Demanda urgente criada |
| `demand:ready` | salao | Cozinha marca pronto |
| `demand:updated` | (não usado diretamente) | — |
| `demand:retrieved` | todos | Salão confirma retirada |
| `demand:cancelled` | todos | Cancelamento (payload inclui `cancelled_by`) |
| `demand:stockout` | cozinha_quente/cozinha_fria, salao | Zerou reportado — som mais alto que urgente normal |
| `demand:cross-cancel` | **[v2.5]** todos | Item cancelado por um lado já estava em preparo pelo outro — alerta proeminente |
| `demand:queue-updated` | todos | Fila recalculada (afeta cronômetros exibidos) |
| `kitchen:capacity-updated` | cozinha_quente, cozinha_fria, gerente | Capacidade alterada |
| `menu:updated` | salao | Cardápio do dia alterado |
| `product:updated` | todos | Produto alterado/desativado |

> **Importante (mudança v2.4):** `demand:new`, `demand:urgent` e `demand:queue-updated` foram alterados de `io.to(room).emit()` para `io.emit()` (broadcast global) após problemas de entrega a rooms específicas. Funcional para o porte atual (~3-5 clientes simultâneos), mas se o sistema crescer isso deve ser revisitado — o design original (v2.1) previa emissão direcionada por estação/room para reduzir ruído.

---

## 8. Cancel Reasons — sistema v2.4

```sql
CREATE TABLE cancel_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label VARCHAR(100) NOT NULL,
  category VARCHAR(10) NOT NULL CHECK (category IN ('salao','cozinha')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Seed (8 motivos): Salão — Erro no pedido, Cliente desistiu, Pedido duplicado, Mudança de cardápio. Cozinha — Falta de insumo, Prato estragado/contaminado, Equipamento com defeito, Tempo de preparo inviável.

Integração:
- `salao.html`: modal de cancelamento com `<select>` de motivos de categoria `salao`
- `cozinha-quente.html` / `cozinha-fria.html`: modal dark com `<select>` de motivos de categoria `cozinha`
- `admin.html`: tab "Motivos Cancelamento" com CRUD (criar, toggle ativo/inativo, excluir)
- API: `GET/POST/PATCH/DELETE /api/v1/admin/cancel-reasons` + `GET /api/v1/analytics/cancel-reasons`

---

## 9. Dashboard analítico (`/dashboard`, v2.4 → v2.5)

`GET /api/v1/analytics/dashboard?range=today|week|month` (v2.4) / `?from=&to=` **[v2.5]** retorna objeto com 16 seções:

| Chave | Conteúdo |
|---|---|
| `kpis` | 11 métricas: total_pedidos, zerados, cancelados, atrasos (cozinha/salão), urgentes (puros/zerou), SLA%, tempo médio |
| `produtos` | Ranking por `SUM(quantity)` |
| `trend` | Breakdown diário (entregues, cancelados, zerados, atrasos) — só multi-day |
| `speed_by_hour` | Tempo médio de preparo por hora |
| `queue_time_by_station` | Tempo de espera na fila + preparo por estação. **[v2.5]** Adicionado breakdown por hora |
| `occupancy_by_shift` | % ociosa por turno (Manhã/Almoço/Tarde/Jantar) |
| `sla_by_product` | Pareto de estouros de SLA por produto |
| `cancel_reasons` | Agrupamento por motivo (usa tabela `cancel_reasons`) |
| `pickup_by_hour` | Tempo médio de retirada por hora |
| `volume_ma` | Média móvel de 7 dias — só multi-day |
| `weekday_seasonality` | Volume por dia da semana |
| `qty_vs_time` | Scatter quantidade × tempo real de preparo |
| `heatmap` | Matriz hora × dia da semana |
| `funnel` | criadas → prontas → retiradas → canceladas |
| `week_comparison` | **[v2.5]** Período atual vs anterior com linha de indicador selecionável (SLA%, tempo médio, cancelamentos, zerados, % urgentes) |
| `scatter_zerados` | Scatter total demandas × total zerados por produto |

**Melhorias planejadas (v2.5):**
- Seletor de data com calendário (dia específico ou período de até 31 dias) + botões rápidos (Hoje/Ontem/7d/30d)
- Filtro por estação/cozinha (`station_id` query param)
- Exportação PDF (por dia ou consolidado) e Excel (abas por seção)
- Tela de critérios de avaliação explicando o cálculo do score de desempenho
- Auto-limpeza de dados > 6 meses configurável via `system_settings.data_retention_days`

---

## 10. API — rotas HTTP consolidadas

| Prefixo | Arquivo | Principais operações |
|---|---|---|
| `/api/v1/products` | `products.ts` | `GET /`, `GET /all`, `PATCH /:id` (toggle active), **[v2.5]** `GET /search?q=` |
| `/api/v1/demands` | `demands.ts` | `GET /`, `POST /`, `PATCH /:id/ready`, `PATCH /:id/retrieve`, `PATCH /:id/cancel-salao`, `PATCH /:id/cancel-cozinha`, `POST /:id/stockout`, `GET /history`, `GET /metrics` |
| `/api/v1/daily-menu` | `daily-menu.ts` | `GET /today`, `PATCH /today`, `GET /:date`, **[v2.5]** `GET /calendar?from=&to=` |
| `/api/v1/kitchen-stations` | `kitchen-stations.ts` | `GET /`, `PATCH /:id`, `GET /queue-occupation` |
| `/api/v1/units` | `units.ts` | `GET /`, `GET /by-product/:productId` |
| `/api/v1/admin` | `admin.ts` | CRUD produtos/menus/unidades/cancel_reasons; `POST /menus/:id/set-today`; `POST /units/bind-product`; **[v2.5]** `POST /demands/:id/annul`; `PUT /daily-menu/:date`; `POST /cleanup` |
| `/api/v1/analytics` | `analytics.ts` | Endpoints do dashboard (§9). **[v2.5]** `from`/`to` date range, `station_id` filter |
| `/api/v1/auth` | `auth.ts` | `POST /login`, `GET /me` |

Fastify + Socket.IO no mesmo servidor HTTP, porta 3000. CORS aberto em dev (`*`).

---

## 11. Frontend / Views — design system

Todas as views: HTML puro + CSS inline + JS vanilla, sem frameworks/bundlers. Fonte Inter (Google Fonts, `&display=swap`, pesos 400/500/600/700/800). Socket.IO client via `/socket.io/socket.io.js`.

**Paleta:**

| Token | Hex | Uso |
|---|---|---|
| Fundo cozinhas | `#0f0f0f` / `#0a1628` | Background escuro cozinhas |
| Fundo claro | `#f4f4f5` | Salão/gerente/admin |
| Card escuro / claro | `#1a1a1a` / `#ffffff` | |
| Primária/Urgente | `#e63946` | Ações destrutivas, urgente, cancelar |
| Secundária/Sucesso | `#2a9d8f` | Pronto, confirmar, ETA ok |
| Terciária/Warning | `#f4a261` | Rotura, SLA breached |
| Header | `#1d3557` | Headers, barras de título |
| Label | `#457b9d` | Info secundária |
| Texto claro/escuro | `#f1faee` / `#1e1e1e` | |
| Border | `#e0e0e0` | |
| Disabled | `#9ca3af` | |

**Animações:** `fadeInUp` (cards entrando), `urgentPulse` (glow em cards urgentes), `gentlePulse` (badge "PRONTA").

### Views principais

- **`salao.html`** — form de registro (produto/quantidade/unidade dinâmica/urgência), **[v2.5]** busca com autocomplete (itens do cardápio favoritados + busca global), check "Troca" com dropdown do item substituído, header com data e cardápio ativo, duplo botão de confirmar retirada, modal de cancelamento (`backdrop-filter: blur(4px)`). IDs preservados: `#demandForm`, `#productSelect`, `#productSearch` **[v2.5]**, `#quantity`, `#unitSelect`, `#isUrgent`, `#isReplacement` **[v2.5]**, `#replacedProduct` **[v2.5]**, `#demandList`, `#cancelModal`, `#cancelReason`, `#confirmCancelBtn`, `#closeCancelModal`, `.retrieve-btn`, `.cancel-btn`, `.zerou-btn` **[v2.5]**, `.demand-card`, `.badge`.
- **`cozinha-quente.html`** — 2 colunas (A borda vermelha / B borda laranja), **[v2.5]** contagem regressiva global (canto superior direito, update 1s), botão cancelar 64px, duplo clique no "Pronto", gestão visual de cores (vermelho=urgência, verde=dopamina, flash na entrada), alerta de cancelamento cruzado. IDs: `#reconnectBanner`, `#globalTimer` **[v2.5]**, `#gridA`, `#gridB`, `.ready-btn`, `.cancel-btn`.
- **`cozinha-fria.html`** — mesma lógica em grid único, acentos ciano (`#00d4ff`), fundo `#0a1628`. **[v2.5]** Mesmas melhorias da cozinha quente.
- **`cozinha.html`** — visão unificada legada (todas estações sem filtro), fallback.
- **`gerente.html`** — 3 cards de métrica, cardápio do dia com remoção, **[v2.5]** calendário interativo de cardápios com override por data, botão anular demanda, tabela zebrada com últimas 100 demandas, botão para `/admin`.
- **`admin.html`** — tabs Produtos / Cozinhas / Cardápios / Unidades / Motivos Cancelamento; CRUD inline; toast notifications.
- **`dashboard.html`** — **[v2.5]** seletor de data (calendário + botões rápidos), filtro por cozinha, exportação PDF/Excel, gráfico Comparativo com linha de indicador selecionável, tela de critérios de avaliação. Atualização via Socket.IO.

**Regra geral:** preservar IDs existentes no HTML — o JS depende deles para manipulação do DOM.

---

## 12. Configuração de ambiente

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
SUPABASE_URL=https://gyhrbtvodalafsvcwygq.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
REFERENCE_DATE=2025-01-01
NODE_ENV=development
RETOOL_URL=
```

- `REFERENCE_DATE` define o dia-base da rotação dos 14 cardápios (`(diffDays % 14) + 1`) — ajustar para a data real em que o restaurante começar a usar o sistema.
- `.env` nunca deve ser commitado (`.gitignore`: `node_modules/`, `dist/`, `.env`, `*.db`, `.DS_Store`).

---

## 13. Comandos úteis

```powershell
# Iniciar PostgreSQL (como Admin)
Start-Service -Name "postgresql-x64-18"

# Verificar status
Get-Service -Name "postgresql-x64-18"

# Conectar via psql
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d postgres

# Aplicar/recriar schema
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d postgres -f supabase_schema.sql
```

```bash
npm run dev              # servidor dev com hot-reload (ts-node-dev)
npm run build             # tsc + copia views HTML para dist/views/
npm start                  # roda a partir de dist/
node dist/seed-prod.js     # seed standalone, sem subir o servidor
```

---

## 14. Convenções de código

- TypeScript `strict: true`
- SQL sempre parametrizado (`$1, $2, ...`) — **nunca** concatenar strings
- Todas as queries são `async` via `query<T>(sql, params)` de `db/client.ts`
- Eventos Socket.IO: `fastify.io.emit()` (broadcast) ou `fastify.io.to(room).emit()` — hoje os 3 eventos críticos de demanda usam broadcast global (ver §7)
- Views: HTML/CSS/JS inline, sem frameworks
- **`GROUP BY` sempre posicional** (`GROUP BY 1, 2, ...`), nunca por alias — ver §16.2
- Nunca usar `additionalProperties: false` em schemas de validação Fastify sem necessidade explícita — ver §16.4
- Preservar IDs existentes no HTML (dependência do JS)

---

## 15. Hardware (contexto original — validar se ainda se aplica ao estado atual do projeto)

Definido em v1.0/v2.1, não confirmado como ainda vigente no v2.3/v2.4 (que já rodam localmente em notebook/Windows). Se o deploy físico na cozinha ainda for parte do plano:

- **SBC:** Orange Pi Zero 3 4GB + placa de expansão (~R$497) — Raspberry Pi 4 descartado por custo no Brasil
- **SO:** Debian 12 Bookworm Server (headless, sem interface gráfica)
- **Vídeo:** Micro HDMI via placa de expansão; **2 monitores** via splitter HDMI 1x2 ativo (uma seção da cozinha por monitor)
- **Exibição:** Chrome/Chromium em modo quiosque, trava na URL da cozinha
- **Acesso remoto:** Tailscale (VPN mesh gratuita, até 3 devices)
- **Tablet do salão:** Android com Fully Kiosk Browser
- Configuração evoluiu de **1 Orange Pi** (v2.0) para **2 Orange Pi** (v2.1): um para Cozinha Quente (tela dividida A/B), outro para Cozinha Fria — refletindo o modelo atual de duas estações independentes
- Cuidados de campo: sempre usar dissipador em local ventilado (throttling em pico); fonte USB-C obrigatoriamente 5V/3A ou superior (fonte fraca causa travamentos aleatórios)
- `orange-pi-autostart.sh` no repo cuida do autostart do servidor no boot

**Planilha de cadastro do cliente** (`Cadastro_Restaurante_KDS.xlsx`): 4 abas — LEIA-ME (instruções), PRODUTOS (nome/categoria/estação/SLA normal/SLA urgente/unidades, 10 exemplos), CARDÁPIOS (nº 1-14/nome/produtos separados por vírgula, 5 exemplos), UNIDADES (código/nome, 10 padrão).

---

## 16. Problemas resolvidos (lições para não repetir)

### 16.1 Dashboard: "coluna created_at é ambígua"
Queries com JOIN (`demands d JOIN kitchen_stations ks`, `demands d LEFT JOIN cancel_reasons cr`) referenciavam `created_at` sem prefixo de tabela — ambas têm essa coluna. **Solução:** sempre prefixar (`d.created_at`) em queries com JOIN.

### 16.2 Dashboard: "coluna X deve aparecer no GROUP BY"
Com `only_full_group_by`, Postgres rejeita `GROUP BY alias` (quando o alias vem de CASE/EXTRACT) e `ORDER BY` com coluna não-agregada após GROUP BY. **Solução geral e permanente:** usar `GROUP BY 1, 2, ...` (posicional) sempre; se o `ORDER BY` for complexo, ordenar em TypeScript (`.sort()`) em vez de SQL.

### 16.3 Socket.IO: cozinhas não recebiam eventos em tempo real
Causa raiz: um `<div id="cancelModal">` foi inserido **depois** da tag `</script>`, mas os `addEventListener` dos seus botões estavam **dentro** do script. Como o DOM não existia ainda na execução, `getElementById(...)` retornava `null` e `.addEventListener` em `null` quebrava o script inteiro antes de registrar os handlers de Socket.IO. **Soluções aplicadas (mantidas como padrão):**
1. HTML de modais sempre **antes** da tag `<script>`.
2. Todo `addEventListener` envolvido em `if (element) element.addEventListener(...)`.
3. `setInterval(carregarDemandas, 5000)` como polling fallback, independente do Socket.IO.

### 16.4 Erro 400 na criação de demandas
`additionalProperties: false` no schema Fastify de `POST /api/v1/demands` rejeitava qualquer campo extra do body. **Solução:** removido esse schema restritivo dessa rota — cuidado ao reintroduzir validação estrita sem revisar todos os campos que o frontend realmente envia.

---

## 17. Correções de bugs pós-implementação (23/07/2026)

**Bugs identificados e corrigidos — rodada 1 (9 itens, 23/07/2026):**

| Bug | Arquivo | Solução |
|-----|---------|---------|
| DB local ao invés de Supabase | `.env`, Supabase | `DATABASE_URL` → Supabase; migration v2.5 aplicada |
| Preempção zerou SLA não funcionava | `demands.ts` | SELECT após recompute + emit `demand:queue-updated` |
| Timer único misturava A+B | `cozinha-quente.html` | `#timerA` + `#timerB` (um por coluna) |
| Sem countdown por demanda | `cozinha-quente.html`, `cozinha-fria.html` | `.card-timer` com MM:SS regressivo |
| Unidades "erro ao carregar" | `salao.html`, Supabase | `console.error` + schema corrigido |
| Dashboard: datas customizadas | `dashboard.html` | try/catch em `buildContent` |
| Dashboard: dropdown cozinhas | `dashboard.html` | `console.error` + feedback visual |
| Dashboard: exportar | `dashboard.html` | Botão inicia disabled, habilita ao carregar |
| Dashboard: indicador gráfico | `dashboard.html` | Event listener com referência correta |

**Bugs identificados e corrigidos — rodada 2 (8 itens, 23/07/2026):**

| Bug | Arquivo | Solução |
|-----|---------|---------|
| SLA após zerou virava 0 | `demands.ts:268-279` | `Math.min(sla, null)` → 0. Corrigido com guard `urgente != null && > 0` |
| Timers de demanda pequenos | `cozinha-quente.html`, `cozinha-fria.html` | `.card-timer` de 13px para 19px, font-weight 800 |
| Pedidos "Troca" sem indicador visual | `cozinha-quente.html`, `cozinha-fria.html`, `demands.ts`, `types.ts` | Badge roxo "TROCA" + nome do item substituído (`replaced_name`) nas queries |
| Anular demanda retornava 500 e deixava inconsistência | `admin.ts`, `supabase_schema.sql` | Transação atômica (`client.query()` no lugar de `query()`); constraint `demand_events.event_type` não incluía `'annulled'` — migration aplicada |
| Export Excel "Por Dia" gerava aba "0723" vazia | `dashboard.html` | Nome da aba corrigido para `DD/MM`; closure IIFE para capturar variáveis corretas; exporta produtos + cancelamentos por dia |
| Export PDF "Por Dia": imagens achatadas, página em branco, sem data | `dashboard.html` | Scale 1.5→2; removido `pdf.addPage()` extra entre dias; header azul com data `DD/MM/AAAA` por página |
| Gráfico "Evolução das Notas" com nome escapado + apenas 1 linha | `dashboard.html` | Unicode escapado corrigido; séries trocadas para Quente A (vermelho), Quente B (laranja), Fria (ciano), Salão (azul) |
| Sistema de notas sem datas dos erros individuais | `performance.service.ts`, `analytics.ts`, `dashboard.html` | Nova função `getDetractorDates()`; endpoint `/performance` retorna `detractor_dates`; tabela no frontend com hora, tipo, produto e detalhe de cada ocorrência |

---

## 18. Contexto de negócio (referência, da v1.0 — validar se ainda vigente)

- Perfis de acesso originais: Salão (`/salao`, tablet, sem login), Cozinha (`/cozinha`, monitor + Orange Pi, sem login), Gerente (`/admin`, celular/PC, com login) — o modelo de "acesso por URL sem login para operação, login só para gerente" permanece a lógica de fundo do sistema.
- Precificação sugerida (pode estar desatualizada): sistema completo R$1.500–3.000, repasse de hardware sem margem R$800–1.500, manutenção mensal R$100–200, instalação presencial avulsa R$150–300. Split sugerido: 50% na aprovação + 50% na entrega.
- Evoluções futuras cogitadas como upsell: login individual por funcionário, app mobile nativo com push, integração com PDV, alertas via WhatsApp para item parado, relatório mensal em PDF por email, dashboard em TV na área administrativa.

---

## 19. Checklist para quem for continuar o projeto

### Pré-condições
- [x] Conexão com Supabase ativa (`DATABASE_URL` aponta para `db.gyhrbtvodalafsvcwygq.supabase.co`)
- [x] Migration v2.5 aplicada no Supabase (colunas novas + constraint `annulled` + view `daily_menu_effective`)
- [ ] Validar que todo produto tem pelo menos uma linha em `product_units` e SLA normal/urgente definidos

### Correções (v2.5) — rodada 1, 23/07/2026
- [x] Bug dashboard week/month: `Math.floor(rangeNum)` + remover `::integer`
- [x] Preempção zerou SLA: `SELECT` movido para depois do `recomputeStationQueue` + `demand:queue-updated`
- [x] Timers cozinha-quente: `#timerA` e `#timerB` por coluna + `.card-timer` por demanda
- [x] Timer cozinha-fria: `.card-timer` por demanda
- [x] Dashboard `buildContent` com try/catch; `.catch()` restaura UI
- [x] Dashboard `loadStations`: `console.error` + feedback visual no dropdown
- [x] Dashboard botão Exportar: inicia desabilitado, habilita ao carregar dados
- [x] Dashboard `cmpIndicatorSelect`: `removeEventListener` usa referência correta
- [x] Salão `loadUnitsForProduct`: `console.error` no catch

### Correções (v2.5) — rodada 2, 23/07/2026
- [x] SLA zerou: guard `urgente != null && > 0` no `Math.min`
- [x] Timers das demandas ampliados (13px → 19px)
- [x] Badge "TROCA" roxo nas cozinhas + campo `replaced_name` nas queries
- [x] Anulação atômica: `client.query()` no lugar de `query()` dentro da transação
- [x] Constraint `demand_events.event_type` inclui `'annulled'` (migration aplicada)
- [x] Excel "Por Dia": nome `DD/MM`, closure IIFE, mais dados por aba
- [x] PDF "Por Dia": scale 2, header com data, sem página em branco
- [x] Gráfico notas: título corrigido, 4 linhas (Quente A/B, Fria, Salão)
- [x] Datas dos erros de dedução no `/performance` + tabela no frontend

### Pendências de arquitetura
- [ ] Revisar se `RETOOL_URL` / CORS restrito ainda fazem sentido, já que o Retool foi abandonado
- [ ] Revisar se o broadcast global do Socket.IO (§7) ainda é adequado ou se deve voltar a rooms direcionadas
- [ ] Confirmar se o hardware físico (Orange Pi/§15) segue sendo o plano de deploy ou se foi substituído

### Implementação v2.5 (ver `PLANO_MUDANCAS_CLIENTE.md` para especificações detalhadas)
- [x] **Salão:** Trocar "Rotura" → "Zerou" nos labels de UI
- [x] **Salão:** Duplo botão de confirmar retirada (modal 2 etapas)
- [x] **Salão:** Busca de produtos fora do cardápio (`GET /products/search`)
- [x] **Salão:** Header com data e cardápio do dia
- [x] **Salão:** Check "Troca" + dropdown de item substituído
- [x] **Cozinha:** Botões maiores (touch-friendly 64px) + duplo clique no "Pronto"
- [x] **Cozinha:** Contagem regressiva por coluna + por demanda (update 1s)
- [x] **Cozinha:** Gestão visual de cores (vermelho=urgência, verde=dopamina, flash entrada)
- [x] **Cozinha:** Ajuste de SLA no zerou (`demands.ts`)
- [x] **Cozinha:** Flag "pronto fora de sequência" (`ready_out_of_order`)
- [x] **Cozinha:** Alerta de cancelamento cruzado (`demand:cross-cancel`)
- [x] **Gerente:** Calendário interativo de cardápios com override e propagação sequencial
- [x] **Gerente:** Status "anulado" — endpoint `POST /admin/demands/:id/annul` + filtro em todas as queries de analytics
- [x] **Dashboard:** Seletor de data (calendário, período até 31 dias)
- [x] **Dashboard:** Filtro por estação/cozinha (`station_id` param)
- [x] **Dashboard:** Exportação PDF (html2canvas+jspdf) e Excel (SheetJS)
- [x] **Dashboard:** Gráfico "Comparativo" com linha de indicador selecionável
- [x] **Dashboard:** Gráfico "Tempo fila por estação" com breakdown por hora
- [x] **Dashboard:** Tela de critérios de avaliação (score 0-5)
- [x] **Admin:** Endpoint de cleanup de dados antigos (`POST /admin/cleanup`)
- [x] **Schema:** Novas colunas em `demands` + constraint `annulled` + `data_retention_days`

---

## 20. Sumário de mudanças (v2.5 — implementado 22/07/2026, corrigido 23/07/2026)

> O plano detalhado com especificações técnicas, queries, endpoints e ordem de implementação está em `PLANO_MUDANCAS_CLIENTE.md`. Todos os 21 itens do plano original foram implementados. Em 23/07/2026, 17 bugs pós-implementação foram corrigidos em duas rodadas (9 + 8, ver §17 e §19).

### Nomenclatura
- **"Rotura" → "Zerou"** em todos os labels de UI. Código interno (`stockout`, `stockout_reported`) e colunas DB mantidos.

### Novas colunas em `demands`
| Coluna | Tipo | Função |
|--------|------|--------|
| `is_replacement` | `BOOLEAN DEFAULT false` | Demanda é troca de item do cardápio |
| `replaced_product_id` | `UUID REFERENCES products` | Item original que foi substituído |
| `ready_out_of_order` | `BOOLEAN DEFAULT false` | Item pronto antes de outro que iniciou antes |
| `annulled_at` | `TIMESTAMPTZ` | Timestamp da anulação |
| `annulled_by` | `TEXT` | Quem anulou |
| `annul_reason` | `TEXT` | Motivo da anulação |

### Novos endpoints
| Método | Path | Função |
|--------|------|--------|
| `GET` | `/api/v1/products/search?q=` | Busca produtos com flag `in_today_menu` |
| `GET` | `/api/v1/daily-menu/calendar?from=&to=` | Calendário de cardápios |
| `PUT` | `/api/v1/admin/daily-menu/:date` | Override de cardápio por data |
| `POST` | `/api/v1/admin/demands/:id/annul` | Anular demanda (status `annulled`) |
| `POST` | `/api/v1/admin/cleanup` | Limpar dados antigos |

### Novo evento Socket.IO
| Evento | Gatilho |
|--------|---------|
| `demand:cross-cancel` | Item cancelado por um lado já estava em preparo pelo outro |

### Novas bibliotecas (CDN, frontend apenas)
- `html2canvas` + `jspdf` — exportação PDF
- `SheetJS (xlsx)` — exportação Excel

### Pontos de atenção para implementação
1. Status `annulled` precisa ser excluído de TODAS as queries de analytics, métricas e performance scores
2. O endpoint `POST /stockout` deve atualizar `sla_minutes` ao promover prioridade (não só `priority`)
3. A correção do bug dashboard (§17) é pré-requisito para o novo seletor de data
4. Exportação PDF/Excel roda no navegador do gerente (notebook), não no Orange Pi
5. Preservar todos os IDs existentes no HTML — convenção do projeto (§14)
6. **CHECK constraint de `demand_events.event_type` precisa incluir `'annulled'`** — a migration no `supabase_schema.sql:344-352` faz isso, mas pode precisar ser aplicada manualmente se o banco não tiver a migração v2.5. Sem ela, `logDemandEvent(id, 'annulled', ...)` falha com erro de constraint
7. **Transações no admin.ts exigem `client.query()` (PoolClient), não `query()` (Pool)** — a função global `query()` pega uma conexão diferente do pool, fora da transação. Dentro de `BEGIN`/`COMMIT`, usar `client.query()` explicitamente
8. **Gráfico de notas mostra 4 linhas:** Quente A (vermelho), Quente B (laranja), Fria (ciano), Salão (azul) — expandir se novas estações forem adicionadas
