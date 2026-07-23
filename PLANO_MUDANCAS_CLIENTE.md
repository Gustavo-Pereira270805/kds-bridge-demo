# KDS Bridge — Plano de Mudanças (Cliente v2.5)

> Documento de planejamento técnico consolidado a partir dos comentários do cliente sobre o estado atual do sistema (v2.4).
> **Status:** Implementado + Corrigido (22-23/07/2026)
> **Data:** 23/07/2026

---

## Status da Implementação

Todos os 21 itens foram implementados em 22/07/2026. Em 23/07/2026, 9 bugs foram identificados e corrigidos. Resumo:

| Fase | Itens | Status |
|------|-------|:---:|
| Fase 1 — Fundação | 6 itens | Concluído |
| Fase 2 — Backend + DB | 11 itens | Concluído |
| Fase 3 — Frontend | 12 itens | Concluído |
| Fase 4 — Opcionais | 3 itens | Parcial (apenas job de limpeza automática)
| Correções (23/07/2026) | 9 fixes | Concluído

### Correções aplicadas em 23/07/2026

| # | Bug | Arquivo | Correção |
|---|-----|---------|----------|
| 1 | DB local ao invés de Supabase | `.env`, Supabase | `DATABASE_URL` trocada para Supabase; migration v2.5 aplicada (colunas `is_replacement`, `replaced_product_id`, `ready_out_of_order`, `annulled_*` + constraint `annulled` + view `daily_menu_effective`) |
| 2 | Preempção zerou SLA não funcionava | `demands.ts` | `SELECT * FROM demands` movido para depois do `recomputeStationQueue`; adicionado `demand:queue-updated` |
| 3 | Timer único global misturava A+B | `cozinha-quente.html` | Substituído `#globalTimer` por `#timerA` e `#timerB` (um por coluna) |
| 4 | Sem timer countdown por demanda | `cozinha-quente.html`, `cozinha-fria.html` | Adicionado `.card-timer` com MM:SS regressivo em cada card (`updateAllTimers` / `updateGlobalTimer` com `setInterval` 1s) |
| 5 | "Erro ao carregar" no dropdown de unidades | `salao.html` | Adicionado `console.error(err)` no catch; resolvido pelo fix #1 (schema Supabase) |
| 6 | Dashboard: aplicar datas customizadas não funcionava | `dashboard.html` | `buildContent(data)` envolvido em try/catch; `.catch()` restaura UI |
| 7 | Dashboard: dropdown de cozinhas vazio | `dashboard.html` | `console.error` no catch + feedback visual; resolvido pelo fix #1 (kitchen_stations no Supabase) |
| 8 | Dashboard: exportar não funcionava | `dashboard.html` | Botão inicia desabilitado, habilitado quando `state.lastData` é populado |
| 9 | Dashboard: indicador do gráfico comparativo não atualizava | `dashboard.html` | `removeEventListener` usa referência correta (`cmpSel._ch`); `buildContent` com try/catch |

### Pendências conhecidas

1. **`week_comparison` no dashboard só funciona com `range=week|month`** (comportamento preexistente). Para períodos customizados (`from/to`), a seção mostra "Comparativo disponível apenas nos modos Semana/Mês".
2. **Timezone do `CURRENT_DATE`** pode divergir entre UTC (Supabase) e horário local — usar fuso `America/Sao_Paulo` quando necessário.
3. **Preempção completa na fila (§3.5-B)** não implementada — apenas o ajuste de SLA no zerou (§3.5-A) e reordenação normal de urgentes no waiting.

---

## Índice

1. [Resumo das Mudanças](#1-resumo-das-mudanças)
2. [Vista Atendente — Salão](#2-vista-atendente--salão)
3. [Vista Cozinha](#3-vista-cozinha)
4. [Painel Gerente](#4-painel-gerente)
5. [Dashboard Analítico](#5-dashboard-analítico)
6. [Correção de Bug — Dashboard Week/Month 500](#6-correção-de-bug--dashboard-weekmonth-500)
7. [Resumo de Mudanças no Banco de Dados](#7-resumo-de-mudanças-no-banco-de-dados)
8. [Resumo de Mudanças na API](#8-resumo-de-mudanças-na-api)
9. [Ordem de Implementação e Dependências](#9-ordem-de-implementação-e-dependências)
10. [Riscos e Pontos de Atenção](#10-riscos-e-pontos-de-atenção)

---

## 1. Resumo das Mudanças

| Área | Itens | Complexidade | Impacto |
|------|-------|:---:|:---:|
| Salão (`salao.html`) | 5 itens | 2 alta, 1 média, 2 baixa | UI + API + DB |
| Cozinha (`cozinha-quente.html`, `cozinha-fria.html`) | 7 itens | 1 alta, 4 média, 2 baixa | UI + queue.service + DB |
| Gerente (`gerente.html`) | 2 itens | 2 alta | UI + menu.service + API + DB |
| Dashboard (`dashboard.html`) | 7 itens | 2 alta, 3 média, 2 baixa | UI + analytics + API |
| **Total** | **21 itens** | | |

---

## 2. Vista Atendente — Salão

### 2.1 Trocar "Rotura" por "Zerou"

**Escopo:** Labels de UI apenas. Colunas DB e código interno mantêm `stockout` para compatibilidade.

| Arquivo | O que muda |
|---------|-----------|
| `src/views/salao.html` | Botão: `"Rotura"` → `"Zerou"`. Badge: `"ROTURA"` → `"ZEROU"`. Classe CSS `stockout-badge` mantida, só texto muda |
| `src/views/cozinha.html` | CSS class `stockout` mantida (é interna). Somente se houver label visível com "rotura" |
| `src/views/cozinha-quente.html` | Idem |
| `src/views/cozinha-fria.html` | Idem |
| `src/views/dashboard.html` | Labels: `"Roturas"` → `"Zerados"`, `"rotura"` → `"zerou"`, `"Roturas por Produto"` → `"Zerados por Produto"` |
| `src/routes/demands.ts` | Mensagens de erro: `"Erro ao reportar rotura"` → `"Erro ao reportar zerou"`. Comentários internos mantidos. |
| `src/routes/analytics.ts` | Mensagem de erro: `"Erro ao buscar roturas"` → `"Erro ao buscar zerados"` |
| `src/services/performance.service.ts` | Label `"Roturas"` → `"Zerados"` nos detractors |
| `dashboard/pages/6_Cancelamentos_e_Roturas.py` | Streamlit: labels `"Roturas"` → `"Zerados"`, nome do arquivo pode ser renomeado |

**O que NÃO muda:** colunas DB (`stockout_reported`, `stockout_reported_at`), evento Socket.IO (`demand:stockout`), endpoints (`/stockout`), tipos TypeScript (`stockout_reported`), variáveis internas.

**Esforço:** ~1h — alterações pontuais de string.

---

### 2.2 Duplo Botão de Confirmar Retirada

**Problema atual:** Um clique em "Confirmar Retirada" já executa o PATCH imediatamente. Se o garçom clicar sem querer, a demanda sai da fila sem volta.

**Solução proposta:** Modal de confirmação em 2 etapas.

**Fluxo:**
1. Garçom clica "Confirmar Retirada" no card
2. Abre modal com detalhes do item: "Confirmar retirada de **2x Arroz Branco**?"
3. Botão "Sim, Confirmar Retirada" executa o `PATCH /api/v1/demands/:id/retrieve`
4. Botão "Cancelar" fecha o modal

**Arquivos afetados:** `src/views/salao.html`
- Reutilizar o padrão de modal já existente (`#cancelModal`) ou criar novo `#confirmModal`
- A função `retrieveDemand(id)` atual passa a abrir o modal; a ação real fica no handler do modal

**Esforço:** ~1h30 — HTML do modal + handlers JS.

---

### 2.3 Busca de Itens Fora do Cardápio

**Problema atual:** O `<select>` de produtos só mostra itens do cardápio do dia (`GET /api/v1/daily-menu/today`). Itens de outros cardápios ficam inacessíveis.

**Solução proposta:** Campo de busca com autocomplete. Itens do cardápio do dia aparecem primeiro como "favoritos"; digitar filtra entre TODOS os produtos ativos.

**Novo endpoint necessário:**
```
GET /api/v1/products/search?q=arroz
```
**Resposta:**
```json
[
  { "id": "...", "name": "Arroz Branco", "category": "Guarnição", "in_today_menu": true, "kitchen_station_id": "..." },
  { "id": "...", "name": "Arroz de Festa", "category": "Guarnição", "in_today_menu": false, "kitchen_station_id": "..." }
]
```

**Implementação:**

| Camada | Arquivo | Mudança |
|--------|---------|---------|
| Backend | `src/routes/products.ts` | Novo handler `GET /search`. Query: busca `products WHERE active = true AND name ILIKE $1` + subquery para flag `in_today_menu` |
| Frontend | `src/views/salao.html` | Substituir `<select>` por `<input type="search">` + `<datalist>` ou dropdown customizado com `position: absolute`. Renderizar itens do cardápio com destaque (ex: ★). Ao selecionar, popular campos (product_id, unit options, kitchen_station_id). |

**Query SQL (endpoint search):**
```sql
SELECT p.*,
  EXISTS(
    SELECT 1 FROM daily_menu_effective dme
    WHERE dme.product_id = p.id AND dme.date = CURRENT_DATE
  ) AS in_today_menu
FROM products p
WHERE p.active = true AND p.name ILIKE $1
ORDER BY in_today_menu DESC, p.name
LIMIT 15
```

**Esforço:** ~3h — endpoint + UI de busca com dropdown.

---

### 2.4 Identificação do Dia e Cardápio

**Problema atual:** O garçom não sabe qual cardápio está ativo hoje.

**Solução proposta:** Header no topo da página mostrando data e cardápio.

**Dados já disponíveis:** `GET /api/v1/daily-menu/today` retorna os produtos; o endpoint pode ser estendido para incluir metadata (número e nome do cardápio).

**Mudança no endpoint `GET /api/v1/daily-menu/today`:**
```json
{
  "menu": { "number": 3, "name": "Cardápio 3" },
  "date": "2026-07-22",
  "products": [ ... ]
}
```

**UI:** Barra superior fixa no `salao.html`:
```
Terça, 22 de Julho de 2026  ·  Cardápio 3
```

**Arquivos afetados:**
- `src/routes/daily-menu.ts` — adicionar metadata na resposta
- `src/views/salao.html` — adicionar elemento header

**Esforço:** ~45min.

---

### 2.5 Check "Troca" com Item Substituído

**Problema atual:** Quando o garçom pede um item que substitui outro do cardápio (ex: "Arroz de Festa" no lugar de "Arroz Saboroso"), isso não fica registrado. O cliente quer essa informação para análise.

**Solução proposta:** Checkbox "Troca" ao lado de "Urgente". Quando marcado, exibe dropdown com itens do cardápio do dia para selecionar qual foi substituído.

**Mudanças no Banco:**
```sql
ALTER TABLE demands ADD COLUMN is_replacement BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE demands ADD COLUMN replaced_product_id UUID REFERENCES products(id);
```

**Mudanças na API:**

| Endpoint | Mudança |
|----------|---------|
| `POST /api/v1/demands` | Aceitar `is_replacement: boolean` e `replaced_product_id: string` (opcionais) no body |
| `GET /api/v1/analytics/dashboard` | Nova seção de análise de trocas (percentual de substituições por dia) |

**UI (`salao.html`):**
- Checkbox "Troca" ao lado do "Urgente"
- Quando marcado, `<select id="replacedProduct">` aparece, populado com itens do cardápio do dia
- Ambos os campos são enviados no POST da demanda

**Arquivos afetados:**
- `supabase_schema.sql` — ALTER TABLE + migration block
- `src/types.ts` — adicionar campos ao `Demand` e `CreateDemandBody`
- `src/routes/demands.ts` — handler POST aceitar novos campos
- `src/views/salao.html` — checkbox + dropdown condicional
- `src/views/dashboard.html` — nova seção analítica (opcional, fase 2)

**Esforço:** ~3h — schema + API + UI.

---

## 3. Vista Cozinha

### 3.1 Botão Cancelar Maior (Touch-Friendly)

**Problema atual:** Botão de cancelar nos cards da cozinha é pequeno, difícil de acertar em monitor touch.

**Solução:** Aumentar tamanho mínimo para 64x64px (recomendação de touch target), aumentar padding e font-size.

**Arquivos afetados:**
- `src/views/cozinha-quente.html` — CSS do `.cancel-btn`
- `src/views/cozinha-fria.html` — CSS do `.cancel-btn`
- `src/views/cozinha.html` — CSS do `.cancel-btn` (legado)

```css
.cancel-btn {
  min-width: 64px;
  min-height: 64px;
  font-size: 18px;
  padding: 14px 20px;
  border-radius: 10px;
}
```

**Esforço:** ~15min — CSS apenas.

---

### 3.2 Duplo Clique na Confirmação "Pronto"

**Problema atual:** Um clique acidental em "Pronto" marca o item como concluído sem possibilidade de desfazer.

**Solução:** Sistema de double-click com timeout:
1. Primeiro clique: botão muda para "Confirmar?" com cor de warning (laranja)
2. Segundo clique dentro de 3 segundos: executa o PATCH
3. Após 3 segundos sem segundo clique: botão volta ao estado original

**Lógica JS:**
```javascript
let pendingConfirm = null;
btn.addEventListener('click', function() {
  if (pendingConfirm === id) {
    // Segundo clique — confirma
    marcarPronto(id);
    pendingConfirm = null;
  } else {
    // Primeiro clique — prepara
    pendingConfirm = id;
    btn.textContent = 'Confirmar?';
    btn.classList.add('confirm-pending');
    setTimeout(() => {
      if (pendingConfirm === id) {
        pendingConfirm = null;
        btn.textContent = 'Pronto';
        btn.classList.remove('confirm-pending');
      }
    }, 3000);
  }
});
```

**Arquivos afetados:**
- `src/views/cozinha-quente.html` — handler do `.ready-btn`
- `src/views/cozinha-fria.html` — handler do `.ready-btn`

**Esforço:** ~1h — lógica JS + CSS para estado "confirm-pending".

---

### 3.3 Contagem Regressiva Grande no Canto Superior Direito

**Problema atual:** O tempo é mostrado dentro de cada card individual com ícone de relógio, atualizado a cada 30s, em fonte pequena.

**Solução:** Timer global no canto superior direito mostrando o countdown do item mais crítico (o que vencerá primeiro). Atualização a cada 1 segundo.

**UI:**
```
┌──────────────────────────────────────────────┐
│  COZINHA QUENTE A          ⏱  03:42  🔴     │
│                                               │
│  ┌─────────────┐  ┌─────────────┐            │
│  │  2x Arroz   │  │  1x Feijão  │            │
│  │  ⏲ 02:15   │  │  ⏲ 04:30   │            │
│  └─────────────┘  └─────────────┘            │
└──────────────────────────────────────────────┘
```

**Lógica:**
1. A cada 1s, calcula `expected_ready_at - now()` para cada demanda pending/ready
2. O menor tempo restante (mais crítico) é exibido no timer global
3. Cor do timer: verde (> 50% do SLA restante), laranja (25-50%), vermelho (< 25% ou vencido)
4. Se há item urgente, timer mostra o do urgente com pulsação

**Arquivos afetados:**
- `src/views/cozinha-quente.html` — novo elemento HTML + `setInterval(1000)` + lógica
- `src/views/cozinha-fria.html` — idem

**Esforço:** ~1h30 — HTML + CSS + JS com intervalo de 1s.

---

### 3.4 Gestão Visual com Cores

**Objetivo do cliente:**
- Vermelho = urgência, itens atrasados — gera senso de ação imediata
- Verde = tudo em dia, itens prontos — gera "dopamina" (satisfação visual)
- Piscar na entrada de novos itens
- Sons diferenciados por nível de criticidade

**Especificação:**

| Estado | Cor de fundo do card | Borda | Animação | Som |
|--------|---------------------|-------|----------|-----|
| Normal, no prazo | `#1a1a1a` (padrão) | sutil | — | Tom único suave |
| Normal, atrasado | Gradiente para vermelho | `#e63946` | — | — |
| Urgente, no prazo | `#2d0a0a` (vermelho escuro) | `#e63946` pulsando | `urgentPulse` | 6 pulsos (existente) |
| Urgente, atrasado | `#4a0000` (vermelho intenso) | `#ff0000` pulsando rápido | `criticalPulse` | 12 pulsos (existente) |
| Pronto para retirar | `#0a2a1a` (verde escuro) | `#2a9d8f` | `gentlePulse` (existente) | Som de "pronto" |
| Zerou (novo) | `#2d1a00` (laranja escuro) | `#f4a261` pulsando | `urgentPulse` | 12 pulsos agudos |
| Entrada (novo item) | Flash branco → cor normal | — | `flashIn` (0.5s) | Som conforme prioridade |

**Progress bar atual (corrigir semântica):**
- Hoje: barra mostra tempo RESTANTE (encolhe da direita pra esquerda) — contra-intuitivo
- Proposta: barra enche da esquerda pra direita conforme tempo decorrido
  - Verde até 50% do SLA
  - Laranja 50-75%
  - Vermelho 75%+

```javascript
// Novo cálculo:
const pct = Math.min(100, (elapsed / (slaMinutes * 60000)) * 100);
// width: pct% (enche da esquerda pra direita)
```

**Arquivos afetados:**
- `src/views/cozinha-quente.html` — CSS + render()
- `src/views/cozinha-fria.html` — CSS + render()
- `src/views/cozinha.html` — CSS + render() (legado)

**Esforço:** ~2h — CSS animations + ajustes de render + correção da barra de progresso.

---

### 3.5 Prioridade com Preempção na Fila

**Problema atual:** Quando um item urgente entra, ele só "fura a fila" entre itens waiting (não iniciados). Itens já em preparo (`cooking_started = true`) são imutáveis e o urgente espera atrás deles. Além disso, quando um item normal vira urgente por zerou, o `sla_minutes` não é atualizado — o algoritmo de fila usa o SLA original (normal, maior) mesmo após a promoção.

**Análise do algoritmo atual (`queue.service.ts`):**

O algoritmo é greedy de máquinas paralelas com slots:
1. Lê todas demandas `pending` da estação
2. Separa em `locked` (já cooking_started) e `waiting`
3. Ordena waiting: urgentes primeiro, depois FIFO
4. Slots são inicializados com o `expected_ready_at` dos locked
5. Slots restantes preenchidos com `now`
6. Para cada waiting, atribui ao slot mais cedo; se for `now` → lock (`cooking_started = true`)

**Problema identificado:** Locked items NUNCA são reordenados. O `sla_minutes` é snapshot congelado no momento da criação da demanda — mesmo que o item vire urgente por zerou (demands.ts linha 383-385 só altera `priority`, não `sla_minutes`).

**Solução proposta:**

#### A. Ajuste do SLA no zerou (stockout)

No handler `POST /:id/stockout` (`demands.ts`), alterar para buscar o `sla_minutes_urgente` do produto e atualizar a demanda quando a prioridade for promovida:

```typescript
// Após promover priority para 'urgent':
if (demand.priority === 'normal') {
  const [product] = await query<{ sla_minutes_urgente: number }>(
    `SELECT sla_minutes_urgente FROM products WHERE id = $1`,
    [demand.product_id]
  );
  const novoEta = Math.min(demand.sla_minutes, product.sla_minutes_urgente);
  // Se ETA atual > SLA urgente, reduz para SLA urgente
  // Se ETA atual <= SLA urgente, mantém
  await query(
    `UPDATE demands SET priority = 'urgent', sla_minutes = $1 WHERE id = $2`,
    [novoEta, id]
  );
}
```

#### B. Preempção na fila (queue.service.ts)

Adicionar passo no algoritmo: antes de particionar locked/waiting, verificar se há urgente na fila. Se houver, itens locked não-urgentes podem ter seu slot "roubado" — o item urgente assume o slot, o normal vai para waiting com ETA recalculado.

**Nova lógica no `recomputeStationQueue`:**

```
1. Buscar pending (igual)
2. Se há urgente na fila:
   a. Identificar locked items não-urgentes
   b. Liberar slots desses itens (marcar cooking_started = false, colocar em waiting)
   c. Ordenar waiting: urgentes primeiro (com novo SLA do zerou se aplicável)
3. Reatribuir slots com algoritmo greedy normal
```

**Nota:** Isso é uma simplificação. Na prática, "parar o tempo" de um item já em preparo não reflete a realidade física (o cozinheiro não vai parar de cozinhar). O comportamento desejado é mais sobre preempção de SLOTS FUTUROS: itens waiting que teriam um slot antes do urgente são empurrados para frente quando o urgente entra. A parte de "parar o tempo" se aplica ao display visual (o countdown do item waiting é recalculado com o novo ETA mais tardio).

**Recomendação:** Implementar apenas a parte A (ajuste de SLA no zerou) e parte B-leve (urgentes reordenam waiting items, mas locked permanecem intocados). Isso cobre 90% do cenário sem complexidade de "descozer" itens já iniciados.

**Arquivos afetados:**
- `src/routes/demands.ts` — handler stockout: atualizar `sla_minutes` ao promover prioridade
- `src/services/queue.service.ts` — (opcional, fase 2) preempção de locked items

**Esforço:** ~2h (parte A) + ~4h (parte B completa).

---

### 3.6 Flag "Pronto Fora de Sequência"

**Objetivo:** Quando um item é marcado como pronto mas havia outro item na mesma estação que iniciou antes e ainda está pendente, flagar para análise posterior. Isso indica que a cozinha pode ter priorizado incorretamente ou que houve algum problema.

**Nova coluna no banco:**
```sql
ALTER TABLE demands ADD COLUMN ready_out_of_order BOOLEAN NOT NULL DEFAULT false;
```

**Lógica no handler `PATCH /:id/ready` (`demands.ts`):**
```typescript
// Após marcar como ready, verificar se há itens mais antigos ainda pending:
const [older] = await query<{ cnt: string }>(
  `SELECT COUNT(*)::int AS cnt FROM demands
   WHERE kitchen_station_id = $1
     AND status = 'pending'
     AND cooking_started = true
     AND cooking_started_at < $2`,
  [demand.kitchen_station_id, demand.cooking_started_at]
);
if (parseInt(older.cnt) > 0) {
  await query(
    `UPDATE demands SET ready_out_of_order = true WHERE id = $1`,
    [id]
  );
}
```

**Exposição no dashboard:** Adicionar métrica de "% itens prontos fora de sequência" na seção de KPIs e no gráfico de funnel.

**Arquivos afetados:**
- `supabase_schema.sql` — ALTER TABLE
- `src/types.ts` — campo `ready_out_of_order` no `Demand`
- `src/routes/demands.ts` — handler ready
- `src/routes/analytics.ts` — expor no dashboard (opcional)
- `src/views/dashboard.html` — exibir métrica (opcional)

**Esforço:** ~1h30 — schema + handler + tipo.

---

### 3.7 Alerta de Cancelamento Cruzado

**Objetivo:** Quando o salão cancela um item que a cozinha já começou a preparar (`cooking_started = true`), a cozinha precisa de um alerta visual/sonoro proeminente. Vice-versa: se a cozinha cancela, o salão precisa saber.

**Implementação:**

#### Backend — Novo evento Socket.IO

No handler `cancel-salao` e `cancel-cozinha` (`demands.ts`), verificar se o item estava `cooking_started = true` e, se sim, emitir evento especial:

```typescript
if (demand.cooking_started) {
  fastify.io.emit('demand:cross-cancel', {
    ...updated,
    cancelled_by: 'salao', // ou 'cozinha'
    message: 'Item cancelado pelo salão já estava em preparo!'
  });
}
```

#### Frontend — Cozinhas

No `cozinha-quente.html` e `cozinha-fria.html`, escutar `demand:cross-cancel`:
- Tocar som de alerta (diferente dos existentes — tom grave + agudo alternado)
- Destacar o card do item cancelado com animação de "shake" e borda vermelha pulsante
- Exibir toast: "ATENÇÃO: Item cancelado pelo Salão já estava em preparo!"

#### Frontend — Salão

No `salao.html`, escutar `demand:cross-cancel` quando `cancelled_by === 'cozinha'`:
- Toast: "Cozinha cancelou um item"

**Arquivos afetados:**
- `src/routes/demands.ts` — emitir `demand:cross-cancel`
- `src/views/cozinha-quente.html` — listener + animação + som
- `src/views/cozinha-fria.html` — idem
- `src/views/salao.html` — listener + toast

**Esforço:** ~1h30.

---

## 4. Painel Gerente

### 4.1 Calendário de Cardápios com Programação Sequencial

**Problema atual:** A rotação de cardápios é puramente determinística: `(diasDesdeDataRef % 14) + 1`. Não há interface para o gerente ver ou alterar a programação.

**Requisitos do cliente:**
1. Visualizar num calendário qual cardápio está atribuído a cada dia
2. Poder alterar o cardápio de um dia específico
3. Ao alterar um dia, os dias seguintes (não sobreescritos manualmente) propagam sequencialmente: se hoje foi alterado para cardápio Y, amanhã = Y+1, depois = Y+2...
4. Ciclo de 14 dias: após 14, volta ao 1

**Modelo de dados atual:**
- `daily_menus`: `date UNIQUE`, `menu_id`, `is_override BOOLEAN`
- `menu.service.ts`: função `ensureTodayMenu()` calcula deterministicamente

**Mudanças necessárias:**

#### A. Endpoint de calendário
```
GET /api/v1/daily-menu/calendar?from=2026-07-01&to=2026-07-31
```
**Resposta:**
```json
[
  { "date": "2026-07-01", "menu_number": 5, "menu_name": "Cardápio 5", "is_override": false },
  { "date": "2026-07-02", "menu_number": 6, "menu_name": "Cardápio 6", "is_override": false },
  ...
]
```
**Lógica:** Para cada dia no intervalo, verifica se existe `daily_menus` com `is_override = true`. Se sim, usa esse. Se não, calcula sequencialmente a partir do último override.

#### B. Endpoint para alterar um dia específico
```
PUT /api/v1/admin/daily-menu/:date
Body: { "menu_id": "uuid-do-menu-7" }
```
- Cria/atualiza `daily_menus` para a data com `is_override = true`
- Dias seguintes (sem override próprio) são recalculados automaticamente na próxima consulta

#### C. Refatoração do `menu.service.ts`

Nova função `getMenuForDate(date)`:
1. Busca `daily_menus WHERE date = $1`
2. Se existe e `is_override = true`, retorna esse `menu_id`
3. Se existe mas `is_override = false`, recalcula (pode ter sido afetado por override anterior)
4. Se não existe:
   - Busca o override mais recente anterior a essa data
   - Se existe: `menu_id = (override.menu_number + diasDesdeOverride) % 14`
   - Se não existe override: usa `REFERENCE_DATE` como antes
5. Insere/atualiza `daily_menus` com o resultado e retorna

#### D. UI no `gerente.html`

Nova tab ou seção "Calendário de Cardápios":
- Visualização mensal (grid 7 colunas como calendário)
- Cada dia mostra o número do cardápio (ex: "C3" para Cardápio 3)
- Dias com override manual destacados (ex: borda ou badge)
- Clique em um dia: modal para selecionar novo cardápio (dropdown dos 14)
- Após alterar: refresh do calendário

**Alternativa mais simples (recomendada para MVP):**
- Manter determinação automática
- Adicionar apenas endpoint `POST /api/v1/admin/menus/:id/set-date/:date` que cria uma entrada com `is_override = true`
- Ajustar `menu.service.ts` para respeitar overrides e propagar sequencialmente
- UI: lista simples dos próximos 14 dias com dropdown para alterar cada um

**Arquivos afetados:**
- `src/services/menu.service.ts` — refatoração significativa
- `src/routes/daily-menu.ts` — novo endpoint GET calendar
- `src/routes/admin.ts` — novo endpoint PUT daily-menu/:date
- `src/views/gerente.html` — nova UI de calendário

**Esforço:** ~5h — refatoração do serviço + 2 endpoints + UI.

---

### 4.2 Anulação de Ações (Status "Anulado")

**Objetivo:** Poder anular uma demanda (ex: erro de registro, ação fraudulenta) sem que isso afete os indicadores e métricas. O registro permanece visível no histórico, mas é excluído de todos os cálculos de KPI, SLA, performance score, etc.

**Novo status:** `'annulled'`

**Modelo de dados:**
```sql
-- Adicionar 'annulled' ao CHECK constraint de status
ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_status_check;
ALTER TABLE demands ADD CONSTRAINT demands_status_check
  CHECK (status IN ('pending','ready','retrieved','cancelled_salao','cancelled_cozinha','annulled'));

-- Colunas para auditoria da anulação
ALTER TABLE demands ADD COLUMN IF NOT EXISTS annulled_at TIMESTAMPTZ;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS annulled_by TEXT;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS annul_reason TEXT;
```

**Novo endpoint:**
```
POST /api/v1/admin/demands/:id/annul
Body: { "reason": "Erro de registro - quantidade errada" }
```
- Verifica se a demanda existe
- Marca status como `'annulled'`, preenche `annulled_at`, `annulled_by`, `annul_reason`
- Registra evento no `demand_events`
- Recalcula scores de performance do dia (excluindo esta demanda)
- Emite evento Socket.IO para atualizar UIs

**Impacto nas queries existentes:**

TODAS as queries de analytics, métricas, dashboard, performance precisam adicionar filtro:
```sql
AND status != 'annulled'
-- ou
WHERE status NOT IN ('annulled', ...outros status excluídos...)
```

**Locais críticos a atualizar (lista não exaustiva):**

| Arquivo | Queries afetadas |
|---------|-----------------|
| `src/routes/demands.ts` | `GET /metrics` — excluir anulled dos counts |
| `src/routes/analytics.ts` | TODAS as queries do dashboard, summary, sla-breaches, cancellations, stockouts, peak-hours, by-product, by-shift |
| `src/services/sla.service.ts` | Queries de SLA já filtram por status específicos, não devem ser afetadas |
| `src/services/queue.service.ts` | Já filtra `WHERE status = 'pending'` — não afetado |
| `src/services/performance.service.ts` | `computeDailyScores` — todas as queries de contagem |

**UI no `gerente.html` e `admin.html`:**
- No histórico de demandas, items anulados aparecem com estilo diferenciado (riscado, opacidade reduzida)
- Botão "Anular" visível apenas para o gerente (se autenticado)
- Modal de confirmação: "Tem certeza que deseja anular esta demanda? Ela será removida dos indicadores."

**Arquivos afetados:**
- `supabase_schema.sql` — ALTER TABLE + constraint
- `src/types.ts` — adicionar `'annulled'` ao `DemandStatus`, campos de anulação ao `Demand`
- `src/routes/admin.ts` — novo endpoint `POST /:id/annul`
- `src/routes/analytics.ts` — filtro em TODAS as queries
- `src/routes/demands.ts` — filtro nas queries de métricas
- `src/services/performance.service.ts` — filtro nas queries de contagem
- `src/views/gerente.html` — botão + modal de anulação
- `src/views/admin.html` — (opcional) gestão de anulados

**Esforço:** ~4h — alto impacto transversal, muitas queries para atualizar.

---

## 5. Dashboard Analítico

### 5.1 Seletor de Data com Calendário (Período Específico)

**Problema atual:** Só é possível selecionar Hoje / Semana / Mês. Não dá para ver um dia específico no passado nem um período customizado.

**Solução proposta:**
- Date picker com dois campos: "De" e "Até"
- Limite máximo de 31 dias (validado no frontend e backend)
- Se apenas "De" for preenchido sem "Até", assume dia único
- Botões rápidos: Hoje / Ontem / Últimos 7 dias / Últimos 30 dias

**Mudanças no endpoint:**
O endpoint `GET /api/v1/analytics/dashboard` já aceita `from` e `to` como query params (linha 242 do analytics.ts), mas nunca foram expostos na UI. Precisa apenas:
- Validar `to - from <= 31 dias` com erro 400
- Corrigir o bug do week/month (ver seção 6)

**UI (`dashboard.html`):**
- Substituir botões Hoje/Semana/Mês por date inputs + botões rápidos
- `loadDashboard({ from: '2026-07-01', to: '2026-07-15' })`

**Arquivos afetados:**
- `src/routes/analytics.ts` — validação de intervalo máximo 31 dias
- `src/views/dashboard.html` — novos controles de data

**Esforço:** ~2h.

---

### 5.2 Auto-Limpeza de Dados

**Objetivo:** Limitar acúmulo de dados históricos para não sobrecarregar o sistema.

**Solução:**

#### Configuração
```sql
INSERT INTO system_settings (key, value) VALUES ('data_retention_days', '180')
ON CONFLICT (key) DO NOTHING;
```

#### Endpoint de limpeza manual
```
POST /api/v1/admin/cleanup
Body: { "older_than_days": 180 }  // opcional, default do system_settings
```
- Deleta `demand_events` onde `created_at < NOW() - INTERVAL 'N days'`
- Deleta `demands` onde `created_at < NOW() - INTERVAL 'N days'`
- Deleta `daily_menus` onde `date < CURRENT_DATE - N`
- Deleta `daily_menu_overrides` órfãos
- Deleta `performance_scores` onde `date < CURRENT_DATE - N`
- Retorna contagem de registros removidos por tabela

#### Job automático (opcional, fase 2)
- `setInterval` no `server.ts` que roda 1x por dia (ex: 3am)
- Ou: hook no startup que verifica última limpeza

**Query de limpeza (transacional):**
```sql
BEGIN;
DELETE FROM demand_events WHERE created_at < NOW() - ($1 || ' days')::INTERVAL;
DELETE FROM demands WHERE created_at < NOW() - ($1 || ' days')::INTERVAL;
DELETE FROM daily_menu_overrides WHERE daily_menu_id IN (
  SELECT id FROM daily_menus WHERE date < CURRENT_DATE - $1
);
DELETE FROM daily_menus WHERE date < CURRENT_DATE - $1;
DELETE FROM performance_scores WHERE date < CURRENT_DATE - $1;
COMMIT;
```

**Arquivos afetados:**
- `supabase_schema.sql` — system_setting
- `src/routes/admin.ts` — endpoint cleanup
- `src/server.ts` — (opcional) job agendado

**Esforço:** ~1h30.

---

### 5.3 Exportar PDF e Excel

**Decisão:** PDF e Excel gerados no frontend (html2canvas + jspdf para PDF, SheetJS/xlsx para Excel).

**Contexto:** A exportação é usada apenas na tela do gerente (`dashboard.html`), que roda num notebook com Chrome comum — não no Orange Pi das cozinhas. Portanto, não há restrição de hardware para essa funcionalidade. O processamento ocorre no navegador do gerente.

**Alternativa viável (se desejado):** Também seria possível usar puppeteer no backend para gerar PDFs com qualidade superior, já que o servidor não precisaria rodar o Chrome no Orange Pi. Mas a abordagem frontend é mais simples e não requer dependências novas no servidor.

**Bibliotecas necessárias (CDN, sem build step):**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
```

**Fluxo de exportação:**

1. Usuário seleciona período no dashboard
2. Clica "Exportar" → modal com opções:
   - Formato: PDF | Excel
   - Agrupamento: Por dia (uma página/aba por dia) | Período (consolidado)
3. PDF: html2canvas captura cada seção → jsPDF monta páginas
4. Excel: dados brutos das queries são serializados em worksheets

**Implementação PDF:**
```javascript
async function exportPDF(byDay) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  
  if (byDay) {
    // Para cada dia no período, recarrega dashboard com range=aquele dia
    // Captura com html2canvas e adiciona página ao PDF
    for (const day of days) {
      await loadDashboardForDay(day);
      const canvas = await html2canvas(document.getElementById('content'));
      pdf.addImage(canvas, 'PNG', 10, 10, 190, 0);
      if (day !== days[days.length-1]) pdf.addPage();
    }
  } else {
    // Captura o dashboard atual (período consolidado)
    const canvas = await html2canvas(document.getElementById('content'));
    pdf.addImage(canvas, 'PNG', 10, 10, 190, 0);
  }
  
  pdf.save(`dashboard_${dateFrom}_${dateTo}.pdf`);
}
```

**Implementação Excel:**
```javascript
function exportExcel(byDay) {
  const wb = XLSX.utils.book_new();
  
  if (byDay) {
    for (const day of days) {
      const data = await fetchDashboardForDay(day);
      const ws = XLSX.utils.json_to_sheet(data.products);
      XLSX.utils.book_append_sheet(wb, ws, day);
    }
  } else {
    // Abas: KPIs, Produtos, Tendência, SLA, Cancelamentos, etc.
    XLSX.utils.book_append_sheet(wb, json_to_sheet(kpis), 'KPIs');
    XLSX.utils.book_append_sheet(wb, json_to_sheet(products), 'Produtos');
    // ...
  }
  
  XLSX.writeFile(wb, `dashboard_${dateFrom}_${dateTo}.xlsx`);
}
```

**Arquivos afetados:**
- `src/views/dashboard.html` — scripts CDN + funções de export + modal

**Esforço:** ~4h — integração das libs + lógica de captura por dia.

---

### 5.4 Filtro por Cozinha em Gráficos Específicos

**Objetivo:** Poder filtrar o dashboard por estação: "Todas", "Quente A", "Quente B", "Fria".

**Endpoint:**
Adicionar query param opcional `station_id` ao endpoint `GET /api/v1/analytics/dashboard`:
```
GET /api/v1/analytics/dashboard?from=2026-07-01&to=2026-07-15&station_id=uuid-da-fria
```

**Query:** Adicionar `AND d.kitchen_station_id = $N` (dinâmico) em todas as sub-queries quando `station_id` estiver presente.

**UI:** Dropdown no topo do dashboard ao lado do seletor de período.

**Arquivos afetados:**
- `src/routes/analytics.ts` — query param + filtro dinâmico nas sub-queries
- `src/views/dashboard.html` — dropdown + envio do param

**Esforço:** ~2h — adicionar filtro em 16 sub-queries.

---

### 5.5 Gráfico "Tempo Fila por Estação" com Horas

**Problema atual:** O gráfico `queue_time_by_station` retorna apenas totais por estação, sem breakdown por hora do dia.

**Solução:** Adicionar versão com hora, similar ao `speed_by_hour`:

```sql
SELECT ks.name AS estacao,
  EXTRACT(HOUR FROM d.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
  ROUND(AVG(EXTRACT(EPOCH FROM (d.ready_at - d.created_at)) / 60))::int AS tempo_medio_min
FROM demands d
JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
WHERE d.status IN ('ready', 'retrieved') AND d.ready_at IS NOT NULL
  AND [dateFilter]
GROUP BY ks.name, EXTRACT(HOUR FROM d.created_at AT TIME ZONE 'America/Sao_Paulo')
ORDER BY ks.name, hora
```

**UI:** Gráfico de linhas (Canvas) com uma série por estação, eixo X = hora do dia, eixo Y = tempo médio em minutos.

**Arquivos afetados:**
- `src/routes/analytics.ts` — nova query ou modificação da existente
- `src/types.ts` — novo tipo `QueueTimeByHourRow`
- `src/views/dashboard.html` — renderização do gráfico

**Esforço:** ~1h30.

---

### 5.6 Gráfico "Comparativo: Atual vs Período Anterior" com Linha de Indicador

**Interpretação corrigida:** O cliente se refere ao gráfico de **comparação entre períodos** (seção 15 do dashboard, `week_comparison`). Hoje ele mostra barras agrupadas: uma barra para o período atual e outra para o período anterior, lado a lado por dia. O cliente quer adicionar uma **linha sobreposta** representando um indicador selecionável via dropdown pelo gerente.

**Indicadores disponíveis no dropdown (exemplos):**
- SLA% médio do dia
- Tempo médio de preparo (min)
- Taxa de cancelamento (%)
- Zerados no dia (qtd)
- % de itens urgentes

**Especificação visual:**
- Barras agrupadas (atuais vs anteriores) — mantidas como estão
- Linha colorida sobreposta (ex: laranja `#f4a261`) com marcadores circulares em cada ponto — novo
- Eixo Y secundário à direita para a escala da linha (ex: 0-100% para SLA%, 0-30min para tempo médio)
- Dropdown no canto superior do painel para selecionar o indicador

**Dados necessários (backend):**

Para cada dia no período, além do total de demandas (barras), o endpoint precisa retornar o valor do indicador selecionado:

```json
{
  "week_comparison": [
    {
      "day": "2026-07-15",
      "current_total": 42,
      "previous_total": 38,
      "indicators": {
        "sla_pct": 87.5,
        "avg_time_min": 8.2,
        "cancel_rate": 4.8,
        "stockouts": 2,
        "urgent_pct": 12.0
      }
    }
  ]
}
```

**Query para os indicadores diários (adicionar ao `week_comparison`):**

Cada indicador requer uma agregação diferente. A abordagem mais eficiente é uma subquery por dia:

```sql
SELECT created_at::date AS day,
  COUNT(*)::int AS total,
  ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at)) / 60)::numeric, 1) AS avg_time_min,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sla_breached_cozinha = true)
    / NULLIF(COUNT(*) FILTER (WHERE status IN ('ready','retrieved')), 0), 1) AS sla_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('cancelled_salao','cancelled_cozinha'))
    / NULLIF(COUNT(*), 0), 1) AS cancel_rate,
  COUNT(*) FILTER (WHERE stockout_reported = true)::int AS stockouts,
  ROUND(100.0 * COUNT(*) FILTER (WHERE priority = 'urgent')
    / NULLIF(COUNT(*), 0), 1) AS urgent_pct
FROM demands
WHERE created_at::date >= $1 AND created_at::date <= $2
  AND status != 'annulled'
GROUP BY created_at::date
ORDER BY day
```

**UI (Canvas dual-axis):**

```javascript
function drawComparisonWithLine(canvas, data, indicator) {
  const ctx = canvas.getContext('2d');
  const barMax = Math.max(...data.map(d => Math.max(d.current_total, d.previous_total)));
  const lineMax = Math.max(...data.map(d => d.indicators[indicator]));
  
  // Eixo Y esquerdo: barras (totais)
  // Eixo Y direito: linha (indicador)
  // Barras agrupadas: azul (atual) + cinza (anterior)
  // Linha: laranja com bolinhas
  // Legendas: "Atual", "Anterior", nome do indicador selecionado
}
```

**Mudança na query 15 (`week_comparison` no analytics.ts):**

A query atual (UNION ALL de current + previous) só retorna `day`, `total`, `period`. É necessário refatorar para incluir os indicadores no retorno ou fazer uma query separada para os indicadores (recomendado: query separada para manter a query de barras simples). A query de indicadores é chamada apenas quando o dropdown é alterado.

**Arquivos afetados:**
- `src/routes/analytics.ts` — nova query para indicadores diários OU estender a query 15
- `src/types.ts` — novo tipo `DayIndicators`
- `src/views/dashboard.html` — dropdown + renderização dual-axis Canvas

**Esforço:** ~3h — query dos indicadores + Canvas dual-axis + dropdown.

---

### 5.7 Tela de Critérios de Avaliação

**Objetivo:** Explicar para o gerente como as notas de desempenho (0-5) são calculadas.

**Fonte dos critérios:** `src/services/performance.service.ts` já contém toda a lógica:
- Nota base: 5.0
- Penalidades:
  - SLA breach (cozinha): -0.15 por ocorrência
  - Cancelamento: -0.30 por ocorrência
  - Zerou (cozinha): -0.20 por ocorrência
  - Zerou (salão): -0.10 por ocorrência
  - Item lento: -0.10 por ocorrência
- Entidades avaliadas: `cozinha_quente_a`, `cozinha_quente_b`, `cozinha_fria`, `salao`, `cozinha_geral` (média)

**UI:** Modal ou seção no dashboard com:
- Tabela de pesos e penalidades
- Exemplo de cálculo
- Escala de cores: 4.0-5.0 (verde, "Ótimo"), 3.0-3.9 (amarelo, "Bom"), 2.0-2.9 (laranja, "Regular"), 0-1.9 (vermelho, "Ruim")

**Arquivos afetados:**
- `src/views/dashboard.html` — novo modal/seção HTML + CSS

**Esforço:** ~1h — HTML/CSS apenas (dados já existem no endpoint `/api/v1/analytics/performance`).

---

## 6. Correção de Bug — Dashboard Week/Month 500

**Diagnóstico técnico (confirmado por análise):**

O bug NÃO é causado por mismatch de parâmetros posicionais como sugeria o handoff §17. Todas as 16 sub-queries têm parâmetros corretamente alinhados.

**Causa raiz provável:** A query 15 (`WeekComparison`, linha 507 do `analytics.ts`) usa `$5::integer` onde `$5` é `rangeNum` (7 ou 30), um JavaScript `number`. O driver `pg` envia `number` como PostgreSQL `float8`, e o cast explícito `::integer` pode falhar dependendo da versão do driver/servidor.

**Correção:**
```typescript
// Linha 276: garantir que rangeNum seja inteiro
const rangeNum = dateFrom === dateTo ? 1 : range === 'week' ? 7 : 30;
// → alterar para:
const rangeNum = Math.floor(dateFrom === dateTo ? 1 : range === 'week' ? 7 : 30);

// Linha 507: remover ::integer desnecessário
SELECT (created_at::date + $5::integer)::date AS day
// → alterar para:
SELECT (created_at::date + $5)::date AS day
```
PostgreSQL aceita `date + float` (interpreta como dias), então o cast não é necessário.

**Arquivo afetado:** `src/routes/analytics.ts`, linhas 276 e 507.

**Esforço:** ~15min.

---

## 7. Resumo de Mudanças no Banco de Dados

### Novas colunas

| Tabela | Coluna | Tipo | Default | Descrição |
|--------|--------|------|---------|-----------|
| `demands` | `is_replacement` | `BOOLEAN` | `false` | Se a demanda é uma troca de item do cardápio |
| `demands` | `replaced_product_id` | `UUID` | `NULL` | FK → products. Item do cardápio que foi substituído |
| `demands` | `ready_out_of_order` | `BOOLEAN` | `false` | Se o item foi marcado pronto fora da ordem de início |
| `demands` | `annulled_at` | `TIMESTAMPTZ` | `NULL` | Timestamp da anulação |
| `demands` | `annulled_by` | `TEXT` | `NULL` | Quem anulou |
| `demands` | `annul_reason` | `TEXT` | `NULL` | Motivo da anulação |

### Status constraint atualizado

```sql
ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_status_check;
ALTER TABLE demands ADD CONSTRAINT demands_status_check
  CHECK (status IN ('pending','ready','retrieved','cancelled_salao','cancelled_cozinha','annulled'));
```

### Nova configuração

```sql
INSERT INTO system_settings (key, value) VALUES ('data_retention_days', '180')
ON CONFLICT (key) DO NOTHING;
```

---

## 8. Resumo de Mudanças na API

### Novos endpoints

| Método | Path | Descrição | Seção |
|--------|------|-----------|-------|
| `GET` | `/api/v1/products/search?q=` | Busca produtos com flag `in_today_menu` | 2.3 |
| `GET` | `/api/v1/daily-menu/calendar?from=&to=` | Calendário de cardápios no período | 4.1 |
| `PUT` | `/api/v1/admin/daily-menu/:date` | Alterar cardápio de uma data específica | 4.1 |
| `POST` | `/api/v1/admin/demands/:id/annul` | Anular demanda (status `annulled`) | 4.2 |
| `POST` | `/api/v1/admin/cleanup` | Limpeza de dados antigos | 5.2 |

### Endpoints modificados

| Método | Path | Mudança | Seção |
|--------|------|---------|-------|
| `GET` | `/api/v1/daily-menu/today` | Adicionar metadata (menu number, name, date) | 2.4 |
| `POST` | `/api/v1/demands` | Aceitar `is_replacement`, `replaced_product_id` | 2.5 |
| `POST` | `/api/v1/demands/:id/stockout` | Atualizar `sla_minutes` ao promover prioridade | 3.5 |
| `PATCH` | `/api/v1/demands/:id/ready` | Verificar e flagar `ready_out_of_order` | 3.6 |
| `PATCH` | `/api/v1/demands/:id/cancel-salao` | Emitir `demand:cross-cancel` se cooking_started | 3.7 |
| `PATCH` | `/api/v1/demands/:id/cancel-cozinha` | Emitir `demand:cross-cancel` se cooking_started | 3.7 |
| `GET` | `/api/v1/analytics/dashboard` | Aceitar `from`/`to` com validação de 31 dias; aceitar `station_id`; adicionar coluna hora em queue_time; corrigir bug week/month | 5.1, 5.4, 5.5, 6 |
| `GET` | `/api/v1/demands/metrics` | Excluir `annulled` dos cálculos | 4.2 |
| `GET` | `/api/v1/analytics/*` | Excluir `annulled` de todas as queries | 4.2 |

### Novos eventos Socket.IO

| Evento | Emitido por | Recebido por | Descrição |
|--------|-------------|-------------|-----------|
| `demand:cross-cancel` | `demands.ts` (cancel) | cozinha, salao | Alerta quando item cancelado já estava em preparo |

---

## 9. Ordem de Implementação e Dependências

### Fase 1 — Fundação (sem dependências externas)

| # | Item | Seção | Depende de |
|---|------|-------|-----------|
| 1 | Correção bug dashboard week/month 500 | 6 | Nada |
| 2 | Trocar "Rotura" por "Zerou" | 2.1 | Nada |
| 3 | Identificação do dia e cardápio | 2.4 | Nada |
| 4 | Botão cancelar maior (touch) | 3.1 | Nada |
| 5 | Duplo clique confirmar "Pronto" | 3.2 | Nada |
| 6 | Duplo botão confirmar retirada | 1.2 | Nada |

### Fase 2 — Backend + DB

| # | Item | Seção | Depende de |
|---|------|-------|-----------|
| 7 | Schema: novas colunas (`is_replacement`, `replaced_product_id`, `ready_out_of_order`, `annulled`, `annul_reason`, etc.) | 7 | Nada |
| 8 | Check "Troca" + item substituído (backend) | 2.5 | #7 |
| 9 | Busca de itens fora do cardápio (endpoint) | 2.3 | Nada |
| 10 | Flag "pronto fora de sequência" (backend) | 3.6 | #7 |
| 11 | Ajuste SLA no zerou (stockout) | 3.5 | Nada |
| 12 | Alerta cancelamento cruzado (backend) | 3.7 | Nada |
| 13 | Status "anulado" + endpoint annul | 4.2 | #7 |
| 14 | Filtro `annulled` em todas as queries | 4.2 | #7, #13 |
| 15 | Calendário de cardápios (backend) | 4.1 | Nada |
| 16 | Endpoint cleanup | 5.2 | #7 |
| 17 | Dashboard: aceitar `from`/`to` + `station_id` | 5.1, 5.4 | Nada |

### Fase 3 — Frontend

| # | Item | Seção | Depende de |
|---|------|-------|-----------|
| 18 | Salão: busca de itens (UI) | 2.3 | #9 |
| 19 | Salão: check "Troca" (UI) | 2.5 | #7, #8 |
| 20 | Cozinha: contagem regressiva | 3.3 | Nada |
| 21 | Cozinha: gestão visual com cores | 3.4 | Nada |
| 22 | Cozinha: alerta cancelamento cruzado (UI) | 3.7 | #12 |
| 23 | Gerente: calendário de cardápios (UI) | 4.1 | #15 |
| 24 | Gerente: botão anular (UI) | 4.2 | #13 |
| 25 | Dashboard: seletor de data | 5.1 | #17 |
| 26 | Dashboard: exportação PDF/Excel | 5.3 | #17 |
| 27 | Dashboard: gráfico fila com horas | 5.5 | #17 |
| 28 | Dashboard: gráfico barras + linha | 5.6 | #17 |
| 29 | Dashboard: critérios de avaliação | 5.7 | Nada |

### Fase 4 — Opcionais / Refinamento

| # | Item | Seção |
|---|------|-------|
| 30 | Preempção completa na fila (queue.service.ts refactor) | 3.5-B |
| 31 | Auto-limpeza agendada (job no server.ts) | 5.2 |
| 32 | Análise de trocas no dashboard | 2.5 |

---

## 10. Riscos e Pontos de Atenção

### Riscos técnicos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| **Performance do dashboard com 31 dias** | 16 sub-queries × 31 dias de dados = potencial lentidão | Testar com volume realista. Adicionar índices se necessário. Considerar materialized view para agregações comuns. |
| **html2canvas + jspdf com 31 páginas** | Gerar 31 páginas PDF no navegador pode ser lento | Para períodos > 7 dias, recomendar modo "consolidado". Se o gerente insistir em "por dia", processar em lotes com feedback de progresso. |
| **Transações concorrentes no queue.service** | Read fora da transação pode causar phantom reads | Para preempção (fase 4), mover read para dentro da transação com `SELECT ... FOR UPDATE`. |
| **Migração de schema em produção** | ALTER TABLE com dados existentes | Testar em cópia do banco primeiro. Usar `ADD COLUMN IF NOT EXISTS`. |
| **Filtro `annulled` esquecido em alguma query** | Métricas inconsistentes | Criar helper `sqlExcludeAnnulled(baseQuery)` para aplicar automaticamente. |

### Pontos de atenção

1. **IDs do DOM:** Preservar todos os IDs existentes no HTML — o JS depende deles (convenção do handoff §14).
2. **`GROUP BY` posicional:** Manter `GROUP BY 1, 2, ...` (convenção do handoff §16.2).
3. **SQL parametrizado:** Nunca concatenar strings nas queries (convenção do handoff §14).
4. **Sem frameworks no frontend:** HTML/CSS/JS vanilla, sem build step ou bundler.
5. **CDN para bibliotecas:** html2canvas, jspdf e xlsx carregados via `<script>` CDN, sem npm install adicional.
6. **Timezone:** Manter `America/Sao_Paulo` hardcoded por enquanto. Futuro: tornar configurável via `system_settings`.
7. **Broadcast Socket.IO:** Com as novas funcionalidades, considerar voltar a usar rooms direcionadas em vez de broadcast global para eventos que só interessam a um perfil específico (ex: `demand:cross-cancel`).

---

> **Fim do plano.** Este documento deve ser revisado e aprovado antes do início da implementação.
