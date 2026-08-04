# Relatório da Tarefa 5

## Status

Implementação concluída em `src/views/dashboard.html`.

## Alterações

- A seção de performance chama `GET /api/v1/analytics/performance` com `from` e `to` exatos, convertendo atalhos para datas antes da chamada.
- Os cartões exibem nota operacional, média diária e demandas do período separadamente.
- Cozinha Geral usa a nota operacional agregada e mostra a média diária simples das estações recebida pela API.
- Critérios usam `count`, `eligible_base`, `rate`, `deduction` e pesos por versão; não há reconstrução de descontos no frontend.
- Ocorrências usam `operational[entidade].occurrences`, com tipo, data, produto, detalhe, origem, peso, versão e desconto.
- Preparo lento, retirada lenta e zerado informativo têm rótulos distintos.
- Demandas abertas, bases elegíveis e desconto total aparecem no detalhamento por entidade.
- O modal foi atualizado para explicar pesos separados, vigência histórica e zerado da cozinha sem desconto.
- Estados de carregamento, vazio e erro HTTP são renderizados na seção de performance e os erros são registrados no console.
- Seleção dos cartões e gráfico histórico foram preservados.

## Validações

- `git diff --check`: passou, sem erros de whitespace.
- Busca estrutural no HTML: não encontrou `Math.min(2.5, ...)`, multiplicação fixa por `0.5` ou chamada de performance com `range`.
- Endpoint real, dia único: HTTP 500 com `Erro ao buscar performance: Não foi encontrada uma versão de pesos para a data`.
- Endpoint real, intervalo de dois dias: HTTP 500 com o mesmo erro de infraestrutura/dados.
- Página real `/dashboard`: HTTP 200.

## Preocupações

- Não foi possível validar um payload `operational` com Playwright porque o banco usado pelo servidor não possui versão de pesos para as datas consultadas. O dashboard agora exibe esse HTTP 500 em estado de erro, em vez de esconder a falha.
- Não foram alterados backend, admin ou exportações, conforme o escopo da tarefa. Alterações preexistentes no mesmo `dashboard.html` foram preservadas.
