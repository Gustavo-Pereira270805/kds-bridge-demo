# Fix — telas da cozinha pedindo senha (SNAT do Tailscale × Docker)

**Data:** 2026-10-30
**Sintoma:** as três telas da cozinha (`/cozinha`, `/cozinha-quente`, `/cozinha-fria`) abriram na página `/login`, mesmo com o bypass por IP (`KDS_KIOSK_IPS`) configurado. Nenhuma mudança de código tinha sido feita.

## Causa raiz

O `tailscaled` da VM foi atualizado **de 1.102.3 para 1.104.4 às 00:57 UTC de 30/10** (registro em `/var/log/dpkg.log`). Depois disso, o tráfego que chega pela tailnet e é **encaminhado** para outra interface passou a ser mascarado:

```
-A ts-forward -i tailscale0 -j MARK --set-xmark 0x40000/0xff0000
-A POSTROUTING -j ts-postrouting
-A ts-postrouting -m mark --mark 0x40000/0xff0000 -j MASQUERADE
```

O Pi abre `http://100.81.149.114/cozinha-*` → o pacote entra por `tailscale0`, é encaminhado para a bridge do Docker (onde está o Caddy) e sai com **SNAT para `172.18.0.1`**. O Caddy monta o `X-Forwarded-For` com o que vê e o app (`clientIpFromHeaders`, último item do XFF) compara `172.18.0.1` com a lista `100.114.73.108,100.82.174.3` — nunca casa, e o `cozinhaGuard` responde `302 /login`.

É o **mesmo sintoma** das outras duas causas já documentadas no `AGENTS.md`: URL pública no `kds-kiosk.sh` e `userland-proxy` do Docker. Aqui, a origem foi o próprio Tailscale (`--snat-subnet-routes`, padrão `true`).

### Evidências

| Verificação | Antes | Depois |
|---|---|---|
| Contador de `ts-postrouting` durante um `curl` do Pi | +3 pacotes (mascarando) | estável |
| `curl` do Pi em `http://100.81.149.114/cozinha` | `302` | `200` |
| `curl` do notebook (tailnet, fora da lista) | `302` | `302` (fail closed) |
| Log do app para `/cozinha-fria` | `302` + `GET /login?next=` | `200` + `/api/v1/demands` `200` |

## Correção aplicada (produção)

Exceção estreita no `POSTROUTING`, **antes** do `ts-postrouting`: tráfego com origem na tailnet (`100.64.0.0/10`) e destino em rede privada de container (`172.16.0.0/12`) não é mascarado.

```bash
iptables -t nat -I POSTROUTING 1 -s 100.64.0.0/10 -d 172.16.0.0/12 -j RETURN
sudo iptables -t nat -S POSTROUTING | head -3   # a regra precisa ser a 1ª
```

Persistência (a regra sozinha não sobrevive a reboot nem a um restart do `tailscaled`):

- `/usr/local/sbin/kds-kiosk-ipfix.sh` — aplica/reposiciona a regra (idempotente). Cópia versionada em `scripts/kds-kiosk-ipfix.sh`.
- `/etc/systemd/system/kds-kiosk-ipfix.service` — `After=tailscaled.service docker.service` e `PartOf=tailscaled.service` (reexecuta quando o Tailscale reinicia, que foi exatamente o gatilho do incidente). Cópia versionada em `scripts/kds-kiosk-ipfix.service`.
- `scripts/setup-instance.sh` — passo `[5/7]` instala os dois em VM nova e o `daemon.json` agora nasce com `"userland-proxy": false` (antes, reexecutar o setup reintroduzia o mascaramento do Docker).

Verificação rápida em produção:

```bash
sudo iptables -t nat -S POSTROUTING | head -3   # RETURN na 1ª posição
sudo iptables -t nat -S ts-postrouting          # só "-N ts-postrouting" (vazio)
systemctl is-active kds-kiosk-ipfix-watch.service
# no Pi:
curl -s -o /dev/null -w '%{http_code}\n' http://100.81.149.114/cozinha-fria   # 200
```

## Reincidência em 08/11/2026 — e a correção definitiva

O bug voltou 9 dias depois, com o Tailscale indo de **1.104.4 para 1.104.5** (08/11, 21:57 UTC):

- o `tailscaled` **insere** o jump `-A POSTROUTING -j ts-postrouting` no **início** da chain (não anexa no fim), então a nossa regra foi empurrada da posição 1 para a 2 — e o `MASQUERADE` voltou a mascarar o IP do Pi;
- o `kds-kiosk-ipfix.service` **rodou** no restart (`PartOf=tailscaled.service`, registrado às 21:57:38), mas o tailscaled aplica as regras de rede de forma assíncrona, **depois** de o serviço reportar `started` — ou seja, havia uma corrida que o serviço perdia.

Correções aplicadas em 09/11:

1. **Raiz — `tailscale set --snat-subnet-routes=false`.** A VM não é subnet router nem exit node (`AdvertiseRoutes: null`, `RouteAll: false`, `ExitNodeID: ""`), então esse SNAT não tem função. Resultado: `iptables -t nat -S ts-postrouting` fica **vazio** e o Tailscale pode reinserir o jump à vontade — não há mais o que mascarar.
2. **Rede de segurança — `kds-kiosk-ipfix-watch.service`** (`scripts/kds-kiosk-ipfix-watch.sh`): loop de 30s que roda o `kds-kiosk-ipfix.sh`. Cobre o caso de a pref voltar ao padrão ou de alguma outra regra empurrar a exceção para baixo. Testado: regra removida → volta em ~15s; regra empurrada para a posição 2 → reordenada em ~30s.
3. **Timer do systemd não serve aqui:** nesta VM (systemd 259) o `OnCalendar=*:0/2` carrega com `next_elapse` no passado e `NextElapseUSecRealtime` vazio (`Trigger: n/a`), e nunca dispara. Por isso o vigia é um loop, não um `.timer`.

## Alternativas (para janela de manutenção)

1. ~~`tailscale set --snat-subnet-routes=false`~~ — **aplicado em 09/11** (ver seção acima). Zero efeito colateral nesta VM.
2. **Caddy com `network_mode: host`** — elimina a classe inteira do problema (sem DNAT para bridge, o pacote é LOCAL e não passa por `ts-forward`). Exige `ports` do Caddy fora, `reverse_proxy 127.0.0.1:3000` e publicar o app em `127.0.0.1:3000`.
3. `tailscale up --netfilter-mode=nodivert` — o Tailscale para de religar os próprios jumps; exige gerenciar `ts-*` à mão (não recomendado).

## Lições

- Atualização automática do Tailscale é mudança de infraestrutura de rede: o bypass por IP depende do **IP de origem chegar intacto** até o app, e cada camada (Docker, Tailscale, proxy) pode mascarar.
- `ts-postrouting` pode voltar a cada upgrade/restart do `tailscaled`; o `PartOf=tailscaled.service` **não basta** (corrida contra a aplicação assíncrona das regras) — daí a pref `snat-subnet-routes=false` + o vigia de 30s.
- Antes de suspeitar do código, medir: `curl` do próprio Pi para o vhost tailnet (`200` × `302`) + `iptables -t nat -L POSTROUTING -n -v` durante o request identificam a camada que está mascarando.
