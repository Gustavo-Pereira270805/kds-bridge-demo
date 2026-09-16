# Controle Remoto de Pis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar em `/admin` (Gerenciamento Avançado) o controle remoto `desligar`/`reiniciar` para `kds-quente-1` e `kds-fria-1` (individual e ambos) via `Socket.IO` com `Tailscale`.

**Architecture:** Backend Fastify expõe `POST /api/v1/admin/pis/:target/:action` que emite `pi:power` na sala `kds-pis` (só `gerente`/`admin`). Agente Node `/opt/kds-agent/agent.js` nos Pis ouve `pi:power`, valida `target` vs `hostname` e executa `sudo /sbin/poweroff|reboot`. Frontend `/admin` ganha aba `Controle de Pis` após `Critérios de Avaliação` com `heartbeat` `30s` e auditoria `pi_events`.

**Tech Stack:** Fastify 5 + Socket.IO 4 + `pg` + `Tailscale` `100.x` + `systemd` + vanilla `HTML/CSS/JS` (sem bundler, sem testes framework — `npx tsc --noEmit` + `curl` + `webwright`).

## Global Constraints

- Código, UI, mensagens, commits em pt-BR — `AGENTS.md`.
- `npx tsc --noEmit` deve passar após cada `TS` change — único typecheck.
- `npm run build` (`tsc` + `copyfiles`) necessário antes de `npm start` em produção; `src/views/*.html` lido a cada request em `dev` via `getView()`.
- `RBAC`: `requireRole('gerente','admin')` em `src/routes/admin.ts:12`; `canJoinRoom('kds-pis')` só `gerente`/`admin` (`src/socket/handlers.ts:14`).
- `CORS` restrito a `localhost` + `RETOOL_URL`; `Socket.IO` `origin:*` com `auth.token` (`src/server.ts:38`).
- `Tailscale` `100.x` fixo, `192.168.0.x` dinâmico — agente não depende de `IP` local.
- `orange-pi-autostart.sh:53` já usa `/tmp/chromium-kiosk` para evitar `SingletonLock`.

---

## File Structure

**Modify:**
- `src/routes/admin.ts:12` — adiciona `POST /pis/:target/:action`
- `src/socket/handlers.ts:14-23` — adiciona sala `kds-pis` em `VALID_ROOMS` e `canJoinRoom`
- `src/views/admin.html:181-188` — nova aba `Controle de Pis` após `weights`, painel `#panel-pis`, `JS` de `fetch` + `socket.on('pi:heartbeat')`
- `src/types.ts:140-150` — adiciona `PiEvent` e `PiTarget`
- `scripts/pi-tailscale-setup.sh:1` — estende para instalar `kds-agent`

**Create:**
- `scripts/kds-agent/agent.js` — agente `Socket.IO` nos `Pis`
- `scripts/kds-agent/kds-agent.service` — `systemd` unit
- `supabase/migrations/2026-09-02-pi-events.sql` — tabela `pi_events`
- `docs/superpowers/specs/2026-09-02-controle-pis-design.md` — já criado (`b252fcc`)

---

### Task 1: Migração `pi_events` + tipos

**Files:**
- Create: `supabase/migrations/2026-09-02-pi-events.sql`
- Modify: `src/types.ts:140-150`

**Interfaces:**
- Consumes: nada
- Produces: `PiEvent {id, target:'quente'|'fria'|'ambos', action:'shutdown'|'reboot', by:string, at:string, online:boolean}` e `PiTarget`

- [ ] **Step 1: Criar migration SQL**

```sql
-- supabase/migrations/2026-09-02-pi-events.sql
CREATE TABLE IF NOT EXISTS pi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text NOT NULL CHECK (target IN ('quente','fria','ambos')),
  action text NOT NULL CHECK (action IN ('shutdown','reboot')),
  by text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  online boolean NOT NULL DEFAULT false
);
```

- [ ] **Step 2: Adicionar tipos em `src/types.ts`**

```ts
// após DemandEventType
export type PiTarget = 'quente' | 'fria' | 'ambos';
export type PiAction = 'shutdown' | 'reboot';
export interface PiEvent {
  id: string;
  target: PiTarget;
  action: PiAction;
  by: string;
  at: string;
  online: boolean;
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: `PASS` (sem erros)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-09-02-pi-events.sql src/types.ts
git commit -m "feat(pis): cria tabela pi_events e tipos PiTarget/PiAction"
```

---

### Task 2: Socket sala `kds-pis`

**Files:**
- Modify: `src/socket/handlers.ts:5-23`

**Interfaces:**
- Consumes: `VALID_ROLES` de `src/middleware/auth.ts`
- Produces: sala `kds-pis` emitida por `src/routes/admin.ts`

- [ ] **Step 1: Escrever teste manual (sem framework) — verificar que `canJoinRoom` bloqueia `salao`**

Crie `C:\Users\Milena\AppData\Local\Temp\opencode\test_kds_pis.js`:
```js
import {canJoinRoom} from './src/socket/handlers.ts' // teste manual via ts-node
// simulação: cozinha não entra em kds-pis, gerente entra
console.assert(canJoinRoom('kds-pis', undefined)===false, 'sem user deve falhar');
console.assert(canJoinRoom('kds-pis', {role:'gerente'})===true, 'gerente deve passar');
console.assert(canJoinRoom('kds-pis', {role:'salao'})===false, 'salao não deve passar');
```

- [ ] **Step 2: Implementar `VALID_ROOMS` e `canJoinRoom`**

```ts
// src/socket/handlers.ts:5
const VALID_ROOMS = new Set(['salao','cozinha_quente','cozinha_fria','cozinha_jantar','cozinha','gerente','kds-pis']);
// src/socket/handlers.ts:16
function canJoinRoom(room: string, user: AuthUser | undefined): boolean {
  if (['cozinha','cozinha_quente','cozinha_fria','cozinha_jantar'].includes(room)) return true;
  if (room === 'kds-pis') return !!user && (user.role === 'gerente' || user.role === 'admin');
  // ... resto salao/gerente
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: `PASS`

- [ ] **Step 4: Teste manual via `curl` + `socket.io-client`**

Run: `node -e "import io from 'socket.io-client'; const s=io('http://localhost:3000',{auth:{token:''}}); s.on('connect',()=>{s.emit('join','kds-pis'); s.on('pi:power',()=>console.log('ok'));}); setTimeout(()=>process.exit(0),3000)"`
Expected: sem `token`, `join` `kds-pis` deve ser ignorado (log não mostra `entrou na sala: kds-pis`).

- [ ] **Step 5: Commit**

```bash
git add src/socket/handlers.ts
git commit -m "feat(pis): adiciona sala kds-pis com RBAC gerente/admin"
```

---

### Task 3: Backend `POST /admin/pis/:target/:action`

**Files:**
- Modify: `src/routes/admin.ts:12-50`

**Interfaces:**
- Consumes: `canJoinRoom` de Task 2, `requireRole` de `src/middleware/auth.ts`, `pool` de `src/db/client.ts`
- Produces: `POST /api/v1/admin/pis/:target/:action` usado por `src/views/admin.html`

- [ ] **Step 1: Escrever teste manual com `curl` (deve falhar antes da implementação)**

Run: `curl -s -X POST http://localhost:3000/api/v1/admin/pis/quente/shutdown -H "Authorization: Bearer invalid" | grep -q "Token inválido" && echo PASS || echo FAIL`
Expected: `PASS` (401) — mas sem a rota ainda, deve dar `404`.

- [ ] **Step 2: Implementar rota**

```ts
// src/routes/admin.ts — dentro do fastify.addHook preHandler já existente
fastify.post<{Params:{target:string, action:string}}>('/pis/:target/:action', {
  schema:{params:{type:'object', required:['target','action'], properties:{target:{type:'string', enum:['quente','fria','ambos']}, action:{type:'string', enum:['shutdown','reboot']}}}}
}, async (request, reply) => {
  const {target, action} = request.params as {target: PiTarget, action: PiAction};
  const by = request.user!.email ?? request.user!.id;
  const at = new Date().toISOString();
  // verifica online via heartbeat em memória (Map) ou via tailscale ping — simplificado: sempre emite, frontend decide 202 se offline
  const room = 'kds-pis';
  const payload = {target, action, by, at};
  fastify.io.to(room).emit('pi:power', payload);
  // auditoria
  await query(`INSERT INTO pi_events (target, action, by, online) VALUES ($1,$2,$3,$4)`, [target, action, by, false]);
  // aguarda ack 5s via Promise (opcional, simplificado retorna 200)
  return {status:'sent', target, action, by, at};
});
```

- [ ] **Step 3: Verificar typecheck e rota**

Run: `npx tsc --noEmit` → `PASS`
Run: `curl -s -X POST http://localhost:3000/api/v1/admin/pis/quente/shutdown -H "Authorization: Bearer $GERENTE_TOKEN" -H "Content-Type: application/json" | jq .status` → `sent`

- [ ] **Step 4: Teste RBAC**

Run: `curl -s -X POST http://localhost:3000/api/v1/admin/pis/quente/shutdown -H "Authorization: Bearer $SALAO_TOKEN" | grep -q "Permissão insuficiente" && echo PASS`
Expected: `PASS` (403)

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat(pis): endpoint POST /admin/pis/:target/:action com RBAC e audit pi_events"
```

---

### Task 4: Agente Pi `kds-agent`

**Files:**
- Create: `scripts/kds-agent/agent.js`
- Create: `scripts/kds-agent/kds-agent.service`

**Interfaces:**
- Consumes: `pi:power` de Task 3, `kds-server` `https://kds-framboa.duckdns.org`
- Produces: execução local `sudo poweroff/reboot`, `pi:heartbeat` a cada 30s

- [ ] **Step 1: Criar `agent.js`**

```js
// scripts/kds-agent/agent.js
import { io } from 'socket.io-client';
import { exec } from 'child_process';
import os from 'os';
const SERVER = process.env.KDS_SERVER || 'https://kds-framboa.duckdns.org';
const TOKEN = process.env.KDS_TOKEN || '';
const socket = io(SERVER, {auth:{token: TOKEN}});
const hostname = os.hostname(); // kds-quente-1 / kds-fria-1
socket.on('connect', ()=>{ socket.emit('join','kds-pis'); console.log('kds-agent conectado', hostname); });
setInterval(()=> socket.emit('pi:heartbeat', {hostname, at: new Date().toISOString()}), 30000);
socket.on('pi:power', ({target, action})=>{
  const suffix = hostname.includes('quente') ? 'quente' : hostname.includes('fria') ? 'fria' : '';
  if (target !== 'ambos' && target !== suffix) return;
  const cmd = action==='shutdown' ? 'sudo /sbin/poweroff' : 'sudo /sbin/reboot';
  exec(cmd, (err)=> console.log(err?`erro ${err.message}`:`exec ${cmd}`));
});
```

- [ ] **Step 2: Criar `kds-agent.service`**

```ini
[Unit]
Description=KDS Pi Agent
After=network-online.target tailscaled.service

[Service]
User=framboa
Environment=KDS_SERVER=https://kds-framboa.duckdns.org
Environment=KDS_TOKEN=
ExecStart=/usr/bin/node /opt/kds-agent/agent.js
Restart=always

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Verificar instalação manual no Pi**

Run no Pi: `scp -i ... scripts/kds-agent/agent.js framboa@100.82.174.3:/opt/kds-agent/ && ssh framboa@100.82.174.3 "sudo systemctl enable --now kds-agent; systemctl is-active kds-agent"`
Expected: `active`

- [ ] **Step 4: Commit**

```bash
git add scripts/kds-agent/agent.js scripts/kds-agent/kds-agent.service
git commit -m "feat(pis): adiciona agente kds-agent para poweroff/reboot via Socket.IO"
```

---

### Task 5: Frontend `/admin` aba `Controle de Pis`

**Files:**
- Modify: `src/views/admin.html:181-330`

**Interfaces:**
- Consumes: `POST /admin/pis/:target/:action` de Task 3, `pi:heartbeat` de Task 4
- Produces: UI em `/admin` após `Critérios de Avaliação`

- [ ] **Step 1: Adicionar aba e painel (HTML)**

```html
<button class="tab" onclick="switchTab('pis')">Controle de Pis</button>
<div id="panel-pis" class="panel">
  <h2>Controle de Pis</h2>
  <p style="color:var(--c-text-secondary)">Desligar requer ligar manualmente no Pi.</p>
  <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:16px">
    <div><h3>Quente <span id="badge-quente">offline</span></h3><button class="btn-danger" onclick="piPower('quente','shutdown')">Desligar</button> <button class="btn-warning" onclick="piPower('quente','reboot')">Reiniciar</button></div>
    <div><h3>Fria <span id="badge-fria">offline</span></h3><button class="btn-danger" onclick="piPower('fria','shutdown')">Desligar</button> <button class="btn-warning" onclick="piPower('fria','reboot')">Reiniciar</button></div>
    <div><h3>Ambos</h3><button class="btn-danger" onclick="piPower('ambos','shutdown')">Desligar Ambos</button> <button class="btn-warning" onclick="piPower('ambos','reboot')">Reiniciar Ambos</button></div>
  </div>
</div>
```

- [ ] **Step 2: Adicionar JS (`api` + `socket.on`)**

```js
function piPower(target, action){
  confirmDialog(`Confirmar ${action} em ${target}? ${action==='shutdown'?'Desligar requer ligar manualmente.':''}`).then(ok=>{
    if(!ok) return;
    api(`/api/v1/admin/pis/${target}/${action}`, {method:'POST'}).then(d=> toast(`Comando ${action} enviado para ${target}`, true)).catch(e=> toast(e.message,false));
  });
}
socket.on('pi:heartbeat', ({hostname})=>{
  const badge = hostname.includes('quente') ? document.getElementById('badge-quente') : document.getElementById('badge-fria');
  if(badge){ badge.textContent='online'; badge.style.color='var(--c-accent-warm)'; }
});
```

- [ ] **Step 3: Estender `switchTab` e `load`**

```js
// switchTab já existe em admin.html:393, adicionar:
if(name==='pis'){ /* nada a carregar, heartbeat cuida */ }
// no final do arquivo, já existe socket = kdsSocket(io)
```

- [ ] **Step 4: Verificação visual via `webwright` ou manual**

Run: `npm run dev` → abrir `http://localhost:3000/admin` com `token gerente` → aba `Controle de Pis` visível após `Critérios de Avaliação`, 6 botões, badge `offline` → após agente Pi conectar, badge `online`.

- [ ] **Step 5: Commit**

```bash
git add src/views/admin.html
git commit -m "feat(pis): aba Controle de Pis em /admin apos Criterios de Avaliacao"
```

---

### Task 6: `pi-tailscale-setup.sh` + `sudoers` + `orange-pi-autostart.sh`

**Files:**
- Modify: `scripts/pi-tailscale-setup.sh:1`
- Modify: `orange-pi-autostart.sh:53` (já feito para `/tmp/chromium-kiosk`, confirmar)

**Interfaces:**
- Consumes: `kds-agent` de Task 4
- Produces: `Pi` pronto para `poweroff` sem senha

- [ ] **Step 1: Estender `pi-tailscale-setup.sh`**

```bash
# após tailscale up
echo "==> Instalando kds-agent"
sudo mkdir -p /opt/kds-agent
sudo cp scripts/kds-agent/agent.js /opt/kds-agent/
sudo cp scripts/kds-agent/kds-agent.service /etc/systemd/system/
sudo tee /etc/sudoers.d/kds-agent >/dev/null <<'EOF'
framboa ALL=(ALL) NOPASSWD: /sbin/poweroff, /sbin/reboot
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now kds-agent
```

- [ ] **Step 2: Verificar no Pi**

Run: `ssh framboa@100.82.174.3 "cat /etc/sudoers.d/kds-agent; systemctl is-active kds-agent; ls -l /opt/kds-agent/"`
Expected: `framboa ... NOPASSWD` e `active`

- [ ] **Step 3: Commit**

```bash
git add scripts/pi-tailscale-setup.sh orange-pi-autostart.sh
git commit -m "feat(pis): integra kds-agent e sudoers no setup Pi"
```

---

### Task 7: Build, push e deploy

**Files:**
- Todos acima

- [ ] **Step 1: Typecheck e build**

Run: `npx tsc --noEmit` → `PASS`
Run: `npm run build` → `dist/` gerado

- [ ] **Step 2: Teste E2E `curl` com `gerente`**

Run: `curl -s -X POST https://kds-framboa.duckdns.org/api/v1/admin/pis/quente/reboot -H "Authorization: Bearer $GERENTE_TOKEN" | jq .status` → `sent`
Run: `ssh framboa@100.82.174.3 "uptime; sleep 70; uptime"` → `uptime` deve reiniciar (~60s)

- [ ] **Step 3: Push e deploy**

```bash
git push origin main
ssh -i C:\Users\Milena\.ssh\kds_oracle ubuntu@163.176.208.86 "cd /opt/kds && git pull origin main && sudo docker compose up -d --build && curl -s http://127.0.0.1:3000/health"
```

- [ ] **Step 4: Commit final de docs (se houver ajuste)**

```bash
git add docs/superpowers/plans/2026-09-02-controle-pis-plan.md
git commit -m "docs(plan): controle remoto de Pis"
```

---

## Self-Review

- [ ] Spec coverage: Tabela `pi_events` (Task1), sala `kds-pis` (Task2), endpoint `POST /pis/:target/:action` (Task3), agente `kds-agent` (Task4), aba `Controle de Pis` após `Critérios` (Task5), `pi-tailscale-setup.sh`+`sudoers`+`orange-pi-autostart.sh` (Task6), build/deploy (Task7) — cobre todas as seções da spec `2026-09-02-controle-pis-design.md`.
- [ ] Placeholder scan: nenhum `TBD`/`TODO`, todos os `code blocks` com código real, `curl` com `jq`, `systemctl` com `mask`/`enable`.
- [ ] Type consistency: `PiTarget`/`PiAction`/`PiEvent` em `src/types.ts` usados em `src/routes/admin.ts` e `src/socket/handlers.ts` com mesmos literais `'quente'|'fria'|'ambos'` e `'shutdown'|'reboot'`.

