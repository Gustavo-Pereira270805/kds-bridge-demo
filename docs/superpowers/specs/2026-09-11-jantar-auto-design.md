# Jantar Automático — Design (spec)

> **Data:** 2026-09-11
> **Status:** Aprovado no brainstorming (3/3 seções)
> **Autor:** Muse Spark + Milena
> **Escopo:** Ativar o turno jantar automaticamente no horário configurado (padrão `15:00`, fuso `America/Sao_Paulo`), com botão diário ON/OFF no `/gerente` e configuração do horário no `/admin`.

## 1. Objetivo e escopo

O gerente quer parar de ativar o jantar manualmente todo dia: às `15:00` (ajustável) o servidor executa sozinho exatamente a mesma ativação do botão “Iniciar Turno Jantar”. A desativação do automático vale só naquele dia; todo dia o padrão volta a ON.

* **Local do botão:** `/gerente`, ao lado do botão manual (`gerente.html:244-246`).
* **Local da configuração de horário:** nova aba `Turno Jantar` no `/admin` (Gerenciamento Avançado).
* **Sem escopo:** recriação de VM, retry da ARM, refresh de token, painel de saúde no `/admin`, mudanças nas telas kiosk além do que já reage a `shift:updated`, qualquer alteração em fila/SLA/RBAC.

## 2. Arquitetura

```text
[system_settings] dinner_auto_time / dinner_auto_disabled_date / dinner_auto_fired_date
        |
        v
[scheduleDinnerAuto — tick 60s em server.ts] -- passou do horário SP, ON hoje, não disparou, turno != dinner -->
        |
        +--> [activateDinnerShift(trigger='auto') em shift.service.ts] — MESMA transação do botão manual
                |-- recomputeStationQueue + computeDailyScores (pós-commit)
                |-- emits: menu:updated, shift:updated, demand:queue-updated, dinner:auto-updated
                v
[/gerente: botão + rótulo atualizam]   [/admin: horário salvo reflete no rótulo]   [kiosks: reagem via shift:updated]
```

**Decisão de scheduler (aprovada):** tick em processo no servidor, mesmo molde de `scheduleDailyCleanup()` (`server.ts:422-433`, com `.unref()`). Rejeitadas: `pg_cron` (morre com projeto pausado no free, e precisaria chamar o app de volta) e cron externo (duplicaria a fonte de verdade do horário).

## 3. Banco de dados

### 3.1 Nova migration `supabase/migrations/2026-09-11-dinner-auto.sql`

```sql
INSERT INTO system_settings (key, value) VALUES ('dinner_auto_time', '15:00')
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value) VALUES ('dinner_auto_disabled_date', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value) VALUES ('dinner_auto_fired_date', '')
ON CONFLICT (key) DO NOTHING;
```

Sem tabela nova, sem CHECK novo, sem toque em `demands`/`menus`/`performance_scores`.

### 3.2 Espelho em `seedDatabase()` (`server.ts`)

Conforme AGENTS.md, os mesmos 3 `INSERT ... ON CONFLICT DO NOTHING` para DBs existentes convergirem.

### 3.3 Dia canônico: `America/Sao_Paulo` (aprovado)

```sql
SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today_sp;
SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS time_sp;
```

* **ON do dia** = `dinner_auto_disabled_date` vazio ou diferente de `today_sp`. O “reset para ON todo dia” é implícito — sem job.
* **Ajuste cirúrgico incluído:** `getCurrentShift()` (`shift.service.ts:3-10`) e a ativação/reversão manual (`admin.ts:655,706-709,763,807`) passam a gravar e comparar `shift_dinner_active_date` com o dia em SP, não mais `CURRENT_DATE` do banco. Sem isso, entre 21h e 0h (UTC e SP em dias diferentes) o auto e o manual discordariam sobre “que dia é hoje”.
* `shift_dinner_started_at` e as métricas **não** são tocados.

## 4. Backend

### 4.1 `src/services/shift.service.ts`

* `todaySP()` / `timeSP()` — helpers com o SQL acima.
* `getDinnerAutoConfig()` → `{ time, enabled, fired, shift, today, timeSource: 'America/Sao_Paulo' }` (`enabled = disabled_date !== today`, `fired = fired_date === today`).
* `activateDinnerShift(trigger)` — código movido de `POST /admin/shift/dinner` (`admin.ts:641-742`), sem mudança de comportamento; `trigger: 'manual' | 'auto'`:
  * mesma transação (overrides + transferência de `pending` + `shift_dinner_active_date` + grava `dinner_auto_fired_date = today_sp` quando `trigger='auto'`);
  * eventos de transferência mantêm `actor='sistema'`; a nota passa a dizer “na ativação **automática** do turno jantar” quando `trigger='auto'`;
  * pós-commit idêntico (recompute + scores) e mesmos emits, mais `dinner:auto-updated`.
* `maybeAutoActivateDinner()` — chamada pelo tick:
  1. lê config + turno + agora SP;
  2. pula se desligado hoje, já disparado hoje ou horário não chegou;
  3. se turno já `dinner` (manual antecipado), só grava `fired_date` e pula;
  4. senão ativa com `trigger='auto'`.
* `POST /admin/shift/dinner` vira invólucro fino (`trigger='manual'`); resposta ganha campo aditivo `trigger`. `POST /admin/shift/lunch` inalterado.

### 4.2 Novos endpoints (router admin: só `gerente`/`admin`, `admin.ts:36-49`)

* `GET /api/v1/admin/settings/dinner-auto` → estado completo (item 4.1).
* `PUT /api/v1/admin/settings/dinner-auto`, body `{ time?: "HH:MM", enabled?: boolean }`:
  * `time` validado por `^([01]\d|2[0-3]):[0-5]\d$` → `400` se inválido;
  * `enabled: true` limpa `disabled_date`; `enabled: false` grava `today_sp`;
  * emite `dinner:auto-updated` com o estado; retorna o estado.

### 4.3 Scheduler (`server.ts`)

`scheduleDinnerAuto()` ao lado de `scheduleDailyCleanup()`: `setInterval(60s)` com `.unref()`, chamando `maybeAutoActivateDinner()` com try/catch e log (nunca derruba o processo).

**Premissa explícita:** uma única instância do app (a mesma do cleanup atual); o `fired_date` no banco protege contra tick duplo e restart.

## 5. Frontend

### 5.1 `/gerente` — botão Jantar Auto (`gerente.html:244-246`)

* Novo `button#dinnerAutoBtn` após `dinnerEndBtn`: círculo (`span.dot`, ~10px) + rótulo (`span`).
* Rótulo exato: `Jantar Auto às HH:MM: ON` / `...: OFF`, com `HH:MM` vindo da config.
* Círculo ON = preenchido com `var(--c-accent-warm)` (Emerald, token “OK / Ready” em `theme.css:12`); OFF = só contorno com o mesmo token. `aria-pressed` como no `themeToggle`.
* Clique alterna o dia via `PUT` (sem modal — reversível, vale só hoje); otimista + toast; em erro reverte e mostra erro.
* Carrega em `fetchShiftStatus()`; ouve `shift:updated` e `dinner:auto-updated` (mudança em outra aba ou horário salvo no `/admin` reflete ao vivo).
* Sempre clicável: mesmo após o disparo, ligar/desligar não reativa nada — o `fired_date` do dia impede re-disparo.
* ES5 estrito (`var`/`function`), try/catch com toast (nunca `.catch` vazio).

### 5.2 `/admin` — aba “Turno Jantar”

* Nova aba após “Controle de Pis” (`switchTab('turno')` + `div#panel-turno`), mesmo molde do painel de pesos (`admin.html:313-344`).
* Campo `input[type=time]#dinnerAutoTime` + botão Salvar + linha de leitura do dia (auto ON/OFF, já disparou?, turno atual).
* Validação `HH:MM` no cliente e no servidor; toast de sucesso/erro.
* Salvar emite `dinner:auto-updated` → o rótulo no `/gerente` atualiza sem reload.

## 6. Fluxo e segurança

1. Gerente abre `/gerente`: botão mostra `Jantar Auto às 15:00: ON`, círculo verde.
2. Às 15:00 SP (ou no primeiro tick após voltar de uma queda, mesma regra do catch-up aprovado): tick ativa via `activateDinnerShift('auto')`; kiosks e salão reagem pelo `shift:updated` existente; botão/aba refletem via `dinner:auto-updated`.
3. Gerente clica no botão → `PUT {enabled:false}` → círculo esvazia, rótulo `...: OFF`, toast confirma; às 15:00 o tick pula.
4. Vira o dia em SP → `disabled_date` deixa de ser “hoje” → botão volta a ON sozinho.
5. Gerente muda horário no `/admin` → rótulos atualizam ao vivo em todas as abas abertas.

Segurança: endpoints no router admin (só `gerente`/`admin`); sem token novo; sem dado sensível no `dinner:auto-updated` (só `time/enabled/fired/shift/today`); CORS e `kdsGuard` inalterados.

## 7. Casos de borda

1. **Servidor fora do ar no horário:** ao voltar, o tick vê “passou do horário, ON, não disparou” e ativa (catch-up aprovado). Vale para o mesmo dia em SP.
2. **Manual antecipado:** turno já `dinner` no tick → só marca `fired`, sem reexecutar a transação.
3. **Encerramento manual após o auto:** `fired` permanece; sem re-disparo. Reativar depois é sempre manual.
4. **Desligar o auto com jantar já ativo:** sem efeito prático hoje; vale para o bloqueio da ativação automática (que já ocorreu).
5. **Horário alterado para um passado de hoje** (ex.: 15:00→14:00 às 16:00, auto ON, não disparado): o próximo tick dispara imediatamente — documentado como comportamento intencional.
6. **Horário alterado após disparo:** só atualiza rótulos; sem re-disparo.
7. **Duas instâncias do app:** risco de disparo duplo; fora do escopo (arquitetura atual tem uma só; mesma premissa do cleanup).
8. **Horário inválido:** `400` + toast; nada é gravado.
9. **Kiosks:** nenhuma mudança além do `shift:updated` já existente; telas sem socket aberto atualizam no próximo load/poll.
10. **Meia-noite UTC vs SP:** resolvido pela normalização do §3.3; `started_at`/métricas seguem como estão.

## 8. Padrões visuais (obrigatório)

* Tokens de `theme.css` (nada hardcoded); círculo usa `var(--c-accent-warm)`.
* Botão pequeno, ao lado do manual, sem quebrar o `flex-wrap` do header (`gerente.html:244`).
* Views em ES5 estrito; guardar handler no elemento se precisar re-anexar listener (`el._ch`).
* `buildContent`-like: qualquer render novo em try/catch para não travar spinner em “Carregando...”.

## 9. Plano de verificação

1. `npx tsc --noEmit` — sem erros.
2. `npm run dev` em background; checar porta 3000.
3. Migration aplicada no SQL Editor + `seedDatabase()` converge DB existente (3 chaves presentes).
4. `GET /settings/dinner-auto` retorna `time 15:00, enabled true`.
5. Ajustar horário para +2 min, aguardar tick: turno vira `dinner`, rótulo atualiza, demandas de teste transferidas.
6. Repetir com auto OFF: passado o horário, turno segue `lunch`.
7. Restart após o horário com auto ON e sem disparo: catch-up ativa.
8. `PUT` com `time: "25:00"` → `400`.
9. Fluxo Playwright (padrão `test_webwright/`, skill webwright) com screenshots: `/admin` salva horário → `/gerente` rótulo reflete; demandas de teste criadas frescas no dia (`notes: 'WW-...'`) e anuladas após.
10. Typecheck final + `npm run build`.

## 10. Implantação

1. Branch a partir de `main`; implementar backend → frontend → migration.
2. Deploy fora de pico pelo fluxo existente (`git push` + `deploy-kds.bat`, que já exige typecheck).
3. Validar `/ready`-like: `GET /shift/status` + `GET /settings/dinner-auto` em produção.
4. Rollback: só código (chaves de settings são aditivas e inofensivas); `git revert` + republicar.

## 11. Fora de escopo

* Ligar Pis remotamente, agendamento de desligamento dos quiosques, controle de Docker/Caddy.
* Reativação da task ARM, Supabase pago, refresh de token.
* Nova aba de métricas do jantar (fase 2 já prevista em spec própria).
* `avahi`/`.local` nos Pis.
