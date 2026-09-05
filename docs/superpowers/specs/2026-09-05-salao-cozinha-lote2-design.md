# Spec de implementação — Lote 2: salão, cozinha clara, capacidade e jantar

Aprovado pelo usuário em 2026-09-05. Implementar exatamente o descrito abaixo.
NÃO commitar nem dar push sem aprovação explícita do usuário ao final.

## 0. Contexto para a sessão de implementação

- Repositório: `C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo`.
  Idioma do código/docs/commits: pt-BR. TypeScript strict.
- Comandos: `npm run dev` (sobe em background com
  `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`;
  porta 3000 pode estar ocupada por instância anterior — `taskkill` antes);
  `npx tsc --noEmit` (obrigatório após qualquer mudança TS).
  Views são HTML puro em `src/views/` servido do disco a cada request em
  dev (sem restart); CSS/JS via fastify-static (`/styles/*`, `/scripts/*`).
- Banco: Supabase Postgres (`DATABASE_URL` no `.env`). Colunas de
  `demands` relevantes já existem: `ready_at`, `cancelled_at`,
  `cooking_started`, `cooking_started_at`, `stockout_reported`,
  `stockout_reported_at`, `expected_ready_at`, `sla_minutes`, `priority`,
  `unit_label`, `is_replacement`, `replaced_product_id`.
- Papéis: `salao|cozinha|gerente|admin` (`app_metadata.role`). Conta de
  teste com papel gerente existe; ver usuário/senha em
  `outputs/verificacao-6-itens/final_runs/run_1/final_script.py`
  (`ADMIN_EMAIL`/`ADMIN_PASS`). Python com Playwright:
  `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe`
  (Chromium funcional).
- Padrão de verificação já estabelecido: scripts Playwright em
  `outputs/verificacao-6-itens/final_runs/run_N/final_script.py` com
  `plan.md` de critical points, screenshots lidos um a um, limpeza total
  das demandas de teste (cancelar via API; se poluir métrica, anular via
  `POST /api/v1/admin/demands/:id/annul` com `{"reason": "..."}` — motivo
  obrigatório). Reutilizar `run_1` como modelo (login, token em
  sessionStorage, criação de demandas, asserts).
- Estado atual: produção em `afb0c75` (lote 1 deployed); SLAs zerados para
  normal=12/urgente=5 (backup em
  `C:\Users\Milena\AppData\Local\Temp\opencode\sla-backup-2026-09-04.json`);
  temas das estações no servidor = `light`; 18 demandas de teste anuladas.
- Tokens CSS (todos em `src/views/styles/theme.css`): fundo/borda de
  alerta `--alert-urgent-bg-dark #4c0519`, `--alert-urgent-bg-light #fff1f2`,
  `--alert-warn-bg-dark #451a03`, `--alert-warn-bg-light #fffbeb`
  (linhas ~40-47; overrides claros ~165-168); jantar `--dinner-bg #0b1020`,
  `--dinner-surface #141a2e`, `--dinner-accent #d4a574` (~122-124, iguais
  nos dois temas); perigo `--c-danger`, aviso `--c-warn`.

## A — Card urgente/zerado no tema claro (salao, quente, fria)

Hoje (tema escuro): `.urgent` fundo vermelho-escuro + `urgentPulse`;
`.stockout` fundo âmbar-escuro + borda + `stockoutPulse`. No claro, essas
regras não são espelhadas e o card fica apagado.

1. `src/views/salao.html` (~141-147): adicionar regras
   `:root[data-theme="light"] .demand-card.urgent` (fundo
   `var(--alert-urgent-bg-light)`, `border-left: 6px solid var(--c-danger)`,
   animação `urgentPulse`) e `.demand-card.stockout` (fundo
   `var(--alert-warn-bg-light)`, borda `var(--c-warn)`, `stockoutPulse`).
   Nome do produto nesses cards: 16px→19px, peso 800.
2. `src/views/cozinha-quente.html` e `cozinha-fria.html` (blocos
   `:root[data-theme="light"]` no `<style>`): mesmo espelhamento para
   `.card.urgent` / `.card.stockout`; `.card .name` 22px→25px, peso 800.
3. Selo de zeramento: no salão (`renderDemands`, ~linha 381) trocar
   `ZERADO` por `ZERADO às HH:MM` usando `d.stockout_reported_at`
   (formatar `toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})`;
   fallback sem hora se nulo). Nas cozinhas, que hoje só têm a classe no
   card, adicionar `<div class="stockout-label">ZERADO às HH:MM</div>`
   (mesmo padrão do `.urgent-label` existente) com CSS nos dois temas.
4. Verificar com prints: card urgente e card zerado lado a lado nos temas
   claro e escuro, nas 3 telas; texto legível (contraste) em todos.

## B — Teto rígido de capacidade (`src/services/queue.service.ts`)

Hoje `PATCH /kitchen-stations/:id` (`src/routes/kitchen-stations.ts:72`) já
chama `recomputeStationQueue`, mas o motor nunca desmarca `locked`
(só preempção por urgente, linhas 41-71) e o array `slots` não é limitado
à capacidade (linhas 36-39) — novos itens seguem entrando.

1. Após separar `locked`/`waiting` (linhas 28-29): se
   `locked.length > station.capacity`, manter os `capacity` com
   `expected_ready_at` mais próximo (desempate: `created_at` mais antigo;
   tratar `expected_ready_at` nulo como +infinito) e mover o resto para
   `waiting` com `cooking_started=false` (persistir como os demais
   unlocks: `cooking_started=false, cooking_started_at=NULL`, seguindo o
   padrão do bloco `unlockOnly`, linhas 104-109).
2. Limitar `slots` a `station.capacity` posições antes do loop de
   `waiting` (linhas 73-96): `slots = slots.slice(0, capacity)` após o
   `while` de preenchimento — com `locked.length <= capacity` garantido
   pelo passo 1.
3. Manter a preempção por urgente inalterada, rodando após o teto.
4. Vale para todas as estações (motor único). `npx tsc --noEmit`.
5. Verificar E2E: criar N+2 demandas, reduzir capacidade para N, conferir
   via API que só N têm `cooking_started=true` (as de ETA mais próximo) e
   que as demais voltaram a `false` com `expected_ready_at` recalculado;
   print da cozinha antes/depois.

## C — Ordenação no salão (`src/views/salao.html` ~353-399)

Trocar o comparador atual (urgente-primeiro, linhas 361-365) por:
avisos de cancelamento (seção F) primeiro; depois `ready` por `ready_at`
ASC (fallback `created_at`); depois urgentes pendentes por `created_at`
ASC; depois demais pendentes por `created_at` ASC. Demanda pronta sobe ao
topo as
...[truncated 3881 chars]