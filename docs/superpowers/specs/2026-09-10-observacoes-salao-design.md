# Observações do salão nas demandas (runtime, sem DB) — Design

Data: 2026-09-10. Origem: pedido do dono (checkbox libera caixa de texto no
salão; cozinheiros veem no card da demanda; máx. 50 chars + letreiro).

## 1. Objetivo

O atendente do salão pode anexar uma observação curta a uma demanda no ato
do registro. A observação aparece com alta visibilidade no card da demanda
em TODAS as telhas de cozinha (`cozinha`, `cozinha-quente` incl. grade do
jantar, `cozinha-fria`) nos TRÊS visuais (escuro, claro, jantar). A
observação é **somente runtime**: nenhum coluna nova, nenhuma migration,
nada gravado no Postgres. Restart do servidor apaga as observações
(comportamento esperado e documentado aqui).

## 2. Não-objetivos (YAGNI)

- Editar/adicionar observação em demanda já criada (só na criação).
- Histórico de observações, métricas, filtros por observação.
- Reutilizar a coluna `notes` (persistida — fora do pedido).

## 3. Arquitetura

```
salao.html (checkbox + input + contador)
  │ POST /api/v1/demands { ..., observation?: string }
  ▼
demands.ts — valida, NÃO inclui no INSERT
  │ guarda em observation.service.ts (Map<id, texto>)
  ▼
resposta + eventos socket levam `observation`
  │ GET / e /cancelled-cozinha mesclam o Map (F5 / tela tardia veem)
  ▼
cards das 3 cozinhas renderizam .obs-strip (esc + letreiro se transbordar)
  │ retrieve / cancel-salao / cancel-cozinha / annul ──► apaga do Map
```

### 3.1 Novo serviço `src/services/observation.service.ts`

- `Map<string, string>` em memória (chave = demanda id).
- `setObservation(id, text)`: guarda texto já validado (trim).
- `getObservation(id): string | undefined`.
- `takeObservation(id)`: lê e apaga (uso nas transições terminais).
- `clearObservation(id)`: apaga sem ler.
- Sem timers/TTL: a limpeza acontece nas transições (retrieve, cancelamentos,
  annul) — ver §6. Demandas que somem do quadro sem passar por transição
  (ex.: nunca acontece hoje: toda saída passa por uma rota) não vazam; de
  todo modo o Map só guarda strings ≤ 50 chars.

### 3.2 API (`src/routes/demands.ts`)

- `POST /`: schema aceita `observation: { type: 'string', maxLength: 50 }`.
  Validação server-side após parse: `trim()`; string vazia → trata como
  ausente; `length > 50` → `400 { error: 'Observação com no máximo 50 caracteres' }`.
  (Fastify já barra >50 pelo schema; a checagem manual cobre bypass e dá
  mensagem pt-BR amigável.)
- O INSERT **não** recebe a observação. Após criar, `setObservation(id)` e
  responde `{ ...newDemand, observation }` (ausente → campo `undefined`/omitido).
- `GET /` e `GET /cancelled-cozinha`: após o SELECT, anexam `observation`
  do Map a cada linha (mesmo nome de campo). Sem N+1: leitura O(1) por linha.
- Transições que tiram do quadro (`retrieve`, `cancel-salao`,
  `cancel-cozinha`, `annul` em admin.ts): chamam `clearObservation(id)`
  **depois** do commit do UPDATE (mesmo padrão do `demand:stockout`: evento
  após recompute — aqui, limpeza após persistência).
- Tipos (`src/types.ts`): `CreateDemandBody.observation?: string`;
  `Demand.observation?: string | null` (opcional — nunca vem do banco).

### 3.3 Salão (`src/views/salao.html`)

- No form, abaixo da linha Urgente/Troca/Observação: a caixa de texto
  (`maxlength=50`, `placeholder` com exemplo) fica OCULTA até marcar o
  checkbox `Observação` (ao lado de Urgente/Troca); desmarcar esconde e
  limpa. `<small>` contador `0/50` (discreto, pequeno, abaixo da caixa).
- JS: checkbox alterna `display` do wrapper (e foca a caixa ao marcar);
  `input` atualiza o contador; submit inclui `observation` (trim, só se checkbox marcado e
  não-vazio); após sucesso desmarca/limpa/contador zera.
- Lista "Demandas Ativas": se `d.observation`, mostra a mesma faixa
  `.obs-strip` (sem letreiro animado — espaço menor; `text-overflow: ellipsis`).
  Mantém consistência sem poluir a tela do atendente.

### 3.4 Cozinhas (`cozinha.html`, `cozinha-quente.html`, `cozinha-fria.html`)

- Nova faixa no card pendente, logo abaixo do nome do produto:
  `<div class="obs-strip"><span class="obs-tag">OBS</span><span
  class="obs-text">…esc…</span></div>`.
- Posição fixa (sempre no mesmo lugar do card) para leitura por padrão visual.
- Cores via TOKENS do tema (consistência com os cards): fundo
  `var(--alert-warn-bg-dark)` (adapta sozinho ao claro), borda
  `rgba(245,158,11,.35)` + filete esquerdo `3px solid var(--c-warn)`,
  rótulo `OBS` em `var(--c-warn)` no estilo das badges de status e texto em
  `var(--c-text-body)` 15px/700 — mesma família visual de zerado/troca.
  Tamanho: 15px / peso 700 — maior que o meta do card, menor que o nome.
- Letreiro: após render, JS mede `scrollWidth > clientWidth` do `.obs-text`;
  se transbordar, adiciona `.marquee` (animação `translateX` em loop, estilo
  teleprompter, `prefers-reduced-motion` respeitado: sem animação, mostra
  início + `…`). Texto curto: estático, sem animação.
- XSS: sempre via `esc()` existente. `maxlength=50` conta unidades UTF-16
  (input, salão e Node contam igual — consistente).
- Prontos (`ready-strip` pills): sem observação (pílula é compacta; a obs já
  cumpriu o papel no preparo). Decisão explícita: obs só no card pendente.

## 4. Socket

Nenhum evento novo. Os payloads existentes (`demand:new`, `demand:urgent`,
`demand:ready`, `demand:stockout`, `demand:queue-updated` via reload, etc.)
passam a carregar `observation` quando houver, pois vêm dos objetos já
mesclados. Telas atualizam o mapa local ao receber (mesmo padrão dos demais
campos).

## 5. Erros (pt-BR, sem `.catch` vazio)

- `400 'Observação com no máximo 50 caracteres'` (texto longo via API direta).
- Falha ao criar demanda com obs: toast com a mensagem (padrão do salão).
- Render das cozinhas segue em `try/catch` com log — obs nunca quebra o card.

## 6. Limpeza / ciclo de vida

| Transição | Onde | Ação obs |
|---|---|---|
| `retrieve` | demands.ts | `clearObservation` após UPDATE |
| `cancel-salao` | demands.ts | `clearObservation` após UPDATE |
| `cancel-cozinha` | demands.ts | `clearObservation` após UPDATE |
| `annul` | admin.ts | `clearObservation` após UPDATE |
| restart servidor | — | Map esvazia (esperado) |

## 7. Testes

- `tsc --noEmit` limpo.
- Playwright (Python313 + Chromium, 1280x1800) + webwright: salão
  (checkbox habilita/desabilita, contador, envio com/sem obs), 3 cozinhas ×
  3 visuais (faixa visível, contraste, posição, letreiro com texto de 50
  chars), screenshots em `outputs/obs-salao/`.
- E2E lógica: criar com obs → cozinha recebe via socket; F5 cozinha → obs
  volta via GET; >50 via API → 400; XSS `<script>` → escapado; retrieve →
  obs some (GET não retorna); restart (dev) → obs some.
- Commit + push + deploy Oracle (`git pull` + `docker compose up -d --build`,
  health + spot-check visual) somente se tudo passar.

## 8. Riscos

- Restart apaga obs — aceito pelo dono (runtime puro).
- Demanda criada e cozinha com página aberta ANTES do deploy: recebe via
  socket normalmente (campo novo é aditivo; `undefined` → sem faixa).
