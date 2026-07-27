#!/bin/bash
# ~/.config/openbox/autostart — Orange Pi modo quiosque para KDS Bridge v2.1
# Configuração para 2 Orange Pis:
#   - Pi 1 (hostname: cozinha-quente-kds): Cozinha Quente A/B (tela dividida)
#   - Pi 2 (hostname: cozinha-fria-kds):   Cozinha Fria (tela única)

# Desabilitar protetor de tela e desligamento automático da tela
xset s off
xset s noblank
xset -dpms

# Esconder o cursor do mouse
unclutter -idle 0 &

# Aguardar a rede estabilizar
sleep 5

# =====================================================
# ALTERE A LINHA ABAIXO conforme o Orange Pi:
# =====================================================
#
# Orange Pi da Cozinha Quente (A/B):
# chromium --noerrdialogs --disable-infobars --kiosk \
#          --disable-session-crashed-bubble \
#          --disable-restore-session-state \
#          https://SEU-RETOOL.retool.com/app/cozinha-quente
#
# Orange Pi da Cozinha Fria:
# chromium --noerrdialogs --disable-infobars --kiosk \
#          --disable-session-crashed-bubble \
#          --disable-restore-session-state \
#          https://SEU-RETOOL.retool.com/app/cozinha-fria

chromium --noerrdialogs \
         --disable-infobars \
         --kiosk \
         --disable-session-crashed-bubble \
         --disable-restore-session-state \
         https://SEU-RETOOL.retool.com/app/cozinha
