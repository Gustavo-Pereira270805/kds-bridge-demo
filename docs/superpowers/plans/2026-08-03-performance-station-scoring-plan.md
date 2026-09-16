# Plano de Implementação das Notas de Performance das Estações

> **Para agentes de implementação:** use `subagent-driven-development` ou `executing-plans` para executar este plano tarefa por tarefa. Mantenha os passos com checkbox atualizados.

**Objetivo:** unificar o cálculo de notas diárias e de períodos, preservar a vigência dos pesos e alinhar dashboard, detalhamento, PDF e Excel ao mesmo contrato de performance.

**Arquitetura:** o serviço de performance será a única fonte para pesos, critérios, descontos, bases elegíveis e ocorrências. A API montará respostas diárias e de período usando esse serviço; o frontend apenas renderizará os valores recebidos, sem recalcular penalidades. A persistência manterá versões de pesos e snapshot da versão usada em cada score.

**Tecnologias:** TypeScript strict, Fastify, PostgreSQL/Supabase, HTML/CSS/JavaScript vanilla, Chart.js, jsPDF, SheetJS.

## Restrições globais

- Todo código, texto de interface, erro, comentário e documentação nova deve estar em pt-BR.
- Todas as queries devem usar placeholders `$1`, `$2`, etc.
- Alterações de schema devem existir em uma migration SQL versionada e também no patch inline de `seedDatabase()`.
- O dashboard deve usar exatamente `from` e `to` para períodos personalizados de 1 a 31 dias.
- Demandas abertas entram no total, mas não em bases que exigem timestamps ausentes.
- Pesos históricos não são recalculados após mudança de configuração.
- O zerado da cozinha é informativo e não reduz a nota da estação.
- Retirada lenta penaliza somente o salão.

## Mapa de arquivos

- Criar: `supabase/migrations/<timestamp>_performance_score_versions.sql` para versões de pesos e campos de auditoria.
- Modificar: `src/server.ts` para aplicar o patch de schema em bancos existentes.
- Modificar: `src/types.ts` para o contrato de critérios, ocorrências, pesos e respostas de período.
- Modificar: `src/services/performance.service.ts` para pesos vigentes, snapshot, cálculo diário, período e detratores.
- Modificar: `src/routes/admin.ts` para leitura/alteração dos pesos separados e histórico de vigência.
- Modificar: `src/routes/analytics.ts` para o endpoint exato de performance.
- Modificar: `src/views/admin.html` para editar os sete pesos e explicar vigência histórica.
- Modificar: `src/views/dashboard.html` para cartões duplos, bases, detratores reais, detalhes e exportações.
- Criar: `test-playwright.py` ou script temporário equivalente somente se necessário para validação visual, sem introduzir framework de testes.

## Tarefa 1: Persistência e tipos do domínio

**Arquivos:**
- Criar migration SQL de versões de pesos.
- Modificar `src/server.ts` no patch de schema.
- Modificar `src/types.ts`.

**Interfaces produzidas:**
- `PerformanceWeights` com os sete pesos configuráveis.
- `PerformanceWeightVersion` com `id`, pesos, `valid_from`, `valid_to`.
- `PerformanceCriterionSummary` com `count`, `eligible_base`, `rate`, `weight`, `deduction`.
- `PerformanceOccurrence` com entidade, estação, tipo, data, demanda, produto, detalhe, peso e desconto.
- `EntityPerformance` com nota operacional, média diária, totais, critérios, ocorrências e snapshot de pesos.
- `PerformanceResponse` com `current`, `history`, `averages`, `operational` e vigência aplicável.

- [ ] Criar tabela `performance_weight_versions` com UUID, sete colunas numéricas, `valid_from`, `valid_to`, timestamps e constraint para no máximo uma versão aberta.
- [ ] Adicionar `weight_version_id` em `performance_scores` com foreign key para a versão usada.
- [ ] Criar índice para `performance_weight_versions(valid_from, valid_to)` e para `performance_scores(date, entity)`.
- [ ] Espelhar o schema no patch idempotente de `seedDatabase()` sem apagar dados existentes.
- [ ] Atualizar tipos compartilhados sem deixar propriedades obrigatórias incompatíveis com consumidores legados durante a transição.
- [ ] Verificar a migration com `npx tsc --noEmit` e inspeção SQL.

## Tarefa 2: Serviço de pesos vigentes e cálculo diário

**Arquivos:**
- Modificar `src/services/performance.service.ts`.
- Modificar `src/routes/admin.ts` nos endpoints de pesos.

**Interfaces produzidas:**
- `getWeightsForDate(dateStr): Promise<PerformanceWeights & { versionId: string }>`.
- `computeDailyScores(dateStr): Promise<void>` usando a versão vigente da data.
- `buildCriterionSummaries(score): PerformanceCriterionSummary[]`.
- `buildDetractorOccurrences(entity, from, to): Promise<PerformanceOccurrence[]>`.

- [ ] Criar valores padrão dos sete pesos e uma função idempotente que garanta uma versão inicial aberta quando não existir nenhuma.
- [ ] Alterar `computeDailyScores` para buscar pesos por data, separar cancelamento de salão e cozinha e aplicar retirada lenta somente no salão.
- [ ] Manter zerados da cozinha no contador, com peso e desconto zero.
- [ ] Guardar `weight_version_id` no upsert diário.
- [ ] Calcular bases elegíveis: total de demandas, demandas com SLA aplicável, demandas com timestamps de preparo e demandas prontas com retirada elegível.
- [ ] Garantir que demandas abertas permaneçam no total, sem serem classificadas como lentas sem timestamps.
- [ ] Alterar a agregação de Cozinha Geral para produzir a nota operacional agregada e preservar a média simples das três estações.
- [ ] Fazer ocorrências da Cozinha Geral incluírem a estação de origem.
- [ ] Substituir a lista antiga de detratores por resumos derivados do score, sem regras duplicadas no frontend.
- [ ] Alterar o PUT administrativo para fechar a versão atual, criar nova versão com os sete pesos e não recalcular scores históricos.
- [ ] Validar limites: pesos finitos e não negativos; rejeitar payload inválido com HTTP 400.
- [ ] Rodar `npx tsc --noEmit`.

## Tarefa 3: Agregação exata de períodos na API

**Arquivos:**
- Modificar `src/routes/analytics.ts`.
- Modificar `src/services/performance.service.ts` se a agregação precisar sair da rota.

**Interfaces consumidas:**
- Funções de pesos, scores e ocorrências da Tarefa 2.

**Interfaces produzidas:**
- `GET /api/v1/analytics/performance?from=YYYY-MM-DD&to=YYYY-MM-DD`.

- [ ] Validar datas ISO, `from <= to` e intervalo máximo de 31 dias.
- [ ] Manter atalhos `range=week|month` apenas como conversão para datas exatas antes da consulta.
- [ ] Garantir scores existentes para cada data do intervalo sem recalcular datas históricas já consolidadas com versão válida.
- [ ] Retornar nota operacional calculada sobre todos os eventos do período.
- [ ] Retornar média simples das notas diárias e série histórica completa.
- [ ] Retornar contagens, bases elegíveis, taxas, descontos, pesos e ocorrências reais.
- [ ] Retornar vigência ou conjunto de versões usado no intervalo quando houver mais de uma versão.
- [ ] Remover qualquer fórmula de fallback com peso fixo ou multiplicador inventado.
- [ ] Testar manualmente dia único, intervalo de três dias e intervalo de 31 dias com resposta HTTP 200.

## Tarefa 4: Painel administrativo de pesos e histórico

**Arquivos:**
- Modificar `src/views/admin.html`.
- Modificar `src/routes/admin.ts`.

- [ ] Trocar o formulário atual por sete campos nomeados conforme os critérios reais.
- [ ] Indicar que alterações valem para novas apurações e não alteram notas históricas.
- [ ] Exibir a vigência atual e histórico de versões com data inicial, data final e valores.
- [ ] Mostrar validação de números negativos, vazios e não finitos.
- [ ] Exibir feedback de sucesso e erro sem esconder falhas de API.
- [ ] Confirmar que a leitura do formulário usa os sete valores retornados pela API.
- [ ] Testar alteração de pesos e verificar criação de nova versão no banco.

## Tarefa 5: Dashboard de performance e detalhamento

**Arquivos:**
- Modificar `src/views/dashboard.html`.

- [ ] Fazer `loadPerformance` enviar `from` e `to` exatos do filtro atual.
- [ ] Ajustar cartões para mostrar separadamente nota operacional, média diária, demandas totais e versão/vigência dos pesos.
- [ ] Diferenciar visualmente Cozinha Geral operacional e média das estações.
- [ ] Renderizar resumos de critérios vindos da API com ocorrência, base, taxa, peso e desconto real.
- [ ] Remover a reconstrução frontend que usa `0.5` e `Math.min(2.5, ...)`.
- [ ] Exibir nomes distintos para preparo lento, retirada lenta e zerado informativo.
- [ ] Exibir estação de origem em ocorrências da Cozinha Geral.
- [ ] Exibir demandas abertas e bases elegíveis no detalhamento.
- [ ] Corrigir mensagens e modal de critérios para refletir pesos separados e zerado da cozinha sem desconto.
- [ ] Renderizar estado vazio, erro de API e período sem ocorrências de forma explícita.
- [ ] Validar visualmente dia, período manual, semana, mês e seleção de cada estação.

## Tarefa 6: PDF e Excel pelo contrato único

**Arquivos:**
- Modificar `src/views/dashboard.html` nas funções `exportPerformanceHtml`, `exportExcel` e auxiliares.

- [ ] Fazer exportações usarem o mesmo objeto de performance carregado para o período exato.
- [ ] Remover qualquer reconstrução de desconto no PDF ou Excel.
- [ ] Incluir nota operacional e média diária em cada estação.
- [ ] Incluir tabelas de critérios com contagem, base, taxa, peso e desconto.
- [ ] Incluir ocorrências individuais com estação de origem, data, produto, detalhe e desconto.
- [ ] Incluir vigência das versões de pesos aplicáveis.
- [ ] Manter exportação diária usando a nota específica do dia e a versão vigente daquele dia.
- [ ] Gerar PDF consolidado, PDF diário, Excel consolidado e Excel diário em navegador real.

## Tarefa 7: Verificação final

**Arquivos:**
- Nenhum arquivo novo obrigatório; usar código e scripts de validação existentes.

- [ ] Executar `npx tsc --noEmit`.
- [ ] Executar `npm run build`.
- [ ] Executar `git diff --check`.
- [ ] Iniciar servidor de desenvolvimento de forma persistente conforme `AGENTS.md`.
- [ ] Validar endpoint com filtros exatos e comparar nota operacional versus média diária.
- [ ] Validar alteração de pesos sem alteração de scores históricos existentes.
- [ ] Validar ocorrência de retirada lenta apenas no salão.
- [ ] Validar zerado da cozinha como informativo e sem desconto.
- [ ] Validar Cozinha Geral com estação de origem nas ocorrências.
- [ ] Capturar PDFs reais e verificar tamanho, conteúdo e ausência de erros JavaScript.
- [ ] Gerar Excel real e conferir abas e colunas.
- [ ] Revisar `git diff` e separar alterações do trabalho atual de arquivos não relacionados.
