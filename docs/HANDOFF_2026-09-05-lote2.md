# HANDOFF — Sessão 2026-09-05 (lote 2 + refinamentos + notas)

Data: 2026-09-05. Repo: `C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo`, branch `main`.
Idioma do repo: pt-BR (código, commits, docs). TS strict (`npx tsc --noEmit` após mudar TS).

## ⚠️ PENDENTE (não commitado, não testado, não no servidor)
- `src/views/salao.html` → `prefillReplaceForm` (Trocar): busca principal fica VAZIA e focada;
  só o item substituído vem preenchido (troca marcada + `replacedProduct` + busca de troca).
  Motivação: usuário reclamou que vinha preenchida com o cancelado e obrigava apagar.
  Falta: testar (atualizar step 9 do script lote2), commitar, subir.

## Ambiente
- Dev: `npm run dev` (ts-node-dev) na porta 3000. Views HTML lidas do disco a cada request
  (sem restart); **TS exige restart** (matar PID e `Start-Process`). Porta 3000 costuma ficar presa.
- Produção: VM `163.176.208.86` (`ubuntu`, chave `C:\Users\Milena\.ssh\kds_oracle`), `/opt/kds`,
  `docker compose up -d --build` (foreground; background morre no timeout do shell).
  URL `https://kds-framboa.duckdns.org`. Health interno ok; **TLS do meu Python local falha
  ("certificate expired") mas o cert servido vale até 01/12/2026** — problema de CA local, não do servidor.
- Testes: `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe` + Playwright Chromium.
  Conta gerente de teste: ver `ADMIN_EMAIL`/`ADMIN_PASS` em `outputs/verificacao-6-itens/final_runs/run_1/final_script.py`.
- Scripts utilitários da sessão em `C:\Users\Milena\AppData\Local\Temp\opencode\` (`shot_*.py`, `dbg_*.py`,
  `deploy_*.py`). Evidências em `outputs/verificacao-lote2/` (plan.md, final_runs/run_N, jantar-*/,
  grade-scroll/, unidades-grade/, notas-jantar/, notas-fix/, prod-aviso/, empty-jantar/).
- **Nunca** `node -e`/python inline com aspas no PowerShell — escrever arquivo e executar.
- Limpeza de testes: cancelar via API; o que poluir métrica, anular via
  `POST /api/v1/admin/demands/:id/annul` (`{"reason":...}`). `cancel-cozinha` em scripts falhou
  silenciosamente algumas vezes — preferir `cancel-salao` + `retrieve` na limpeza.

## Commits já no ar (origin/main, produção rebuildada e verificada)
1. `70f023f` — lote 2 (fixes A–G) + refinamentos abaixo.
2. `afc428f` — nota do Salão na aba Jantar (dia todo).
3. `20ebf2f` — entidade `salao_jantar` (só demandas criadas após ativar o turno).
4. `448178d` — fixes das notas: 0→5, BRT, janela persistente.

## Lote 2 (spec: `docs/superpowers/specs/2026-09-05-salao-cozinha-lote2-design.md`)
- **B** `queue.service.ts`: teto rígido (excedente volta a `cooking_started=false`, ETA nulo = +inf,
  `slots.slice(capacity)`, preempção depois).
- **A** urgente/zerado no claro (salao/quente/fria): borda 6px + pulso + nome 19/25px 800,
  selo `ZERADO às HH:MM`, `.stockout-label` novo nas cozinhas, contraste do elapsed no claro.
- **C/D** salão: ordem prontos(`ready_at`)>urgentes>demais; reset limpa busca/selects/unidade/qtd/checks.
- **E** `makeProductDropdown` reutilizável (principal + busca do item substituído).
- **F** aviso laranja `CANCELADA PELA COZINHA` no topo (só em memória; some no F5), Trocar/Esquecer,
  envio com `replaced_product_id`. **Provado em produção** (E2E + print, demanda anulada depois).
- **G** salão jantar via `data-shift` (fundo `#0b1020`, dourado `#d4a574`).

## Refinamentos (todos verificados com prints)
- Jantar v1→v2: seções transparentes (corpos idênticos `rgb(11,16,32)` por amostragem),
  nav `#1e1b24`, bordas cinza (fora âmbar estrutural), urgente `#4c0519`/zerado `#451a03` também
  na **cozinha** jantar (regra `.cooking` vencia a `.urgent`), lua crescente no botão de turno
  do gerente (mesmo traço do toggle; JS usa `innerHTML` p/ preservar o SVG), h3/labels legíveis.
- **Atenção**: tokens `--alert-*-bg-dark` são redefinidos p/ tons CLAROS no tema light → no jantar
  usar hex fixo (`#4c0519`, `#451a03`, `#022c22`).
- Grade jantar travada `repeat(3, 1fr)` (auto-fill abria 5 cols em tela larga), 2 até 1100px, 1 no mobile;
  9 visíveis em 900px. Empty-state com `grid-column: 1/-1` + cores do jantar.
- Scroll mobile: quente tinha `overflow:hidden` herdado no breakpoint → `overflow-y:auto`;
  `cozinha.html` sem `<meta viewport>` → adicionada. Fria já rolava.
- Unidades: só ~4/produto (vínculo da importação, código correto). Decisão do usuário: **117 ativas
  p/ todos + favoritas ★ primeiro**. Migration `supabase/migrations/2026-09-05-product-units-todas-ativas.sql`
  + convergência no `seedDatabase` (roda no boot da produção).

## Notas (dashboard)
- Entidade `salao_jantar` = mesma fórmula do salão, filtro `created_at >= shift_dinner_started_at`
  (gravado na ativação; **mantido após encerrar** de propósito; `entity` é VARCHAR sem CHECK).
  Whitelist da API em `analytics.ts:736`. Aba Jantar: Cozinha Jantar + Salão Jantar; detalhe e
  export genéricos. Dias de jantar anteriores à mudança não têm a nota (sem como reconstruir).
- Bugs achados e corrigidos: `Number(score) || 5` exibia 0.0 como 5.0 (helper `numScore`);
  ocorrências em UTC fatiado (+3h) → `fmtOccDate` em `America/Sao_Paulo` (tabela compartilhada).
- Pesos atuais: cancel salão/cozinha 0.05, stockout 0.1, sla 0.05/0.3 (restaurados após teste).
  Teste do 0.0 usou peso temporário 3.0 + stub de API (71 + demandas anuladas depois).

## Estado final
Turno `lunch`, 0 demandas ativas, capacidades originais (fria=1), SLAs normal=12/urgente=5,
temas das estações `light`, NADA confirmado nos Pis. Servidor local dev pode estar rodando
(reiniciar antes de nova sessão). Produção = `448178d` + edição pendente acima.
