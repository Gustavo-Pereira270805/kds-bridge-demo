# Correções finais de performance

- Pesos administrativos exigem usuário autenticado com papel `admin` ou `gerente`, lido dos claims reais `app_metadata.role`, `user_metadata.role` ou `role` do usuário Supabase.
- Snapshots legados são associados por data, entidade e estação; `cozinha_geral` não invalida ocorrências versionadas de estações diferentes.
- Bases sem denominador defensável retornam `null` com `eligible_base_status`; `stockout_cozinha` não usa `total_demands` sintético.
- Pesos possuem constraints idempotentes `>= 0 AND <= 5` na migration e no seed inline.
- Datas operacionais usam UTC explicitamente via `DATA_OPERACIONAL_SQL` e helpers de data.
- `cozinha_geral` só é persistida e exibida quando as três estações estão presentes.
- Erros HTTP 500 retornam mensagens fixas em pt-BR e detalhes ficam somente no log.
