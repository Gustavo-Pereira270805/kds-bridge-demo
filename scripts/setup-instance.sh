#!/bin/bash
# setup-instance.sh — Configuração inicial da instância Oracle Cloud para o KDS Bridge
# Uso: sudo bash scripts/setup-instance.sh
# Idempotente: pode rodar mais de uma vez sem quebrar.

set -euo pipefail

echo "==> [1/6] Atualizando o sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> [2/6] Instalando Docker + Compose"
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y -qq docker.io docker-compose-v2
  systemctl enable --now docker
else
  echo "    Docker já instalado."
fi

echo "==> [3/6] Habilitando IPv6 no daemon do Docker (requisito do Supabase direto)"
mkdir -p /etc/docker
if [ -f /etc/docker/daemon.json ]; then
  if grep -q '"ipv6": true' /etc/docker/daemon.json 2>/dev/null; then
    echo "    IPv6 já habilitado."
  else
    cp /etc/docker/daemon.json /etc/docker/daemon.json.bak.$(date +%s)
    echo "    Backup de daemon.json criado."
  fi
fi
cat > /etc/docker/daemon.json <<'EOF'
{
  "ipv6": true,
  "fixed-cidr-v6": "2001:db8:1::/64"
}
EOF
systemctl restart docker

echo "==> [4/6] Instalando fail2ban (proteção SSH)"
apt-get install -y -qq fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 3

[sshd]
enabled = true
backend = systemd
EOF
systemctl enable --now fail2ban
fail2ban-client reload >/dev/null 2>&1 || true

echo "==> [5/6] Preparando o projeto"
if [ ! -d /opt/kds ]; then
  mkdir -p /opt/kds
  echo "    Criado /opt/kds — cole o repositório aqui (git clone) e crie o .env"
else
  echo "    /opt/kds já existe."
fi

echo "==> [6/6] Resumo das ações manuais pendentes"
cat <<'MSG'

Setup base concluído! Faltam apenas passos manuais:

1. Subir o projeto:
     cd /opt/kds
     git clone <SEU-REPO> .
     cp .env.example .env
     nano .env          # preencha DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY

2. Subir a stack:
     docker compose up -d --build

3. Conferir:
     docker compose ps
     docker compose logs app
     curl -s http://localhost:3000/health

4. Apontar o DuckDNS para o IP público desta instância e testar:
     curl -s https://kds.duckdns.org/health
MSG
echo "Setup concluído."