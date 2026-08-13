# Sons da Cozinha — Revisão v2 (roteamento por sala + stockout após urgente)

# Critical Points
- [x] CP-A: demanda criada na estação FRIA → só `cozinha-fria` toca `playNormalAlert` (`quente=[] fria=[playNormalAlert]`)
- [x] CP-B: demanda criada na estação QUENTE → só `cozinha-quente` toca; a fria não ganha som novo
- [x] CP-C: demanda URGENTE na estação quente → `quente=[..., playUrgentAlert]`, fria intocada
- [x] CP-D: stockout na demanda da fria → backend promove a `priority=urgent` e só a fria toca `playStockoutAlert` (que agora executa urgente→zerado em sequência)

# Causa raiz / fix
- `src/routes/demands.ts:162`: `fastify.io.emit` (broadcast global) → roteado para `room` + `salao` + `gerente` + `cozinha` (mesmo padrão do stockout, L528-531)
- `src/socket/handlers.ts`: `cozinha` adicionada a `VALID_ROOMS` para a tela legada continuar recebendo eventos (zero regressão)
- `src/views/scripts/kitchen-sounds.js`: `recipeStockout()` agora toca `recipeUrgent()` completa e, em `at + 0.9s`, o sino descendente + glissando (urgente → zerado)

# Evidências
- `final_runs/run_2/final_script_log.txt` — passos 1–9 com os arrays de sons por tela
- Screenshots: `final_execution_01_fria_apos_demanda_fria.png`, `final_execution_02_quente_apos_demanda_fria.png`
