import { query, pool } from '../db/client';
import { PerformanceScoreRow, PerformanceDetractor, PerformanceWeights, PerformanceWeightVersion, PerformanceOccurrence, PerformanceCriterionSummary, PerformanceEntity, EntityPerformance, EntityScore } from '../types';

export interface NotaCozinhaGeral {
  operational_score: number;
  daily_average_score: number;
  total_demands: number;
  kitchen_stockout_weight: number;
}

export interface OcorrenciaBruta {
  type: string;
  date: string;
  demand_id: string;
  product_name: string;
  detail: string;
  entity?: PerformanceEntity;
  station?: string | null;
}

export function calcularNotasCozinhaGeral(stations: { total: number; deduction: number; final?: number }[]): NotaCozinhaGeral {
  const total = stations.reduce((sum, station) => sum + station.total, 0);
  const deduction = stations.reduce((sum, station) => sum + station.deduction, 0);
  const operationalScore = round1(5 - deduction);
  const dailyAverageScore = stations.length
    ? round1(stations.reduce((sum, station) => sum + (station.final ?? round1(5 - station.deduction)), 0) / stations.length)
    : 5;
  return {
    operational_score: operationalScore,
    daily_average_score: dailyAverageScore,
    total_demands: total,
    kitchen_stockout_weight: 0,
  };
}

export const PESOS_PADRAO: PerformanceWeights = {
  sla_breach_cozinha: 0.15,
  sla_breach_salao: 0.15,
  cancellation_cozinha: 0.30,
  cancellation_salao: 0.30,
  stockout_salao: 0.10,
  slow_item_cozinha: 0.10,
  slow_pickup_salao: 0.10,
};

export async function ensureWeightVersion(): Promise<PerformanceWeightVersion> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('performance_weight_versions', 0))`);
    const { rows: existing } = await client.query<PerformanceWeightVersion>(
      `SELECT * FROM performance_weight_versions
       WHERE valid_to IS NULL ORDER BY valid_from DESC LIMIT 1`
    );
    if (existing[0]) {
      await client.query('COMMIT');
      return existing[0];
    }

    const columns = Object.keys(PESOS_PADRAO);
    const values = columns.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO performance_weight_versions (${columns.join(', ')}) VALUES (${values})`,
      columns.map(key => PESOS_PADRAO[key as keyof PerformanceWeights])
    );
    const { rows: created } = await client.query<PerformanceWeightVersion>(
      `SELECT * FROM performance_weight_versions
       WHERE valid_to IS NULL ORDER BY valid_from DESC LIMIT 1`
    );
    if (!created[0]) throw new Error('Não foi possível garantir a versão de pesos vigente');
    await client.query('COMMIT');
    return created[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getWeightVersionForDate(dateStr: string): Promise<PerformanceWeightVersion> {
  await ensureWeightVersion();
  const [version] = await query<PerformanceWeightVersion>(
    `SELECT * FROM performance_weight_versions
      WHERE (valid_from AT TIME ZONE 'UTC')::date <= $1::date
        AND (valid_to IS NULL OR (valid_to AT TIME ZONE 'UTC')::date > $1::date)
      ORDER BY valid_from DESC LIMIT 1`,
    [dateStr]
  );
  if (!version) throw new Error('Não foi encontrada uma versão de pesos para a data');
  return version;
}

export async function getWeightVersions(): Promise<PerformanceWeightVersion[]> {
  return query<PerformanceWeightVersion>(
    `SELECT * FROM performance_weight_versions ORDER BY valid_from DESC`
  );
}

export type PerformanceWeightCache = Map<string, PerformanceWeightVersion>;

function versionForDate(dateStr: string, versions: PerformanceWeightVersion[]): PerformanceWeightVersion {
  const civilDate = (value: string): string => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
  };
  const version = versions
    .filter(candidate => civilDate(candidate.valid_from) <= dateStr
      && (!candidate.valid_to || civilDate(candidate.valid_to) > dateStr))
    .sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime())[0];
  if (!version) throw new Error('Não foi encontrada uma versão de pesos para a data');
  return version;
}

export async function createPerformanceWeightCache(dateFrom: string, dateTo: string): Promise<PerformanceWeightCache> {
  await ensureWeightVersion();
  const versions = await getWeightVersions();
  const cache: PerformanceWeightCache = new Map();
  for (const date = new Date(`${dateFrom}T00:00:00Z`); date <= new Date(`${dateTo}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const dateStr = date.toISOString().slice(0, 10);
    cache.set(dateStr, versionForDate(dateStr, versions));
  }
  return cache;
}

function cachedWeightVersion(dateStr: string, cache?: PerformanceWeightCache): Promise<PerformanceWeightVersion> {
  if (cache?.has(dateStr)) return Promise.resolve(cache.get(dateStr)!);
  return getWeightVersionForDate(dateStr);
}

function round1(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

function entityFromStationCode(code: string): string {
  if (code === 'quente_a') return 'cozinha_quente_a';
  if (code === 'quente_b') return 'cozinha_quente_b';
  return 'cozinha_fria';
}

async function upsertScore(
  entity: string, dateStr: string, finalScore: number, total: number,
  slaBreaches: number, slaDed: number,
  cancellations: number, cancelDed: number,
  stockouts: number, stockDed: number,
  slowItems: number, slowDed: number, weightVersionId: string
): Promise<void> {
  await query(
    `INSERT INTO performance_scores (entity, date, base_score, final_score, total_demands,
       sla_breaches, sla_breach_deduction, cancellations, cancellation_deduction,
       stockouts, stockout_deduction, slow_items, slow_item_deduction, weight_version_id, updated_at)
     VALUES ($1, $2, 5.0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     ON CONFLICT (entity, date) DO UPDATE SET
        weight_version_id = EXCLUDED.weight_version_id,
       final_score = EXCLUDED.final_score,
       total_demands = EXCLUDED.total_demands,
       sla_breaches = EXCLUDED.sla_breaches,
       sla_breach_deduction = EXCLUDED.sla_breach_deduction,
       cancellations = EXCLUDED.cancellations,
       cancellation_deduction = EXCLUDED.cancellation_deduction,
       stockouts = EXCLUDED.stockouts,
       stockout_deduction = EXCLUDED.stockout_deduction,
       slow_items = EXCLUDED.slow_items,
       slow_item_deduction = EXCLUDED.slow_item_deduction,
       updated_at = now()`,
     [entity, dateStr, finalScore, total,
      slaBreaches, slaDed, cancellations, cancelDed,
      stockouts, stockDed, slowItems, slowDed, weightVersionId]
  );
}

async function safeCount(sql: string, params: unknown[]): Promise<number> {
  const rows = await query<{ cnt: string }>(sql, params);
  return parseInt(rows[0]?.cnt || '0', 10);
}

export async function computeDailyScores(dateStr: string): Promise<void> {
  const version = await getWeightVersionForDate(dateStr);

  const stations = await query<{ id: string; code: string }>(
    `SELECT id, code FROM kitchen_stations`
  );

  // -- Kitchen stations --
  for (const st of stations) {
    const entity = entityFromStationCode(st.code);
    const sid = st.id;

    const slaBreaches = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND created_at::date = $2 AND sla_breached_cozinha = true
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const cancellations = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND created_at::date = $2 AND status = 'cancelled_cozinha'
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const stockouts = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND created_at::date = $2 AND stockout_reported = true
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const slowItems = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND created_at::date = $2
         AND status != 'annulled'
         AND ready_at IS NOT NULL AND sla_minutes IS NOT NULL
         AND EXTRACT(EPOCH FROM (ready_at - created_at))/60 > sla_minutes * 1.5`,
      [sid, dateStr]
    );
    const total = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND created_at::date = $2
         AND status != 'annulled'`,
      [sid, dateStr]
    );

    const slaDed = slaBreaches * version.sla_breach_cozinha;
    const cancelDed = cancellations * version.cancellation_cozinha;
    const stockDed = 0; // Zerado na cozinha é ocorrência, mas não desconta.
    const slowDed = slowItems * version.slow_item_cozinha;
    const totalDed = slaDed + cancelDed + stockDed + slowDed;
    const finalScore = round1(5.0 - totalDed);

    await upsertScore(entity, dateStr, finalScore, total,
      slaBreaches, slaDed, cancellations, cancelDed, stockouts, stockDed, slowItems, slowDed, version.id);
  }

  // -- Salão --
  const sSla = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE created_at::date = $1 AND sla_breached_salao = true AND status != 'annulled'`,
    [dateStr]
  );
  const sCancel = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE created_at::date = $1 AND status = 'cancelled_salao' AND status != 'annulled'`,
    [dateStr]
  );
  const sStock = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE created_at::date = $1 AND stockout_reported = true AND status != 'annulled'`,
    [dateStr]
  );

  const [tolRow] = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'pickup_tolerance_minutes'`
  );
  const tolerance = parseFloat(tolRow?.value || '3');

  const sSlow = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands
     WHERE created_at::date = $1 AND status != 'annulled'
       AND retrieved_at IS NOT NULL AND ready_at IS NOT NULL
       AND EXTRACT(EPOCH FROM (retrieved_at - ready_at))/60 > $2`,
    [dateStr, tolerance * 2]
  );

  const sTotal = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE created_at::date = $1 AND status != 'annulled'`,
    [dateStr]
  );

  const sSlaDed = sSla * version.sla_breach_salao;
  const sCancelDed = sCancel * version.cancellation_salao;
  const sStockDed = sStock * version.stockout_salao;
  const sSlowDed = sSlow * version.slow_pickup_salao;
  const sTotalDed = sSlaDed + sCancelDed + sStockDed + sSlowDed;
  const sFinal = round1(5.0 - sTotalDed);

  await upsertScore('salao', dateStr, sFinal, sTotal,
    sSla, sSlaDed, sCancel, sCancelDed, sStock, sStockDed, sSlow, sSlowDed, version.id);

  // Cozinha Geral usa toda a base das três estações; a média simples fica separada.
  const stationRows = await query<PerformanceScoreRow>(
    `SELECT * FROM performance_scores
     WHERE date = $1 AND entity IN ('cozinha_quente_a','cozinha_quente_b','cozinha_fria')`,
    [dateStr]
  );
  if (stationRows.length > 0) {
    const aggregate = calcularNotasCozinhaGeral(stationRows.map(row => ({
      total: Number(row.total_demands),
      deduction: Number(row.sla_breach_deduction) + Number(row.cancellation_deduction)
        + Number(row.stockout_deduction) + Number(row.slow_item_deduction),
      final: Number(row.final_score),
    })));
    const agg = stationRows.reduce((sum, row) => ({
      total: sum.total + Number(row.total_demands),
      sla: sum.sla + Number(row.sla_breaches), slaDed: sum.slaDed + Number(row.sla_breach_deduction),
      cancel: sum.cancel + Number(row.cancellations), cancelDed: sum.cancelDed + Number(row.cancellation_deduction),
      stock: sum.stock + Number(row.stockouts), stockDed: sum.stockDed + Number(row.stockout_deduction),
      slow: sum.slow + Number(row.slow_items), slowDed: sum.slowDed + Number(row.slow_item_deduction),
    }), { total: 0, sla: 0, slaDed: 0, cancel: 0, cancelDed: 0, stock: 0, stockDed: 0, slow: 0, slowDed: 0 });
    await upsertScore('cozinha_geral', dateStr,
      aggregate.operational_score, agg.total, agg.sla, agg.slaDed,
      agg.cancel, agg.cancelDed, agg.stock, agg.stockDed, agg.slow, agg.slowDed, version.id);
  }
}

export async function ensureScoresForDate(dateStr: string): Promise<void> {
  const [row] = await query<{ cnt: string }>(
    `SELECT COUNT(*)::int AS cnt FROM performance_scores WHERE date = $1`,
    [dateStr]
  );
  if (parseInt(row?.cnt || '0', 10) < 5) {
    await computeDailyScores(dateStr);
  }
}

export function buildDetractors(score: PerformanceScoreRow): PerformanceDetractor[] {
  const list: PerformanceDetractor[] = [];
  if (score.sla_breaches > 0) {
    list.push({ label: 'Estouros de SLA', count: score.sla_breaches, deduction: score.sla_breach_deduction });
  }
  if (score.cancellations > 0) {
    list.push({ label: 'Cancelamentos', count: score.cancellations, deduction: score.cancellation_deduction });
  }
  if (score.stockouts > 0) {
    list.push({ label: 'Zerados', count: score.stockouts, deduction: score.stockout_deduction });
  }
  if (score.slow_items > 0) {
    list.push({ label: 'Preparo/Retirada lenta', count: score.slow_items, deduction: score.slow_item_deduction });
  }
  list.sort((a, b) => b.deduction - a.deduction);
  return list;
}

export type DetractorDate = PerformanceOccurrence;

export async function enriquecerOcorrencias(
  entity: PerformanceEntity,
  ocorrencias: OcorrenciaBruta[],
  weightCache?: PerformanceWeightCache
): Promise<PerformanceOccurrence[]> {
  const isKitchen = entity !== 'salao';
  return Promise.all(ocorrencias.map(async occurrence => {
    const occurrenceDate = String(occurrence.date).slice(0, 10);
    const version = await cachedWeightVersion(occurrenceDate, weightCache);
    const resultEntity = occurrence.entity || entity;
    const key = occurrence.type === 'Estouro de SLA'
      ? (isKitchen ? 'sla_breach_cozinha' : 'sla_breach_salao')
      : occurrence.type === 'Cancelamento'
        ? (isKitchen ? 'cancellation_cozinha' : 'cancellation_salao')
        : occurrence.type === 'Zerado'
          ? (isKitchen ? null : 'stockout_salao')
          : (isKitchen ? 'slow_item_cozinha' : 'slow_pickup_salao');
    const weight = key ? version[key] : 0;
    return {
      ...occurrence,
      entity: resultEntity,
      station: occurrence.station ?? (isKitchen ? resultEntity.replace('cozinha_', '') : null),
      weight,
      deduction: weight,
      weight_version_id: version.id,
    };
  }));
}

export async function ensureValidScoresForDate(dateStr: string, cache: PerformanceWeightCache): Promise<void> {
  const entities: PerformanceEntity[] = ['cozinha_geral', 'cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'salao'];
  const rows = await query<{ entity: PerformanceEntity; weight_version_id: string | null }>(
    `SELECT entity, weight_version_id FROM performance_scores WHERE date = $1 AND entity = ANY($2)`,
    [dateStr, entities]
  );
  const expectedVersion = cache.get(dateStr);
  const valid = Boolean(expectedVersion) && entities.every(entity => rows.some(row =>
    row.entity === entity && row.weight_version_id === expectedVersion!.id));
  if (!valid) await computeDailyScores(dateStr);
}

export function buildCriterionSummaries(
  score: PerformanceScoreRow,
  weights: PerformanceWeights,
  isKitchen: boolean,
  eligibleBases: Partial<Record<string, number>> = {}
): PerformanceCriterionSummary[] {
  const criteria: [string, number, number][] = isKitchen
    ? [
      ['sla_breach_cozinha', score.sla_breaches, score.sla_breach_deduction],
      ['cancellation_cozinha', score.cancellations, score.cancellation_deduction],
      ['stockout_cozinha', score.stockouts, score.stockout_deduction],
      ['slow_item_cozinha', score.slow_items, score.slow_item_deduction],
    ]
    : [
      ['sla_breach_salao', score.sla_breaches, score.sla_breach_deduction],
      ['cancellation_salao', score.cancellations, score.cancellation_deduction],
      ['stockout_salao', score.stockouts, score.stockout_deduction],
      ['slow_pickup_salao', score.slow_items, score.slow_item_deduction],
    ];
  return criteria.map(([criterion, count, deduction]) => {
    const total = eligibleBases[criterion] ?? (Number(score.total_demands) || 0);
    const weight = criterion === 'stockout_cozinha'
      ? 0
      : getCriterionWeight(criterion, weights);
    return {
      criterion, count, eligible_base: total, rate: total ? count / total : 0,
      weight, deduction: criterion === 'stockout_cozinha' ? 0 : deduction,
    };
  });
}

function getCriterionWeight(criterion: string, weights: PerformanceWeights): number {
  if (criterion === 'stockout_cozinha') return 0;
  if (criterion in weights) return weights[criterion as keyof PerformanceWeights];
  throw new Error(`Critério de desempenho desconhecido: ${criterion}`);
}

export async function getCriterionEligibleBases(entity: string, dateStr: string): Promise<Record<string, number>> {
  const isGeneral = entity === 'cozinha_geral';
  const stationFilter = entity === 'salao' ? '' : 'AND kitchen_station_id IN (SELECT id FROM kitchen_stations WHERE code = ANY($2))';
  const stationCodes = isGeneral
    ? ['quente_a', 'quente_b', 'fria']
    : [entityFromStationCode(entity.replace('cozinha_', ''))];
  const params = entity === 'salao' ? [dateStr] : [dateStr, stationCodes];
  const [row] = await query<{
    total_demands: string;
    sla_cozinha: string;
    sla_salao: string;
    slow_cozinha: string;
    slow_salao: string;
  }>(
    `SELECT
       COUNT(*)::int AS total_demands,
       COUNT(*) FILTER (WHERE sla_minutes IS NOT NULL)::int AS sla_cozinha,
       COUNT(*)::int AS sla_salao,
       COUNT(*) FILTER (WHERE ready_at IS NOT NULL AND sla_minutes IS NOT NULL)::int AS slow_cozinha,
       COUNT(*) FILTER (WHERE ready_at IS NOT NULL AND retrieved_at IS NOT NULL)::int AS slow_salao
     FROM demands
     WHERE created_at::date = $1 AND status != 'annulled' ${stationFilter}`,
    params
  );
  const values = row || { total_demands: '0', sla_cozinha: '0', sla_salao: '0', slow_cozinha: '0', slow_salao: '0' };
  return {
    total_demands: Number(values.total_demands),
    sla_breach_cozinha: Number(values.sla_cozinha),
    sla_breach_salao: Number(values.sla_salao),
    cancellation_cozinha: Number(values.total_demands),
    cancellation_salao: Number(values.total_demands),
    stockout_cozinha: Number(values.total_demands),
    stockout_salao: Number(values.total_demands),
    slow_item_cozinha: Number(values.slow_cozinha),
    slow_pickup_salao: Number(values.slow_salao),
  };
}

export async function getDetractorDates(entity: string, dateFrom: string, dateTo: string, weightCache?: PerformanceWeightCache): Promise<PerformanceOccurrence[]> {
  const results: OcorrenciaBruta[] = [];

  if (entity === 'cozinha_quente_a' || entity === 'cozinha_quente_b' || entity === 'cozinha_fria') {
    const stationCode = entity === 'cozinha_quente_a' ? 'quente_a'
      : entity === 'cozinha_quente_b' ? 'quente_b' : 'fria';

    const slaRows = await query<{ id: string; product_name: string; created_at: string; sla_breach_minutes_cozinha: number }>(
      `SELECT d.id, d.product_name, d.created_at, d.sla_breach_minutes_cozinha
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date >= $2 AND d.created_at::date <= $3 AND d.sla_breached_cozinha = true AND d.status != 'annulled'`,
      [stationCode, dateFrom, dateTo]
    );
    slaRows.forEach(r => results.push({
      type: 'Estouro de SLA',
      date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: `Excedeu em ${Number(r.sla_breach_minutes_cozinha).toFixed(1)} min`,
    }));

    const cancelRows = await query<{ id: string; product_name: string; created_at: string; cancel_reason: string | null }>(
      `SELECT d.id, d.product_name, d.created_at, d.cancel_reason
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date >= $2 AND d.created_at::date <= $3 AND d.status = 'cancelled_cozinha'`,
      [stationCode, dateFrom, dateTo]
    );
    cancelRows.forEach(r => results.push({
      type: 'Cancelamento', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: r.cancel_reason || 'Sem motivo registrado',
    }));

    const stockRows = await query<{ id: string; product_name: string; created_at: string }>(
      `SELECT d.id, d.product_name, d.created_at
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date >= $2 AND d.created_at::date <= $3 AND d.stockout_reported = true AND d.status != 'annulled'`,
      [stationCode, dateFrom, dateTo]
    );
    stockRows.forEach(r => results.push({
      type: 'Zerado', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name, detail: 'Produto zerou na cozinha',
    }));

    const slowRows = await query<{ id: string; product_name: string; created_at: string; sla_minutes: number }>(
      `SELECT d.id, d.product_name, d.created_at, d.sla_minutes
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date >= $2 AND d.created_at::date <= $3 AND d.status != 'annulled'
         AND d.ready_at IS NOT NULL AND d.sla_minutes IS NOT NULL
         AND EXTRACT(EPOCH FROM (d.ready_at - d.created_at))/60 > d.sla_minutes * 1.5`,
      [stationCode, dateFrom, dateTo]
    );
    slowRows.forEach(r => results.push({
      type: 'Item lento', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: `SLA: ${r.sla_minutes} min`,
    }));
  }

  if (entity === 'salao') {
    const sSlaRows = await query<{ id: string; product_name: string; created_at: string; sla_breach_minutes_salao: number }>(
      `SELECT id, product_name, created_at, sla_breach_minutes_salao
       FROM demands WHERE created_at::date >= $1 AND created_at::date <= $2 AND sla_breached_salao = true AND status != 'annulled'`,
      [dateFrom, dateTo]
    );
    sSlaRows.forEach(r => results.push({
      type: 'Estouro de SLA', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: `Excedeu em ${Number(r.sla_breach_minutes_salao).toFixed(1)} min`,
    }));

    const sCancelRows = await query<{ id: string; product_name: string; created_at: string; cancel_reason: string | null }>(
      `SELECT id, product_name, created_at, cancel_reason
       FROM demands WHERE created_at::date >= $1 AND created_at::date <= $2 AND status = 'cancelled_salao'`,
      [dateFrom, dateTo]
    );
    sCancelRows.forEach(r => results.push({
      type: 'Cancelamento', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: r.cancel_reason || 'Sem motivo registrado',
    }));

    const sStockRows = await query<{ id: string; product_name: string; created_at: string }>(
      `SELECT id, product_name, created_at
       FROM demands WHERE created_at::date >= $1 AND created_at::date <= $2 AND stockout_reported = true AND status != 'annulled'`,
      [dateFrom, dateTo]
    );
    sStockRows.forEach(r => results.push({
      type: 'Zerado', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name, detail: 'Reportado pelo salão',
    }));

    const [tolRow] = await query<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'pickup_tolerance_minutes'`
    );
    const tolerance = parseFloat(tolRow?.value || '3');

    const sSlowRows = await query<{ id: string; product_name: string; created_at: string }>(
      `SELECT id, product_name, created_at
       FROM demands WHERE created_at::date >= $1 AND created_at::date <= $2 AND status != 'annulled'
         AND retrieved_at IS NOT NULL AND ready_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (retrieved_at - ready_at))/60 > $3`,
      [dateFrom, dateTo, tolerance * 2]
    );
    sSlowRows.forEach(r => results.push({
      type: 'Item lento', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: `Retirada > ${tolerance * 2} min`,
    }));
  }

  if (entity === 'cozinha_geral') {
    const stationCodes = ['quente_a', 'quente_b', 'fria'];
    for (const code of stationCodes) {
      const subResults = await getDetractorDates(
        code === 'quente_a' ? 'cozinha_quente_a' : code === 'quente_b' ? 'cozinha_quente_b' : 'cozinha_fria',
        dateFrom, dateTo, weightCache
      );
      results.push(...subResults);
    }
  }

  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (!['salao', 'cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'cozinha_geral'].includes(entity)) {
    throw new Error(`Entidade de desempenho desconhecida: ${entity}`);
  }
  return enriquecerOcorrencias(entity as PerformanceEntity, results, weightCache);
}

export interface PerformanceDetails {
  entity: PerformanceEntity;
  criteria: PerformanceCriterionSummary[];
  occurrences: PerformanceOccurrence[];
  weight_versions: PerformanceWeightVersion[];
  total_demands: number;
  open_demands: number;
  total_deduction: number;
}

export async function getPerformanceDetails(entity: PerformanceEntity, dateFrom: string, dateTo: string, weightCache?: PerformanceWeightCache): Promise<PerformanceDetails> {
  const cache = weightCache || await createPerformanceWeightCache(dateFrom, dateTo);
  const occurrences = await getDetractorDates(entity, dateFrom, dateTo, cache);
  const bases: Record<string, number> = {};
  const versions = new Map<string, PerformanceWeightVersion>();
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T00:00:00Z`);
  for (const date = new Date(from); date <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateStr = date.toISOString().slice(0, 10);
    const dailyBases = await getCriterionEligibleBases(entity, dateStr);
    for (const [criterion, base] of Object.entries(dailyBases)) bases[criterion] = (bases[criterion] || 0) + base;
    const version = cache.get(dateStr)!;
    versions.set(version.id, version);
  }
  const counts = new Map<string, number>();
  const deductions = new Map<string, number>();
  const criterionWeights = new Map<string, Map<string, { weight: number; count: number; deduction: number }>>();
  for (const occurrence of occurrences) {
    const criterion = occurrence.type === 'Estouro de SLA'
      ? (entity === 'salao' ? 'sla_breach_salao' : 'sla_breach_cozinha')
      : occurrence.type === 'Cancelamento'
        ? (entity === 'salao' ? 'cancellation_salao' : 'cancellation_cozinha')
        : occurrence.type === 'Zerado'
          ? (entity === 'salao' ? 'stockout_salao' : 'stockout_cozinha')
          : (entity === 'salao' ? 'slow_pickup_salao' : 'slow_item_cozinha');
    counts.set(criterion, (counts.get(criterion) || 0) + 1);
    deductions.set(criterion, (deductions.get(criterion) || 0) + occurrence.deduction);
    if (occurrence.weight_version_id) {
      if (!criterionWeights.has(criterion)) criterionWeights.set(criterion, new Map());
      const version = criterionWeights.get(criterion)!;
      const current = version.get(occurrence.weight_version_id) || { weight: occurrence.weight, count: 0, deduction: 0 };
      current.count += 1;
      current.deduction += occurrence.deduction;
      version.set(occurrence.weight_version_id, current);
    }
  }
  const latest = cache.get(dateTo)!;
  const criteria = buildCriterionSummaries({
    total_demands: bases.total_demands || 0,
    sla_breaches: counts.get(entity === 'salao' ? 'sla_breach_salao' : 'sla_breach_cozinha') || 0,
    sla_breach_deduction: deductions.get(entity === 'salao' ? 'sla_breach_salao' : 'sla_breach_cozinha') || 0,
    cancellations: counts.get(entity === 'salao' ? 'cancellation_salao' : 'cancellation_cozinha') || 0,
    cancellation_deduction: deductions.get(entity === 'salao' ? 'cancellation_salao' : 'cancellation_cozinha') || 0,
    stockouts: counts.get(entity === 'salao' ? 'stockout_salao' : 'stockout_cozinha') || 0,
    stockout_deduction: deductions.get(entity === 'salao' ? 'stockout_salao' : 'stockout_cozinha') || 0,
    slow_items: counts.get(entity === 'salao' ? 'slow_pickup_salao' : 'slow_item_cozinha') || 0,
    slow_item_deduction: deductions.get(entity === 'salao' ? 'slow_pickup_salao' : 'slow_item_cozinha') || 0,
  } as PerformanceScoreRow, latest, entity !== 'salao', bases);
  for (const criterion of criteria) {
    const observedWeights = criterionWeights.get(criterion.criterion) || new Map();
    criterion.weights = Array.from(versions.values()).map(version => {
      const observed = observedWeights.get(version.id);
      return {
        weight_version_id: version.id,
        weight: criterion.criterion === 'stockout_cozinha' ? 0 : getCriterionWeight(criterion.criterion, version),
        count: observed?.count || 0,
        deduction: observed?.deduction || 0,
      };
    });
    criterion.weight = criterion.weights.length === 1 ? criterion.weights[0].weight : null;
  }
  const [openRow] = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM demands
     WHERE created_at::date >= $1 AND created_at::date <= $2
       AND status IN ('pending', 'ready')
       AND status != 'annulled'
       ${entity === 'salao' ? '' : entity === 'cozinha_geral'
         ? "AND kitchen_station_id IN (SELECT id FROM kitchen_stations WHERE code = ANY($3))"
         : "AND kitchen_station_id = (SELECT id FROM kitchen_stations WHERE code = $3)"}`,
    entity === 'salao' ? [dateFrom, dateTo] : entity === 'cozinha_geral'
      ? [dateFrom, dateTo, ['quente_a', 'quente_b', 'fria']]
      : [dateFrom, dateTo, entityFromStationCode(entity.replace('cozinha_', ''))]
  );
  return {
    entity,
    criteria,
    occurrences,
    weight_versions: Array.from(versions.values()),
    total_demands: bases.total_demands || 0,
    open_demands: Number(openRow?.count || 0),
    total_deduction: round1(occurrences.reduce((sum, occurrence) => sum + occurrence.deduction, 0)),
  };
}

export function aggregatePerformance(
  entity: PerformanceEntity,
  rows: PerformanceScoreRow[],
  details: PerformanceDetails,
  dailyAverageRows: PerformanceScoreRow[] = rows
): EntityPerformance {
  const dailyAverages = new Map<string, number[]>();
  for (const row of dailyAverageRows) {
    if (!dailyAverages.has(row.date)) dailyAverages.set(row.date, []);
    dailyAverages.get(row.date)!.push(Number(row.final_score));
  }
  const dailyAverage = dailyAverages.size
    ? round1(Array.from(dailyAverages.values()).reduce((sum, scores) =>
      sum + scores.reduce((dailySum, score) => dailySum + score, 0) / scores.length, 0) / dailyAverages.size)
    : 5;
  const criteria = details.criteria.map(criterion => ({
    ...criterion,
    multi_version: (criterion.weights?.length || 0) > 1,
  }));
  return {
    entity,
    operational_score: round1(5 - details.total_deduction),
    daily_average_score: dailyAverage,
    total_demands: details.total_demands,
    open_demands: details.open_demands,
    total_deduction: details.total_deduction,
    criteria,
    occurrences: details.occurrences,
    weight_versions: details.weight_versions,
    weight_version: details.weight_versions.length === 1 ? details.weight_versions[0] : null,
  };
}

export function aggregateScoreAlias(entity: PerformanceEntity, rows: PerformanceScoreRow[]): EntityScore {
  const sum = (field: keyof PerformanceScoreRow): number => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  const totalDeduction = sum('sla_breach_deduction') + sum('cancellation_deduction') + sum('stockout_deduction') + sum('slow_item_deduction');
  const latest = rows[rows.length - 1];
  return {
    entity,
    final_score: rows.length ? round1(rows.reduce((total, row) => total + Number(row.final_score), 0) / rows.length) : 5,
    base_score: latest ? Number(latest.base_score) : 5,
    total_demands: sum('total_demands'),
    sla_breaches: sum('sla_breaches'),
    sla_breach_deduction: sum('sla_breach_deduction'),
    cancellations: sum('cancellations'),
    cancellation_deduction: sum('cancellation_deduction'),
    stockouts: sum('stockouts'),
    stockout_deduction: sum('stockout_deduction'),
    slow_items: sum('slow_items'),
    slow_item_deduction: sum('slow_item_deduction'),
    detractors: buildDetractors({ ...latest, entity, final_score: rows.length ? round1(5 - totalDeduction) : 5, total_demands: sum('total_demands') } as PerformanceScoreRow),
  };
}
