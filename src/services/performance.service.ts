import { query } from '../db/client';
import { PerformanceDetractor, PerformanceScoreRow, PerformanceWeights } from '../types';

interface SlaTimingRow {
  created_at: string | Date;
  ready_at: string | Date | null;
  retrieved_at?: string | Date | null;
  sla_minutes?: number | string | null;
}

export const SLA_MAX_FACTOR = 2.5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function penaltyForSlaFactor(factor: number, slaMin: number, slaMax: number): number {
  if (!Number.isFinite(factor) || !Number.isFinite(slaMin) || !Number.isFinite(slaMax) || slaMin < 0 || slaMax < slaMin) return 0;
  if (factor <= 1) return 0;
  const raw = slaMin + (slaMax - slaMin) * (factor - 1) / (SLA_MAX_FACTOR - 1);
  const clamped = Math.min(slaMax, Math.max(slaMin, raw));
  return round2(clamped);
}

function dateToMillis(value: string | Date | null | undefined): number {
  if (!value) return NaN;
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}

function slaFactor(start: string | Date | null | undefined, end: string | Date | null | undefined, limit: number): number {
  if (!start || !end || !Number.isFinite(limit) || limit <= 0) return 0;
  const elapsed = (dateToMillis(end) - dateToMillis(start)) / 60000;
  return Number.isFinite(elapsed) ? elapsed / limit : 0;
}

function formatFactor(factor: number): string {
  return factor.toFixed(1).replace('.', ',');
}

function formatDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getWeights(): Promise<PerformanceWeights> {
  const keys = [
    'score_weight_sla_min',
    'score_weight_sla_max',
    'score_weight_cancellation_cozinha',
    'score_weight_cancellation_salao',
    'score_weight_stockout_salao',
  ];
  const rows = await query<{ key: string; value: string }>(
    'SELECT key, value FROM system_settings WHERE key = ANY($1)',
    [keys]
  );
  const map: Record<string, number> = {};
  rows.forEach(r => { map[r.key] = parseFloat(r.value); });
  const valueOrDefault = (value: number, fallback: number): number =>
    Number.isFinite(value) ? round2(Math.min(5, Math.max(0, value))) : fallback;
  const slaMin = valueOrDefault(map.score_weight_sla_min, 0.05);
  const slaMax = valueOrDefault(map.score_weight_sla_max, 0.30);
  const normalizedMin = Math.min(slaMin, slaMax);
  const normalizedMax = Math.max(slaMin, slaMax);
  return {
    sla_min: normalizedMin,
    sla_max: normalizedMax,
    cancellation_cozinha: valueOrDefault(map.score_weight_cancellation_cozinha, 0.30),
    cancellation_salao: valueOrDefault(map.score_weight_cancellation_salao, 0.30),
    stockout_salao: valueOrDefault(map.score_weight_stockout_salao, 0.10),
  };
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
  stockouts: number, stockDed: number
): Promise<void> {
  await query(
     `INSERT INTO performance_scores (entity, date, base_score, final_score, total_demands,
       sla_breaches, sla_breach_deduction, cancellations, cancellation_deduction,
       stockouts, stockout_deduction, slow_items, slow_item_deduction, updated_at)
      VALUES ($1, $2, 5.0, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, now())
      ON CONFLICT (entity, date) DO UPDATE SET
       final_score = EXCLUDED.final_score,
       total_demands = EXCLUDED.total_demands,
       sla_breaches = EXCLUDED.sla_breaches,
       sla_breach_deduction = EXCLUDED.sla_breach_deduction,
       cancellations = EXCLUDED.cancellations,
       cancellation_deduction = EXCLUDED.cancellation_deduction,
       stockouts = EXCLUDED.stockouts,
        stockout_deduction = EXCLUDED.stockout_deduction,
        slow_items = 0,
        slow_item_deduction = 0,
        updated_at = now()`,
     [entity, dateStr, finalScore, total,
      slaBreaches, slaDed, cancellations, cancelDed,
      stockouts, stockDed]
   );
}

async function safeCount(sql: string, params: unknown[]): Promise<number> {
  const rows = await query<{ cnt: string }>(sql, params);
  return parseInt(rows[0]?.cnt || '0', 10);
}

export async function computeDailyScores(dateStr: string): Promise<void> {
  const weights = await getWeights();

  const stations = await query<{ id: string; code: string }>(
    `SELECT id, code FROM kitchen_stations`
  );

  // -- Kitchen stations --
  for (const st of stations) {
    const entity = entityFromStationCode(st.code);
    const sid = st.id;

    const slaRows = await query<SlaTimingRow>(
      `SELECT created_at, ready_at, sla_minutes
       FROM demands
       WHERE kitchen_station_id = $1 AND created_at::date = $2 AND sla_breached_cozinha = true
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const slaBreaches = slaRows.length;
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
    const total = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND created_at::date = $2
         AND status != 'annulled'`,
      [sid, dateStr]
    );

    const slaDed = round2(slaRows.reduce((sum, row) => {
      const factor = slaFactor(row.created_at, row.ready_at, Number(row.sla_minutes));
      return sum + penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max);
    }, 0));
    const cancelDed = round2(cancellations * weights.cancellation_cozinha);
    const stockDed = 0; // Removido o peso para cozinha: "Zerou" não tira nota da cozinha
    const totalDed = slaDed + cancelDed + stockDed;
    const finalScore = Math.max(0, Math.round((5.0 - totalDed) * 10) / 10);

    await upsertScore(entity, dateStr, finalScore, total,
      slaBreaches, slaDed, cancellations, cancelDed, stockouts, stockDed);
  }

  // -- Salão --
  const [tolRow] = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'pickup_tolerance_minutes'`
  );
  const toleranceValue = parseFloat(tolRow?.value || '3');
  const tolerance = Number.isFinite(toleranceValue) && toleranceValue > 0 ? toleranceValue : 3;

  const sSlaRows = await query<SlaTimingRow>(
    `SELECT created_at, ready_at, retrieved_at
     FROM demands WHERE created_at::date = $1 AND sla_breached_salao = true AND status != 'annulled'`,
    [dateStr]
  );
  const sSla = sSlaRows.length;
  const sCancel = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE created_at::date = $1 AND status = 'cancelled_salao' AND status != 'annulled'`,
    [dateStr]
  );
  const sStock = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE created_at::date = $1 AND stockout_reported = true AND status != 'annulled'`,
    [dateStr]
  );

  const sTotal = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE created_at::date = $1 AND status != 'annulled'`,
    [dateStr]
  );

  const sSlaDed = round2(sSlaRows.reduce((sum, row) => {
    const factor = slaFactor(row.ready_at, row.retrieved_at, tolerance);
    return sum + penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max);
  }, 0));
  const sCancelDed = round2(sCancel * weights.cancellation_salao);
  const sStockDed = round2(sStock * weights.stockout_salao);
  const sTotalDed = sSlaDed + sCancelDed + sStockDed;
  const sFinal = Math.max(0, Math.round((5.0 - sTotalDed) * 10) / 10);

  await upsertScore('salao', dateStr, sFinal, sTotal,
    sSla, sSlaDed, sCancel, sCancelDed, sStock, sStockDed);

  // -- Cozinha Geral = média das 3 estações --
  const stationRows = await query<{
    total_demands: string; sla_breaches: string; sla_breach_deduction: string;
    cancellations: string; cancellation_deduction: string;
    stockouts: string; stockout_deduction: string;
    final_score: string;
  }>(
    `SELECT
       SUM(total_demands)::int AS total_demands,
       SUM(sla_breaches)::int AS sla_breaches,
       SUM(sla_breach_deduction) AS sla_breach_deduction,
       SUM(cancellations)::int AS cancellations,
       SUM(cancellation_deduction) AS cancellation_deduction,
       SUM(stockouts)::int AS stockouts,
       SUM(stockout_deduction) AS stockout_deduction,
       ROUND(AVG(final_score), 1) AS final_score
     FROM performance_scores
     WHERE date = $1 AND entity IN ('cozinha_quente_a','cozinha_quente_b','cozinha_fria')`,
    [dateStr]
  );

  const agg = stationRows[0];
  if (agg) {
    await upsertScore('cozinha_geral', dateStr,
      parseFloat(agg.final_score || '5.0'),
      parseInt(agg.total_demands || '0', 10),
      parseInt(agg.sla_breaches || '0', 10),
      parseFloat(agg.sla_breach_deduction || '0'),
       parseInt(agg.cancellations || '0', 10),
       parseFloat(agg.cancellation_deduction || '0'),
       parseInt(agg.stockouts || '0', 10),
       parseFloat(agg.stockout_deduction || '0'));
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

export function buildDetractors(score: Pick<PerformanceScoreRow,
  'sla_breaches' | 'sla_breach_deduction' | 'cancellations' | 'cancellation_deduction' | 'stockouts' | 'stockout_deduction'>): PerformanceDetractor[] {
  const list: PerformanceDetractor[] = [];
  const slaBreaches = Number(score.sla_breaches) || 0;
  const slaDeduction = Number(score.sla_breach_deduction) || 0;
  const cancellations = Number(score.cancellations) || 0;
  const cancellationDeduction = Number(score.cancellation_deduction) || 0;
  const stockouts = Number(score.stockouts) || 0;
  const stockoutDeduction = Number(score.stockout_deduction) || 0;
  if (slaBreaches > 0) {
    list.push({ label: 'Estouros de SLA', count: slaBreaches, deduction: slaDeduction });
  }
  if (cancellations > 0) {
    list.push({ label: 'Cancelamentos', count: cancellations, deduction: cancellationDeduction });
  }
  if (stockouts > 0) {
    list.push({ label: 'Zerados', count: stockouts, deduction: stockoutDeduction });
  }
  list.sort((a, b) => b.deduction - a.deduction);
  return list;
}

export interface DetractorDate {
  type: string;
  date: string;
  demand_id: string;
  product_name: string;
  detail: string;
  deduction: number;
  station?: string;
}

export async function getDetractorDates(entity: string, dateFrom: string, dateTo: string): Promise<DetractorDate[]> {
  const weights = await getWeights();
  const results: DetractorDate[] = [];

  if (entity === 'cozinha_quente_a' || entity === 'cozinha_quente_b' || entity === 'cozinha_fria') {
    const stationCode = entity === 'cozinha_quente_a' ? 'quente_a'
      : entity === 'cozinha_quente_b' ? 'quente_b' : 'fria';

    const slaRows = await query<{
      id: string; product_name: string; created_at: string | Date; ready_at: string | Date | null;
      sla_minutes: number | string | null; station: string;
    }>(
      `SELECT d.id, d.product_name, d.created_at, d.ready_at, d.sla_minutes, ks.name AS station
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date >= $2 AND d.created_at::date <= $3 AND d.sla_breached_cozinha = true AND d.status != 'annulled'`,
      [stationCode, dateFrom, dateTo]
    );
    slaRows.forEach(r => {
      const limit = Number(r.sla_minutes);
      const factor = slaFactor(r.created_at, r.ready_at, limit);
      results.push({
        type: 'Estouro de SLA',
        date: formatDate(r.created_at),
        demand_id: r.id, product_name: r.product_name,
        detail: `Excedeu em ${Math.max(0, (factor - 1) * limit).toFixed(1)} min (${formatFactor(factor)}× SLA)`,
        deduction: penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max),
        station: r.station,
      });
    });

    const cancelRows = await query<{ id: string; product_name: string; created_at: string | Date; cancel_reason: string | null; station: string }>(
      `SELECT d.id, d.product_name, d.created_at, d.cancel_reason, ks.name AS station
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date >= $2 AND d.created_at::date <= $3 AND d.status = 'cancelled_cozinha'`,
      [stationCode, dateFrom, dateTo]
    );
    cancelRows.forEach(r => results.push({
      type: 'Cancelamento', date: formatDate(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: r.cancel_reason || 'Sem motivo registrado',
      deduction: round2(weights.cancellation_cozinha),
      station: r.station,
    }));

    const stockRows = await query<{ id: string; product_name: string; created_at: string | Date; station: string }>(
      `SELECT d.id, d.product_name, d.created_at, ks.name AS station
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date >= $2 AND d.created_at::date <= $3 AND d.stockout_reported = true AND d.status != 'annulled'`,
      [stationCode, dateFrom, dateTo]
    );
    stockRows.forEach(r => results.push({
      type: 'Zerado', date: formatDate(r.created_at),
      demand_id: r.id, product_name: r.product_name, detail: 'Produto zerou na cozinha',
      deduction: 0, station: r.station,
    }));
  }

  if (entity === 'salao') {
    const [tolRow] = await query<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'pickup_tolerance_minutes'`
    );
    const toleranceValue = parseFloat(tolRow?.value || '3');
    const tolerance = Number.isFinite(toleranceValue) && toleranceValue > 0 ? toleranceValue : 3;

    const sSlaRows = await query<{
      id: string; product_name: string; created_at: string | Date; ready_at: string | Date | null;
      retrieved_at: string | Date | null;
    }>(
      `SELECT id, product_name, created_at, ready_at, retrieved_at
       FROM demands WHERE created_at::date >= $1 AND created_at::date <= $2 AND sla_breached_salao = true AND status != 'annulled'`,
      [dateFrom, dateTo]
    );
    sSlaRows.forEach(r => {
      const factor = slaFactor(r.ready_at, r.retrieved_at, tolerance);
      results.push({
        type: 'Estouro de SLA', date: formatDate(r.created_at),
        demand_id: r.id, product_name: r.product_name,
        detail: `Excedeu em ${Math.max(0, (factor - 1) * tolerance).toFixed(1)} min (${formatFactor(factor)}× SLA)`,
        deduction: penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max),
        station: 'Salão',
      });
    });

    const sCancelRows = await query<{ id: string; product_name: string; created_at: string | Date; cancel_reason: string | null }>(
      `SELECT id, product_name, created_at, cancel_reason
       FROM demands WHERE created_at::date >= $1 AND created_at::date <= $2 AND status = 'cancelled_salao'`,
      [dateFrom, dateTo]
    );
    sCancelRows.forEach(r => results.push({
      type: 'Cancelamento', date: formatDate(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: r.cancel_reason || 'Sem motivo registrado',
      deduction: round2(weights.cancellation_salao), station: 'Salão',
    }));

    const sStockRows = await query<{ id: string; product_name: string; created_at: string | Date }>(
      `SELECT id, product_name, created_at
       FROM demands WHERE created_at::date >= $1 AND created_at::date <= $2 AND stockout_reported = true AND status != 'annulled'`,
      [dateFrom, dateTo]
    );
    sStockRows.forEach(r => results.push({
      type: 'Zerado', date: formatDate(r.created_at),
      demand_id: r.id, product_name: r.product_name, detail: 'Reportado pelo salão',
      deduction: round2(weights.stockout_salao), station: 'Salão',
    }));
  }

  if (entity === 'cozinha_geral') {
    const stationCodes = ['quente_a', 'quente_b', 'fria'];
    for (const code of stationCodes) {
      const subResults = await getDetractorDates(
        code === 'quente_a' ? 'cozinha_quente_a' : code === 'quente_b' ? 'cozinha_quente_b' : 'cozinha_fria',
        dateFrom, dateTo
      );
      results.push(...subResults);
    }
  }

  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return results;
}
