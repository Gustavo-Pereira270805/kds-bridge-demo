#!/bin/bash
# kds-kiosk-ipfix.sh — preserva o IP real do quiosque (Pis) até o Caddy.
#
# PROBLEMA
# O tailscaled instala `-A POSTROUTING -j ts-postrouting`, que aplica SNAT
# (`-m mark --mark 0x40000/0xff0000 -j MASQUERADE`) no tráfego vindo da
# tailnet que é encaminhado para outra interface. Como o Caddy roda em Docker,
# o pacote do Pi (100.x) é encaminhado para a bridge e sai mascarado como
# 172.18.0.1 — o app lê 172.18.0.1 no último X-Forwarded-For e o bypass de
# quiosque por IP (KDS_KIOSK_IPS) nunca casa: a tela cai em /login.
# Sintoma idêntico ao do userland-proxy do Docker (ver AGENTS.md).
#
# SOLUÇÃO
# 1) Preferencial (durável): `tailscale set --snat-subnet-routes=false` — esta
#    VM não é subnet router nem exit node, então o SNAT do Tailscale não tem
#    função aqui. É o que zera a regra de MASQUERADE do ts-postrouting (o
#    Tailscale ainda pode deixar o jump, mas a chain fica vazia).
# 2) Exceção estreita ANTES do ts-postrouting: tráfego com origem na tailnet
#    (100.64.0.0/10) e destino em rede privada de container (172.16.0.0/12) não é
#    mascarado, então o Caddy enxerga o IP do Pi. É a rede de segurança para
#    quando o tailscaled reinsere o jump na posição 1 (ele INSERE no início, não
#    anexa) ou se a pref voltar ao padrão.
#
# Uso (root): bash kds-kiosk-ipfix.sh
# Instalação permanente: kds-kiosk-ipfix.service + kds-kiosk-ipfix-watch.service
# (ver docs/FIX_QUIOSQUE_SNAT_TAILSCALE_2026-10-30.md)
#
# Conferir depois: sudo iptables -t nat -S POSTROUTING | head -3
#   A regra precisa ser a PRIMEIRA (antes do `-j ts-postrouting`).

set -u

ORIGEM="100.64.0.0/10"
DESTINO="172.16.0.0/12"
ESPERADA="-A POSTROUTING -s ${ORIGEM} -d ${DESTINO} -j RETURN"

# Já está na posição correta: nada a fazer.
if [ "$(iptables -t nat -S POSTROUTING | sed -n '2p')" = "${ESPERADA}" ]; then
  exit 0
fi

# Remove cópias fora de posição (ex.: tailscaled reinseriu o jump na frente).
while iptables -t nat -C POSTROUTING -s "${ORIGEM}" -d "${DESTINO}" -j RETURN 2>/dev/null; do
  iptables -t nat -D POSTROUTING -s "${ORIGEM}" -d "${DESTINO}" -j RETURN
done

iptables -t nat -I POSTROUTING 1 -s "${ORIGEM}" -d "${DESTINO}" -j RETURN
