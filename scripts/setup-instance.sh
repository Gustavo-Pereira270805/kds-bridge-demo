#!/bin/bash
# setup-instance.sh — Configuração inicial da instância Oracle Cloud para o KDS Bridge
# Uso: sudo bash scripts/setup-instance.sh
# Idempotente: pode rodar mais de uma vez sem quebrar.

set -euo pipefail

echo "==> [1/7] Atualizando o sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> [2/7] Instalando Docker + Compose"
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y -qq docker.io docker-compose-v2
  systemctl enable --now docker
else
  echo "    Docker já instalado."
fi

echo "==> [3/7] Habilitando IPv6 no daemon do Docker (requisito do Supabase direto)"
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
  "fixed-cidr-v6": "2001:db8:1::/64",
  "userland-proxy": false
}
EOF
# userland-proxy=false é OBRIGATÓRIO para o bypass dos quiosques por IP: com o
# proxy userland (padrão), o Caddy vê TODAS as conexões como 172.18.0.1 e as
# telas da cozinha caem no /login (ver AGENTS.md, gotcha do bypass por IP).
systemctl restart docker

echo "==> [4/7] Instalando fail2ban (proteção SSH)"
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

echo "==> [5/7] Preservando o IP dos quiosques (SNAT do Tailscale x Docker)"
# O tailscaled mascara (ts-postrouting MASQUERADE) o tráfego da tailnet que é
# encaminhado para a bridge do Docker; sem esta exceção o Caddy vê 172.18.0.1
# em vez do IP do Pi e o bypass de quiosque para de funcionar.
# Cópia canônica no repositório: scripts/kds-kiosk-ipfix.sh (manter iguais).
cat > /usr/local/sbin/kds-kiosk-ipfix.sh <<'EOF'
#!/bin/bash
# KDS — preserva o IP real do quiosque (Pis) até o Caddy.
# Ver docs/FIX_QUIOSQUE_SNAT_TAILSCALE_2026-10-30.md
set -u

ORIGEM="100.64.0.0/10"
DESTINO="172.16.0.0/12"
ESPERADA="-A POSTROUTING -s ${ORIGEM} -d ${DESTINO} -j RETURN"

if [ "$(iptables -t nat -S POSTROUTING | sed -n '2p')" = "${ESPERADA}" ]; then
  exit 0
fi

while iptables -t nat -C POSTROUTING -s "${ORIGEM}" -d "${DESTINO}" -j RETURN 2>/dev/null; do
  iptables -t nat -D POSTROUTING -s "${ORIGEM}" -d "${DESTINO}" -j RETURN
done

iptables -t nat -I POSTROUTING 1 -s "${ORIGEM}" -d "${DESTINO}" -j RETURN
EOF
chmod 755 /usr/local/sbin/kds-kiosk-ipfix.sh

cat > /etc/systemd/system/kds-kiosk-ipfix.service <<'EOF'
[Unit]
Description=KDS: preserva o IP dos quiosques (evita SNAT do Tailscale para a rede Docker)
Documentation=file:///opt/kds/docs/FIX_QUIOSQUE_SNAT_TAILSCALE_2026-10-30.md
After=tailscaled.service docker.service
PartOf=tailscaled.service
Wants=tailscaled.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/kds-kiosk-ipfix.sh

[Install]
WantedBy=multi-user.target
EOF

# O tailscaled INSERE o jump ts-postrouting no INÍCIO do POSTROUTING a cada
# upgrade/reconfiguração (aconteceu em 30/10 e 08/11), empurrando a exceção para
# a posição 2. Este vigia reaplica a cada 30s (idempotente) e é o que segura o
# bypass no dia a dia; o serviço acima cobre boot e restart do tailscaled.
cat > /usr/local/sbin/kds-kiosk-ipfix-watch.sh <<'EOF'
#!/bin/bash
# Cópia canônica: scripts/kds-kiosk-ipfix-watch.sh (manter iguais).
set -u
INTERVALO="${KDS_IPFIX_INTERVALO:-30}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
while :; do
  /usr/local/sbin/kds-kiosk-ipfix.sh || true
  sleep "$INTERVALO"
done
EOF
chmod 755 /usr/local/sbin/kds-kiosk-ipfix-watch.sh

cat > /etc/systemd/system/kds-kiosk-ipfix-watch.service <<'EOF'
[Unit]
Description=KDS: vigia a excecao de IP dos quiosques (SNAT do Tailscale x Docker)
After=tailscaled.service docker.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/kds-kiosk-ipfix-watch.sh
Restart=always
RestartSec=10
Nice=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now kds-kiosk-ipfix.service kds-kiosk-ipfix-watch.service

# Fix de raiz: esta VM não é subnet router nem exit node, então o SNAT do
# Tailscale não tem função — desligá-lo esvazia o ts-postrouting. O Tailscale é
# instalado fora deste script; se já estiver presente, aplica agora.
if command -v tailscale >/dev/null 2>&1; then
  tailscale set --snat-subnet-routes=false || true
fi

iptables -t nat -S POSTROUTING | head -3
iptables -t nat -S ts-postrouting

echo "==> [6/7] Preparando o projeto"
if [ ! -d /opt/kds ]; then
  mkdir -p /opt/kds
  echo "    Criado /opt/kds — cole o repositório aqui (git clone) e crie o .env"
else
  echo "    /opt/kds já existe."
fi

echo "==> [7/7] Resumo das ações manuais pendentes"
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