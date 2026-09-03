# Espelho de tela dos Pis (x11vnc)

Os Orange Pi `kds-quente-1` e `kds-fria-1` rodam o kiosk Chromium numa sessão
XFCE/Xorg. Para depurar o que aparece na tela física, usamos `x11vnc`
espelhando o display existente `:0`, acessível **somente via túnel SSH/Tailscale**.

## Instalação

O serviço é instalado por `scripts/pi-tailscale-setup.sh` (bloco `[6.5/6]`),
que:

1. Instala `x11vnc`.
2. Copia `scripts/kds-agent/kds-screen-vnc.service` para
   `/etc/systemd/system/`.
3. Habilita e inicia `kds-screen-vnc.service`.

O serviço:

- Roda `x11vnc -display :0 -auth guess -forever -shared -noxdamage`.
- Escuta apenas em `127.0.0.1:5900` (sem senha VNC; protegido pelo túnel SSH).
- Reinicia automaticamente com `Restart=always`.

## Acesso (do notebook)

Abra um túnel SSH para o Pi desejado:

```powershell
ssh -N -L 5900:127.0.0.1:5900 framboa@100.82.174.3   # kds-quente-1
ssh -N -L 5900:127.0.0.1:5900 framboa@100.114.73.108  # kds-fria-1
```

Depois conecte um cliente VNC (por exemplo RealVNC Viewer, TigerVNC,
TightVNC) em `127.0.0.1:5900`.

Também é possível usar `scripts/ssh-kds.bat` e abrir o túnel pelo mesmo
terminal, ou usar o IP tailnet `kds-quente-1` / `kds-fria-1` se o MagicDNS
estiver ativo.

## Verificação

No Pi:

```bash
systemctl is-active kds-screen-vnc   # active
ss -tlnp | grep 5900                 # 127.0.0.1:5900
```

## Segurança

- A porta VNC não é exposta na rede nem na internet; só `localhost`.
- O acesso real passa pela autenticação SSH/Tailscale.
- Não configuramos senha VNC; se quiser, adicione `-rfbauth` no ExecStart e
  gere `/etc/kds-vnc/passwd` com `x11vnc -storepasswd`.

## Limitação

Se o Pi perder Wi‑Fi ou energia, o espelho também fica inacessível. Para
distinguir problema de rede de problema de alimentação/placa, conecte o Pi
temporariamente via Ethernet e repita o acesso.