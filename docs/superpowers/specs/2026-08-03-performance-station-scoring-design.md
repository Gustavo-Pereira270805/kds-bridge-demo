# Revisão do Sistema de Notas de Performance das Estações

## Objetivo

Tornar o cálculo de performance consistente entre apuração diária, períodos, dashboard, detalhamento, PDF e Excel, preservando o histórico de pesos usado em cada apuração.

## Regras de negócio

### Nota diária

Cada entidade começa com nota 5,0. A nota final é o máximo entre zero e a nota base menos a soma das penalidades por ocorrência, arredondada para uma casa decimal ao final.

As penalidades são fixas por ocorrência e usam os pesos vigentes na data da demanda.

Critérios:

- Estouro de SLA da cozinha penaliza a estação da demanda.
- Estouro de SLA do salão penaliza o salão.
- Cancelamento pela cozinha penaliza a estação com peso próprio.
- Cancelamento pelo salão penaliza o salão com peso próprio.
- Zerado reportado pelo salão penaliza o salão.
- Zerado na cozinha é contabilizado, mas não reduz a nota da cozinha.
- Preparo lento penaliza a estação da cozinha.
- Retirada lenta penaliza somente o salão.

Demandas abertas entram no total de demandas. Não entram como elegíveis em critérios que dependem de timestamps ainda inexistentes.

### Pesos

Os pesos configuráveis são:

- `sla_breach_cozinha`
- `sla_breach_salao`
- `cancellation_cozinha`
- `cancellation_salao`
- `stockout_salao`
- `slow_item_cozinha`
- `slow_pickup_salao`

O painel avançado permite ajustar todos os valores. Cada alteração encerra a vigência anterior e cria uma nova versão com valores e início de vigência. Notas históricas não são recalculadas após alteração de pesos.

Cada score diário deve preservar a versão ou snapshot dos pesos usados na apuração.

### Períodos

Consultas de performance usam sempre datas exatas `from` e `to`, inclusive para filtros personalizados.

O retorno de cada entidade contém duas leituras:

- `operational_score`: nota recalculada sobre todos os eventos do período.
- `daily_average_score`: média simples das notas diárias existentes no período.

Também são retornados demandas totais, ocorrências, descontos, bases elegíveis, taxas, ocorrências individuais e histórico diário.

### Cozinha Geral

São exibidas duas consolidações:

- Nota operacional agregada de todas as demandas e eventos de Quente A, Quente B e Fria.
- Média simples das notas das três estações.

As ocorrências da Cozinha Geral preservam a estação de origem.

## Contrato de dados

O backend é a fonte única dos descontos, pesos, bases e detratores. Dashboard, PDF e Excel não recalculam pesos nem criam detratores sintéticos.

Cada detrator individual deve conter entidade, estação de origem, tipo, data, demanda, produto, detalhe, peso aplicado e desconto. O resumo por critério deve conter ocorrência, desconto, base elegível e taxa.

## Interface

Os cartões mostram explicitamente nota operacional, média diária e demandas do período. O detalhamento mostra resumos por critério e ocorrências reais. Preparo lento, retirada lenta e zerado informativo são exibidos com nomes distintos.

## Exportações

PDF e Excel usam o mesmo retorno do endpoint de performance e incluem notas operacional e diária, bases, taxas, descontos, detratores e vigência dos pesos aplicável ao intervalo.

## Validação

Validar fórmula diária, pesos separados, zerado da cozinha sem desconto, retirada lenta somente no salão, notas de período, consolidações da Cozinha Geral, vigência de pesos, demandas abertas, bases elegíveis, dashboard, PDF e Excel.
