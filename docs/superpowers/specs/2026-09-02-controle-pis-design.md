# Controle Remoto de Pis — Design (spec)

> **Data:** 2026-09-02
> **Status:** Aprovado (brainstorming 5/5 seções)
> **Autor:** Muse Spark + Milena
> **Escopo:** Adicionar ao `Gerenciamento Avançado` (`/admin`) o desligamento/reinício remoto dos Orange Pi `kds-quente-1` (`192.168.0.13`/`100.82.174.3`) e `kds-fria-1` (`192.168.0.14`/`100.114.73.108`) via `Tailscale`.

## 1. Objetivo e escopo

O gerente (`gerente`/`admin` via `src/middleware/auth.ts:roleFromUser`) precisa desligar ou reiniciar cada cozinha individualmente ou ambas de uma vez, sem ir até o Pi. Religar continua manual (poweroff requer botão físico; `WoL` não disponível no `H618`, tomada inteligente é futuro).

* **Local:** nova aba `Controle de Pis` em `src/views/admin.html:181-188`, **após** `Critérios de Avaliação` (última aba). Só `gerente`/`admin` (mesmo `preHandler: requireRole` de `src/routes/admin.ts:12`).
* **Ações:** 3 alvos (`quente`/`fria`/`ambos`) × 2 comandos (`shutdown`=`sudo /sbin/poweroff`, `reboot`=`sudo /sbin/reboot`) = 6 botões.
* **Sem escopo:** ligar remoto, agendamento, controle de `Caddy`/`Docker` do servidor.

## 2. Arquitetura

```
[ /admin (browser) ] --POST /api/v1/admin/pis/:target/:action + Bearer--> [Fastify src/routes/admin.ts]
        |                                                              |
        | fastify.io.to('kds-pis').emit('pi:power', {target,action,by,at})
        v
[ Socket.IO src/socket/handlers.ts:14-23 canJoinRoom('kds-pis') só gerente/admin ]
        |
        +--> [kds-quente-1 /opt/kds-agent/agent.js] -- child_process exec sudo poweroff --> OS
        +--> [kds-fria-1   /opt/kds-agent/agent.js] -- child_process exec sudo reboot   --> OS
```

**Backend (`src/routes/admin.ts`):** novo `POST /admin/pis/:target/:action` com `schema {target: enum[quente,fria,ambos], action: enum[shutdown,reboot]}`. Valida `role`, resolve `target` → lista de hostnames (`kds-quente-1`, `kds-fria-1`), emite na sala `kds-pis`, grava auditoria em `pi_events` (ou `system_settings` se preferir evitar nova tabela) e retorna `200` se `ack` em `5s`, `202` se `Pi offline`.

**Agente Pi (`/opt/kds-agent/agent.js`):** Node 20, `socket.io-client`, `~15 linhas`. Conecta `io("https://kds-framboa.duckdns.org", {auth:{token}})`, `socket.emit('join','kds-pis')`, ouve `pi:power`. Filtra `if (target !== 'ambos' && target !== myHostnameSuffix) return`. Valida `action`, roda `exec('sudo /sbin/poweroff')`. `systemd` `kds-agent.service` (`Restart=always`, `User=framboa`). Requer `/etc/sudoers.d/kds-agent: framboa ALL=(ALL) NOPASSWD: /sbin/poweroff, /sbin/reboot`.

**Frontend (`src/views/admin.html`):** nova aba `Controle de Pis` com `grid 3 colunas` (Quente/Fria/Ambos), cada com `Desligar` (`btn-danger` vermelho) e `Reiniciar` (`btn-warning` amarelo), `badge` `online/offline` via `pi:heartbeat` (agent emite a cada `30s`, backend repassa), `modal` de confirmação com aviso `"Desligar requer ligar manualmente no Pi"`.

## 3. Fluxo e segurança

1. Gerente clica `Desligar Quente` → modal `"Desligar kds-quente-1? O Pi ficará offline até ligar manualmente."` → `Confirmar`.
2. `fetch POST /api/v1/admin/pis/quente/shutdown` com `Authorization: Bearer <gerente token>` (`src/views/scripts/security.js:80` injeta).
3. `preHandler requireRole('gerente','admin')` → `403` se `salao`/`cozinha`.
4. `fastify.io.to('kds-pis').emit('pi:power', {target:'quente', action:'shutdown', by: req.user.email, at: new Date().toISOString()})`. Se `ambos`, emite para ambos (ou dois emits).
5. `canJoinRoom('kds-pis', user)` em `src/socket/handlers.ts:14` só permite `gerente`/`admin`; `cozinha`/`salao` não entram.
6. Agente Pi recebe, valida `target === 'quente' || target === 'ambos'` e `hostname === 'kds-quente-1'`, roda `sudo poweroff`, responde `ack`.
7. Backend aguarda `ack` `5s` → `200 {status:'sent', target, action, online:true}` ou `202 {status:'queued', online:false}` se `Pi offline` (sem `ack`). Frontend mostra `toast` (`toast()` em `admin.html:347`) e desabilita botão `30s`.
8. Auditoria: `INSERT INTO pi_events (target, action, by, at, online) VALUES (...)` ou `demand_events` com `event_type='pi_power'`.

`Tailscale` `100.x` garante `IP` fixo; `Socket.IO` sobrevive a `DHCP` dinâmico (`192.168.0.x`). Sem `SSH` no servidor.

## 4. UI/UX em /admin

* **Aba:** `button.tab onclick="switchTab('pis')"` após `weights` (`admin.html:187`), `div#panel-pis.panel`.
* **Grid:** `display:grid; grid-template-columns: repeat(3,1fr); gap:16px` para `Quente`/`Fria`/`Ambos`.
* **Card por alvo:** `h3` com `badge` `online` (verde) / `offline` (cinza) atualizado via `socket.on('pi:heartbeat')` e `socket.on('pi:status')`.
* **Botões:** `Desligar` (`btn-danger`), `Reiniciar` (`btn-warning`), `min-height 44px`, `confirmDialog()` (`admin.html:365`) com mensagem específica.
* **Modal:** `confirmDialog("Desligar kds-quente-1? ...")` → `true` prossegue.
* **Feedback:** `toast("Comando enviado para kds-quente-1", true)` ou `toast("Pi offline, comando será executado quando voltar", false)`.

## 5. Erros e casos limite

* **Pi offline:** `emit` sem `ack` em `5s` → `202` + `toast warn`; comando não enfileirado (poweroff não faz sentido enfileirar). O `heartbeat` mostra `offline`.
* **Timeout/retry:** frontend desabilita botão `30s`, não reenvia automático.
* **Sudo sem permissão:** agente loga `console.error` e emite `pi:error`; `Pi` precisa `NOPASSWD` (instalado via `scripts/pi-tailscale-setup.sh`).
* **Hostname divergente:** agente compara `os.hostname()` (`kds-quente-1`) com `target`; se `ambos`, ambos executam.
* **Segurança:** `authkey` `tskey-...` não vai para `Pi`; agente usa `token` de `cozinha` ou `gerente`? Recomendado criar `role=pi` ou reusar `cozinha` com permissão para `kds-pis`. `canJoinRoom` deve permitir `pi` role também.

## 6. Dados e migrações

* **Opcional nova tabela:** `pi_events (id uuid PK, target text, action text, by text, at timestamptz, online bool)` ou reusar `demand_events` com `event_type='pi_power'`. Preferir nova tabela para não poluir `demand_events`.
* **Sem alteração em `demands`/`kitchen_stations`.**
* **Seed:** nenhum; `system_settings` não necessário.

## 7. Testes

* **Manual local:** `POST /admin/pis/quente/shutdown` com `token gerente` → `200` e `Pi` desliga (ou `reboot` e volta em `60s` com `tailscale status active`).
* **Manual offline:** desligue `Pi` na tomada, `POST` deve retornar `202` e `badge offline`.
* **Automatizado:** `npx tsc --noEmit` OK, `curl /api/v1/admin/pis/quente/shutdown` sem token → `401`, com `salao` → `403`.

## 8. Implantação

1. Atualizar `orange-pi-autostart.sh:53` já usa `/tmp/chromium-kiosk` (evita `SingletonLock`).
2. Instalar agente nos `Pis` via `scripts/pi-tailscale-setup.sh` adicionando bloco `kds-agent` (copia `agent.js`, cria `kds-agent.service`, `systemctl enable`).
3. `git push origin main` + `ssh ubuntu@163.176.208.86 "cd /opt/kds && git pull && sudo docker compose up -d --build"` (já validado em `2026-09-02` com `kds-server` `healthy`).
4. Documentado aqui; `AGENTS.md` não precisa mudar (RBAC já exige `gerente`/`admin`).

## 9. Fora de escopo

* Ligar remoto (`WoL` não suportado no `Zero 3`, sugerir tomada inteligente `Tuya` futura).
* Controle de `Docker`/`Caddy` do servidor.
* Agendamento automático de desligamento.
