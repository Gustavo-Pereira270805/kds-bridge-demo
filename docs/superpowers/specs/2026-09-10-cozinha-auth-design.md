# Auth nas cozinhas com bypass por IP dos Pis — Design (spec)

> **Data:** 2026-09-10
> **Status:** Aprovado pelo dono, aguardando plano de implementação
> **Escopo:** exigir login (gerente/admin) nas telas e na operação das cozinhas, exceto para os Pis identificados pelo IP do Tailscale. Salão intocado. Sem criar usuários (Supabase com criação por e-mail bloqueada).

## 1. Motivação

Hoje as cozinhas são 100% abertas: as 3 views não chamam `kdsGuard`, a API operacional (`ready`, `retrieve`, `cancel-*`, `stockout`, lista) não tem `preHandler` e as salas de socket da cozinha aceitam anônimos. Como o domínio é público na internet, qualquer pessoa no mundo pode ver e operar as cozinhas.

## 2. Regra de acesso

```
podeCozinha(req) = isKioskIp(req) OU (JWT válido E role ∈ {gerente, admin})
```

- Uma única função compartilhada em `src/middleware/auth.ts`, usada em views, API e socket.
- `admin` incluso por equivalência com todas as rotas gerente do código. Só `gerente` puro mediante veto explícito.
- Nenhum usuário novo: o acesso humano usa logins de gerente existentes; os Pis não usam conta alguma.

## 3. Resolução de IP (anti-spoof)

- Atrás do Caddy, o IP real do cliente é a **última** entrada do `X-Forwarded-For` (o Caddy anexa o que ele viu; entradas anteriores vêm do cliente e não são confiáveis). Premissa válida porque a porta 3000 não é publicada — todo tráfego passa pelo Caddy.
- Conexão direta (dev/teste, sem cabeçalho) usa o IP do socket.
- Normaliza IPv6 (minúsculas, sem colchetes) e compara exato com `KDS_KIOSK_IPS` (vírgulas).
- Allowlist de produção: `100.114.73.108` (kds-fria-1), `100.82.174.3` (kds-quente-1) — Tailscale, estáveis.
- Lista vazia ou ausente = ninguém passa pelo bypass (fail closed).

## 4. Onde aplica (e onde não)

| Camada | Alvo | Sem credencial | Logado sem papel |
|---|---|---|---|
| Views (`server.ts`) | `/cozinha`, `/cozinha-quente`, `/cozinha-fria` | `302 /login?next=...` | `302 /login?next=...` |
| API (`demands.ts`) | `PATCH /:id/ready`, `PATCH /:id/cancel-cozinha` | `401` | `403` |
| Socket (`handlers.ts`) | salas `cozinha`, `cozinha_quente`, `cozinha_fria`, `cozinha_jantar` | join negado (log existente) | join negado |

Intocado: salão inteiro (views + criar/retirar/cancelar-salão/zerou/dispensar), `GET /demands`, salas `salao`/`kds-pis`/`gerente`, RBAC e CORS atuais. Nenhum JS muda nos Pis.

**Transporte do token nas views:** a navegação do navegador não envia `Authorization`, então o login espelha o token no cookie `kds_token` (`SameSite=Lax`) e o guarda das views o aceita como alternativa ao header. A API nunca lê cookie (só header + IP) — sem superfície nova de CSRF.

## 5. Limitação consciente

O `GET /demands` continua público porque o salão o usa sem login. Logo, o JSON bruto segue legível para quem conhece a API; o que fecha são **as telas, a operação (pronto/cancelar-cozinha) e o tempo real**. Fechar o JSON exigiria login no salão — vetado neste escopo.

## 6. Configuração

- `KDS_KIOSK_IPS` no `.env` de produção (Oracle) + documentado no `.env.example`. Mudança de IP de Pi = só env + restart, sem código.
- **URL do quiosque OBRIGATORIAMENTE pela tailnet** (`http://100.81.149.114/...`, vhost no Caddyfile): pelo domínio público o Pi chega com o IP de saída da internet e cai no `/login`. HTTP puro é aceitável porque o transporte Tailscale já é criptografado.
- **Premissa de infra:** `/etc/docker/daemon.json` na Oracle com `"userland-proxy": false` — com o proxy userland (padrão), o Caddy vê TODAS as conexões como `172.18.0.1` e o bypass por IP nunca dispara (fail closed, mas quiosques mortos).
- Nenhum segredo novo: IPs do Tailscale não são credenciais, só identificadores de rede privada.

## 7. Erros e observabilidade

- Views: redirect preserva `?next=` para voltar após o login.
- API: `{ "error": "..." }` genérico em pt-BR, sem vazar allowlist, IP detectado ou stack.
- Socket: mantém o log `join negado sala=...` (já existe).
- Respostas de erro nunca incluem a allowlist nem o IP do requisitante.

## 8. Testes e aceite

- `npx tsc --noEmit` e `npm run build` passam.
- Local com `KDS_KIOSK_IPS=127.0.0.1` (temporário, não commitado): bypass libera views + `ready`; sem a variável: views dão 302, API dá 401, token gerente dá 200, token sem papel dá 403.
- Webwright: fluxo criar→pronto→retirar como gerente continua 6/6; quiosque simulado (sem token, IP liberado) opera a cozinha; IP não liberado sem token não abre a tela.
- Deploy fora de pico + reteste na nuvem + telas físicas dos Pis inalteradas (bypass transparente).
- Proibido testar bypass contra IP real dos Pis a partir de máquina não autorizada para "provar" spoof (o teste de spoof é unitário, no resolver).

## 9. Fora de escopo

- Login no salão; fechar o `GET /demands`; tokens de quiosque; novos papéis; mudar RBAC/CORS/fila/SLA; `avahi`/`.local` nos Pis.

---

## Anexo H — Handoff para sessão limpa (vale como contexto completo)

> Escrito em 2026-09-10 ~01:50 BRT para retomar este trabalho após compactação. Uma sessão nova deve conseguir executar o plano só com este arquivo + `docs/superpowers/plans/2026-09-10-cozinha-auth.md`.

### H.1. Onde estamos (atualizado 2026-09-10 ~01:10 BRT)

- Plano 100% executado inline em `feature/cozinha-auth` (5 commits) + merge FF em `main` + deploy em produção (`main@d148fe3`, bridge healthy). Tasks 1–6 completas, E2E local (`outputs/webwright-cozinha-auth/final_runs/run_1/`) e nuvem (`run_2/`) PASS, resíduo zero.
- Quiosques: `~/kds-kiosk.sh` nos Pis aponta para `http://100.81.149.114/cozinha-*` (tailnet, vhost no Caddyfile `cf58b8d`). Telas verificadas por screenshot pós-reboot: quadros abertos, sem login.
- `/opt/kds/.env` com `KDS_KIOSK_IPS` (2 IPs, backup datado); `/etc/docker/daemon.json` com `"userland-proxy": false` (ver H.6).
- Plano de implementação: `docs/superpowers/plans/2026-09-10-cozinha-auth.md`. Registro geral: `docs/DEPLOY_ENDURECIMENTO_KDS_2026-09-09.md` (§9).

### H.2. Decisões travadas (não reabrir sem motivo)

1. Escopo = só as 3 cozinhas; salão intocado.
2. Acesso humano = login **gerente/admin** existente (usuário de teste gerente documentado em `docs/HANDOFF_2026-09-05-lote2.md` §Ambiente + `outputs/verificacao-6-itens/final_runs/run_1/final_script.py:15-16`). Nenhum usuário novo — Supabase com criação por e-mail bloqueada (bounces).
3. Bypass = **só os 2 IPs Tailscale**: `100.114.73.108` (kds-fria-1), `100.82.174.3` (kds-quente-1). Sem rede local. **E os quiosques acessam pela tailnet** (`http://100.81.149.114`, Oracle `100.81.149.114` kds-server) — pelo domínio público o Pi chega com o IP de saída da internet (visto: `187.33.225.76`) e cai no login.
4. Cookie `kds_token` (espelho do login) vale **só no guarda das views** — sem ele o gerente cai em loop login→302→login (navegador não envia `Authorization`); a API nunca lê cookie (sem CSRF nova).
4. `GET /demands` segue público (salão usa) — limitação consciente da §5.
5. Alerta do monitoramento → webhook no celular (usuário configura `KDS_ALERT_WEBHOOK` depois); heartbeat → monitor externo (usuário cria depois). Itens 3–4 da §10 da spec de monitoramento seguem abertos (`avahi`, horário de fechamento).

### H.3. Acessos e segredos (onde estão, nunca os valores)

- SSH Oracle: `ssh -i C:\Users\Milena\.ssh\kds_oracle ubuntu@163.176.208.86` (nativo tem bug hostbound — preferir `scripts/ssh-kds.bat` ou paramiko como `scripts/restart-kds.bat`). Na VM: `sudo -n docker compose ...` (usuário fora do grupo docker de propósito).
- Pis via Tailscale: `framboa@100.114.73.108` / `framboa@100.82.174.3`, senha no cofre do dono (sessão anterior usou e funcionou). VNC só via túnel (`docs/VNC_KDS.md`).
- Produção server-side (fora do git, já aplicados): `/opt/kds/.env` com `DATABASE_URL` nova + `DB_SSL_CA_FILE=/certs/supabase-ca.crt` (sem bypass); `/opt/kds/certs/supabase-ca-2021.crt`; `/opt/kds/docker-compose.override.yml` (monta o crt). Backup: `/opt/kds/.env.bak-20260910`.
- Conta gerente de teste: ver arquivos citados em H.2 (não colar senha em chat/log).

### H.4. Como retomar (comandos)

```powershell
git checkout -b feature/cozinha-auth main
docker start kds-db-local  # se ECONNREFUSED 5432 (abrir o Docker Desktop antes)
npx tsc --noEmit; npm run dev  # porta 3000
curl.exe http://127.0.0.1:3000/health  # {"status":"ok",...}
```

### H.5. Gotchas do ambiente (aprendidos na marra)

- `npx ts-node --transpile-only` quebrado (TS5107/TS5109); harnesses em `curl.exe`/`.mjs`/`.py`, nunca `node -e`.
- Playwright: SÓ `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe` + **Chromium** (viewport 1280x1800, nunca `full_page`).
- Python local não reconhece o cert público (`certificate expired`, vale até 01/12/2026): API via `ssl._create_unverified_context()`, Playwright com `ignore_https_errors`.
- `$pid` é reservado no PowerShell; porta 3000 costuma ficar presa (`taskkill /PID <pid> /F`).
- Sem `pool.on('error')` o Node morria ao perder o banco — já corrigido em `main` (commit `7ca6b01`); `/ready` agora responde 503 em vez de matar o processo.
- Nunca `docker compose up` local com DOMAIN real (dispara ACME de verdade); nunca `DELETE` em demandas (anular via API); anular só vale no mesmo dia; `cancel-salao` só em `pending`.
- Evidências de teste em `outputs/<tarefa>/final_runs/run_N/` (gitignored); ler PNGs com a ferramenta Read para auto-verificação.
- JSON via `curl.exe -d` inline no PowerShell sempre dá `FST_ERR_CTP_INVALID_JSON_BODY` — corpos JSON vão em arquivo (`-d @arq`); asserts com acento usam `-match` (encoding).
- Reiniciar servidor: `Start-Process` desanexado + poll de `/health` (nunca `Start-Job` — morre com o shell; nunca `sleep` fixo longo).
- Screenshot dos Pis sem viewer: `XAUTHORITY=... DISPLAY=:0 xwd -root -out /tmp/tela.xwd` + SFTP + parser próprio (cabeçalho XWD tem 25 words BE com `header_size` primeiro; Pillow não lê esse variant).

### H.6. Incidente pós-deploy (quiosques no /login) — causa raiz dupla

1. **URL errada:** quiosques apontavam para o domínio público → Caddy via o egress da internet. Correção: `SRC="http://100.81.149.114"` nos `~/kds-kiosk.sh` + vhost `http://100.81.149.114` no Caddyfile.
2. **IP mascarado:** com o userland-proxy do Docker (padrão), o Caddy via TODAS as conexões como `172.18.0.1` (provado com log temporário, depois revertido) — o bypass nunca dispararia por URL alguma. Correção server-side: `/etc/docker/daemon.json` com `"userland-proxy": false` + `systemctl restart docker` (containers `unless-stopped` voltam sozinhos; healthy em ~1min).
- Verificação final: curl do Pi → 200 na tailnet / 302 no público; reboot dos 2 Pis → Chromium quiosque na URL tailnet + screenshots dos quadros abertos.

### H.7. Ponto de partida para a próxima feature (salão)

- `main@49a3bfb`, produção com o mesmo build (bridge healthy, 0 erros). Salão 100% intocado por este trabalho: view `/salao` pública, `POST /demands`, `PATCH /:id/retrieve`, `cancel-salao`, `zerou/dispensar`, sala socket `salao`, `GET /demands` público.
- Conta de teste gerente e padrões de E2E (CPs, `WW-` + anular, screenshots 1280x1800 sem `full_page`) em `outputs/webwright-cozinha-auth/final_runs/run_1/final_script.py` + `fase_b.py` e `run_2/` (nuvem) — reutilizar como molde.
- Pendências externas em aberto (não bloquear a feature): `KDS_ALERT_WEBHOOK` + monitor externo do `/ready` (usuário configura); pergunta `avahi`/`.local`; horário de fechamento da cozinha.
