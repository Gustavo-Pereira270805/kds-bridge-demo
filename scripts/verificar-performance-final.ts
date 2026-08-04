import assert from 'node:assert/strict';
import { buildCriterionSummaries, calcularNotasCozinhaGeral, aggregatePerformance, aggregateScoreAlias, consolidacaoGeralValida } from '../src/services/performance.service';
import { validarIntervaloInclusivo } from '../src/services/operational-date.service';
import { PerformanceScoreRow } from '../src/types';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function scoreRow(overrides: Partial<PerformanceScoreRow> = {}): PerformanceScoreRow {
  return {
    id: 'score-1', entity: 'salao', date: '2026-08-04', base_score: 5, final_score: 4,
    total_demands: 1, sla_breaches: 0, sla_breach_deduction: 0,
    cancellations: 0, cancellation_deduction: 0, stockouts: 0, stockout_deduction: 0,
    slow_items: 0, slow_item_deduction: 0, ...overrides,
  };
}

const incomplete = calcularNotasCozinhaGeral([
  { entity: 'cozinha_quente_a', total: 2, deduction: 1 },
]);
assert.equal(incomplete.operational_score, null);
assert.equal(incomplete.total_demands, null);

const missingFinal = calcularNotasCozinhaGeral([
  { entity: 'cozinha_quente_a', total: 2, deduction: 1, final: undefined },
  { entity: 'cozinha_quente_b', total: 2, deduction: 0, final: 5 },
  { entity: 'cozinha_fria', total: 2, deduction: 0, final: 5 },
]);
assert.equal(missingFinal.operational_score, null, 'cozinha geral não pode derivar score ausente');
assert.equal(missingFinal.daily_average_score, null, 'média da cozinha geral não pode derivar score ausente');

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
assert.equal(partialAlias.sla_breach_deduction, null);
assert.equal(partialAlias.cancellation_deduction, null);
assert.equal(partialAlias.stockout_deduction, null);
assert.equal(partialAlias.slow_item_deduction, null);

const legacyStockout = buildCriterionSummaries({
  total_demands: 10,
  sla_breaches: 0,
  sla_breach_deduction: 0,
  cancellations: 0,
  cancellation_deduction: 0,
  stockouts: 1,
  stockout_deduction: null,
  slow_items: 0,
  slow_item_deduction: 0,
} as PerformanceScoreRow, {
  sla_breach_cozinha: 0.15, sla_breach_salao: 0.15,
  cancellation_cozinha: 0.3, cancellation_salao: 0.3,
  stockout_salao: 0.1, slow_item_cozinha: 0.1, slow_pickup_salao: 0.1,
}, true, { stockout_cozinha: 10 }, { stockout_cozinha: 'indisponivel_snapshot_legado' });
assert.equal(legacyStockout.find(item => item.criterion === 'stockout_cozinha')?.deduction, null);

const nullScore = aggregateScoreAlias('salao', [scoreRow({ final_score: null })]);
assert.equal(nullScore.final_score, null, 'alias não pode converter final_score nulo em zero');

const nullOperational = aggregatePerformance('salao', [scoreRow({ final_score: null })], {
  entity: 'salao', criteria: [], occurrences: [], weight_versions: [], total_demands: 1,
  open_demands: 0, total_deduction: 0, legacy_unversioned: false,
});
assert.equal(nullOperational.operational_score, null, 'operacional não pode inventar nota para score nulo');
assert.equal(nullOperational.daily_average_score, null, 'média diária não pode converter score nulo em zero');

const incompleteGeneral = aggregatePerformance('cozinha_geral', [
  scoreRow({ entity: 'cozinha_quente_a', final_score: 4 }),
  scoreRow({ id: 'score-2', entity: 'cozinha_quente_b', final_score: null }),
  scoreRow({ id: 'score-3', entity: 'cozinha_fria', final_score: 4 }),
], {
  entity: 'cozinha_geral', criteria: [], occurrences: [], weight_versions: [], total_demands: 3,
  open_demands: 0, total_deduction: 0, legacy_unversioned: false,
}, [
  scoreRow({ entity: 'cozinha_quente_a', final_score: 4 }),
  scoreRow({ id: 'score-2', entity: 'cozinha_quente_b', final_score: null }),
  scoreRow({ id: 'score-3', entity: 'cozinha_fria', final_score: 4 }),
]);
assert.equal(incompleteGeneral.operational_score, null, 'cozinha geral incompleta não pode inventar nota');
assert.equal(incompleteGeneral.daily_average_score, null, 'cozinha geral incompleta não pode inventar média');

assert.equal(validarIntervaloInclusivo('2026-08-01', '2026-08-31'), null);
assert.equal(validarIntervaloInclusivo('2026-08-01', '2026-09-01'), 'O período máximo é de 31 dias');

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

const requireNumberSource = dashboardSource.match(/function task6RequireNumber\([\s\S]*?\n    \}/)?.[0];
assert.ok(requireNumberSource, 'task6RequireNumber deve existir no dashboard');
const task6RequireNumber = vm.runInNewContext('(' + requireNumberSource + ')') as (value: unknown, path: string, allowNull?: boolean) => number | null;
assert.throws(() => task6RequireNumber(undefined, 'campo.obrigatorio'), /campo ausente/);
assert.throws(() => task6RequireNumber(null, 'campo.obrigatorio'), /campo nulo/);
assert.equal(task6RequireNumber(null, 'campo.nullable', true), null);
assert.equal(task6RequireNumber('2.5', 'campo.numero'), 2.5);
assert.equal(task6RequireNumber(0, 'campo.zero'), 0);
assert.equal(task6RequireNumber(null, 'campo.scatter.sla_min', true), null);
assert.throws(() => task6RequireNumber(null, 'campo.scatter.sla_min'), /campo nulo/);
const criticalArraysSource = dashboardSource.match(/function task6ValidateCriticalArrays\([\s\S]*?\n    \}/)?.[0];
assert.ok(criticalArraysSource, 'task6ValidateCriticalArrays deve existir');
const task6ValidateCriticalArrays = vm.runInNewContext(`(function(task6RequireNumber) { ${criticalArraysSource}; return task6ValidateCriticalArrays; })`)(task6RequireNumber) as (data: unknown) => void;
assert.throws(() => task6ValidateCriticalArrays({ speed_by_hour: [null] }), /item nulo ou inválido em dashboard\.speed_by_hour\[0\]/);
assert.equal(consolidacaoGeralValida([
  { entity: 'cozinha_quente_a', final_score: 5 },
  { entity: 'cozinha_quente_b', final_score: 5 },
  { entity: 'cozinha_fria', final_score: 5 },
]), true);
assert.equal(consolidacaoGeralValida([
  { entity: 'cozinha_quente_a', final_score: 5 },
  { entity: 'cozinha_quente_b', final_score: null },
  { entity: 'cozinha_fria', final_score: 5 },
]), false);

const analyticsSource = readFileSync(new URL('../src/routes/analytics.ts', import.meta.url), 'utf8');
assert.ok(analyticsSource.includes('DATA_OPERACIONAL_SQL'), 'analytics deve usar a data operacional comum');
const relativeEndpoints = ['peak-hours', 'by-product', 'sla-breaches', 'cancellations', 'stockouts'];
for (let index = 0; index < relativeEndpoints.length; index += 1) {
  const endpoint = relativeEndpoints[index];
  const nextEndpoint = relativeEndpoints[index + 1] || 'dashboard';
  const section = analyticsSource.slice(
    analyticsSource.indexOf(`'/${endpoint}'`),
    analyticsSource.indexOf(`'/${nextEndpoint}'`),
  );
  assert.ok(section.includes("created_at >= NOW() - INTERVAL '1 day' * $1"), `${endpoint} deve usar janela móvel`);
}
assert.ok((analyticsSource.match(/AT TIME ZONE 'UTC'/g) || []).length >= 8, 'analytics deve agrupar horários explicitamente em UTC');
assert.ok(!analyticsSource.includes("AT TIME ZONE 'America/Sao_Paulo'"), 'analytics não pode usar fuso legado');
assert.ok(analyticsSource.includes("dateFrom = deslocarDataUtc(dateTo, -6)"), 'semana deve ter 7 dias inclusivos');
assert.ok(analyticsSource.includes("dateFrom = deslocarDataUtc(dateTo, -29)"), 'mês deve ter 30 dias inclusivos');
assert.ok(analyticsSource.includes('setUTCDate(prevStart.getUTCDate() - rangeNum)'), 'comparativo deve usar aritmética UTC');

assert.ok(performanceSource.includes('DATA_OPERACIONAL_SQL'), 'performance deve usar a data operacional comum');
assert.ok(!performanceSource.includes("AT TIME ZONE 'America/Sao_Paulo'"), 'performance não pode usar fuso legado');

function janelaMovelUtc(agora: Date, dias: number): { inicio: Date; fim: Date } {
  return { inicio: new Date(agora.getTime() - dias * 86400000), fim: agora };
}

const borda = new Date('2026-08-04T00:00:00.000Z');
const janela = janelaMovelUtc(borda, 1);
assert.equal(janela.inicio.toISOString(), '2026-08-03T00:00:00.000Z');
assert.equal(janela.fim.toISOString(), '2026-08-04T00:00:00.000Z');
assert.ok(new Date('2026-08-03T23:59:59.999Z') >= janela.inicio, 'borda interna deve entrar na janela');
assert.ok(new Date('2026-08-02T23:59:59.999Z') < janela.inicio, 'borda externa deve ficar fora da janela');

assert.ok((dashboardSource.match(/setUTCDate\(d\.getUTCDate\(\) \+ 1\)/g) || []).length >= 2, 'exportações devem iterar dias em UTC');
assert.ok(dashboardSource.includes('cursor.setUTCDate(cursor.getUTCDate() + 1)'), 'dias exportáveis devem usar aritmética UTC');
assert.ok(dashboardSource.includes('function addUtcDays(date, days)'), 'dashboard deve centralizar deslocamentos relativos em UTC');
assert.ok(!dashboardSource.includes('.setDate('), 'dashboard não pode usar aritmética de data local');
assert.ok(!/T00:00:00['"]/.test(dashboardSource), 'datas de calendário do dashboard devem ser interpretadas explicitamente em UTC');
assert.ok(analyticsSource.includes("reply.code(500).send({ error: 'Erro ao buscar dados do dashboard' })"), 'dashboard não deve expor detalhe do erro');
assert.ok(!analyticsSource.includes("'Erro ao buscar dados do dashboard: ' + msg"), 'dashboard não deve concatenar mensagem crua');
assert.ok(analyticsSource.includes('validarDataCalendario'), 'dashboard deve validar datas civis antes das queries');
assert.ok(analyticsSource.includes('A data deve estar no formato ISO YYYY-MM-DD e ser válida'), 'dashboard deve usar erro fixo para data inválida');
assert.ok(analyticsSource.includes("!['today', 'yesterday', 'week', 'month'].includes(range)"), 'dashboard deve rejeitar range desconhecido');
assert.ok(analyticsSource.includes("O intervalo deve ser week ou month"), 'range inválido deve usar erro fixo');
assert.ok(!analyticsSource.includes('schema: {'), 'pesos não devem ser rejeitados pelo schema antes da mensagem fixa');
assert.ok(!readFileSync(new URL('../src/routes/admin.ts', import.meta.url), 'utf8').includes('sla_breach: version.sla_breach_cozinha'), 'contrato novo não deve expor alias ambíguo');
assert.ok(readFileSync(new URL('../src/views/admin.html', import.meta.url), 'utf8').includes("input.max = '5'"), 'frontend deve limitar pesos a 5');
assert.ok(readFileSync(new URL('../src/services/performance.service.ts', import.meta.url), 'utf8').includes('total_deduction: number | null'), 'desconto agregado deve aceitar indisponibilidade');
assert.ok(performanceSource.includes('valid_to exclusivo'), 'vigência deve documentar data UTC e fim exclusivo');
assert.ok(analyticsSource.includes('historyMap.set(date, { date, ...Object.fromEntries'), 'histórico deve preservar dias incompletos');
assert.ok(dashboardSource.includes('function task6ExportDays(from, to)'), 'exportações devem compartilhar o iterador de dias');
assert.ok(dashboardSource.includes('task6RequireNumber(kpis.tempo_medio_cozinha_min'), 'dashboard deve validar tempo médio de cozinha');
assert.ok(dashboardSource.includes('task6RequireNumber(kpis.tempo_medio_retirada_min'), 'dashboard deve validar tempo médio de retirada');
assert.ok(dashboardSource.includes('task6RequireNumber(item.operational_score'), 'exportação deve validar notas operacionais');
assert.ok(!performanceSource.includes('Number(row.final_score)'), 'agregadores não podem converter score nulo sem guarda');
assert.ok(!performanceSource.includes('aggregate.operational_score!'), 'cozinha geral não pode persistir score com non-null assertion');
assert.ok(performanceSource.includes('aggregate.operational_score !== null && aggregate.daily_average_complete'), 'cozinha geral deve persistir apenas consolidação completa');
assert.ok(dashboardSource.includes('function task6DisplayNumber'), 'dashboard deve usar helper seguro para exibição numérica');
assert.ok(dashboardSource.includes('function task6ValidateCriticalArrays'), 'dashboard deve validar arrays críticos');
assert.ok(dashboardSource.includes("'speed_by_hour'"), 'exportação deve validar velocidade');
assert.ok(dashboardSource.includes("'week_comparison'"), 'exportação deve validar comparativos');
assert.ok(!dashboardSource.includes('Number(s.operational_score)'), 'detalhamento não pode converter score nulo diretamente');
assert.ok(!dashboardSource.includes('Number(o.weight || 0)'), 'detrator não pode converter peso ausente em zero');
assert.ok(!dashboardSource.includes('Number(o.deduction || 0)'), 'detrator não pode converter desconto ausente em zero');
assert.ok(dashboardSource.includes("qty_vs_time: { required: ['qty', 'actual_min'], nullable: ['sla_min'] }"), 'sla_min nulo deve ser aceito no scatter');
assert.ok(dashboardSource.includes('Array.isArray(row)'), 'arrays críticos devem rejeitar itens que não são objetos');
assert.ok(dashboardSource.includes('item nulo ou inválido'), 'arrays críticos devem informar item inválido com caminho');
assert.ok(performanceSource.includes('final_score: number | null'), 'validação geral deve considerar score operacional');
assert.ok(performanceSource.includes("stationEntities.every(entity => stationRows.some(row => row.entity === entity"), 'validação geral deve exigir as três estações');
assert.equal(janela.inicio.toISOString(), '2026-08-03T00:00:00.000Z');
assert.equal(new Date('2026-08-04T00:00:00.000Z').getTime() - new Date('2026-08-03T00:00:00.000Z').getTime(), 86400000);

console.log('Verificações isoladas de performance: OK');
