# Correções finais de performance

- Pesos administrativos exigem usuário autenticado com papel `admin` ou `gerente`, lido exclusivamente do claim confiável `app_metadata.role` do usuário Supabase; `user_metadata.role` e `role` top-level não concedem privilégio.
- Snapshots legados são associados por data, entidade e estação; `cozinha_geral` não invalida ocorrências versionadas de estações diferentes.
- Bases sem denominador defensável retornam `null` com `eligible_base_status`; `stockout_cozinha` não usa `total_demands` sintético.
- Denominadores de SLA excluem demandas abertas sem timestamps aplicáveis: cozinha exige `sla_minutes` e `ready_at`; salão exige `ready_at` e `retrieved_at`. `total_demands` mantém todas as demandas não anuladas, inclusive `pending`.
- Pesos possuem constraints idempotentes `>= 0 AND <= 5` na migration e no seed inline.
- Datas operacionais usam UTC explicitamente via `DATA_OPERACIONAL_SQL` e helpers de data.
- `cozinha_geral` só é persistida e exibida quando as três estações estão presentes.
- Erros HTTP 500 retornam mensagens fixas em pt-BR e detalhes ficam somente no log.

## Achados restantes corrigidos

- Dashboard, analytics e performance usam UTC em conversões, agrupamentos por hora, weekday e comparativos; filtros relativos preservam janelas móveis de 24 horas.
- Cálculos relativos inline do dashboard (today, yesterday, week, month e datas de performance/exportação) usam o helper `addUtcDays`, sem aritmética local com `setDate()`.
- Parsing de datas de calendário do dashboard (filtros, validação customizada e exportações) usa `T00:00:00Z`, preservando timestamps que já informam o fuso.
- A validação `task6RequireNumber` diferencia campo ausente (`undefined`) de campo explicitamente nulo (`null`), aceitando `null` somente quando o contrato permite.
- `scripts/verificar-performance-final.ts` cobre a distinção de nulidade, verifica os cinco endpoints relativos e testa bordas de janela UTC sem abrir conexão com o banco.
- As janelas relativas são inclusivas: `week` = 7 dias (`to - 6`), `month` = 30 dias (`to - 29`); intervalos customizados usam `from/to` exatos e rejeitam mais de 31 dias inclusivos.
- O contrato de desconto legado usa `null` quando qualquer componente não possui snapshot; dashboard, PDF e Excel exibem `Indisponível` sem recalcular a nota histórica.
- O endpoint de dashboard registra o erro detalhado apenas no log e responde mensagem fixa em pt-BR; pesos aceitam somente valores numéricos entre 0 e 5.
- A vigência dos pesos é definida pela data civil UTC de `valid_from`; `valid_to` é exclusivo. A alteração vale a partir da data operacional UTC correspondente.
- O histórico de performance contém todas as datas solicitadas, usando `null` para score ausente ou consolidação incompleta; `current` da Cozinha Geral só usa uma data com as três estações.
- As médias operacionais de cozinha, retirada e indicadores diários usam a mesma população do SLA: exigem os timestamps aplicáveis e excluem demandas canceladas e anuladas.

## Verificações

- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`
- `npx ts-node --transpile-only scripts/verificar-performance-final.ts`
