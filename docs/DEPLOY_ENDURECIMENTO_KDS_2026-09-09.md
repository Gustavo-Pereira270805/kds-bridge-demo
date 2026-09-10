# Endurecimento KDS — registro completo da sessão 2026-09-08/09 (auditoria + implementação + feature)

> **Este documento é autossuficiente**: foi escrito para recuperar todo o contexto após compactação da sessão. Uma sessão nova deve conseguir continuar (merge, deploy, follow-ups) lendo só daqui + os arquivos apontados no item 0.

## 0. Onde está cada coisa (mapa de arquivos)

- Repo: `C:\Users\Milena\OneDrive\Documentos\programas\KDS_demo`
- Branch de trabalho: `endurecimento-kds` (base `main@17191e4`), **limpo, 16 commits, sem push**. `git status` em tracked: vazio.
- Este registro: `docs/DEPLOY_ENDURECIMENTO_KDS_2026-09-09.md` (untracked, de propósito — commitar junto no merge).
- Plano executado: `docs/superpowers/plans/2026-09-08-endurecimento-kds.md` (untracked; Task 10 marcada DESCARTADA).
- Auditoria que originou tudo: `C:\Users\Milena\security-audit-skill\kds_demo\run-2/` (`REPORT.md`, `FINDINGS-DETAIL.md`, `findings.json` validados; run-1 é a auditoria antiga de ago/2026, já superada).
- Evidências de implementação: `.superpowers/sdd/2026-09-08-endurecimento-kds/` (gitignored: briefs `task-N-brief.md`, relatórios `task-N-report.md`, pacotes de revisão, screenshots e scripts webwright por task + `webwright-e2e-full/` com E2E 12/12). **Não deletar** — é a única prova dos testes.
- Projeto da codebase em pt-BR (código, commits, docs). Sem framework de testes; verificação foi via `tsc --noEmit` + servidor local + Playwright/Chromium.

## 1. Estado do ambiente local (como foi deixado)

- `.env` → banco LOCAL (`localhost:5432`, container `kds-db-local`, user/senha locais). `.env.nuvem` → backup da nuvem (não usar no dev).
- Banco local = container Docker `kds-db-local` (Postgres 16, `docker-compose.local.yml`). Contém resíduos de teste das tasks (demandas canceladas, inofensivas; nada pendente de teste).
- Docker Desktop é instalação **por usuário** (`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`) — se o servidor cair com `ECONNREFUSED 127.0.0.1:5432`, é o Docker fechado: abrir o app + `docker start kds-db-local`.
- Servidor dev: `npm run dev` (ts-node-dev) na porta 3000, escuta em `0.0.0.0` (vale `127.0.0.1`, LAN `192.168.0.6` e Tailscale `100.98.228.58`).
- Playwright: SÓ funciona em `C:\Users\Milena\AppData\Local\Programs\Python\Python313\python.exe` + **chromium** (firefox não instalado; `python` do PATH é outro, sem playwright).
- Tailscale já ativo no servidor e nos Pis (comunicação atual dos Pis). Streamlit 1.63 ficou instalado no Python313 (resquício inofensivo de task cancelada).

## 2. O que foi feito (16 commits, todos locais)

Segurança (auditoria run-2 → plano → subagente + revisão + browser por task + 3 checkpoints + revisão final APROVADA, 0 bloqueadores):

| Achado | Commits (hash completo) | Comportamento novo |
|---|---|---|
| F6 | `8dced77` 8dced771a9fdda5860b3a1e530de0acb87e89d6a | `POST /demands`: quantity ≤ 100, unit_label ≤ 30, notes ≤ 500; acima → 400 |
| F12 | `5faf6ed` 5faf6ed2735ae9226ddbe5f2ea8dd25955cbd3f4 | auto-troca → 400; `replaced_product_id` sem `is_replacement` = null |
| F11 | `94d4555` 94d455575ab45290d22b5cda06bb385fae3d6704 | ready/retrieve com CAS (`AND status` + `RETURNING`); replay/corrida → 409 |
| F1-p | `6cb9a75` 6cb9a75e2f951be723e3f10d1439c971e9a36dcb + `10e76d0` 10e76d0f2eb9bac41eb6d000a1659596efa9f51e | `cancel_reason_id` inexistente ou malformado (regex UUID) → 400; motivo livre ok |
| F4 | `78b3aca` 78b3aca0af2903b2766e2f9378b2ff623e524cc2 | stockout idempotente: replay → 409, fator/`reported_at` intactos, 1 evento; promoção com `AND status='pending'` |
| F7 | `06a817c` 06a817c0059a30b373239a05df0ca1c38b41f66d + `e166344` e166344f0956f7dfcabfec415e393f6ad5d949ad + `5488c53` 5488c5332c42e45bcfb3da4ad11acf3eaa81a63d | fim do jantar só reverte com origem (`IS NOT NULL`); nascidas no jantar ficam; recompute em jantar + destinos; evento com destino |
| Higiene | `9fee403` 9fee4038b1e5d9afb2b1982c948c1a937eaf6b4b + `34bc63f` 34bc63f528d0e60a115c227175c5ddcb15e19550 | `esc()` no modal do salão; toast 409 nas 3 cozinhas; `max=100`; schema units (`code` ≤ 20 = banco, `label` ≤ 30); log no polling dos Pis |
| F9-cód | `08cd2cf` 08cd2cff4d477c9695475ad3522640afa248172c + `c8c8de2` c8c8de2aff32001d65c7e1b363ee4aebaee45ca0 | warn alto se TLS desligado (só quando real); `DB_SSL_CA_FILE` com verificação ligada; local inalterado; **senha NÃO rotacionada** |
| F2-infra | `d717b7a` d717b7ab1ab75ca301c0a1632654388d54ccc466 | `:80` só redireciona p/ HTTPS + HSTS; removido `ports 3000:3000` (só `expose`) |

Feature Gerenciamento Avançado (Task 11, pedida na sessão):

| Commits (hash completo) | Comportamento novo |
|---|---|
| `c30ee6e` c30ee6e743ed4007561d7ac5dd2859e15c9e1883 | `POST /admin/products` cria o produto e vincula **todas as unidades ativas** na mesma transação (testado: 117/117); duplicado segue 409 |
| `681c1be` 681c1befa7ac6e26d2cc5267b887eb6084551657 | Aba Unidades → botão **"Selecionar tudo"** (alterna marca/desmarca); testado nos 4 cenários |

Sem migração de banco (nenhum `supabase/` tocado). E2E do fluxo principal: 12/12 PASS com limpeza. Não implementado por decisão: F3 (urgente auto-declarado), F5 (dispensa global), F8 (heartbeat → solução via Tailscale, ver item 5), F13 (banco local), F10 (Streamlit, task cancelada no meio — ver item 6).

## 3. Deploy em produção (ordem obrigatória)

**3.1. Merge.** `git checkout main && git merge endurecimento-kds` (+ `npx tsc --noEmit`, `npm run build`). Committar junto este arquivo e o plano.
**3.2. Tailscale + kiosks PRIMEIRO.** `tailscale serve https / http://127.0.0.1:3000` no servidor; migrar o autostart dos Pis para `https://<servidor>.<rede>.ts.net/...`; validar 1 pedido completo (criar→pronto→retirar) e cancelar o teste. **Sem isso, o passo 3.3 cega a cozinha** (`http://IP:3000` morre no compose novo).
**3.3. Compose novo.** `docker compose up -d --build` na Oracle. Validar: `http://<domínio>/health` redireciona (301/308); HSTS; 3000 fechada de fora; kiosks ok pelo Tailscale. (HTTP-01 do Let's Encrypt segue redirect, emissão preservada.)
**3.4. Fumaça (10 min).** 1 pedido completo, 1 cancel com motivo, 1 zerou, `/gerente` (textos novos de evento), turno `lunch`.
**3.5. Senha do Supabase (SÓ após 3.3 estável).** Painel → nova senha → `DATABASE_URL` no `.env` de produção → restart → log "Banco de dados conectado" sem warn `ATENÇÃO`. Se houver proxy TLS: `DB_SSL_CA_FILE`, nunca religar o bypass.
**Rollback.** Código: revert/redeploy da imagem anterior. Infra: voltar bloco `:80` + `ports 3000:3000` e kiosks ao `http://IP:3000`. Banco: sem migração, nada a reverter; testes, anular (`annulled`), nunca `DELETE`.

## 4. Gotchas e pontos de atenção

1. Kiosks antes do compose — sempre (cozinha cega caso contrário).
2. Novos 400/409 são o sistema funcionando (teto, motivo, replay, duplo-clique); avisar a equipe + olhar pico de 400 no log na 1ª semana.
3. Primeiro ciclo dinner→lunch pós-deploy: conferir nativas no jantar e quente_b/fria recalculadas.
4. Texto de `shift_transfer` mudou ("estação de origem" / "Revertida para X") — atualizar quem casava a string antiga.
5. Nunca `docker compose up` local com DOMAIN real (dispara ACME de verdade); local só `DOMAIN=localhost`/`tls internal`.
6. `npx ts-node --transpile-only` quebrado (TS5107/TS5109); harnesses em `curl.exe`/`.mjs`; `$pid` é reservado no PowerShell.
7. Streamlit segue sem auth — 8501 só em localhost/SSH até o tema voltar.
8. F3/F5 seguem possíveis (decisão consciente, aguardam fase do login); `quenteAId` sem uso em `admin.ts` (limpeza futura); toast 400 genérico, selo TROCA só nas cozinhas e mojibake antigo seguem como antes.

## 5. Decisões registradas (não reabrir sem motivo)

- Salão/cozinhas sem login: provisório, mantido. F8 será resolvido restringindo heartbeat a IP `100.x` + allowlist (Pis já falam por Tailscale).
- Task 10 cancelada pelo usuário no meio da execução: processo :8501 encerrado, `dashboard/.streamlit/` removido; ficou só o pacote `streamlit` no Python313.
- Validação de `/admin` no browser não foi clicada (exige login de gerente; sem credencial de teste na sessão) — coberta via HTML servido + lógica executada + API. Para o clique real, obter login de teste de gerente.
- Revisão final: APROVADO, 0 bloqueadores; diferidos triados como não-bloqueantes (lista no ledger `.superpowers/sdd/.../progress.md`).

## 6. Como retomar (comandos)

```powershell
git checkout endurecimento-kds; git log --oneline 17191e4..HEAD  # 16 commits acima
docker start kds-db-local  # se ECONNREFUSED 5432 (Docker Desktop precisa estar aberto)
npx tsc --noEmit; npm run dev  # porta 3000, insurance: Start-Process ... -WindowStyle Minimized
curl.exe http://127.0.0.1:3000/health  # {"status":"ok",...}
```
