# Dois ajustes no Gerenciamento Avançado (/admin) — Implementation Plan

**Goal:** (1) permitir editar a **categoria** de um produto já cadastrado, igual aos
demais campos da tabela de Produtos; (2) adicionar o **cardápio Jantar** ao dropdown
da aba Cardápios, permitindo editar a lista de produtos do jantar ali mesmo.

**Não-objetivo:** criar um cardápio nº 15 na tabela `menus`. O jantar continua sendo a
lista de produtos ativos da **Cozinha Jantar** (estação `jantar`) — é o que o turno
jantar injeta no cardápio do dia via `daily_menu_overrides` (`shift.service.ts`).

## Contexto descoberto

- `PUT /api/v1/admin/products/:id` **já** aceita `category` (allowlist em `admin.ts`).
  O bloqueio é só de UI: `loadProducts()` renderiza a categoria como texto puro.
- A nuvem só tem os cardápios 1..14 ("Cardápio N"). Não existe menu "Jantar".
- Produtos do jantar = `products.kitchen_station_id = (SELECT id FROM kitchen_stations WHERE code = 'jantar')`
  (22 produtos ativos na nuvem: sopas, proteínas, acompanhamentos + 3 flexíveis).
- Itens flexíveis (`INHAME COZIDO`, `DELÍCIA DE PEIXE`, `DELÍCIA DE FRANGO`) migram
  automaticamente entre almoço e jantar (`syncFlexibleProducts` / `activateDinnerShift`).

## Decisões (aprovadas pelo usuário)

| # | Decisão |
|---|---------|
| D1 | "Jantar" no dropdown edita a lista da Cozinha Jantar (não cria menu novo) |
| D2 | Adicionar ao jantar = `kitchen_station_id = jantar` |
| D3 | Remover do jantar = `kitchen_station_id = NULL` ("Sem cozinha", ajustável na aba Produtos) |
| D4 | "Usar Hoje" fica oculto quando "Jantar" está selecionado (não se aplica) |
| D5 | Durante o turno jantar, add/remove também reflete no cardápio de **hoje** (`daily_menu_overrides`) e emite `menu:updated` para o salão |

## Passos

- [x] **Step 1: Service** — `src/services/dinner-menu.service.ts`
      `listDinnerMenu()` (in/available, mesmo contrato de `/admin/menus/:id/products`)
      e `setDinnerMenuProduct(productId, action)` (estação + override do dia no turno jantar).
- [x] **Step 2: Rotas** — `src/routes/admin.ts`, seção Cardápios, namespace próprio
      (sem colisão com `/menus/:id`):
      `GET /api/v1/admin/dinner-menu/products`,
      `POST /api/v1/admin/dinner-menu/products` ({product_id}),
      `DELETE /api/v1/admin/dinner-menu/products/:productId`.
      Emitem `product:updated` (e `menu:updated` ao salão quando o cardápio do dia mudou).
- [x] **Step 3: UI Produtos** — categoria vira `<input>` inline com
      `updateProduct(p.id, 'category', this.value)`; `updateProduct` passa a exibir erro
      (toast + recarga da tabela) em vez de só `console.error`; `applyProductFilter`
      passa a considerar valores de `<input>` (mesmo padrão de `applyUnitFilter`).
- [x] **Step 4: UI Cardápios** — opção `Jantar — Cozinha Jantar` no `#menuSelect`,
      URL do pseudo-cardápio centralizada em `menuProductsUrl()`, botão "Usar Hoje"
      oculto no jantar, dica textual sobre a semântica add/remove e itens flexíveis.
- [x] **Step 5: Typecheck** — `npx tsc --noEmit` limpo + `npm run build` OK.
- [x] **Step 6: E2E (webwright)** — `outputs/categoria-e-jantar/`:
      login gerente real → editar categoria (persiste após reload) → dropdown Jantar →
      adicionar produto (aparece em "No Cardápio", cozinha muda na aba Produtos) →
      remover (volta para "Disponíveis", fica "Sem cozinha") → turno jantar ativo →
      add/remove refletem no cardápio de hoje (API /daily-menu/today) → limpeza/restauração.
- [x] **Step 7: Deploy nuvem** — Oracle, **somente** a instância do KDS (a outra
      instância AMD, tipo `fatos_bot`, NÃO pode ser tocada).

## Extra (aprovado pelo usuário): sem duplicatas no cardápio efetivo

Durante o E2E apareceu FAROFA 2x no cardápio do dia. Investigação na nuvem: **bug
pré-existente** — itens que estão na base do cardápio (`menu_products`) e são
re-adicionados por override do turno jantar apareciam duas vezes (DELÍCIA DE FRANGO
em 30+ datas, INHAME COZIDO, DELÍCIA DE PEIXE, MACAXEIRA COZIDA). Corrigido com
`supabase/migrations/2026-10-15-daily-menu-effective-sem-duplicatas.sql` (mesmas
colunas da view anterior) + espelho no `seedDatabase()` do boot.

## Resultado

| Etapa | Evidência |
|---|---|
| E2E local | `outputs/categoria-e-jantar/final_runs/run_2/` (CP1–CP9 PASS, 10 screenshots, limpeza = estado inicial) |
| Commit | `3d50e91 feat(admin): categoria do produto editável e cardápio jantar no dropdown` (push `origin/main`) |
| Deploy | `kds-server-amd` (163.176.208.86): `git pull` + `docker compose up -d --build`; container `kds-bridge` healthy, 0 erros level>=40 |
| Banco (nuvem) | view com o filtro novo (`tem_filtro_novo = t`), **0 duplicatas** em `daily_menu_effective`, hoje com 101 itens / 101 distintos |
| Verificação pós-deploy (somente leitura) | `outputs/categoria-e-jantar/final_runs/run_nuvem/` — categoria editável + dropdown com 15 opções + 22 itens reais da Cozinha Jantar, sem erros de console |

## Achado extra (não corrigido — fora do escopo aprovado)

`runCleanup` (`src/services/cleanup.service.ts:39,44,48`) falha toda noite às 03:00
com `operator does not exist: date < integer` (`CURRENT_DATE - $1` com parâmetro sem
cast resolve `$1` como date). O log registra "[Cleanup] Erro na limpeza automática
(não crítico)" — ou seja, a retenção de dados nunca executou. Correção: usar o mesmo
padrão das duas primeiras queries (`NOW() - ($1 || ' days')::INTERVAL`) ou
`CURRENT_DATE - $1::int`. Bug pré-existente, sem efeito na operação.
