# Log de sessão — 2026-09-05 — Lote 2 (salão, cozinha clara, capacidade, jantar)

## Objetivo
Implementar o spec aprovado `docs/superpowers/specs/2026-09-05-salao-cozinha-lote2-design.md`
(fixes A–G) com verificação Playwright por fix, sem commit sem aprovação.

## Fluxo da sessão
1. Usuário aprovou o spec; escolheu compactar depois e pediu o spec detalhado
   para implementação cega → spec expandido com arquivos/linhas, casos de borda e checklist.
2. Ordem de implementação (com skills `executing-plans`, `verification-before-completion`,
   `systematic-debugging`, `webwright`): B → A → C+D → E → F → G → verificação.

## Implementado (fixes A–G)
- **B — teto rígido de capacidade** (`src/services/queue.service.ts`): se `locked.length > capacity`,
  mantém os de `expected_ready_at` mais próximo e devolve o excedente com
  `cooking_started=false`; `slots` limitado à capacidade; preempção de urgentes intacta.
- **A — urgente/zerado no tema claro** (`salao.html`, `cozinha-quente.html`, `cozinha-fria.html`):
  borda 6px + pulso + nome 19px/25px 800; selo `ZERADO às HH:MM`; `.stockout-label` novo
  nas cozinhas; keyframes espelhados no salão; contraste do elapsed/ETA no urgente claro.
- **C — ordenação no salão**: prontos (`ready_at` ASC) > urgentes > demais (FIFO).
- **D — limpeza do formulário**: busca, selects, unidade, qtd=1, checks após envio.
- **E — dropdown reutilizável**: `makeProductDropdown({inputId, dropdownId, wrapperId, initialItems, onPick})`
  para o campo principal e para a busca do item substituído (troca).
- **F — cancelada pela cozinha**: aviso laranja `CANCELADA PELA COZINHA` no topo absoluto
  (motivo + tempo, só em memória), `Trocar` (pré-preenche tudo, envia com
  `replaced_product_id`, dispensa o aviso) e `Esquecer`.
- **G — salão jantar**: `data-shift` + identidade própria (fundo `#0b1020`, dourado `#d4a574`).

## Refinamentos pós-verificação (pedidos do usuário)
1. **Jantar v1**: nav/dropdowns/cards escuros; `ZEROU` âmbar-escuro no claro.
   Achado: tokens `--alert-*-bg-dark` são redefinidos p/ tons claros no tema `light` → hex fixo no jantar.
2. **Jantar v2**: seções transparentes (full-bleed `#0b1020` igual à cozinha; corpos idênticos
   `rgb(11,16,32)` por amostragem), nav `#1e1b24` (painel escuro da cozinha), bordas cinza
   suaves no lugar do âmbar estrutural; urgente `#4c0519`/zerado `#451a03` na cozinha jantar
   (a regra `.card.cooking` vencia a `.urgent`); lua crescente no botão de turno do gerente
   (mesmo traço do toggle de tema; JS preserva o SVG via `innerHTML`).
3. **Grade jantar 3×3 travada** (`repeat(3, 1fr)`, 2 até 1100px, 1 no celular; `auto-fill`
   abria 5 colunas em telas largas); 9 demandas visíveis em 900px.
4. **Scroll mobile**: `cozinha-quente` tinha `overflow:hidden` herdado no breakpoint
   (página travada) → `overflow-y:auto`; `cozinha.html` sem `<meta viewport>` → adicionada.
5. **Unidades**: só ~4 por produto (vínculo da importação do cardápio, código correto).
   Decisão do usuário: vincular as 117 ativas a todos + favoritas ★ primeiro.
   Migration `supabase/migrations/2026-09-05-product-units-todas-ativas.sql` + convergência no seed.
6. **Empty-state do jantar**: `grid-column: 1 / -1` (padrão da fria/genérica) + cores legíveis.

## Verificação
- `npx tsc --noEmit` exit 0 (repetido após cada bloco de edição).
- `outputs/verificacao-lote2/`: `plan.md` 12/12 CPs; `final_runs/run_5` (`VERIFICACAO_PASS`,
  9 prints); `run_7` (contraste/jantar); `jantar-{antes,depois,real,v2}/`, `grade-scroll/`,
  `unidades-grade/`, `empty-jantar/` com asserts de cor/layout/scroll.
- Estado final local: 0 demandas ativas, turno `lunch`, capacidades originais
  (fria=1), SLAs normal=12/urgente=5, NADA confirmado nos Pis.

## Deploy
- Commit + push para `origin/main`; deploy na VM (`/opt/kds`, `docker compose up --build`).
