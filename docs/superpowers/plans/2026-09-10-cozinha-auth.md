# Auth nas cozinhas com bypass por IP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exigir login de gerente/admin nas telas, na operação e no tempo real das cozinhas, liberando os Pis pelo IP do Tailscale sem conta alguma.

**Architecture:** Nova unidade `src/middleware/kiosk.ts` (zero dependências: resolução de IP + allowlist) consumida por `auth.ts` (regra `podeCozinha`), `server.ts` (redirect nas views), `demands.ts` (401/403 na API) e `socket/handlers.ts` (join nas salas). Nada muda no salão, no RBAC e no CORS.

**Tech Stack:** TypeScript strict (Fastify), verificação via `npx tsc --noEmit` + `curl.exe` + Playwright/Chromium (Python313) + scripts `.mjs` avulsos.

## Global Constraints

- Todo texto (código, commits, docs, mensagens de erro) em pt-BR.
- `npx tsc --noEmit` limpo após qualquer mudança em TS.
- Nunca `node -e` nem python inline com aspas no PowerShell — escrever arquivo e executar.
- Nunca `.catch(function() {})` vazio — sempre logar.
- Nunca commitar IPs/senhas reais além dos dois IPs dos Pis já documentados; `KDS_KIOSK_IPS` de teste (`127.0.0.1`) é temporário e nunca commitado.
- Demandas de teste: anular via `POST /api/v1/admin/demands/:id/annul` (`{"reason":...}`), nunca `DELETE`.
- Branch: `feature/cozinha-auth` a partir de `main`. Commits pequenos, um por tarefa.

---

## File Structure

- **Create:** `src/middleware/kiosk.ts` — `normalizeIp`, `clientIpFromHeaders`, `isKioskIp`, `socketIp`. Sem imports (só tipos estruturais). Responsabilidade única: dizer quem é o cliente e se é quiosque.
- **Modify:** `src/middleware/auth.ts` — adiciona `isKitchenAllowed(request): Promise<boolean>` e `requireKitchen` (preHandler). Reusa `extractToken`/`getUserByToken` existentes.
- **Modify:** `src/routes/demands.ts:291-293` (`/:id/ready`) e `:514-527` (`/:id/cancel-cozinha`) — adiciona `preHandler: requireKitchen` + import.
- **Modify:** `src/server.ts:90-100` — preHandler de redirect nas 3 views de cozinha.
- **Modify:** `src/socket/handlers.ts:18-24,51-65` — `canJoinRoom` passa a receber `isKiosk`; salas de cozinha exigem quiosque ou gerente/admin.
- **Modify:** `.env.example` — documenta `KDS_KIOSK_IPS`. **Server-side (fora do git):** `/opt/kds/.env` na Oracle recebe os dois IPs reais.

---

### Task 1: `src/middleware/kiosk.ts` (resolução de IP + allowlist)

**Files:**
- Create: `src/middleware/kiosk.ts`
- Test: `C:\Users\Milena\AppData\Local\Temp\opencode\test-kiosk.mjs` (avulso, não commitar)

**Interfaces:**
- Consumes: nada (zero dependências).
- Produces (usado pelas Tasks 2–4, nomes exatos):
  - `normalizeIp(ip: string): string`
  - `clientIpFromHeaders(xff: unknown, fallback: string): string`
  - `isKioskIp(ip: string): boolean`
  - `socketIp(sock: { handshake: { headers: Record<string, string | string[] | undefined>; address: string } }): string`

- [ ] **Step 1: Criar `src/middleware/kiosk.ts` com o conteúdo exato abaixo**

```ts
// Quiosques (Pis) identificados pelo IP — sem conta, sem token.
// Atrás do Caddy, o IP real é a ÚLTIMA entrada do X-Forwarded-For
// (o Caddy anexa o que ele viu; anteriores vêm do cliente).
// Premissa: porta 3000 não publicada — tudo chega via Caddy.

function ipsPermitidos(): string[] {
  return (process.env.KDS_KIOSK_IPS ?? '')
    .split(',')
    .map((s) => normalizeIp(s))
    .filter((s) => s.length > 0);
}

export function normalizeIp(ip: string): string {
  return String(ip ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase();
}

export function clientIpFromHeaders(xff: unknown, fallback: string): string {
  const raw = Array.isArray(xff) ? xff.join(',') : String(xff ?? '');
  const partes = raw.split(',').map((s) => normalizeIp(s)).filter((s) => s.length > 0);
  if (partes.length > 0) return partes[partes.length - 1];
  return normalizeIp(fallback);
}

export function isKioskIp(ip: string): boolean {
  const normalizado = normalizeIp(ip);
  if (!normalizado) return false;
  return ipsPermitidos().includes(normalizado);
}

export function socketIp(sock: {
  handshake: { headers: Record<string, string | string[] | undefined>; address: string };
}): string {
  return clientIpFromHeaders(sock.handshake.headers['x-forwarded-for'], sock.handshake.address);
}
```

- [ ] **Step 2: Compilar para poder testar o JS real**

Run: `npm run build`
Expected: exit 0, gera `dist/middleware/kiosk.js`

- [ ] **Step 3: Escrever o harness de teste (arquivo avulso, não commitar)**

```js
// C:\Users\Milena\AppData\Local\Temp\opencode\test-kiosk.mjs
import { normalizeIp, clientIpFromHeaders, isKioskIp } from 'C:/Users/Milena/OneDrive/Documentos/programas/KDS_demo/dist/middleware/kiosk.js';
import assert from 'node:assert';
process.env.KDS_KIOSK_IPS = '100.114.73.108, 100.82.174.3';
assert.equal(normalizeIp('  [100.82.174.3] '), '100.82.174.3');
assert.equal(normalizeIp('::1'), '::1');
// spoof: cliente injeta IP liberado, Caddy anexa o real por último — vale o último
assert.equal(clientIpFromHeaders('100.82.174.3, 203.0.113.9', 'x'), '203.0.113.9');
assert.equal(clientIpFromHeaders('100.82.174.3', 'x'), '100.82.174.3');
assert.equal(clientIpFromHeaders(undefined, '10.0.0.51'), '10.0.0.51');
assert.equal(isKioskIp('100.114.73.108'), true);
assert.equal(isKioskIp('100.82.174.3'), true);
assert.equal(isKioskIp('203.0.113.9'), false);
assert.equal(isKioskIp(''), false);
delete process.env.KDS_KIOSK_IPS;
assert.equal(isKioskIp('100.82.174.3'), false); // fail closed
console.log('KIOSK-TESTS-PASS');
```

- [ ] **Step 4: Rodar o teste**

Run: `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe -c "print('n/a')"` — NÃO; rodar direto: `node C:\Users\Milena\AppData\Local\Temp\opencode\test-kiosk.mjs`
Expected: `KIOSK-TESTS-PASS`, exit 0

- [ ] **Step 5: Commit**

```bash
git add src/middleware/kiosk.ts
git commit -m "feat: helpers de IP de quiosque (kiosk.ts sem dependencias)"
```

---

### Task 2: `requireKitchen` na API (`ready`, `cancel-cozinha`)

**Files:**
- Modify: `src/middleware/auth.ts` (append, após `requireRole`)
- Modify: `src/routes/demands.ts` (import + 2 preHandlers)
- Test: `curl.exe` contra dev local (servidor precisa de restart após mudança TS)

**Interfaces:**
- Consumes: `isKioskIp`, `clientIpFromHeaders` (Task 1); `extractToken`, `getUserByToken` (existentes).
- Produces: `isKitchenAllowed(request): Promise<boolean>`; `requireKitchen(request, reply): Promise<void>`.

- [ ] **Step 1: Acrescentar ao final de `src/middleware/auth.ts`**

```ts
import { isKioskIp, clientIpFromHeaders } from './kiosk';

function requestIp(request: FastifyRequest): string {
  return clientIpFromHeaders(
    request.headers['x-forwarded-for'],
    request.ip ?? request.socket?.remoteAddress ?? ''
  );
}

export async function isKitchenAllowed(request: FastifyRequest): Promise<boolean> {
  if (isKioskIp(requestIp(request))) return true;
  const token = extractToken(request);
  if (!token) return false;
  const user = await getUserByToken(token);
  return !!user && (user.role === 'gerente' || user.role === 'admin');
}

export async function requireKitchen(request: FastifyRequest, reply: FastifyReply) {
  if (isKioskIp(requestIp(request))) return;
  const token = extractToken(request);
  if (!token) {
    reply.code(401).send({ error: 'Autenticação necessária para a cozinha' });
    return;
  }
  const user = await getUserByToken(token);
  if (!user) {
    reply.code(401).send({ error: 'Token inválido ou expirado' });
    return;
  }
  if (user.role !== 'gerente' && user.role !== 'admin') {
    reply.code(403).send({ error: 'Acesso à cozinha restrito à gerência' });
    return;
  }
  request.user = user;
}
```

- [ ] **Step 2: Em `src/routes/demands.ts`, adicionar o import e os 2 preHandlers**

Import (junto aos demais imports do topo):
```ts
import { requireKitchen } from '../middleware/auth';
```

Rota ready (`/:id/ready`, hoje sem preHandler):
```ts
  fastify.patch<{ Params: { id: string } }>(
    '/:id/ready',
    { preHandler: requireKitchen },
    async (request, reply) => {
```

Rota cancel-cozinha (mantém o schema existente, adiciona preHandler):
```ts
  fastify.patch<{ Params: { id: string }; Body: { reason?: string; cancel_reason_id?: string } }>(
    '/:id/cancel-cozinha',
    {
      preHandler: requireKitchen,
      schema: {
```

- [ ] **Step 3: Typecheck + restart do dev**

Run: `npx tsc --noEmit` — Expected: exit 0
Run: matar PID da 3000 (`taskkill /PID <pid> /F`), `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`, aguardar 20s, `curl.exe -s http://127.0.0.1:3000/health` → `{"status":"ok",...}`

- [ ] **Step 4: Matriz curl SEM bypass (sem `KDS_KIOSK_IPS` no `.env`)**

```powershell
# 401 sem token (usar demanda pending existente $ID)
curl.exe -s -m 10 -X PATCH http://127.0.0.1:3000/api/v1/demands/$ID/ready
# Expected: {"error":"Autenticação necessária para a cozinha"} (HTTP 401 — conferir com -w "%{http_code}")
# 200 com gerente (token em $TOK via /api/v1/auth/login da conta de teste)
curl.exe -s -m 10 -X PATCH http://127.0.0.1:3000/api/v1/demands/$ID/ready -H "Authorization: Bearer $TOK"
# Expected: 200 e status ready (usar demanda descartável; depois anular se restar resíduo)
# Salão intacto: POST /api/v1/demands sem token continua 200/201
```

- [ ] **Step 5: Modo quiosque simulado (temporário, NÃO commitar)**

Run: acrescentar `KDS_KIOSK_IPS=127.0.0.1` ao `.env` local, restartar o dev, `curl.exe -s -m 10 -X PATCH .../ready` sem token → Expected: 200. Depois REMOVER a linha do `.env` e restartar.
Expected final: `git diff --stat` não mostra `.env` (ignorado) e o bypass sai do ambiente

- [ ] **Step 6: Commit**

```bash
git add src/middleware/auth.ts src/routes/demands.ts
git commit -m "feat: requireKitchen na API (ready e cancel-cozinha)"
```

---

### Task 3: Redirect nas 3 views de cozinha (`server.ts`)

**Files:**
- Modify: `src/server.ts` (import + preHandler nas 3 rotas)
- Test: `curl.exe` (302/200) + Chromium (redirect visual)

**Interfaces:**
- Consumes: `isKitchenAllowed` (Task 2).
- Produces: nada novo (reuso).

- [ ] **Step 1: Importar e proteger as rotas**

Import (junto aos demais de middleware):
```ts
import { isKitchenAllowed } from './middleware/auth';
```

Helper local (antes das rotas de view):
```ts
async function cozinhaGuard(request: FastifyRequest, reply: FastifyReply) {
  if (await isKitchenAllowed(request)) return;
  const next = encodeURIComponent(request.url);
  reply.redirect(`/login?next=${next}`);
}
```

Aplicar nas 3 rotas (exemplo da quente; repetir para `/cozinha` e `/cozinha-fria`):
```ts
fastify.get('/cozinha-quente', { preHandler: cozinhaGuard }, async (_request, reply) => {
  return reply.type('text/html').send(getView('cozinha-quente.html'));
});
```

`FastifyRequest`/`FastifyReply` já estão importados? Verificar o topo de `server.ts`; hoje ele importa `Fastify` default. Se os tipos não estiverem importados, adicionar:
```ts
import { FastifyRequest, FastifyReply } from 'fastify';
```

- [ ] **Step 2: Typecheck + restart do dev (mesmo ritual da Task 2)**

- [ ] **Step 3: Matriz curl**

```powershell
# Sem bypass e sem token → 302 para /login?next=%2Fcozinha-quente
curl.exe -s -m 10 -o NUL -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:3000/cozinha-quente
# Expected: 302 /login?next=%2Fcozinha-quente (igual para /cozinha e /cozinha-fria; /salao continua 200)
# Com token gerente → 200 (curl com -H "Authorization: Bearer $TOK")
```

- [ ] **Step 4: Modo quiosque simulado (`KDS_KIOSK_IPS=127.0.0.1` temporário + restart)**

```powershell
curl.exe -s -m 10 -o NUL -w "%{http_code}\n" http://127.0.0.1:3000/cozinha-quente
# Expected: 200 sem token
```

Remover a linha do `.env` e restartar ao final.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: views da cozinha exigem login, com redirect e bypass do Pi"
```

---

### Task 4: Salas de socket da cozinha exigem quiosque ou gerência

**Files:**
- Modify: `src/socket/handlers.ts`
- Test: Playwright/Chromium (duas páginas: anônima e gerente) + log do servidor

**Interfaces:**
- Consumes: `socketIp` (Task 1); `AuthUser` (existente).
- Produces: `canJoinRoom(room: string, user: AuthUser | undefined, isKiosk: boolean): boolean` (assinatura alterada — atualizar os 3 usos internos: `join`, `identify`, `pi:heartbeat`).

- [ ] **Step 1: Alterar `canJoinRoom` e os pontos de chamada**

```ts
const KITCHEN_ROOMS = ['cozinha', 'cozinha_quente', 'cozinha_fria', 'cozinha_jantar'];

export function canJoinRoom(room: string, user: AuthUser | undefined, isKiosk: boolean): boolean {
  if (KITCHEN_ROOMS.includes(room)) {
    if (isKiosk) return true;
    if (!user) return false;
    return user.role === 'gerente' || user.role === 'admin';
  }
  const publicRooms = ['salao', 'kds-pis'];
  if (publicRooms.includes(room)) return true;
  if (!user) return false;
  if (room === 'gerente') return user.role === 'gerente' || user.role === 'admin';
  return false;
}
```

Nos handlers `join`, `identify` e no guard do `pi:heartbeat`, calcular uma vez por socket:
```ts
import { socketIp, isKioskIp } from '../middleware/kiosk';
// dentro de io.on('connection'): const kiosk = isKioskIp(socketIp(socket));
// chamadas: canJoinRoom(room, socket.data.user as AuthUser | undefined, kiosk)
```

Manter a linha de log `join negado` (ela já registra sala + papel + id).

- [ ] **Step 2: Typecheck + restart do dev**

- [ ] **Step 3: Teste de tempo real (2 páginas Chromium)**

Página A (gerente, com token via login na UI): abre `/cozinha-quente`, cria demanda via API com outro token e confirma que o card aparece sem reload (socket funcionando para gerente).
Página B (anônima, IP não liberado): conecta `io()` sem token via `page.evaluate` com o `socket.io.js` servido, emite `join cozinha_quente`, cria demanda via API e confirma que NENHUM evento chega em 5s + log do servidor contém `join negado sala=cozinha_quente`.
Página C (quiosque simulado, `KDS_KIOSK_IPS=127.0.0.1` temporário + restart): mesma página B agora RECEBE o evento.
Remover a linha do `.env` e restartar ao final.

- [ ] **Step 4: Commit**

```bash
git add src/socket/handlers.ts
git commit -m "feat: salas de socket da cozinha exigem quiosque ou gerencia"
```

---

### Task 5: Configuração documentada + `.env` de produção

**Files:**
- Modify: `.env.example`
- Server-side (SSH, fora do git): `/opt/kds/.env`
- Test: inspeção (sem segredos no output)

**Interfaces:** Consumes: nada de código. Produces: variável operacional.

- [ ] **Step 1: Documentar no `.env.example`**

```env
# Quiosques das cozinhas (bypass de login por IP do Tailscale, vírgulas, sem espaços extras)
# Produção: KDS_KIOSK_IPS=100.114.73.108,100.82.174.3
# Ausente ou vazio = nenhum bypass (fail closed)
KDS_KIOSK_IPS=
```

- [ ] **Step 2: Aplicar na Oracle (via paramiko, NUNCA imprimir valores)**

Comandos remotos: backup `cp /opt/kds/.env /opt/kds/.env.bak-<data>`; acrescentar `KDS_KIOSK_IPS=100.114.73.108,100.82.174.3` se ausente; conferir só com `grep -c "^KDS_KIOSK_IPS=" /opt/kds/.env` (esperado: `1`). Sem restart dedicado — vale no próximo deploy (env lido por chamada, mas o deploy reinicia de qualquer forma).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: documenta KDS_KIOSK_IPS no .env.example"
```

---

### Task 6: E2E, deploy e validação (fora de pico)

**Files:** nenhum código novo. Evidências em `outputs/webwright-cozinha-auth/final_runs/run_1/` (log + screenshots, padrão webwright: viewport 1280x1800, sem `full_page`).

**Interfaces:** Consumes: Tasks 1–5.

- [ ] **Step 1: Webwright local (dev com branch, banco local)**
  - CP1: sem token e sem bypass, `/cozinha-quente` redireciona para `/login?next=...` (screenshot).
  - CP2: login gerente abre a cozinha; fluxo criar→pronto→retirar 6/6 como gerente.
  - CP3: com `KDS_KIOSK_IPS=127.0.0.1` (temporário), página anônima opera a cozinha (pronto via clique) e recebe socket sem reload.
  - CP4: `PATCH ready` sem token e sem bypass → 401; com bypass → 200.
  - CP5: `/salao` continua 200 anônimo e criando demanda.
  - Limpeza: anular demandas WW; remover `KDS_KIOSK_IPS` do `.env` local.

- [ ] **Step 2: Push + merge + deploy (fluxo existente)**
  - `git push origin feature/cozinha-auth`, merge fast-forward em `main`, push.
  - Oracle: `git pull --ff-only` + `docker compose up -d --build`; aguardar `healthy`; conferir `/health` 200, `/ready` 200, HSTS.

- [ ] **Step 3: Webwright nuvem (`https://kds-framboa.duckdns.org`, `ignore_https_errors`)**
  - CP1–CP2 repetidos contra a produção; CP6: telas físicas dos Pis inalteradas (SSH nos Pis: processo Chromium com a mesma URL + `curl /health` 200 do Pi). Resíduo zero.

---

## Self-Review

**1. Cobertura da spec:** §2 (regra) → Tasks 1–2; §3 (IP anti-spoof) → Task 1 (+ teste de spoof no harness); §4 (tabela 3 camadas) → Tasks 2–4; §5 (limitação `GET /demands`) → explicitamente preservada (nenhuma tarefa o toca); §6 (config) → Task 5; §7 (erros/observabilidade) → mensagens nos Steps 1–2 + log existente; §8 (testes) → Tasks 1–4 (unitário do resolver, matriz curl, socket) + Task 6 (E2E/deploy); §9 (fora de escopo) → nenhuma tarefa o viola.

**2. Placeholders:** nenhum `TODO/TBD`; todos os comandos, códigos e asserts estão literais acima.

**3. Consistência de tipos:** `normalizeIp/clientIpFromHeaders/isKioskIp/socketIp` têm a mesma assinatura na Task 1 (definição), no harness (uso) e nas Tasks 2–4 (consumo); `canJoinRoom(room, user, isKiosk)` alterada com os 3 usos internos atualizados na Task 4; `requireKitchen`/`isKitchenAllowed` definidos na Task 2 e consumidos nas Tasks 2–3 com os mesmos nomes.
