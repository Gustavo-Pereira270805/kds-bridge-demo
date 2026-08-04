import assert from 'node:assert/strict';
import { buildCriterionSummaries, calcularNotasCozinhaGeral, aggregateScoreAlias } from '../src/services/performance.service';
import { PerformanceScoreRow } from '../src/types';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
assert.equal(partialAlias.final_score, null);
assert.equal(partialAlias.total_demands, null);

const authSource = readFileSync(new URL('../src/middleware/auth.ts', import.meta.url), 'utf8');
assert.ok(!authSource.includes('user_metadata?.role'), 'user_metadata não pode conceder papel');
assert.ok(authSource.includes('app_metadata?.role'), 'app_metadata deve ser a fonte do papel');

const dashboardSource = readFileSync(new URL('../src/views/dashboard.html', import.meta.url), 'utf8');
assert.ok(dashboardSource.includes("item.operational_score === null ? 'Indisponível'"));
assert.ok(dashboardSource.includes("item.total_demands === null ? 'Indisponível'"));
assert.ok(dashboardSource.includes("c.eligible_base === null ? 'Indisponível'"));
assert.ok(dashboardSource.includes("c.rate === null ? 'Indisponível'"));
assert.ok(!dashboardSource.includes('Number(item.operational_score || 0)'));
assert.ok(!dashboardSource.includes('Number(item.total_demands || 0)'));

const performanceSource = readFileSync(new URL('../src/services/performance.service.ts', import.meta.url), 'utf8');
assert.ok(performanceSource.includes("weights_status = hasLegacySnapshot"));
assert.ok(performanceSource.includes("'indisponivel_snapshot_legado'"));

const dashboardSource = readFileSync(new URL('../src/views/dashboard.html', import.meta.url), 'utf8');
const requireNumberSource = dashboardSource.match(/function task6RequireNumber\([\s\S]*?\n    \}/)?.[0];
assert.ok(requireNumberSource, 'task6RequireNumber deve existir no dashboard');
const task6RequireNumber = vm.runInNewContext('(' + requireNumberSource + ')') as (value: unknown, path: string, allowNull?: boolean) => number | null;
assert.throws(() => task6RequireNumber(undefined, 'campo.obrigatorio'), /campo ausente/);
assert.throws(() => task6RequireNumber(null, 'campo.obrigatorio'), /campo nulo/);
assert.equal(task6RequireNumber(null, 'campo.nullable', true), null);
assert.equal(task6RequireNumber('2.5', 'campo.numero'), 2.5);

const analyticsSource = readFileSync(new URL('../src/routes/analytics.ts', import.meta.url), 'utf8');
assert.ok(analyticsSource.includes('DATA_OPERACIONAL_SQL'), 'analytics deve usar a data operacional comum');
assert.ok(!analyticsSource.includes("AT TIME ZONE 'America/Sao_Paulo'"), 'analytics não pode usar o fuso legado');
assert.ok(!/created_at\s*::date/.test(analyticsSource), 'analytics não pode usar created_at::date direto');
assert.ok(!/EXTRACT\(DOW FROM created_at\)/.test(analyticsSource), 'weekday deve usar o dia operacional UTC');
assert.ok(!/WHERE created_at\s*[<>=]/.test(analyticsSource), 'filtros críticos não podem usar created_at bruto');

assert.ok(performanceSource.includes('DATA_OPERACIONAL_SQL'), 'performance deve usar a data operacional comum');
assert.ok(!performanceSource.includes("AT TIME ZONE 'America/Sao_Paulo'"), 'performance não pode usar o fuso legado');
assert.ok(!/created_at\s*::date/.test(performanceSource), 'performance não pode usar created_at::date direto');

console.log('Verificações isoladas de performance: OK');
