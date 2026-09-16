# Tailscale para KDS Bridge — Pis fora da rede local

> Objetivo: acessar os Orange Pi Zero 3 (`framboa`) por SSH de qualquer rede, mesmo com IP dinâmico, sem port-forward. O KDS em si já usa `https://kds-framboa.duckdns.org` (Oracle `163.176.208.86`), então os Pis não precisam de IP fixo para operar — só para manutenção.

## 1. O que foi preparado agora (sem ligar os Pis)

- `orange-pi-autostart.sh` com `SERVER_URL="https://kds-framboa.duckdns.org"` — já independe de rede local (`orange-pi-autostart.sh:19`).
- `scripts/pi-tailscale-setup.sh` — script idempotente para Armbian (instala Tailscale, define hostname `kds-fria-1`/`kds-quente-1`, habilita SSH).
- `scripts/ssh-kds.bat` e `scripts/logs-kds.bat` com fallback `100.x` (tailnet).
- Servidor Oracle `kds-server-amd` já com Tailscale instalado (ver `6.`) — acessível via `100.x` quando o Pi também estiver na tailnet.

## 2. Criar rede Tailscale (1x, 5 min, no navegador)

1. Acesse `https://login.tailscale.com` → crie conta (use mesmo e-mail do GitHub/Google).
2. Em `https://login.tailscale.com/admin/settings/keys` → `Generate auth key`:
   - **Reusable:** ON
   - **Ephemeral:** OFF (Pi deve permanecer)
   - **Tags:** `tag:kds-pi` (opcional, para ACL)
   - Expiração: `90 dias` → copie `<SUA_TAILSCALE_AUTH_KEY>` (só aparece 1x).
3. Em `https://login.tailscale.com/admin/dns` → habilite `MagicDNS` e `HTTPS`.

Guarde a chave em `C:\Users\Milena\.secrets\tailscale.authkey` (não versionar, já ignorado por `.gitignore`).

## 3. Seu notebook (Windows) — já dá para fazer agora

```powershell
# Instalar Tailscale
winget install Tailscale.Tailscale
# ou https://tailscale.com/download/windows
# Abra Tailscale → Log in → escolha mesma conta
tailscale ip -4 # seu 100.x.x.x
tailscale status
```

## 4. Servidor Oracle — já instalado por nós

Via `ssh -i C:\Users\Milena\.ssh\kds_oracle ubuntu@163.176.208.86`:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=<SUA_TAILSCALE_AUTH_KEY> --hostname=kds-server --advertise-tags=tag:kds-server
tailscale ip -4
sudo tailscale status
```

## 5. Pis — quando ligar (5 min por Pi, com monitor/teclado ou SSH local)

Conecte o Pi na rede atual (`192.168.0.x`), ache o IP (`arp-scan`/`nmap -sn 192.168.0.0/24` ou roteador), `ssh framboa@192.168.0.13`.

```bash
# 1. Copie e rode o script preparado (já está no repo)
scp -i C:\Users\Milena\.ssh\kds_oracle scripts/pi-tailscale-setup.sh framboa@192.168.0.13:/tmp/
ssh framboa@192.168.0.13 "sudo bash /tmp/pi-tailscale-setup.sh --authkey <SUA_TAILSCALE_AUTH_KEY> --hostname kds-fria-1"
# para o outro Pi troque para --hostname kds-quente-1

# 2. Verifique
tailscale ip -4   # 100.x.x.x
tailscale status  # deve mostrar kds-server e seu notebook
```

Depois disso o Pi é acessível de qualquer lugar:
```powershell
ssh framboa@kds-fria-1 # MagicDNS
ssh framboa@100.x.x.x  # IP tailnet
.\scripts\ssh-kds.bat kds-fria-1 # script já tenta tailnet primeiro
```

## 6. Checklist para quando você voltar

- [ ] Ligar Pi 1 e Pi 2, anotar IP local atual
- [ ] Rodar `pi-tailscale-setup.sh` nos dois (com a mesma auth key)
- [ ] No Admin Tailscale (`https://login.tailscale.com/admin/machines`) aprovar/renomear `kds-fria-1`, `kds-quente-1`, `kds-server`, `DESKTOP-MOIP4Q7`
- [ ] Testar `ssh framboa@kds-fria-1` do notebook em outra rede (4G)
- [ ] Opcional: em `https://login.tailscale.com/admin/acls` liberar `tag:kds-pi` → `*`

## 7. Notas

- IP `192.168.0.x` continuará mudando se não fizer reserva DHCP — irrelevante após Tailscale, pois o `100.x` é fixo no tailnet.
- O KDS não precisa de ajuste: `orange-pi-autostart.sh:19` já aponta para `https://kds-framboa.duckdns.org`, que independe da LAN do Pi.
- Para reverter: `sudo tailscale down` ou `sudo tailscale logout` no Pi.
- Logs: `sudo journalctl -u tailscaled -f`
