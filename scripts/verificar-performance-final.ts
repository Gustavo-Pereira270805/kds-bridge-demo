import assert from 'node:assert/strict';
import { buildCriterionSummaries, calcularNotasCozinhaGeral, aggregateScoreAlias } from '../src/services/performance.service';
import { PerformanceScoreRow } from '../src/types';

const incomplete = calcularNotasCozinhaGeral([
  { entity: 'cozinha_quente_a', total: 2, deduction: 1 },
]);
assert.equal(incomplete.operational_score, null);
assert.equal(incomplete.total_demands, null);

const criteria = buildCriterionSummaries({
  total_demands: 10,
  sla_breaches: 1,
  sla_breach_deduction: 0.15,
  cancellations: 1,
  cancellation_deduction: 0.3,
  stockouts: 2,
  stockout_deduction: 0,
  slow_items: 1,
  slow_item_deduction: 0.1,
} as PerformanceScoreRow, {
  sla_breach_cozinha: 0.15, sla_breach_salao: 0.15,
  cancellation_cozinha: 0.3, cancellation_salao: 0.3,
  stockout_salao: 0.1, slow_item_cozinha: 0.1, slow_pickup_salao: 0.1,
}, true, { stockout_cozinha: null }, { stockout_cozinha: 'indisponivel_sem_denominador' });
const stockout = criteria.find(item => item.criterion === 'stockout_cozinha');
assert.equal(stockout?.eligible_base, null);
assert.equal(stockout?.eligible_base_status, 'indisponivel_sem_denominador');
assert.equal(stockout?.rate, null);

const partialAlias = aggregateScoreAlias('cozinha_geral', [
  { entity: 'cozinha_geral', final_score: 4, base_score: 5, total_demands: 2,
    sla_breaches: 1, sla_breach_deduction: 1, cancellations: 0, cancellation_deduction: 0,
    stockouts: 0, stockout_deduction: 0, slow_items: 0, slow_item_deduction: 0 } as PerformanceScoreRow,
]);
assert.equal(partialAlias.final_score, 5);
assert.equal(partialAlias.total_demands, 0);

console.log('Verificações isoladas de performance: OK');
