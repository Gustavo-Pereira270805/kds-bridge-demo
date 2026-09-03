#!/bin/bash
# kds-watchdog.sh — watchdog local de rede.
# Quando o gateway local deixa de responder por ~30s, reinicia o Wi-Fi e,
# se persistir, reinicia a placa. Não depende de internet, Tailscale ou
# servidor externo (ping no gateway da rede local).
set -u

GATEWAY="${KDS_WATCHDOG_GATEWAY:-192.168.0.1}"
PING_INTERVAL="${KDS_WATCHDOG_PING_INTERVAL:-10}"
MAX_FAILS="${KDS_WATCHDOG_MAX_FAILS:-3}"
LOG_TAG="kds-watchdog"

fail=0
while true; do
  if ping -c 1 -W 2 "$GATEWAY" >/dev/null 2>&1; then
    fail=0
  else
    fail=$((fail + 1))
  fi

  if [ "$fail" -ge "$MAX_FAILS" ]; then
    logger -t "$LOG_TAG" "Sem resposta do gateway por $((MAX_FAILS * PING_INTERVAL))s — reiniciando Wi-Fi"
    if nmcli device reapply wlan0 2>/dev/null; then
      :
    else
      nmcli device disconnect wlan0 2>/dev/null
      sleep 3
      nmcli device connect wlan0 2>/dev/null
    fi
    sleep 15
    if ! ping -c 1 -W 2 "$GATEWAY" >/dev/null 2>&1; then
      logger -t "$LOG_TAG" "Wi-Fi ainda sem resposta — reiniciando a placa"
      /sbin/reboot
      exit 0
    fi
    logger -t "$LOG_TAG" "Wi-Fi restaurado após reinício da interface"
    fail=0
  fi

  sleep "$PING_INTERVAL"
done