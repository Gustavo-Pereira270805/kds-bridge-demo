# Relatório da Tarefa 6

## Escopo

Foi alterado somente o fluxo de exportação em `src/views/dashboard.html`. As mudanças pré-existentes da árvore de trabalho não foram modificadas.

## Implementação

- PDF e Excel consultam `/api/v1/analytics/performance` com `from` e `to` exatos no momento da exportação.
- O relatório usa exclusivamente `performance.operational`, sem reconstruir descontos ou pesos no navegador.
- PDF e Excel incluem resumo operacional, nota, média diária, demandas, critérios com contagem, base elegível, taxa, peso/desconto, vigências dos pesos e ocorrências reais.
- A exportação por dia consulta dashboard e performance para cada data, usando a nota e as versões aplicáveis daquele dia.
- Falhas de performance ou de dados interrompem a exportação e exibem erro explícito; nenhum arquivo parcial é salvo.
- Textos provenientes da API usados no HTML temporário são escapados com `escapePerfHtml`.

## Validações

- `npx tsc --noEmit`: passou, código de saída 0.
- `npm run build`: passou, código de saída 0.
- `git diff --check`: passou; apenas aviso normal de conversão LF/CRLF do Git.
- Exportações com servidor real: registrar disponibilidade e resultado abaixo.

## Resultado

As quatro exportações com servidor real não foram executadas nesta sessão. O ambiente não foi iniciado para evitar interferir nos processos e alterações pré-existentes do workspace.
