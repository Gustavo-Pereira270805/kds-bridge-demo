# Relatório da Tarefa 1

## Arquivos alterados

- `supabase/migrations/2026-08-03-performance-score-versions.sql`
  - Criada a tabela `performance_weight_versions` com UUID, sete pesos, vigência e timestamps.
  - Criados índice de vigência, índice parcial para impedir mais de uma versão aberta e índice de consulta em `performance_scores(date, entity)`.
  - Adicionada a coluna nullable `performance_scores.weight_version_id` com chave estrangeira para a versão de pesos.
- `src/server.ts`
  - Espelhado o schema no patch transacional e idempotente de `seedDatabase()`, sem inserção ou remoção de dados de negócio.
- `src/types.ts`
  - Adicionados tipos de pesos, versão, entidade, resumo de critério, ocorrência e performance por entidade.
  - Mantida a compatibilidade com consumidores existentes: `weight_version_id` e os novos agrupamentos da resposta são opcionais.

## Decisões

- A chave estrangeira aceita `NULL` durante a transição. Scores antigos continuam válidos e scores futuros poderão receber o snapshot quando a Tarefa 2 alterar o serviço.
- A versão aberta é identificada por `valid_to IS NULL`; o índice único parcial rejeita uma segunda versão aberta no PostgreSQL.
- Os pesos foram definidos como `numeric NOT NULL`, sem valores padrão, para que a criação de uma versão exija explicitamente os sete valores.
- `ON DELETE SET NULL` preserva scores históricos caso uma versão seja removida administrativamente.
- Não foram alterados fórmula, serviço de performance, rotas, dashboard ou configurações legadas em `system_settings`.

## Testes executados

- `npx tsc --noEmit`

## Preocupações

- A migration e o patch usam `gen_random_uuid()`, função disponível no Supabase/PostgreSQL atual. Instalações PostgreSQL muito antigas sem `pgcrypto` precisarão habilitar essa extensão antes da aplicação.
- A criação do índice único parcial falhará se um banco já tiver mais de uma versão com `valid_to IS NULL`; a Tarefa 2 deverá garantir a criação/normalização da versão inicial antes de permitir novas versões.
- A coluna nullable deixa scores históricos sem versão até a implementação do snapshot na Tarefa 2, conforme previsto pela compatibilidade temporária.
