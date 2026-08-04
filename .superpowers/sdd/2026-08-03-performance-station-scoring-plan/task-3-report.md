# Relatório da Tarefa 3

## Implementação

- O endpoint `GET /api/v1/analytics/performance` agora aceita `from` e `to` exatos em `YYYY-MM-DD`.
- `range=week|month` é convertido para datas exatas antes das consultas.
- Datas inválidas, ordem invertida e períodos acima de 31 dias retornam HTTP 400.
- Scores diários existentes com `weight_version_id` válido são preservados; somente datas sem o conjunto completo de scores versionados são garantidas pelo serviço.
- A resposta mantém `current`, `history`, `averages` e `detractor_dates` como aliases compatíveis e adiciona `operational`, `date_from`, `date_to` e `weight_versions`.
- A nota operacional usa a soma dos descontos das ocorrências reais do período. A média simples das notas diárias permanece separada em `daily_average_score`.
- O detalhamento agora expõe `total_demands`, `open_demands`, `total_deduction`, bases elegíveis, descontos, ocorrências e pesos por versão quando necessário.
- Erros de banco continuam como HTTP 500 e são registrados; falhas de ocorrências não são convertidas em listas vazias.
- Nenhuma alteração foi feita no dashboard.
- `EntityPerformance` agora preserva `weight_versions` por entidade; critérios multi-versão expõem `weights` agrupados por `weight_version_id` e `multi_version`.
- A rota usa a agregação oficial do serviço para `operational_score` e `daily_average_score`; aliases `averages` agregam todos os contadores e descontos do intervalo.
- Scores diários só são preservados quando as cinco entidades têm `weight_version_id` igual à versão aplicável à data.
- Versões são carregadas uma vez por intervalo e reutilizadas no enriquecimento das ocorrências, sem consulta individual por ocorrência.

## Validação

| Cenário | Resultado |
| --- | --- |
| `from=2026-08-01&to=2026-08-01` | HTTP 500 no ambiente de teste: não havia versão de pesos vigente para a data. O erro foi preservado e registrado. |
| Intervalo manual de 3 dias | HTTP 500 pelo mesmo motivo de vigência ausente. |
| Intervalo de 31 dias | HTTP 500 pelo mesmo motivo de vigência ausente. |
| Data inválida `2026-02-30` | HTTP 400. |
| `from > to` | HTTP 400. |
| Intervalo acima de 31 dias | HTTP 400. |
| Dia atual, com versão vigente | HTTP 200, 5 entidades em `operational` e 1 versão em `weight_versions`. |
| `npx tsc --noEmit` | Passou. |
| `npm run build` | Passou. |
| `git diff --check` | Passou, com avisos de normalização LF/CRLF do Git. |
| Data inválida via HTTP | HTTP 400. |
| `from > to` via HTTP | HTTP 400. |
| Período acima de 31 dias via HTTP | HTTP 400. |
| Dia único sem versão histórica disponível | HTTP 500, com erro preservado e registrado. |

## Preocupações

- O banco de teste não possui versão de pesos para datas históricas usadas nos cenários manuais; por isso não foi possível validar respostas 200 de 3 e 31 dias nem um período com múltiplas versões ponta a ponta.
- A resposta multi-versão foi coberta no contrato, preservação global/por entidade e montagem de `weights` por critério; falta uma massa histórica com duas versões para validação HTTP 200.
- O servidor já apresentava problemas independentes desta tarefa em logs de schema de `theme`; eles não foram alterados por escopo.
