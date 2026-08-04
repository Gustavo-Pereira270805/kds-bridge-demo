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
  - Adicionado o tipo `PerformanceAverage` para representar os objetos agregados retornados por `averages`.
  - Mantida a compatibilidade com consumidores existentes: `weight_version_id`, os novos agrupamentos e `detractor_dates` são opcionais.

## Decisões

- A chave estrangeira aceita `NULL` durante a transição. Scores antigos continuam válidos e scores futuros poderão receber o snapshot quando a Tarefa 2 alterar o serviço.
- A versão aberta é identificada por `valid_to IS NULL`; o índice único parcial rejeita uma segunda versão aberta no PostgreSQL.
- Os pesos foram definidos como `numeric NOT NULL`, sem valores padrão, para que a criação de uma versão exija explicitamente os sete valores.
- `ON DELETE SET NULL` preserva scores históricos caso uma versão seja removida administrativamente.
- A foreign key é procurada pelo nome e por `conrelid = 'performance_scores'::regclass`, evitando colisões de nomes em outras tabelas.
- `pgcrypto` é habilitado com `CREATE EXTENSION IF NOT EXISTS` antes da tabela, tornando `gen_random_uuid()` disponível de modo idempotente no Supabase e em PostgreSQL local com permissões de extensão.
- Não foram alterados fórmula, serviço de performance, rotas, dashboard ou configurações legadas em `system_settings`.

## Testes executados

- `npx tsc --noEmit`
- `npx tsc --noEmit` após as correções da revisão

## Preocupações

- A criação de `pgcrypto` depende de permissões para instalar extensões no PostgreSQL local; em ambientes sem essa permissão, o administrador deverá habilitar a extensão previamente.
- A criação do índice único parcial falhará se um banco já tiver mais de uma versão com `valid_to IS NULL`; a Tarefa 2 deverá garantir a criação/normalização da versão inicial antes de permitir novas versões.
- A coluna nullable deixa scores históricos sem versão até a implementação do snapshot na Tarefa 2, conforme previsto pela compatibilidade temporária.
