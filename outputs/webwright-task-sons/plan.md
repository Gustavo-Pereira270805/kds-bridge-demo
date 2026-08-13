# Sons da Cozinha — Verificação Playwright

# Critical Points
- [x] CP1: `/cozinha-quente` carrega sem erros de console (sem 404 de scripts, sem ReferenceError, sem erro do motor de sons) — únicos erros: `favicon.ico` 404 pré-existente (view não tem `<link rel="icon">`), não relacionado ao motor
- [x] CP2: `/cozinha-fria` carrega sem erros de console (0 erros)
- [x] CP3: motor `kitchen-sounds.js` exposto e funcional: as 4 funções globais existem e os 4 sons tocam sem exceção nas duas telas (`playNormalAlert/Urgent/Stockout/CrossCancel: ok`)
- [x] CP4: cenário kiosk: alerta disparado sem interação prévia não gera erro no console; após gesto real (mouse.click trusted), nenhuma mensagem de bloqueio — retry/flush operando
- [x] CP5: nenhuma referência ao CDN do Tone.js nas telas quente/fria (`telas_com_tone=nenhuma`) — offline seguro

# Evidências
- `final_runs/run_1/final_script_log.txt` — passos 1–7 com resultados
- `final_runs/run_1/screenshots/final_execution_01..06_*.png` — telas carregadas, 4 sons, kiosk antes/após gesto
