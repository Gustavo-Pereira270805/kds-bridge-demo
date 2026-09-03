#!/bin/bash
# pi-tailscale-setup.sh — Provisionamento Tailscale para Orange Pi Zero 3 (Armbian)
# Uso: sudo bash pi-tailscale-setup.sh --authkey tskey-auth-xxxxx --hostname kds-fria-1
# Idempotente: pode rodar de novo sem quebrar.
set -euo pipefail

AUTHKEY=""
HOSTNAME=""
SSH_ENABLE=1
RAW_AGENT_BASE="${KDS_AGENT_RAW_BASE:-https://raw.githubusercontent.com/Gustavo-Pereira270805/kds-bridge-demo/main/scripts/kds-agent}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --authkey) AUTHKEY="$2"; shift 2;;
    --hostname) HOSTNAME="$2"; shift 2;;
    --no-ssh) SSH_ENABLE=0; shift;;
    *) echo "Opção desconhecida: $1"; exit 1;;
  esac
done

if [[ -z "$AUTHKEY" ]]; then
  echo "ERRO: informe --authkey tskey-auth-xxxxx (gere em https://login.tailscale.com/admin/settings/keys)"
  exit 1
fi
if [[ -z "$HOSTNAME" ]]; then
  HOSTNAME="kds-pi-$(hostname | cut -c1-8)"
  echo "AVISO: hostname não informado, usando $HOSTNAME"
fi

echo "==> [1/6] Definindo hostname $HOSTNAME"
hostnamectl set-hostname "$HOSTNAME" || true
if ! grep -q "$HOSTNAME" /etc/hosts; then
  echo "127.0.1.1 $HOSTNAME" >> /etc/hosts
fi

echo "==> [2/6] Habilitando SSH se necessário"
if [[ $SSH_ENABLE -eq 1 ]]; then
  systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true
  # Garante usuário framboa com senha (já existe), mas não altera se já estiver ok
  id framboa >/dev/null 2>&1 || echo "Usuário framboa não encontrado — crie via armbian-config"
fi

echo "==> [3/6] Instalando Tailscale (se não estiver instalado)"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
else
  echo "    Tailscale já instalado: $(tailscale version | head -n1)"
fi
systemctl enable --now tailscaled

echo "==> [4/6] Conectando à tailnet"
# --accept-dns e --accept-routes para MagicDNS funcionar em Armbian
tailscale up --authkey="$AUTHKEY" --hostname="$HOSTNAME" --accept-dns=true --accept-routes=true

echo "==> [5/6] Verificação"
tailscale ip -4 || true
tailscale status || true
echo ""
echo "OK. IPs tailnet:"
tailscale ip
echo ""
echo "Teste do seu notebook: ssh framboa@$HOSTNAME  ou  ssh framboa@\$(tailscale ip -4 | head -n1)"
echo "Logs: sudo journalctl -u tailscaled -f"

echo "==> [6/6] Instalando kds-agent"
# Diretório do script (para cp funcionar tanto da raiz quanto de scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Suporta execução da raiz (scripts/kds-agent/...) ou local (./kds-agent/...)
if [ -f "$REPO_ROOT/scripts/kds-agent/agent.js" ]; then
  AGENT_SRC="$REPO_ROOT/scripts/kds-agent/agent.js"
  SERVICE_SRC="$REPO_ROOT/scripts/kds-agent/kds-agent.service"
elif [ -f "$SCRIPT_DIR/kds-agent/agent.js" ]; then
  AGENT_SRC="$SCRIPT_DIR/kds-agent/agent.js"
  SERVICE_SRC="$SCRIPT_DIR/kds-agent/kds-agent.service"
else
  AGENT_SRC="scripts/kds-agent/agent.js"
  SERVICE_SRC="scripts/kds-agent/kds-agent.service"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "    Node.js/npm não encontrados — instalando pelos pacotes do sistema"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm
fi

DOWNLOAD_DIR=""
if [ ! -f "$AGENT_SRC" ] || [ ! -f "$SERVICE_SRC" ] || [ ! -f "$REPO_ROOT/scripts/kds-agent/package.json" ]; then
  DOWNLOAD_DIR="$(mktemp -d)"
  trap 'rm -rf "$DOWNLOAD_DIR"' EXIT
  echo "    Arquivos locais não encontrados — baixando o agente da origem configurada"
  curl -fsSL "$RAW_AGENT_BASE/agent.js" -o "$DOWNLOAD_DIR/agent.js"
  curl -fsSL "$RAW_AGENT_BASE/kds-agent.service" -o "$DOWNLOAD_DIR/kds-agent.service"
  curl -fsSL "$RAW_AGENT_BASE/package.json" -o "$DOWNLOAD_DIR/package.json"
  AGENT_SRC="$DOWNLOAD_DIR/agent.js"
  SERVICE_SRC="$DOWNLOAD_DIR/kds-agent.service"
  PACKAGE_SRC="$DOWNLOAD_DIR/package.json"
else
  PACKAGE_SRC="$REPO_ROOT/scripts/kds-agent/package.json"
fi

echo "==> Instalando kds-agent"
sudo mkdir -p /opt/kds-agent
sudo cp "$AGENT_SRC" /opt/kds-agent/agent.js
sudo cp "$PACKAGE_SRC" /opt/kds-agent/package.json
sudo cp "$SERVICE_SRC" /etc/systemd/system/kds-agent.service
echo "    Instalando dependência socket.io-client"
sudo npm --prefix /opt/kds-agent install --omit=dev 2>&1 | tail -n 5
sudo tee /etc/sudoers.d/kds-agent >/dev/null <<'EOF'
framboa ALL=(ALL) NOPASSWD: /sbin/poweroff, /sbin/reboot
EOF
sudo chmod 440 /etc/sudoers.d/kds-agent
sudo visudo -c
sudo systemctl daemon-reload
sudo systemctl enable --now kds-agent
echo "    kds-agent: $(systemctl is-active kds-agent 2>&1) | sudoers: $(cat /etc/sudoers.d/kds-agent 2>&1)"
echo "    Configure KDS_TOKEN em /etc/systemd/system/kds-agent.service (Environment=KDS_TOKEN=seu_token_gerente)"
