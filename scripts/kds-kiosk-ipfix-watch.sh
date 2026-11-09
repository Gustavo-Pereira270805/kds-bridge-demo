#!/bin/bash
# kds-kiosk-ipfix-watch.sh — rede de segurança do bypass por IP dos quiosques.
#
# Por que existe: o tailscaled INSERE o jump `-A POSTROUTING -j ts-postrouting`
# no INÍCIO do POSTROUTING a cada (re)configuração de rede e em todo upgrade do
# pacote — empurrando a exceção de kds-kiosk-ipfix.sh para a posição 2 e
# religando o SNAT que mascara o IP do Pi (Caddy vê 172.18.0.1 e a tela cai em
# /login). Aconteceu em 30/10 (1.104.4) e de novo em 08/11 (1.104.5).
#
# O kds-kiosk-ipfix.service cobre boot e restart do tailscaled, mas não vence a
# corrida (o tailscaled aplica as regras alguns segundos DEPOIS de o serviço
# subir). Este loop reaplica a cada 30s — é idempotente e sai na primeira linha
# quando a regra já está na posição 1.
#
# Instalação: kds-kiosk-ipfix-watch.service
# Conferir: sudo iptables -t nat -S POSTROUTING | head -3

set -u
INTERVALO="${KDS_IPFIX_INTERVALO:-30}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

while :; do
  /usr/local/sbin/kds-kiosk-ipfix.sh || true
  sleep "$INTERVALO"
done
