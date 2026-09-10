# Endurecimento KDS Bridge (pós-auditoria run-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os achados do run-2 que valem no ambiente local, sem login no salão/cozinha e sem tocar na nuvem.

**Architecture:** Endurecimento em camadas no próprio código: validação de entrada (schema), CAS nos UPDATEs, idempotência, escopo correto de reversão e transporte fechado. Nenhuma migração de banco nova — tudo usa colunas que já existem.

**Tech Stack:** TypeScript strict (Fastify 5 + `pg` com placeholders `$1`), Socket.IO 4, Caddy 2, Streamlit. Sem framework de testes — verificação via `npx tsc --noEmit` + servidor local com banco local + `curl.exe`/harness `.ts`.

## Global Constraints

- Todo texto novo (código, erro, commit) em português brasileiro (pt-BR).
- Toda query SQL com placeholders `$1` — nunca interpolar valor; só fragmento de coluna fixa via allowlist.
- Após qualquer mudança `.ts`, rodar `npx tsc --noEmit`; `npm run build` antes de `npm start`.
- Nunca `.catch(function() {})` vazio — sempre logar e mostrar estado de erro na UI.
- Transições de demanda usam CAS (`WHERE status = ...`) e evento socket de `stockout` só após o recompute.
- PowerShell: nunca `node -e` inline — escrever `.ts` temporário e rodar com `npx ts-node --transpile-only`.
- Servidor de teste em background: `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`; se a porta 3000 travar, `taskkill` antes.
- Nuvem/Oracle proibida neste plano — nada de ssh, `DATABASE_URL` de produção ou rotação de senha (vira follow-up).
- Fora de escopo (não implementar): F3 (urgente auto-declarado), F5 (dispensa global), F8 (heartbeat — Tailscale próprio), F13 (banco local nunca sobe), F10 (Streamlit — descartada pelo usuário em 2026-09-09).

---

### Task 1: Teto de quantidade e tamanho de textos (F6)

**Files:**
- Modify: `src/routes/demands.ts:92-108` (schema do `POST /`)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: schema rejeita `quantity > 100` e textos gigantes (usado pelas Tasks 4 e 6 como premissa).

- [ ] **Step 1: Evidenciar a falha (pedido absurdo aceito)**

Run (servidor local com banco local no ar):
```powershell
curl.exe -s -X POST http://127.0.0.1:3000/api/v1/products/all | Out-String | Select-Object -First 2
$pid = "<id-de-produto-valido>"
curl.exe -s -X POST http://127.0.0.1:3000/api/v1/demands -H "Content-Type: application/json" -d "{`"product_id`":`"$pid`",`"quantity`":99999999.99}"
```
Expected: FAIL (bug presente) — resposta `201` com a demanda criada em vez de `400`.

- [ ] **Step 2: Aplicar tetos no schema**

Em `src/routes/demands.ts`, trocar:
```ts
quantity: { type: 'number', minimum: 0.01 },
unit_id: { type: 'string' },
unit_label: { type: 'string' },
priority: { type: 'string', enum: ['normal', 'urgent'] },
notes: { type: 'string' },
```
por:
```ts
quantity: { type: 'number', minimum: 0.01, maximum: 100 },
unit_id: { type: 'string' },
unit_label: { type: 'string', maxLength: 30 },
priority: { type: 'string', enum: ['normal', 'urgent'] },
notes: { type: 'string', maxLength: 500 },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (sem erros).

- [ ] **Step 4: Verificar a correção**

Run (reiniciar o `npm run dev` para valer o schema):
```powershell
curl.exe -s -X POST http://127.0.0.1:3000/api/v1/demands -H "Content-Type: application/json" -d "{`"product_id`":`"$pid`",`"quantity`":99999999.99}"
curl.exe -s -X POST http://127.0.0.1:3000/api/v1/demands -H "Content-Type: application/json" -d "{`"product_id`":`"$pid`",`"quantity`":2}"
```
Expected: PASS — primeira resposta `400`, segunda `201`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/demands.ts
git commit -m "fix: limita quantity a 100 e tamanho de unit_label/notes"
```

---

### Task 2: Bloquear troca fantasma e auto-troca (F12)

**Files:**
- Modify: `src/routes/demands.ts:146-160` (validação de `replaced_product_id`)

**Interfaces:**
- Consumes: nada novo.
- Produces: `is_replacement` só verdadeiro com item distinto e válido.

- [ ] **Step 1: Evidenciar a falha (troca do produto por ele mesmo)**

Run:
```powershell
curl.exe -s -X POST http://127.0.0.1:3000/api/v1/demands -H "Content-Type: application/json" -d "{`"product_id`":`"$pid`",`"quantity`":1,`"is_replacement`":true,`"replaced_product_id`":`"$pid`"}"
```
Expected: FAIL (bug presente) — `201` em vez de `400`.

- [ ] **Step 2: Validar vínculo da troca**

Em `src/routes/demands.ts`, logo após o bloco que valida `replaced_product_id` (linhas 152-160), inserir:
```ts
if (replaced_product_id && replaced_product_id === product_id) {
  return reply.code(400).send({
    error: 'O item substituído deve ser diferente do item pedido',
  });
}
```
E na montagem do `INSERT` (linhas ~222-245), quando `isReplacement` for falso, persistir `replaced_product_id` como `null` em vez do valor órfão enviado.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verificar a correção**

Run:
```powershell
curl.exe -s -X POST http://127.0.0.1:3000/api/v1/demands -H "Content-Type: application/json" -d "{`"product_id`":`"$pid`",`"quantity`":1,`"is_replacement`":true,`"replaced_product_id`":`"$pid`"}"
```
Expected: PASS — resposta `400` com `O item substituído deve ser diferente do item pedido`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/demands.ts
git commit -m "fix: rejeita auto-troca e descarta replaced_product_id orfao"
```

---

### Task 3: CAS em ready e retrieve (F11)

**Files:**
- Modify: `src/routes/demands.ts:305-308` (UPDATE do ready), `src/routes/demands.ts:374-377` (UPDATE do retrieve)

**Interfaces:**
- Consumes: nada novo.
- Produces: padrão CAS com `RETURNING id` reutilizável pela Task 4.

- [ ] **Step 1: Evidenciar a falha (UPDATE sem guarda de status)**

Run: `Select-String -Pattern "UPDATE demands SET status = '(ready|retrieved)'" -Path src/routes/demands.ts`
Expected: FAIL (bug presente) — dois UPDATEs com `WHERE id = $1` e sem `AND status`.

- [ ] **Step 2: Adicionar CAS com RETURNING**

Trocar em `src/routes/demands.ts:305-308`:
```ts
await query(
  `UPDATE demands SET status = 'ready', ready_at = now() WHERE id = $1`,
  [id]
);
```
por:
```ts
const readyRows = await query<{ id: string }>(
  `UPDATE demands SET status = 'ready', ready_at = now()
    WHERE id = $1 AND status = 'pending' RETURNING id`,
  [id]
);
if (readyRows.length === 0) {
  return reply.code(409).send({ error: 'Demanda não está mais pendente' });
}
```
Trocar em `src/routes/demands.ts:374-377`:
```ts
await query(
  `UPDATE demands SET status = 'retrieved', retrieved_at = now() WHERE id = $1`,
  [id]
);
```
por:
```ts
const retrievedRows = await query<{ id: string }>(
  `UPDATE demands SET status = 'retrieved', retrieved_at = now()
    WHERE id = $1 AND status = 'ready' RETURNING id`,
  [id]
);
if (retrievedRows.length === 0) {
  return reply.code(409).send({ error: 'Demanda não está mais pronta para retirada' });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verificar fluxo normal intacto**

Run: criar demanda → `PATCH /:id/ready` (espera 200) → `PATCH /:id/ready` de novo (espera 409) → `PATCH /:id/retrieve` (espera 200) → `PATCH /:id/retrieve` de novo (espera 409).
Expected: PASS — segundo ready e segundo retrieve retornam `409`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/demands.ts
git commit -m "fix: ready e retrieve com CAS para nao ressuscitar cancelada"
```

---

### Task 4: Motivo de cancelamento inválido retorna 400 (F1-parcial)

**Files:**
- Modify: `src/routes/demands.ts:436-438` (cancel-salao), `src/routes/demands.ts:526-528` (cancel-cozinha, mesmo padrão)

**Interfaces:**
- Consumes: padrão CAS da Task 3.
- Produces: cancels só com motivo existente ou texto livre.

- [ ] **Step 1: Evidenciar a falha (id inexistente aceito)**

Run:
```powershell
curl.exe -s -X PATCH http://127.0.0.1:3000/api/v1/demands/<id-pendente>/cancel-cozinha -H "Content-Type: application/json" -d "{`"cancel_reason_id`":`"00000000-0000-0000-0000-000000000000`"}"
```
Expected: FAIL (bug presente) — cancela com sucesso gravando id inexistente em vez de `400`.

- [ ] **Step 2: Rejeitar motivo inexistente**

Nos dois handlers, trocar o padrão:
```ts
const reasonLabel = cancel_reason_id
  ? ((await query<{ label: string }>('SELECT label FROM cancel_reasons WHERE id = $1', [cancel_reason_id]))[0]?.label || trimmedReason || null)
  : trimmedReason || null;
```
por:
```ts
let reasonLabel: string | null = trimmedReason || null;
if (cancel_reason_id) {
  const [reasonRow] = await query<{ label: string }>(
    'SELECT label FROM cancel_reasons WHERE id = $1',
    [cancel_reason_id]
  );
  if (!reasonRow) {
    return reply.code(400).send({ error: 'Motivo de cancelamento inválido' });
  }
  reasonLabel = reasonRow.label;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verificar a correção**

Run: repetir o Step 1 (espera `400`), depois cancelar com `{"reason":"sem peixe"}` (espera 200).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/demands.ts
git commit -m "fix: cancelamento rejeita motivo inexistente com 400"
```

---

### Task 5: Stockout idempotente com CAS total (F4)

**Files:**
- Modify: `src/routes/demands.ts:577-651` (handler `POST /:id/stockout`)

**Interfaces:**
- Consumes: padrão `RETURNING id` + 409 da Task 3.
- Produces: stockout à prova de replay.

- [ ] **Step 1: Evidenciar a falha (replay reescreve o laudo)**

Run (harness `.ts` temporário fora do repo, ex. `C:\Users\Milena\AppData\Local\Temp\opencode\replay-stockout.ts`, executado com `npx ts-node --transpile-only`): cria demanda, chama `POST /:id/stockout` duas vezes e imprime `stockout_reported_at`, `stockout_sla_factor` e contagem de eventos `stockout_reported`.
Expected: FAIL (bug presente) — segunda chamada retorna 200, muda o fator e insere novo evento.

- [ ] **Step 2: Ler `stockout_reported` e travar o primeiro UPDATE**

No `SELECT` de `src/routes/demands.ts:577-586`, incluir `stockout_reported`. Após o gate de `pending` (linhas 591-595), inserir:
```ts
if (demand.stockout_reported) {
  return reply.code(409).send({ error: 'Rotura já registrada para esta demanda' });
}
```
Trocar o UPDATE das linhas 605-610 por:
```ts
const stockRows = await query<{ id: string }>(
  `UPDATE demands SET stockout_reported = true, stockout_reported_at = now(),
    stockout_sla_factor = $2
   WHERE id = $1 AND status = 'pending' AND stockout_reported = false
   RETURNING id`,
  [id, stockoutFactor]
);
if (stockRows.length === 0) {
  return reply.code(409).send({
    error: 'Rotura já registrada ou demanda saiu de pendente',
  });
}
```

- [ ] **Step 3: Fechar os UPDATEs de promoção**

Nos três UPDATEs de promoção (linhas ~624-649), acrescentar `AND status = 'pending'` ao `WHERE` de cada um, sem mexer na ordem (recompute antes dos emits, linhas 659-683, fica como está).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Verificar a correção**

Run: repetir o harness do Step 1.
Expected: PASS — segunda chamada retorna `409`, fator e `reported_at` intactos, sem novo evento.

- [ ] **Step 6: Commit**

```bash
git add src/routes/demands.ts
git commit -m "fix: stockout idempotente com CAS e sem reescrever fator"
```

---

### Task 6: Reversão do jantar preserva origem (F7)

**Files:**
- Modify: `src/routes/admin.ts:747-752` (UPDATE de reversão do `/shift/lunch`)

**Interfaces:**
- Consumes: nada novo.
- Produces: demandas sem origem ficam no jantar.

- [ ] **Step 1: Evidenciar a falha (tudo cai na quente_a)**

Run (harness `.ts` temporário): com gerente logado (token de teste local), ativa `POST /admin/shift/dinner`, cria demanda de `INHAME COZIDO` (flexível) e de um produto nativo do jantar, encerra com `POST /admin/shift/lunch` e imprime `kitchen_station_id` de cada uma.
Expected: FAIL (bug presente) — ambas pendentes aparecem na `quente_a`.

- [ ] **Step 2: Reverter só quem tem origem**

Em `src/routes/admin.ts:747-752`, trocar:
```sql
UPDATE demands SET kitchen_station_id = COALESCE(origin_station_id, $1), origin_station_id = NULL
WHERE status = 'pending' AND created_at::date = $2 AND kitchen_station_id = $3
```
por:
```sql
UPDATE demands SET kitchen_station_id = origin_station_id, origin_station_id = NULL
WHERE status = 'pending' AND created_at::date = $2 AND kitchen_station_id = $3
  AND origin_station_id IS NOT NULL
```
Demandas com `origin_station_id` nulo (nascidas no jantar) permanecem no jantar — nenhum outro trecho precisa mudar (o `recomputeStationQueue(jantarId)` da linha 771 já cobre a fila que ficou).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verificar a correção**

Run: repetir o harness do Step 1.
Expected: PASS — demanda do almoço volta à origem, INHAME e nativo do jantar permanecem no jantar.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts
git commit -m "fix: reversao do jantar mantem pedidos sem origem no jantar"
```

---

### Task 7: Higiene frontend — escape no modal e log no status dos Pis

**Files:**
- Modify: `src/views/salao.html:723` (`d.product_name` sem `esc`), `src/views/admin.html:~891` (`.catch(()=>{})` do polling dos Pis)

**Interfaces:**
- Consumes: nada.
- Produces: UGC sempre escapado; falha de rede visível no console.

- [ ] **Step 1: Evidenciar (grep)**

Run:
```powershell
Select-String -Pattern "qty \+ 'x ' \+ d\.product_name" -Path src/views/salao.html
Select-String -Pattern "catch\(\(\)=>\{\}\)" -Path src/views/admin.html
```
Expected: FAIL (higiene pendente) — ambas as linhas existem.

- [ ] **Step 2: Escapar e logar**

Em `src/views/salao.html:723`, trocar:
```js
textEl.innerHTML = 'Confirmar retirada de <strong>' + qty + 'x ' + d.product_name + '</strong>?';
```
por:
```js
textEl.innerHTML = 'Confirmar retirada de <strong>' + qty + 'x ' + esc(d.product_name) + '</strong>?';
```
Em `src/views/admin.html` (~linha 891), trocar o `.catch(()=>{})` do polling de status dos Pis por:
```js
.catch(function(err) { console.warn('[Pis] Falha ao atualizar status:', err); });
```

- [ ] **Step 3: Verificar visualmente**

Run: abrir `http://127.0.0.1:3000/salao`, retirar um item (modal mostra o nome normalmente); abrir `/admin` com rede ativa (sem erro no console).
Expected: PASS — nenhum `innerHTML` com UGC sem `esc()` restante (`Select-String -Pattern "product_name" -Path src/views/salao.html` só mostra ocorrências com `esc(`).

- [ ] **Step 4: Commit**

```bash
git add src/views/salao.html src/views/admin.html
git commit -m "fix: escapa nome no modal do salao e loga falha do status dos Pis"
```

---

### Task 8: Banco — alerta alto e CA própria em vez de bypass silencioso (F9-código)

**Files:**
- Modify: `src/db/client.ts:58-70` (montagem do SSL)

**Interfaces:**
- Consumes: nada.
- Produces: bypass nunca silencioso; caminho para proxy de inspeção sem desligar tudo. Rotação de senha fica como follow-up de nuvem, fora deste plano.

- [ ] **Step 1: Evidenciar (bypass silencioso)**

Run: `Select-String -Pattern "rejectUnauthorized" -Path src/db/client.ts`
Expected: FAIL (higiene pendente) — nenhum `warn` quando a verificação é desligada.

- [ ] **Step 2: Avisar e aceitar CA própria**

Em `src/db/client.ts`, antes do `new Pool`, inserir:
```ts
const customCaPath = process.env.DB_SSL_CA_FILE;
if (!isLocal && !rejectUnauthorized) {
  console.warn(
    '[db] ATENÇÃO: verificação TLS do banco DESLIGADA (DB_SSL_REJECT_UNAUTHORIZED=false). ' +
    'Use DB_SSL_CA_FILE com o CA do proxy em vez disso.'
  );
}
```
E trocar `ssl: isLocal ? false : { rejectUnauthorized, servername: dbConfig.host }` por uma montagem que, quando `DB_SSL_CA_FILE` estiver definido, lê o arquivo e passa `ca` com `rejectUnauthorized: true`. Ler o arquivo com `fs.readFileSync` dentro do bloco assíncrono de inicialização.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verificar (banco local continua sem SSL, sem warn)**

Run: `npm run dev` com `.env` local e observar o log de boot.
Expected: PASS — conecta normalmente, sem o aviso (aviso só aparece com host não-local + opt-out).

- [ ] **Step 5: Commit**

```bash
git add src/db/client.ts
git commit -m "fix: alerta bypass TLS do banco e suporta CA propria"
```

---

### Task 9: Transporte — fechar HTTP claro (F2)

**Files:**
- Modify: `Caddyfile:15-23` (bloco `:80`), `docker-compose.yml:12-13` (porta 3000), `Caddyfile:5-13` (HSTS)

**Interfaces:**
- Consumes: Task 8 (postura TLS coerente).
- Produces: `:80` redireciona, `:3000` não exposto, HSTS no domínio. **Dependência operacional:** kiosks na LAN que usam `http://IP:3000` precisam migrar para o domínio HTTPS via Tailscale — enquanto isso, risco residual documentado no corpo da task.

**Atenção (não quebrar os kiosks):** aplicar primeiro no ambiente local com `docker compose`, validar, e só então replicar na nuvem. O desafio HTTP-01 do Let's Encrypt segue redirects para HTTPS, então o `redir` não quebra a emissão do certificado.

- [ ] **Step 1: Evidenciar (`:80` serve app em claro, `3000` exposta)**

Run:
```powershell
Select-String -Pattern "reverse_proxy app:3000" -Path Caddyfile
Select-String -Pattern '"3000:3000"' -Path docker-compose.yml
```
Expected: FAIL (bug presente) — bloco `:80` com proxy e porta publicada.

- [ ] **Step 2: Redirecionar, fechar porta e HSTS**

Em `Caddyfile`, trocar todo o bloco `:80` (linhas 15-23) por:
```
:80 {
    redir https://{host}{uri} permanent
}
```
No bloco `{$DOMAIN}`, acrescentar após `encode gzip`:
```
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
```
Em `docker-compose.yml`, remover a linha `- "3000:3000"` (manter `expose: ["3000"]`).

- [ ] **Step 3: Validar sintaxe e subida local**

Run:
```powershell
docker compose config
docker compose up -d --build
curl.exe -s -o NUL -w "%{http_code} %{redirect_url}\n" http://127.0.0.1/health
```
Expected: PASS — `config` válido, `http://127.0.0.1/health` retorna `308` para `https://...`.

- [ ] **Step 4: Commit**

```bash
git add Caddyfile docker-compose.yml
git commit -m "fix: :80 redireciona para https, fecha 3000 e ativa HSTS"
```

---

### Task 10: Streamlit só em localhost (F10) — DESCARTADA, não implementar

**Files:**
- Create: `dashboard/.streamlit/config.toml`

**Interfaces:**
- Consumes: nada.
- Produces: sidecar nunca exposto na LAN por padrão; acesso remoto via SSH/Tailscale.

- [ ] **Step 1: Evidenciar (sem config de bind)**

Run: `Test-Path dashboard/.streamlit/config.toml`
Expected: FAIL (bug presente) — `False` (Streamlit sobe em `0.0.0.0:8501` por padrão).

- [ ] **Step 2: Travar o bind**

Criar `dashboard/.streamlit/config.toml` com:
```toml
[server]
address = "127.0.0.1"
port = 8501
```
(Não adicionar lib de auth — fora do escopo; o isolamento é via rede. Acesso remoto: túnel SSH ou Tailscale até a máquina.)

- [ ] **Step 3: Verificar**

Run:
```powershell
streamlit run dashboard/app.py
curl.exe -s -o NUL -w "%{http_code}\n" http://127.0.0.1:8501/
```
Expected: PASS — `200` em localhost. (Na LAN de outra máquina, a porta não responde — validar com o IP da máquina e esperar falha de conexão.)

- [ ] **Step 4: Commit**

```bash
git add dashboard/.streamlit/config.toml
git commit -m "fix: streamlit escuta so em localhost"
```

---

## Self-Review

**1. Cobertura:** F6→Task 1; F12→Task 2; F11→Task 3; F1-parcial (400 motivo)→Task 4; F4→Task 5; F7→Task 6; higiene `salao.html:723`+catch→Task 7; F9-código→Task 8; F2→Task 9; F10→Task 10. F3/F5/F8/F13 explicitamente fora. F9-rotação e replicação nuvem da Task 9 são follow-ups fora deste plano. Sem gaps.

**2. Placeholders:** nenhum "TODO/TBD"; todo passo tem comando ou código exato; tipos conferem (`query<{ id: string }>` com `RETURNING id`, `reasonLabel: string | null`, `QUOTED` pt-BR).

**3. Consistência:** CAS com `RETURNING id` + 409 usado igual nas Tasks 3–5; ordem stockout→recompute→emit preservada; `origin_station_id` (uuid, já migrado no seed) respeitado; `esc()` global reutilizado; sem nova migração SQL.
