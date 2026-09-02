# Novo Sistema de Sons da Cozinha — Design (spec)

> Documento de design para a troca dos 4 alertas sonoros das telas de cozinha. Escopo pequeno e cirúrgico: **nenhuma mudança** em backend, banco, rotas ou serviços. Apenas frontend (HTML/JS das views) e um novo arquivo JS compartilhado.

## 1. Contexto do projeto

KDS Bridge: comunicação cozinha–salão, backend **Fastify + Socket.IO + pg** (TS), views **HTML/JS vanilla** em `src/views/` (sem framework, sem bundler). Tudo em **pt-BR**. Views são lidas do disco a cada request (`server.ts:getView()`) — edições live no dev sem restart; produção exige `npm run build` (o `copyfiles src/views -> dist/views` copia a pasta `scripts/` inteira).

Comandos: `npm run dev` (não typechecka) · `npx tsc --noEmit` · `npm run build` · `npm start`.

Hoje os 4 alertas são sintetizados com **Tone.js via CDN** (`https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js`), duplicados nas telas `cozinha-quente.html` e `cozinha-fria.html` (funções `playNormalAlert`, `playUrgentAlert`, `playStockoutAlert`, `playCrossCancelAlert`). Os timbres FM/sawtooth atuais soam artificiais — motivo da mudança.

## 2. Decisões alinhadas com o usuário (via visual companion)

O usuário ouviu e aprovou uma nova família sonora baseada em **síntese física de sino de cristal** (partials inarmônicos com decay por partial). Escolhas finais:

| Evento | Som | Receita (freq em Hz, tempos relativos em s) |
|---|---|---|
| **Novo pedido** | Dois sinos de cristal (ding-dong) | `crystalBell(1318, 0, 1.15, .62)` · `crystalBell(1047, .29, 1.35, .62)` |
| **Urgência** | Som comum duplicado, levemente mais rápido (variante B aprovada) | `crystalBell(1318, 0, 1.15, .85)` · `crystalBell(1047, .22, 1.35, .85)` · `crystalBell(1318, .44, 1.15, .85)` · `crystalBell(1047, .66, 1.35, .85)` |
| **Stockout** | Sino metálico descendente (fora da família cristal, de propósito) | perfil `descending` + `sweptTone('sine', 659 → 370, 1.35s)` |
| **Cancelamento** | Dois sinos de cristal descendentes, suaves | `crystalBell(784, 0, .9, .6)` · `crystalBell(659, .24, 1.0, .6)` |

- **Stockout** usa o perfil de partials `[[1,1,.9],[2.01,.42,.52],[2.65,.25,.36],[3.35,.14,.25]]` sobre `659Hz` (volume .68) + um glissando sine `sweptTone('sine', 659, 370, 1.35s, .28)` por baixo — comunica falta sem soar como urgência. (Volumes .68/.28 resgatados da prova v8 no companion.)
- **Perfil de cristal padrão** (novo/urgência/cancelamento): `[[1,1,1],[2.01,.52,.58],[2.65,.34,.42],[3.35,.22,.3],[4.15,.13,.22],[5.05,.07,.16]]` — 6 partials inarmônicos, amplitude e decay por partial.
- **Volume**: ganhos lineares (Web Audio), como na prova. A urgência é a mais alta (0.85), o cancelamento a mais suave (0.6).
- **Não há arquivos de áudio novos** — sons sintetizados em tempo real, zero assets, zero licenças, funciona offline.

## 3. Escopo — guardrails absolutos

### Proibido
| # | Proibido | Motivo |
|---|---|---|
| G1 | ~~Modificar `src/server.ts`, rotas, serviços, `src/types.ts` ou banco~~ | **REVISADO (v2)**: a rota `demands.ts:162` será ajustada — ver seção 11 |
| G2 | Alterar os call sites dos eventos Socket.IO (handlers que chamam `play*Alert()`) | Chamadas e nomes de função continuam os mesmos |
| G3 | Alterar HTML estrutural/CSS das telas da cozinha | Fora do escopo |
| G4 | Tocar na tela legada `cozinha.html` (`/cozinha`) | Telas ativas são quente/fria; a legada fica como está (mantém Tone.js) |
| G5 | Introduzir arrow functions/template literals/`let` nos arquivos de view | Views são ES5 estrito (gotcha do codebase) |
| G6 | Comitar sem aval explícito do usuário | Regra do projeto |

### Permitido (lista completa)
1. **Criar** `src/views/scripts/kitchen-sounds.js` — motor compartilhado (Web Audio API nativa, ES5).
2. `src/views/cozinha-quente.html` — substituir o corpo das 4 funções por delegação ao motor; **remover** o `<script>` do Tone.js (não será mais usado).
3. `src/views/cozinha-fria.html` — idem.
4. Este spec e, na implementação, um plano em `docs/superpowers/plans/` + verificação (sem commits).

## 4. Estado atual do código

- `cozinha-quente.html` L332–407 e `cozinha-fria.html` L311–386: 4 funções duplicadas (`playNormalAlert` etc.) usando `Tone.Synth`/`Tone.FMSynth` + `Tone.gainToDb`.
- Call sites (não mudam): quente L721/729/752/771; fria L692/700/723/742.
- `<script src=".../tone/14.7.77/Tone.js">` em quente L12, fria L12, e na legada `cozinha.html` L8 (esta permanece).
- `fastifyStatic` serve `src/views/scripts/` em `/scripts/` (server.ts L50–55) — o novo arquivo entra nessa pasta e é carregado como `/scripts/kitchen-sounds.js`, mesmo padrão de `station-theme.js`.

## 5. Arquitetura do motor (`kitchen-sounds.js`)

- **ES5** (var/function), IIFE ou objeto global `KDSSounds` — expõe exatamente os 4 nomes existentes para os call sites continuarem idênticos: `window.playNormalAlert`, `window.playUrgentAlert`, `window.playStockoutAlert`, `window.playCrossCancelAlert`.
- **Web Audio API nativa** (substitui Tone.js): contexto criado lazy no primeiro toque + `ctx.resume()` (política de autoplay — mesmo comportamento do `Tone.start()` atual).
- Primitivas internas (portadas da prova aprovada, resgatada do companion em 52683):
  - `crystalBell(freq, at, dur, vol, profile)` — N osciladores sine, um por partial (`freq * partial[0]`), com `gainEnvelope(at, .003, vol*partial[1], dur*partial[2])` e `stop()` próprio (`at + dur*partial[2] + .05`) — sem vazamento de vozes; dispensa os `setTimeout(dispose)` atuais.
  - `sweptTone(type, f0, f1, at, dur, vol)` — glissando exponencial (stockout), `gainEnvelope(at, .008, vol, dur)`, `stop(at + dur + .06)`.
  - `gainEnvelope(at, attack, peak, duration)` — `setValueAtTime(.0001)` → rampa exponencial até `max(peak, .0002)` em `at+attack` → rampa de volta a `.0001` em `at+duration`.
  - Master gain + `DynamicsCompressor` (threshold −18dB, ratio 6) — mesma cadeia da prova; master → compressor → destination.
- Falha de áudio: `try/catch` com `console.error` (gotcha: nunca `.catch(function(){})` vazio).
- Sem dependências novas; Tone.js deixa de ser carregado nas telas quente/fria.

## 5.1 Confiabilidade de reprodução (problema histórico — "som às vezes não toca")

Diagnóstico do código atual (call sites em quente L721–771 e fria L692–742): o evento Socket.IO **dispara corretamente** e sempre chama `play*Alert()`. As causas reais de silêncio intermitente são duas:

1. **Autoplay policy (causa principal, típica de kiosk)**: `Tone.start()` é chamado dentro do handler do socket. Se o kiosk da cozinha liga e a primeira demanda chega antes de qualquer gesto do usuário (toque/clique) na tela, o `AudioContext` fica `suspended` e o som é silenciosamente bloqueado. O evento roda, o render funciona, mas nada toca.
2. **Dependência de CDN**: se o `Tone.js` (Cloudflare) não carregar (rede instável/offline), `typeof Tone === 'undefined'` faz `play*Alert()` retornar sem som — falha invisível.

Medidas do motor novo:

- **Unlock por gesto**: registrar um listener único (`click`/`touchstart`/`keydown`) na página que chama `ctx.resume()` — a cozinha é tela touch, o primeiro toque desbloqueia permanentemente.
- **Retry de alerta pendente**: se no momento do evento `ctx.state === 'suspended'`, guardar o alerta pendente e tentar tocá-lo na primeira interação do usuário (e re-tentar com backoff curto ~1s/2s/3s). Assim nenhum alerta é perdido no boot do kiosk.
- **Sem CDN**: Web Audio nativa elimina a dependência externa — som funciona offline (mesmo com `suppress` de rede, o alerta toca).
- **Falha visível**: se ainda assim não puder tocar, `console.error` com motivo — nunca silêncio mudo (gotcha do codebase).

## 6. Mudanças por arquivo

### 6.1 `src/views/scripts/kitchen-sounds.js` (novo, ~120 linhas)
Conforme seção 5, com as 4 receitas da seção 2 exatamente (mesmos Hz/tempos/ganhos da prova v8 aprovada).

### 6.2 `src/views/cozinha-quente.html`
1. L12: remover `<script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js"></script>`.
2. Adicionar `<script src="/scripts/kitchen-sounds.js"></script>` ao lado do `station-theme.js`.
3. L332–407: **remover** as 4 funções locais — as globais definidas pelo motor têm o mesmo nome, e os call sites L721+ continuam válidos. (Não delegar com wrappers: declarações locais `function playNormalAlert()` sofreriam hoisting e sobrescreveriam as globais.)

### 6.3 `src/views/cozinha-fria.html`
Mesmos 3 passos (L12, script, L311–386).

## 7. Gotchas do codebase (respeitar)

- Nunca `.catch(function(){})` vazio — sempre `console.error` + estado de erro na UI.
- Views ES5 estrito: `var`/`function()`/concatenação com `+` — sem template literals/arrow/`let`.
- Áudio em cozinha barulhenta: os ganhos da prova (0.6–0.85) foram aprovados de ouvido — manter.
- Vozes: cada oscilador tem `stop()` agendado — sem acúmulo ao chegar várias demandas juntas.

## 8. Plano de verificação

1. `npx tsc --noEmit` — sem erros (não há mudança TS, deve continuar limpo).
2. `npm run dev` (background: `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`).
3. Abrir `/cozinha-quente` e `/cozinha-fria` no navegador: sem erros de console (404 de script, ReferenceError).
4. Disparar os 4 eventos via Socket.IO (script temporário ou console do browser emitindo `demand:new`, `demand:urgent`, `demand:stockout`, `demand:cancelled`) e conferir que os 4 sons tocam.
5. **Cenário kiosk (regressão do bug histórico)**: abrir a tela em aba limpa (nenhum clique/toque), aguardar ~5s e disparar `demand:new` — o som deve tocar (backoff de retry) ou, se o navegador bloquear de todo, registrar `console.error` explícito e tocar no primeiro gesto. Repetir 3×.
6. **Cenário offline**: no DevTools, Network → Offline, disparar evento — som deve tocar (sem CDN).
7. Comparação auditiva com a prova v8 (mesmas receitas — esperado: idêntico).
8. `npm run build` — `dist/views/scripts/kitchen-sounds.js` presente; `npm start` serve as telas sem erro.
9. Guardrails: `git status` mostra apenas os 3 arquivos + docs.

## 9. Definição de pronto

- [ ] Motor criado em `src/views/scripts/kitchen-sounds.js` com as 4 receitas da seção 2.
- [ ] Quente/fria carregam o motor, sem Tone.js, sem erros de console.
- [ ] Os 4 eventos tocam nas duas telas (verificação 8.4).
- [ ] Cenários de confiabilidade 8.5 (kiosk) e 8.6 (offline) validados — nenhum alerta perdido em silêncio.
- [ ] `npx tsc --noEmit` OK; `npm run build` OK.
- [ ] Nenhum arquivo fora da lista da seção 3 alterado; nenhum commit sem aval.

## 10. Referências

- Prova auditiva aprovada: companion v8 (`cozinha-sons-v8.html`) — variante B escolhida para urgência.
- `AGENTS.md` — comandos, gotchas (fonte da seção 7).
- Padrão de script compartilhado: `src/views/scripts/station-theme.js`.

## 11. Revisão v2 (bugs reportados pelo usuário após implementação)

### 11.1 Bug: som de demanda toca nas duas cozinhas

**Causa raiz** (`src/routes/demands.ts:162`): ao criar uma demanda, o evento `demand:new`/`demand:urgent` era emitido com `fastify.io.emit(...)` — **broadcast para todas as salas** — apesar de o `room` correto (`cozinha_quente`/`cozinha_fria` via `getStationRoom`) já ser calculado na linha 159. Resultado: as duas telas de cozinha tocavam o alerta para qualquer pedido.

**Fix**: rotear o evento para as salas corretas (mesmo padrão do stockout, L528-529):

```ts
fastify.io.to(room).emit(eventName, newDemand);
fastify.io.to('salao').emit(eventName, newDemand);
fastify.io.to('gerente').emit(eventName, newDemand);
```

- `room` → só a cozinha da estação do produto toca o som;
- `salao` → o salão precisa do payload para atualizar a lista em tempo real (`salao.html:771-772`);
- `gerente` → `gerente.html:680-681` e `dashboard.html` (que se identifica como `gerente`, L584) fazem refresh nesses eventos.

G1 é revogado especificamente para essa linha; o restante do backend permanece intocado.

### 11.2 Pedido: som do "zerado" (stockout) deve tocar logo após o urgente

**Contexto**: quando um produto zera, `demands.ts:460-498` promove a demanda para `urgent` (e recalcula SLA), mas o evento emitido é só `demand:stockout` — a cozinha ouvia apenas o sino descendente, sem a cadência urgente.

**Fix (frontend, no motor)**: `playStockoutAlert()` passa a tocar a sequência **urgente → zerado**:

1. `recipeUrgent()` completa (4 sinos, 0.85) começando em `at`;
2. em `at + 0.9s` (logo após o último sino do urgente em `at + 0.66s`), `recipeStockout()` original: sino metálico descendente (`crystalBell(659, ..., .68, descending)`) + glissando (`sweptTone('sine', 659→370, .28)`).

Os call sites (`demand:stockout` → `playStockoutAlert()`) permanecem idênticos (G2 preservado).

### 11.3 Verificação adicional (v2)

- Roteamento: criar demanda de produto da estação fria e conferir que `cozinha-quente` NÃO toca som e NÃO recebe o evento; e vice-versa.
- Stockout: disparar `demand:stockout` e conferir a sequência urgente→zerado (audição) + sem erro de console.
