# Revisão das Notas de Performance das Estações — Plano de Implementação

> **Para agentes de implementação:** use `superpowers:executing-plans` para executar este plano tarefa por tarefa, com checkpoints. Os passos usam caixas de seleção para acompanhamento.

**Objetivo:** substituir o cálculo antigo das notas de performance pela curva dinâmica de SLA e pelos cinco pesos simples definidos na especificação v2, mantendo o layout, os filtros, as rotas fora do escopo e o módulo de exportação estruturalmente intactos.

**Arquitetura:** o serviço de performance continuará sendo a única fonte das regras de pontuação. Ele lerá os cinco pesos de `system_settings`, calculará penalidades individuais a partir dos timestamps das demandas e persistirá os campos atuais de `performance_scores`, mantendo `slow_items` zerado apenas por compatibilidade com o schema. As rotas apenas montarão o contrato novo, e as views consumirão deduções reais sem fabricar valores no navegador.

**Stack:** TypeScript strict, Fastify, PostgreSQL via `pg`, HTML/JavaScript vanilla ES5, `npx tsc`, `npm run build` e Playwright/webwright para a UI.

## Restrições Globais

- Todo código, texto de interface, comentários e documentação novos devem estar em pt-BR.
- Não modificar `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/server.ts`, `src/services/sla.service.ts`, `src/routes/demands.ts`, sockets, filtros de período ou arquivos em `supabase/`.
- Não adicionar autenticação, preHandlers, endpoints, serviços, tabelas ou migrations.
- Em `src/views/dashboard.html`, alterar somente o modal de critérios, `renderPerfDetractors`, `loadPerformance`, `exportPerformanceHtml` e `appendPerformanceExcel`; não reformatar nem reescrever o layout geral.
- Preservar `slow_items` e `slow_item_deduction` no banco; gravá-los como zero e não expô-los no shape da API de entidade.
- Usar SQL parametrizado com placeholders `$1`, `$2` etc.; não usar `?`.
- Manter o JavaScript das views em ES5: `var`, `function`, concatenação com `+` e escapes existentes; não introduzir `let`, `const`, arrow functions ou template literals.
- Não criar commit; o usuário exigiu aval explícito antes de qualquer commit.

---

### Tarefa 1: Preparar e validar a fórmula de penalidade SLA

**Arquivos:**
- Criar temporariamente: `scripts/verify-performance-scoring.ts` ou `verify-performance-scoring.ts` na raiz quando `scripts/` não existir
- Modificar: `src/services/performance.service.ts`
- Remover ao final da verificação: `scripts/verify-performance-scoring.ts`

**Interfaces:**
- Produz `penaltyForSlaFactor(factor: number, slaMin: number, slaMax: number): number` exportada pelo serviço para permitir a verificação isolada.
- A função usa `SLA_MAX_FACTOR = 2.5`, `round2`, clamp entre `slaMin` e `slaMax` e retorna zero para fator menor ou igual a `1`.

- [ ] **Passo 1: Criar o teste temporário primeiro**

Criar `scripts/verify-performance-scoring.ts` com asserções reais contra a função do serviço:

```ts
import assert from 'node:assert/strict';
import { penaltyForSlaFactor } from '../src/services/performance.service';

const padroes: Array<[number, number]> = [
  [1.0, 0],
  [1.1, 0.07],
  [1.5, 0.13],
  [2.2, 0.25],
  [2.5, 0.30],
  [3.0, 0.30],
];

padroes.forEach(function (caso) {
  assert.equal(penaltyForSlaFactor(caso[0], 0.05, 0.30), caso[1]);
});
assert.equal(penaltyForSlaFactor(1.0, 0.10, 0.50), 0);
assert.equal(penaltyForSlaFactor(2.5, 0.10, 0.50), 0.50);
console.log('Fórmula de performance validada.');
```

- [ ] **Passo 2: Rodar para confirmar a falha esperada**

Executar:

```bash
npx ts-node --transpile-only scripts/verify-performance-scoring.ts
```

Resultado esperado antes da implementação: falha informando que `penaltyForSlaFactor` não existe no módulo. A regra normativa é `factor <= 1 → 0`; um exemplo isolado da especificação que dizia aplicar `sla_min` no fator `1,0` é inconsistente e não deve prevalecer.

- [ ] **Passo 3: Implementar o helper mínimo**

No início de `src/services/performance.service.ts`, substituir a interface de pesos antiga por:

```ts
interface Weights {
  sla_min: number;
  sla_max: number;
  cancellation_cozinha: number;
  cancellation_salao: number;
  stockout_salao: number;
}

export const SLA_MAX_FACTOR = 2.5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function penaltyForSlaFactor(factor: number, slaMin: number, slaMax: number): number {
  if (factor <= 1) return 0;
  var raw = slaMin + (slaMax - slaMin) * (factor - 1) / (SLA_MAX_FACTOR - 1);
  var clamped = Math.min(slaMax, Math.max(slaMin, raw));
  return round2(clamped);
}
```

- [ ] **Passo 4: Rodar novamente o teste da fórmula**

Executar o mesmo comando do passo 2. Resultado esperado: saída `Fórmula de performance validada.` e código de saída zero.

- [ ] **Passo 5: Remover o teste temporário somente depois do verde**

Apagar `scripts/verify-performance-scoring.ts` com `apply_patch`. A função exportada permanece para verificação manual posterior e não cria endpoint novo.

### Tarefa 2: Atualizar o serviço de cálculo diário

**Arquivos:**
- Modificar: `src/services/performance.service.ts`

**Interfaces:**
- `getWeights(): Promise<Weights>` passa a devolver exatamente as cinco propriedades novas.
- `upsertScore` recebe somente as deduções/contagens de SLA, cancelamento e zerado; os parâmetros `slowItems`/`slowDed` deixam de existir.

- [ ] **Passo 1: Escrever a consulta de pesos exatos e seus defaults**

Fazer `getWeights` consultar somente estas chaves, sem `LIKE` amplo:

```ts
const keys = [
  'score_weight_sla_min',
  'score_weight_sla_max',
  'score_weight_cancellation_cozinha',
  'score_weight_cancellation_salao',
  'score_weight_stockout_salao',
];
const rows = await query<{ key: string; value: string }>(
  'SELECT key, value FROM system_settings WHERE key = ANY($1)',
  [keys]
);
```

Mapear os valores com defaults `0.05`, `0.30`, `0.30`, `0.30`, `0.10`, na ordem das propriedades da interface.

- [ ] **Passo 2: Substituir as deduções de SLA da cozinha por timestamps**

Manter a contagem de `sla_breached_cozinha = true`, mas obter as linhas com `ready_at`, `created_at` e `sla_minutes` para as mesmas condições. Para cada linha válida, calcular:

```ts
const elapsed = (new Date(String(row.ready_at)).getTime() - new Date(String(row.created_at)).getTime()) / 60000;
const factor = Number(row.sla_minutes) > 0 ? elapsed / Number(row.sla_minutes) : 0;
slaDed += penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max);
```

Somar cada ocorrência já arredondada por `penaltyForSlaFactor`; arredondar novamente a soma com `round2`. Remover a consulta e todos os cálculos de `slowItems`/`slowDed`. Manter zerado da cozinha com dedução zero.

- [ ] **Passo 3: Substituir as deduções de SLA do salão por timestamps**

Ler `pickup_tolerance_minutes` com default `3`, consultar linhas com `retrieved_at`, `ready_at` e `sla_breached_salao = true`, calcular o fator de retirada e somar a curva com `weights.sla_min` e `weights.sla_max`. Remover a consulta de retirada lenta e usar `cancellation_salao` e `stockout_salao` nos critérios fixos.

- [ ] **Passo 4: Persistir as colunas legadas como zero**

Manter `slow_items` e `slow_item_deduction` no `INSERT ... ON CONFLICT` para respeitar o schema existente, mas fazer o `VALUES` receber `0, 0` internamente. Não adicionar coluna, migration ou alteração de banco.

- [ ] **Passo 5: Atualizar a soma e a agregação de `cozinha_geral`**

Calcular `totalDed` apenas com `slaDed + cancelDed + stockDed`, e `sTotalDed` apenas com `sSlaDed + sCancelDed + sStockDed`. Aplicar `Math.max(0, Math.round((5 - totalDed) * 10) / 10)`. Remover `slow_items` e `slow_item_deduction` do SELECT de agregação e dos argumentos de `upsertScore`, mantendo `ROUND(AVG(final_score), 1)` e as somas dos campos restantes.

- [ ] **Passo 6: Rodar o typecheck do serviço**

Executar:

```bash
npx tsc --noEmit
```

Resultado esperado: sem erros TypeScript.

### Tarefa 3: Atualizar detratores individuais e tipos compartilhados

**Arquivos:**
- Modificar: `src/services/performance.service.ts`
- Modificar: `src/types.ts`

**Interfaces:**
- `DetractorDate` passa a conter `deduction: number` e `station?: string`.
- `EntityScore` deixa de expor `slow_items` e `slow_item_deduction`.
- `PerformanceResponse` passa a descrever `current`, `averages`, `history`, `detractor_dates` e `weights`.

- [ ] **Passo 1: Remover o detrator de item lento**

Excluir de `buildDetractors` o bloco que lê `score.slow_items`; manter apenas SLA, cancelamentos e zerados, ordenados por `deduction` decrescente.

- [ ] **Passo 2: Atualizar as ocorrências de cozinha**

Alterar a consulta de SLA para selecionar `ready_at`, `created_at`, `sla_minutes`, `sla_breach_minutes_cozinha` e `ks.name AS station`. Calcular `deduction` com a curva, exibir o detalhe como `Excedeu em X min (F× SLA)` com uma casa no fator e manter a data no formato atual. Para cancelamento e zerado, selecionar `ks.name`, atribuir respectivamente `weights.cancellation_cozinha` e `0` e incluir `station`.

Para formatar o fator no texto sem mudar o contrato numérico, usar uma função local simples:

```ts
function formatFactor(factor: number): string {
  return factor.toFixed(1).replace('.', ',');
}
```

- [ ] **Passo 3: Atualizar as ocorrências do salão**

Obter tolerância no serviço, selecionar `retrieved_at` e `ready_at` na consulta de SLA, calcular a curva usando a tolerância, incluir `deduction` e `station: 'Salão'`. Cancelamentos usam `weights.cancellation_salao`; zerados usam `weights.stockout_salao`. Remover integralmente as consultas e linhas de `Item lento`.

- [ ] **Passo 4: Preservar a agregação de `cozinha_geral`**

Continuar chamando as três entidades de cozinha e concatenando os resultados. Cada ocorrência individual já deve carregar o nome da estação, de modo que a entidade geral não invente nem perca esse campo.

- [ ] **Passo 5: Rodar o typecheck novamente**

Executar `npx tsc --noEmit` e corrigir somente erros causados pelas mudanças deste plano.

### Tarefa 4: Entregar o contrato novo de analytics

**Arquivos:**
- Modificar: `src/routes/analytics.ts`

**Interfaces:**
- `GET /api/v1/analytics/performance` continua aceitando exatamente `{ range?, from?, to?, station_id? }`.
- A resposta adiciona `weights`, expõe deduções reais em `averages`, não expõe `slow_*` em `current` nem em `averages`, e cada ocorrência vem de `getDetractorDates`.

- [ ] **Passo 1: Importar `getWeights` sem duplicar regra**

Exportar `getWeights` do serviço, se necessário, e importá-la no handler. Não copiar defaults nem SQL de pesos para `analytics.ts`.

- [ ] **Passo 2: Remover os campos lentos de `current`**

Ao montar cada entidade, manter `entity`, notas, totais, contagens, deduções e `detractors`; remover `slow_items` e `slow_item_deduction`.

- [ ] **Passo 3: Corrigir `averages`**

Alterar a consulta para somar `sla_breach_deduction`, `cancellation_deduction` e `stockout_deduction`, removendo `SUM(slow_items)`. Montar cada média com os três valores numéricos convertidos e `detractors: buildDetractors(...)`. Como `buildDetractors` recebe o espelho da linha, manter um objeto local com os campos necessários e `slow_items: 0` apenas internamente se o tipo do banco exigir, sem enviar esse campo na resposta.

- [ ] **Passo 4: Retornar pesos junto do contrato**

Alterar o retorno final para:

```ts
return {
  current,
  history,
  averages,
  detractor_dates: detractorDates,
  weights: await getWeights(),
};
```

Preservar validações de datas, `ensureScoresForDate`, histórico, `station_id` sem filtro e tratamento de erros.

- [ ] **Passo 5: Rodar typecheck e revisar o diff do arquivo**

Executar `npx tsc --noEmit` e confirmar que a alteração em `analytics.ts` está restrita ao handler `/performance`.

### Tarefa 5: Atualizar tipos e endpoints de pesos do administrador

**Arquivos:**
- Modificar: `src/routes/admin.ts`
- Modificar: `src/views/admin.html`
- Modificar: `src/types.ts`

**Interfaces:**
- GET e PUT `/api/v1/admin/settings/weights` usam `{ cancellation_cozinha, cancellation_salao, stockout_salao, sla_min, sla_max }`.
- O PUT rejeita valores ausentes, não numéricos, infinitos, menores que zero, maiores que cinco ou com mínimo maior que máximo; persiste arredondado a duas casas.

- [ ] **Passo 1: Alterar o GET de pesos**

Consultar as cinco chaves novas ou reutilizar uma função compartilhada do serviço e devolver somente os cinco campos novos com defaults. Não devolver os nomes legados.

- [ ] **Passo 2: Validar e sanitizar o PUT**

Ler as cinco propriedades do body, validar `typeof value === 'number'`, `Number.isFinite(value)`, `value >= 0`, `value <= 5` e `sla_min <= sla_max`. Para entrada inválida, retornar `reply.code(400).send({ error: 'Valores inválidos: confira mínimo ≤ máximo e limites 0–5' })`. Para cada valor válido, usar `Math.round(value * 100) / 100` antes do upsert.

- [ ] **Passo 3: Persistir apenas as cinco chaves novas e apagar as legadas**

Fazer upsert de:

```ts
score_weight_cancellation_cozinha
score_weight_cancellation_salao
score_weight_stockout_salao
score_weight_sla_min
score_weight_sla_max
```

Depois executar `DELETE FROM system_settings WHERE key IN ('score_weight_sla_breach','score_weight_cancellation','score_weight_slow_item')`. Manter exatamente o recálculo retroativo em background e a mensagem de retorno existente.

- [ ] **Passo 4: Atualizar o painel admin em ES5**

No `#panel-weights`, trocar os quatro inputs por `weightCancellationCozinha`, `weightCancellationSalao`, `weightStockoutSalao`, `weightSlaMin` e `weightSlaMax`. Atualizar o texto para explicar que SLA usa curva com mínimo/máximo e teto fixo em 2,5×; zerado da cozinha é informativo. Manter as classes, o painel e o botão existentes.

- [ ] **Passo 5: Atualizar `loadWeights` e `saveWeights`**

Preencher e enviar os cinco campos novos. Preservar `api`, toast, método PUT e recálculo em background. Erros devem continuar visíveis via toast e `console.error` quando aplicável.

- [ ] **Passo 6: Rodar typecheck**

Executar `npx tsc --noEmit`.

### Tarefa 6: Atualizar o detalhamento e o modal do dashboard

**Arquivos:**
- Modificar: `src/views/dashboard.html`

**Interfaces:**
- `renderPerfDetractors(perf, detractorDates)` consome `perf.averages` quando existir e usa os `detractors` do backend sem construir deduções.
- `populateCriteriaModal(weights)` preenche o modal somente com os pesos recebidos da API.

- [ ] **Passo 1: Substituir o conteúdo fixo do modal**

Trocar o `tbody` e os textos estáticos do `#criteriaModal` por contêineres identificáveis, mantendo o título, o botão Fechar e a estrutura geral do modal. O conteúdo inicial pode informar `Carregando critérios...`, mas não pode exibir pesos hardcoded.

- [ ] **Passo 2: Implementar `populateCriteriaModal(weights)`**

Montar via concatenação ES5:

- nota base `5.0`;
- SLA da cozinha e do salão: `sla_min` a `sla_max`, teto `2,5× SLA`;
- cancelamento cozinha/salão e zerado salão com seus valores reais;
- zerado cozinha como informativo, sem desconto;
- exemplo calculado com os pesos recebidos, como SLA de 20 minutos e preparo de 44 minutos, mostrando fator `2,2` e dedução arredondada;
- escala `≥4,5 Ótimo`, `≥3,5 Bom`, `≥2,5 Regular`, `<2,5 Ruim`.

Se `weights` não existir ou tiver campo não numérico, renderizar `Não foi possível carregar os pesos da API.` e não usar fallback numérico.

- [ ] **Passo 3: Ajustar `renderPerfDetractors`**

Usar `perf.averages` quando houver chaves; caso contrário, `perf.current`. Para cada entidade existente na fonte, gerar painel mesmo com lista vazia. Com zero detratores, exibir `Sem ocorrências registradas.`. Em ocorrências, adicionar as colunas `Dedução` e `Estação`, formatar dedução como `−0,00`/`-0.00` seguindo o estilo numérico atual e exibir `occ.station || ''`.

Adicionar botão `Fechar`/`✕` em cada painel que esconda o painel e remova `.selected` dos cards. Manter as classes existentes e não alterar CSS, grid, navegação ou outras funções.

- [ ] **Passo 4: Ajustar `loadPerformance` sem fabricar dados**

Remover completamente `detractorSource`, `Math.min`, `count * 0.5` e a referência a `slow_items`. Guardar `perf.weights` em variável de escopo do script, chamar `renderPerfDetractors(perf, perf.detractor_dates)` e chamar `populateCriteriaModal(perf.weights)` após a resposta, preferencialmente antes de montar o HTML.

No click handler de `#btnCriteria`, chamar `populateCriteriaModal(window._perfWeights)` antes de abrir o modal. Se a resposta falhar, manter o aviso de erro e não deixar o loading indefinidamente ativo.

- [ ] **Passo 5: Não alterar o filtro nem o restante do dashboard**

Manter `filterForPerf`, `filterToParams`, `getFilterLabel`, `getDaySpan`, `getExportDates`, `createPerfTrendChart`, `renderScoreCards`, `scoreClass`, `perfStars`, CSS e estrutura de navegação sem mudanças.

### Tarefa 7: Corrigir os dados das exportações sem refatorá-las

**Arquivos:**
- Modificar: `src/views/dashboard.html`

- [ ] **Passo 1: Corrigir `exportPerformanceHtml`**

Usar `item.detractors` diretamente, remover o fallback que calcula `Math.min(2.5, count * 0.5)`, remover `Itens lentos` e manter cards, barras, detalhes e gráfico existentes.

- [ ] **Passo 2: Corrigir `appendPerformanceExcel`**

Na aba `Notas Performance`, remover somente a propriedade `'Itens lentos'`. Manter o mesmo nome da aba, ordem das outras colunas, aba `Detratores` e fluxo PDF/Excel.

- [ ] **Passo 3: Fazer uma busca de regressão textual**

Executar buscas no dashboard para confirmar ausência de `Math.min(2.5`, `Itens lentos`, `slow_items` e `sourceOverride` nas funções alteradas. Não remover ocorrências fora do escopo se existirem em outras partes não relacionadas.

### Tarefa 8: Verificar integração, UI e guardrails

**Arquivos:**
- Criar temporariamente, se necessário: `scripts/verify-performance-api.ts`, scripts Playwright em `outputs/` seguindo o padrão existente
- Remover scripts temporários após uso, mantendo somente screenshots/logs de evidência em `outputs/`

- [ ] **Passo 1: Rodar typecheck e build completos**

Executar em sequência:

```bash
npx tsc --noEmit
npm run build
```

Ambos devem terminar com código zero. O build deve copiar as views alteradas para `dist/views`.

- [ ] **Passo 2: Verificar a fórmula novamente**

Recriar o script temporário da Tarefa 1, executar `npx ts-node --transpile-only scripts/verify-performance-scoring.ts`, registrar a saída e remover o arquivo depois.

- [ ] **Passo 3: Subir o servidor dev de forma persistente**

Se a porta 3000 estiver livre, usar `Start-Process cmd -ArgumentList "/c npm run dev" -WindowStyle Minimized`. Se estiver ocupada por instância antiga, identificar e encerrar somente o PID da instância antiga antes de iniciar. Não modificar dados fora do fluxo de verificação.

- [ ] **Passo 4: Verificar o contrato HTTP**

Consultar `GET /api/v1/analytics/performance?range=week` e conferir que a resposta contém `weights`, deduções em `averages`, `detractor_dates[*].deduction`, `detractor_dates[*].station` e nenhum `slow_items` no shape enviado. Consultar GET de pesos e fazer PUT inválido com `sla_min > sla_max`; esperar 400. Fazer PUT válido somente se houver autorização operacional para alterar os pesos do ambiente, restaurando os valores originais depois se necessário.

- [ ] **Passo 5: Verificar a UI com webwright/Playwright**

No dashboard, conferir cards, painel de entidade sem detratores, botão de fechar, colunas `Dedução`/`Estação`, modal com pesos da API e escala correta. No modo semanal, comparar barras com `averages`. No admin, conferir cinco inputs, carregamento e validação. Nas exportações, conferir ausência de valores sintéticos e da coluna `Itens lentos`. Salvar screenshots e log em `outputs/` sem adicionar arquivos de código ao commit.

- [ ] **Passo 6: Auditar guardrails no diff**

Executar:

```bash
git diff -- src/middleware/auth.ts src/routes/auth.ts src/server.ts src/services/sla.service.ts src/routes/demands.ts supabase
git diff --stat
git status --short
```

O primeiro diff deve ser vazio. Os únicos arquivos de produção modificados devem ser `src/services/performance.service.ts`, `src/routes/analytics.ts`, `src/routes/admin.ts`, `src/types.ts`, `src/views/admin.html` e as funções permitidas de `src/views/dashboard.html`, além do plano.

- [ ] **Passo 7: Confirmar ausência de commit**

Verificar que nenhuma operação `git add`, `git commit`, `git push` ou alteração de configuração do git foi executada. Informar ao usuário o estado do working tree, os comandos verificados e qualquer integração que não tenha sido possível por indisponibilidade do banco/servidor.

## Checklist de Cobertura da Especificação

- [x] Cinco pesos simples, defaults e remoção das três chaves legadas.
- [x] Curva dinâmica com arredondamento em duas casas e teto fixo de 2,5×.
- [x] Remoção dos critérios de preparo/retirada lenta.
- [x] Média de período com deduções reais somadas, sem valores sintéticos.
- [x] Modal alimentado por `weights` da API.
- [x] Detalhamento para todas as entidades, com dedução, estação e fechamento.
- [x] Exportações corrigidas sem refatoração estrutural.
- [x] Recálculo retroativo mantido no PUT.
- [x] Auth, layout geral, filtros, sockets, SLA service, demands e schema fora do diff.
- [x] Typecheck, build, fórmula, contrato HTTP e UI previstos.
