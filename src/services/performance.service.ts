import { query } from '../db/client';
import { PerformanceScoreRow, PerformanceDetractor } from '../types';

interface Weights {
  sla_breach: number;
  cancellation: number;
  stockout_kitchen: number;
  stockout_salao: number;
  slow_item: number;
}

async function getWeights(): Promise<Weights> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE key LIKE 'score_weight_%'`
  );
  const map: Record<string, number> = {};
  rows.forEach(r => { map[r.key] = parseFloat(r.value); });
  return {
    sla_breach: map.score_weight_sla_breach ?? 0.15,
    cancellation: map.score_weight_cancellation ?? 0.30,
    stockout_kitchen: map.score_weight_stockout_kitchen ?? 0.20,
    stockout_salao: map.score_weight_stockout_salao ?? 0.10,
    slow_item: map.score_weight_slow_item ?? 0.10,
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
  stockouts: number, stockDed: number,
  slowItems: number, slowDed: number
): Promise<void> {
  await query(
    `INSERT INTO performance_scores (entity, date, base_score, final_score, total_demands,
       sla_breaches, sla_breach_deduction, cancellations, cancellation_deduction,
       stockouts, stockout_deduction, slow_items, slow_item_deduction, updated_at)
     VALUES ($1, $2, 5.0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     ON CONFLICT (entity, date) DO UPDATE SET
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
     stockouts, stockDed, slowItems, slowDed]
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

    const slaDed = Math.round(slaBreaches * weights.sla_breach * 100) / 100;
    const cancelDed = Math.round(cancellations * weights.cancellation * 100) / 100;
    const stockDed = Math.round(stockouts * weights.stockout_kitchen * 100) / 100;
    const slowDed = Math.round(slowItems * weights.slow_item * 100) / 100;
    const totalDed = slaDed + cancelDed + stockDed + slowDed;
    const finalScore = Math.max(0, Math.round((5.0 - totalDed) * 10) / 10);

    await upsertScore(entity, dateStr, finalScore, total,
      slaBreaches, slaDed, cancellations, cancelDed, stockouts, stockDed, slowItems, slowDed);
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

  const sSlaDed = Math.round(sSla * weights.sla_breach * 100) / 100;
  const sCancelDed = Math.round(sCancel * weights.cancellation * 100) / 100;
  const sStockDed = Math.round(sStock * weights.stockout_salao * 100) / 100;
  const sSlowDed = Math.round(sSlow * weights.slow_item * 100) / 100;
  const sTotalDed = sSlaDed + sCancelDed + sStockDed + sSlowDed;
  const sFinal = Math.max(0, Math.round((5.0 - sTotalDed) * 10) / 10);

  await upsertScore('salao', dateStr, sFinal, sTotal,
    sSla, sSlaDed, sCancel, sCancelDed, sStock, sStockDed, sSlow, sSlowDed);

  // -- Cozinha Geral = média das 3 estações --
  const stationRows = await query<{
    total_demands: string; sla_breaches: string; sla_breach_deduction: string;
    cancellations: string; cancellation_deduction: string;
    stockouts: string; stockout_deduction: string;
    slow_items: string; slow_item_deduction: string;
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
       SUM(slow_items)::int AS slow_items,
       SUM(slow_item_deduction) AS slow_item_deduction,
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
      parseFloat(agg.stockout_deduction || '0'),
      parseInt(agg.slow_items || '0', 10),
      parseFloat(agg.slow_item_deduction || '0'));
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

export interface DetractorDate {
  type: string;
  date: string;
  demand_id: string;
  product_name: string;
  detail: string;
}

export async function getDetractorDates(entity: string, dateStr: string): Promise<DetractorDate[]> {
  const results: DetractorDate[] = [];

  if (entity === 'cozinha_quente_a' || entity === 'cozinha_quente_b' || entity === 'cozinha_fria') {
    const stationCode = entity === 'cozinha_quente_a' ? 'quente_a'
      : entity === 'cozinha_quente_b' ? 'quente_b' : 'fria';

    const slaRows = await query<{ id: string; product_name: string; created_at: string; sla_breach_minutes_cozinha: number }>(
      `SELECT d.id, d.product_name, d.created_at, d.sla_breach_minutes_cozinha
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date = $2 AND d.sla_breached_cozinha = true AND d.status != 'annulled'`,
      [stationCode, dateStr]
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
       WHERE ks.code = $1 AND d.created_at::date = $2 AND d.status = 'cancelled_cozinha'`,
      [stationCode, dateStr]
    );
    cancelRows.forEach(r => results.push({
      type: 'Cancelamento', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: r.cancel_reason || 'Sem motivo registrado',
    }));

    const stockRows = await query<{ id: string; product_name: string; created_at: string }>(
      `SELECT d.id, d.product_name, d.created_at
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date = $2 AND d.stockout_reported = true AND d.status != 'annulled'`,
      [stationCode, dateStr]
    );
    stockRows.forEach(r => results.push({
      type: 'Zerado', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name, detail: 'Produto zerou na cozinha',
    }));

    const slowRows = await query<{ id: string; product_name: string; created_at: string; sla_minutes: number }>(
      `SELECT d.id, d.product_name, d.created_at, d.sla_minutes
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND d.created_at::date = $2 AND d.status != 'annulled'
         AND d.ready_at IS NOT NULL AND d.sla_minutes IS NOT NULL
         AND EXTRACT(EPOCH FROM (d.ready_at - d.created_at))/60 > d.sla_minutes * 1.5`,
      [stationCode, dateStr]
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
       FROM demands WHERE created_at::date = $1 AND sla_breached_salao = true AND status != 'annulled'`,
      [dateStr]
    );
    sSlaRows.forEach(r => results.push({
      type: 'Estouro de SLA', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: `Excedeu em ${Number(r.sla_breach_minutes_salao).toFixed(1)} min`,
    }));

    const sCancelRows = await query<{ id: string; product_name: string; created_at: string; cancel_reason: string | null }>(
      `SELECT id, product_name, created_at, cancel_reason
       FROM demands WHERE created_at::date = $1 AND status = 'cancelled_salao'`,
      [dateStr]
    );
    sCancelRows.forEach(r => results.push({
      type: 'Cancelamento', date: (r.created_at as any) instanceof Date ? (r.created_at as any).toISOString() : String(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: r.cancel_reason || 'Sem motivo registrado',
    }));

    const sStockRows = await query<{ id: string; product_name: string; created_at: string }>(
      `SELECT id, product_name, created_at
       FROM demands WHERE created_at::date = $1 AND stockout_reported = true AND status != 'annulled'`,
      [dateStr]
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
       FROM demands WHERE created_at::date = $1 AND status != 'annulled'
         AND retrieved_at IS NOT NULL AND ready_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (retrieved_at - ready_at))/60 > $2`,
      [dateStr, tolerance * 2]
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
        dateStr
      );
      results.push(...subResults);
    }
  }

  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return results;
}
