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

## 5. Limitação consciente

O `GET /demands` continua público porque o salão o usa sem login. Logo, o JSON bruto segue legível para quem conhece a API; o que fecha são **as telas, a operação (pronto/cancelar-cozinha) e o tempo real**. Fechar o JSON exigiria login no salão — vetado neste escopo.

## 6. Configuração

- `KDS_KIOSK_IPS` no `.env` de produção (Oracle) + documentado no `.env.example`. Mudança de IP de Pi = só env + restart, sem código.
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
