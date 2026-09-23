import { query } from '../db/client';
import { PerformanceDetractor, PerformanceScoreRow, PerformanceWeights } from '../types';
import { BR_TZ, brDayOf } from './period.service';

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

function capDeductions(sla: number, canc: number, stock: number, ret: number): { sla: number; canc: number; stock: number; ret: number; total: number } {
  const total = sla + canc + stock + ret;
  if (total <= 5) return { sla, canc, stock, ret, total };
  const scale = 5 / total;
  // distribui proporcionalmente e corrige arredondamento no stock
  const s = round2(sla * scale);
  const c = round2(canc * scale);
  const r = round2(ret * scale);
  const st = round2(5 - s - c - r);
  return { sla: s, canc: c, stock: Math.max(0, st), ret: r, total: 5 };
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

// Tolerância (em minutos) entre o pedido ficar pronto e a retirada pelo salão
// antes de contar como estouro de SLA. Editável no painel admin
// (Critérios de Avaliação). Fallback 3 min para base antiga/sem valor.
export async function getPickupTolerance(): Promise<number> {
  const [row] = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'pickup_tolerance_minutes'`
  );
  const parsed = parseFloat(row?.value || '3');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export async function getWeights(): Promise<PerformanceWeights> {
  const keys = [
    'score_weight_sla_min',
    'score_weight_sla_max',
    'score_weight_cancellation_cozinha',
    'score_weight_cancellation_salao',
    'score_weight_stockout_salao',
    'score_weight_returned',
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
    returned: valueOrDefault(map.score_weight_returned, 0.20),
  };
}

function entityFromStationCode(code: string): string {
  if (code === 'quente_a') return 'cozinha_quente_a';
  if (code === 'quente_b') return 'cozinha_quente_b';
  if (code === 'jantar') return 'cozinha_jantar';
  return 'cozinha_fria';
}

async function upsertScore(
  entity: string, dateStr: string, finalScore: number, total: number,
  slaBreaches: number, slaDed: number,
  cancellations: number, cancelDed: number,
  stockouts: number, stockDed: number,
  returned: number, returnedDed: number
): Promise<void> {
  await query(
     `INSERT INTO performance_scores (entity, date, base_score, final_score, total_demands,
       sla_breaches, sla_breach_deduction, cancellations, cancellation_deduction,
       stockouts, stockout_deduction, returned, returned_deduction, slow_items, slow_item_deduction, updated_at)
      VALUES ($1, $2, 5.0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, now())
      ON CONFLICT (entity, date) DO UPDATE SET
       final_score = EXCLUDED.final_score,
       total_demands = EXCLUDED.total_demands,
       sla_breaches = EXCLUDED.sla_breaches,
       sla_breach_deduction = EXCLUDED.sla_breach_deduction,
       cancellations = EXCLUDED.cancellations,
       cancellation_deduction = EXCLUDED.cancellation_deduction,
       stockouts = EXCLUDED.stockouts,
       stockout_deduction = EXCLUDED.stockout_deduction,
       returned = EXCLUDED.returned,
       returned_deduction = EXCLUDED.returned_deduction,
       slow_items = 0,
       slow_item_deduction = 0,
       updated_at = now()`,
     [entity, dateStr, finalScore, total,
      slaBreaches, slaDed, cancellations, cancelDed,
      stockouts, stockDed, returned, returnedDed]
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
       WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2 AND sla_breached_cozinha = true
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const slaBreaches = slaRows.length;
    // Zeramentos com SLA já estourado no reporte: culpa da cozinha (estouro),
    // exceto os que também estouraram no ready (já contados acima, sem duplicar).
    const lateStockRows = await query<{ stockout_sla_factor: number | string | null }>(
      `SELECT stockout_sla_factor
       FROM demands
       WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2 AND stockout_reported = true
         AND stockout_sla_factor > 1 AND sla_breached_cozinha = false
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const lateStockBreaches = lateStockRows.length;
    const lateStockDed = round2(lateStockRows.reduce((sum, row) => {
      return sum + penaltyForSlaFactor(Number(row.stockout_sla_factor), weights.sla_min, weights.sla_max);
    }, 0));
    const cancellations = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2 AND status = 'cancelled_cozinha'
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const stockouts = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2 AND stockout_reported = true
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const total = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2
         AND status != 'annulled'`,
      [sid, dateStr]
    );
    const returnedCount = await safeCount(
      `SELECT COALESCE(SUM(returned_to_kitchen_count), 0)::int AS cnt FROM demands
       WHERE kitchen_station_id = $1 AND ${brDayOf('created_at')} = $2
         AND status != 'annulled'`,
      [sid, dateStr]
    );

    const slaDedRaw = round2(slaRows.reduce((sum, row) => {
      const factor = slaFactor(row.created_at, row.ready_at, Number(row.sla_minutes));
      return sum + penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max);
    }, 0) + lateStockDed);
    const cancelDedRaw = round2(cancellations * weights.cancellation_cozinha);
    const stockDedRaw = 0; // Removido o peso para cozinha: "Zerou" não tira nota da cozinha
    const returnedDedRaw = round2(returnedCount * weights.returned);
    const cappedK = capDeductions(slaDedRaw, cancelDedRaw, stockDedRaw, returnedDedRaw);
    const finalScore = Math.max(0, Math.round((5.0 - cappedK.total) * 10) / 10);

    await upsertScore(entity, dateStr, finalScore, total,
      slaBreaches + lateStockBreaches, cappedK.sla, cancellations, cappedK.canc, stockouts, cappedK.stock,
      returnedCount, cappedK.ret);
  }

  // -- Salão --
  const tolerance = await getPickupTolerance();

  // Corte do turno jantar: no dia em que o jantar foi iniciado, demandas
  // criadas a partir do início pertencem ao salao_jantar. O "Salão" (turno do
  // almoço/geral) fica restrito ao que veio antes do início para não puxar
  // penalidades do jantar.
  // O dia do início do jantar é derivado em BRT pela própria query — o valor
  // gravado por `now()::text` depende do fuso da sessão do banco (UTC em produção).
  const [dinnerStartRow] = await query<{ value: string; start_day: string | null }>(
    `SELECT value,
       CASE WHEN value IS NULL OR value = '' THEN NULL
         ELSE (value::timestamptz AT TIME ZONE '${BR_TZ}')::date::text END AS start_day
     FROM system_settings WHERE key = 'shift_dinner_started_at'`
  );
  const dinnerStart = (dinnerStartRow?.value || '').trim();
  const dinnerOnThisDay = Boolean(dinnerStart) && dinnerStartRow?.start_day === dateStr;
  const lunchCutoff = dinnerOnThisDay ? dinnerStart : null;

  const sSlaRows = await query<SlaTimingRow>(
    `SELECT created_at, ready_at, retrieved_at
     FROM demands WHERE ${brDayOf('created_at')} = $1
       AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
       AND sla_breached_salao = true AND status != 'annulled'`,
    [dateStr, lunchCutoff]
  );
  const sSla = sSlaRows.length;
  const sCancel = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE ${brDayOf('created_at')} = $1
       AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
       AND status = 'cancelled_salao' AND status != 'annulled'`,
    [dateStr, lunchCutoff]
  );
  // Zeramento dentro do SLA (ou sem veredito, dados antigos): detrator do salão.
  // Zeramento com SLA estourado vai para o estouro da cozinha (bloco acima).
  const sStock = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE ${brDayOf('created_at')} = $1
      AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
      AND stockout_reported = true
      AND (stockout_sla_factor IS NULL OR stockout_sla_factor <= 1) AND status != 'annulled'`,
    [dateStr, lunchCutoff]
  );

  const sTotal = await safeCount(
    `SELECT COUNT(*)::int AS cnt FROM demands WHERE ${brDayOf('created_at')} = $1
       AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
       AND status != 'annulled'`,
    [dateStr, lunchCutoff]
  );

  const sSlaDedRaw = round2(sSlaRows.reduce((sum, row) => {
    const factor = slaFactor(row.ready_at, row.retrieved_at, tolerance);
    return sum + penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max);
  }, 0));
  const sCancelDedRaw = round2(sCancel * weights.cancellation_salao);
  const sStockDedRaw = round2(sStock * weights.stockout_salao);
  const cappedS = capDeductions(sSlaDedRaw, sCancelDedRaw, sStockDedRaw, 0);
  const sFinal = Math.max(0, Math.round((5.0 - cappedS.total) * 10) / 10);

  await upsertScore('salao', dateStr, sFinal, sTotal,
    sSla, cappedS.sla, sCancel, cappedS.canc, sStock, cappedS.stock, 0, 0);

  // -- Salão Jantar: mesma fórmula, só com demandas criadas após ativar o jantar --
  // (sem janela de jantar no dia, registra 5.0 zerado como as demais entidades)
  if (!dinnerOnThisDay) {
    await upsertScore('salao_jantar', dateStr, 5.0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  } else {
    const jSlaRows = await query<SlaTimingRow>(
      `SELECT created_at, ready_at, retrieved_at
       FROM demands WHERE ${brDayOf('created_at')} = $1 AND created_at >= $2::timestamptz
        AND sla_breached_salao = true AND status != 'annulled'`,
      [dateStr, dinnerStart]
    );
    const jCancel = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands WHERE ${brDayOf('created_at')} = $1 AND created_at >= $2::timestamptz
        AND status = 'cancelled_salao' AND status != 'annulled'`,
      [dateStr, dinnerStart]
    );
    const jStock = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands WHERE ${brDayOf('created_at')} = $1 AND created_at >= $2::timestamptz
        AND stockout_reported = true AND (stockout_sla_factor IS NULL OR stockout_sla_factor <= 1)
        AND status != 'annulled'`,
      [dateStr, dinnerStart]
    );
    const jTotal = await safeCount(
      `SELECT COUNT(*)::int AS cnt FROM demands WHERE ${brDayOf('created_at')} = $1 AND created_at >= $2::timestamptz
        AND status != 'annulled'`,
      [dateStr, dinnerStart]
    );
    const jSlaDedRaw = round2(jSlaRows.reduce((sum, row) => {
      const factor = slaFactor(row.ready_at, row.retrieved_at, tolerance);
      return sum + penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max);
    }, 0));
    const jCancelDedRaw = round2(jCancel * weights.cancellation_salao);
    const jStockDedRaw = round2(jStock * weights.stockout_salao);
    const cappedJ = capDeductions(jSlaDedRaw, jCancelDedRaw, jStockDedRaw, 0);
    const jFinal = Math.max(0, Math.round((5.0 - cappedJ.total) * 10) / 10);

    await upsertScore('salao_jantar', dateStr, jFinal, jTotal,
      jSlaRows.length, cappedJ.sla, jCancel, cappedJ.canc, jStock, cappedJ.stock, 0, 0);
  }

  // -- Operação: média simples das entidades com movimento no dia --
  // (só entra quem tem demandas; estação vazia em 5.0 não infla a média)
  // salao e salao_jantar são turnos distintos (almoço × jantar) — os dois entram.
  const opLeaves = await query<{
    entity: string; final_score: string; total_demands: string;
    sla_breaches: string; sla_breach_deduction: string;
    cancellations: string; cancellation_deduction: string;
    stockouts: string; stockout_deduction: string;
    returned: string; returned_deduction: string;
  }>(
    `SELECT entity, final_score, total_demands, sla_breaches, sla_breach_deduction,
       cancellations, cancellation_deduction, stockouts, stockout_deduction,
       returned, returned_deduction
     FROM performance_scores
     WHERE date = $1 AND total_demands > 0
       AND entity IN ('cozinha_quente_a','cozinha_quente_b','cozinha_fria','cozinha_jantar','salao','salao_jantar')`,
    [dateStr]
  );

  if (opLeaves.length === 0) {
    await upsertScore('operacao', dateStr, 5.0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  } else {
    const n = opLeaves.length;
    const avgScore = opLeaves.reduce((s, r) => s + parseFloat(r.final_score || '5'), 0) / n;
    // Deduções efetivas: quando a nota foi para 0, a dedução real foi >=5 mas é
    // exibida como 5 (5 - 0). Para a média da operação usar a dedução efetiva
    // evita inconsistência do tipo 5 - 2,22 = 2,78 vs nota 3,8.
    const eff = (r: (typeof opLeaves)[number]): number => {
      const s = parseFloat(r.final_score || '5');
      if (s <= 0) return 5;
      const d = parseFloat(r.sla_breach_deduction || '0') + parseFloat(r.cancellation_deduction || '0') + parseFloat(r.stockout_deduction || '0') + parseFloat(r.returned_deduction || '0');
      return Math.min(5, d);
    };
    const avgEffDed = round2(opLeaves.reduce((s, r) => s + eff(r), 0) / n);
    // Quebra proporcional pelas categorias (mantém a soma = avgEffDed)
    const sumCat = (get: (r: (typeof opLeaves)[number]) => string): number =>
      opLeaves.reduce((s, r) => s + parseFloat(get(r) || '0'), 0);
    const totalRaw = sumCat((r) => String(parseFloat(r.sla_breach_deduction || '0') + parseFloat(r.cancellation_deduction || '0') + parseFloat(r.stockout_deduction || '0') + parseFloat(r.returned_deduction || '0')));
    const scale = totalRaw > 0 ? avgEffDed / (totalRaw / n) : 0;
    // Para robustez, quando houver clamp (ex.: salão 10,1 → 5), a escala corrige.
    const avgSla = round2(sumCat((r) => r.sla_breach_deduction) / n * (scale || 1));
    const avgCanc = round2(sumCat((r) => r.cancellation_deduction) / n * (scale || 1));
    const avgStock = round2(sumCat((r) => r.stockout_deduction) / n * (scale || 1));
    const avgRet = round2(sumCat((r) => r.returned_deduction) / n * (scale || 1));
    // Ajuste de arredondamento para garantir soma = avgEffDed
    const adj = round2(avgEffDed - (avgSla + avgCanc + avgStock + avgRet));
    const finalAvgStock = round2(avgStock + adj);
    const sumInt = (get: (r: (typeof opLeaves)[number]) => string): number =>
      opLeaves.reduce((s, r) => s + parseInt(get(r) || '0', 10), 0);
    await upsertScore('operacao', dateStr,
      Math.round(avgScore * 10) / 10,
      opLeaves.reduce((m, r) => Math.max(m, parseInt(r.total_demands || '0', 10)), 0),
      sumInt((r) => r.sla_breaches), avgSla,
      sumInt((r) => r.cancellations), avgCanc,
      opLeaves.filter((r) => r.entity === 'salao').reduce((s, r) => s + parseInt(r.stockouts || '0', 10), 0),
      finalAvgStock,
      sumInt((r) => r.returned), avgRet);
  }

  // -- Cozinha Geral = média das estações COM movimento (vazia não entra) --
  // Deduções também em média para manter 5 - deduções ≈ nota (robustez).
  const stationRows = await query<{
    total_demands: string; sla_breaches: string; sla_breach_deduction: string;
    cancellations: string; cancellation_deduction: string;
    stockouts: string; stockout_deduction: string;
    returned: string; returned_deduction: string;
    final_score: string;
  }>(
    `SELECT
       SUM(total_demands)::int AS total_demands,
       SUM(sla_breaches)::int AS sla_breaches,
       AVG(sla_breach_deduction) AS sla_breach_deduction,
       SUM(cancellations)::int AS cancellations,
       AVG(cancellation_deduction) AS cancellation_deduction,
       SUM(stockouts)::int AS stockouts,
       AVG(stockout_deduction) AS stockout_deduction,
       SUM(returned)::int AS returned,
       AVG(returned_deduction) AS returned_deduction,
       ROUND(AVG(final_score), 1) AS final_score
      FROM performance_scores
      WHERE date = $1 AND entity IN ('cozinha_quente_a','cozinha_quente_b','cozinha_fria')
        AND total_demands > 0`,
    [dateStr]
  );

  const agg = stationRows[0];
  if (agg && agg.total_demands !== null) {
    await upsertScore('cozinha_geral', dateStr,
      parseFloat(agg.final_score || '5.0'),
      parseInt(agg.total_demands || '0', 10),
      parseInt(agg.sla_breaches || '0', 10),
      parseFloat(agg.sla_breach_deduction || '0'),
       parseInt(agg.cancellations || '0', 10),
       parseFloat(agg.cancellation_deduction || '0'),
       parseInt(agg.stockouts || '0', 10),
       parseFloat(agg.stockout_deduction || '0'),
       parseInt(agg.returned || '0', 10),
       parseFloat(agg.returned_deduction || '0'));
  } else {
    await upsertScore('cozinha_geral', dateStr, 5.0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}

export async function ensureScoresForDate(dateStr: string): Promise<void> {
  const [row] = await query<{ cnt: string }>(
    `SELECT COUNT(*)::int AS cnt FROM performance_scores WHERE date = $1`,
    [dateStr]
  );
  if (parseInt(row?.cnt || '0', 10) < 8) {
    await computeDailyScores(dateStr);
  }
}

export function buildDetractors(score: Pick<PerformanceScoreRow,
  'sla_breaches' | 'sla_breach_deduction' | 'cancellations' | 'cancellation_deduction' | 'stockouts' | 'stockout_deduction' | 'returned' | 'returned_deduction'>): PerformanceDetractor[] {
  const list: PerformanceDetractor[] = [];
  const slaBreaches = Number(score.sla_breaches) || 0;
  const slaDeduction = Number(score.sla_breach_deduction) || 0;
  const cancellations = Number(score.cancellations) || 0;
  const cancellationDeduction = Number(score.cancellation_deduction) || 0;
  const stockouts = Number(score.stockouts) || 0;
  const stockoutDeduction = Number(score.stockout_deduction) || 0;
  const returned = Number(score.returned) || 0;
  const returnedDeduction = Number(score.returned_deduction) || 0;
  if (slaBreaches > 0) {
    list.push({ label: 'Estouros de SLA', count: slaBreaches, deduction: slaDeduction });
  }
  if (cancellations > 0) {
    list.push({ label: 'Cancelamentos', count: cancellations, deduction: cancellationDeduction });
  }
  if (stockouts > 0) {
    list.push({ label: 'Zerados', count: stockouts, deduction: stockoutDeduction });
  }
  if (returned > 0) {
    list.push({ label: 'Devolvidas pelo salão', count: returned, deduction: returnedDeduction });
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

  if (entity === 'cozinha_quente_a' || entity === 'cozinha_quente_b' || entity === 'cozinha_fria' || entity === 'cozinha_jantar') {
    const stationCode = entity === 'cozinha_quente_a' ? 'quente_a'
      : entity === 'cozinha_quente_b' ? 'quente_b'
      : entity === 'cozinha_jantar' ? 'jantar' : 'fria';

    const slaRows = await query<{
      id: string; product_name: string; created_at: string | Date; ready_at: string | Date | null;
      sla_minutes: number | string | null; station: string;
    }>(
      `SELECT d.id, d.product_name, d.created_at, d.ready_at, d.sla_minutes, ks.name AS station
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND ${brDayOf('d.created_at')} >= $2 AND ${brDayOf('d.created_at')} <= $3 AND d.sla_breached_cozinha = true AND d.status != 'annulled'`,
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
       WHERE ks.code = $1 AND ${brDayOf('d.created_at')} >= $2 AND ${brDayOf('d.created_at')} <= $3 AND d.status = 'cancelled_cozinha'`,
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
       WHERE ks.code = $1 AND ${brDayOf('d.created_at')} >= $2 AND ${brDayOf('d.created_at')} <= $3 AND d.stockout_reported = true
        AND (d.stockout_sla_factor IS NULL OR d.stockout_sla_factor <= 1) AND d.status != 'annulled'`,
      [stationCode, dateFrom, dateTo]
    );
    stockRows.forEach(r => results.push({
      type: 'Zerado', date: formatDate(r.created_at),
      demand_id: r.id, product_name: r.product_name, detail: 'Produto zerou na cozinha',
      deduction: 0, station: r.station,
    }));

    // Zeramentos com SLA já estourado: entram no estouro de SLA da cozinha.
    const lateStockRows = await query<{
      id: string; product_name: string; created_at: string | Date;
      stockout_sla_factor: number | string | null; station: string;
    }>(
      `SELECT d.id, d.product_name, d.created_at, d.stockout_sla_factor, ks.name AS station
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND ${brDayOf('d.created_at')} >= $2 AND ${brDayOf('d.created_at')} <= $3 AND d.stockout_reported = true
        AND d.stockout_sla_factor > 1 AND d.sla_breached_cozinha = false AND d.status != 'annulled'`,
      [stationCode, dateFrom, dateTo]
    );
    lateStockRows.forEach(r => {
      const factor = Number(r.stockout_sla_factor);
      results.push({
        type: 'Estouro de SLA', date: formatDate(r.created_at),
        demand_id: r.id, product_name: r.product_name,
        detail: `Zerou com SLA já estourado (${formatFactor(factor)}× SLA)`,
        deduction: penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max),
        station: r.station,
      });
    });

    // Devoluções do salão: cada devolução conta (reincidência acumula).
    const returnedRows = await query<{
      id: string; product_name: string; created_at: string | Date;
      returned_to_kitchen_count: number; returned_to_kitchen_reason: string | null;
      returned_to_kitchen_observation: string | null; station: string;
    }>(
      `SELECT d.id, d.product_name, d.created_at, d.returned_to_kitchen_count,
         d.returned_to_kitchen_reason, d.returned_to_kitchen_observation, ks.name AS station
       FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
       WHERE ks.code = $1 AND ${brDayOf('d.created_at')} >= $2 AND ${brDayOf('d.created_at')} <= $3
         AND d.returned_to_kitchen_count > 0 AND d.status != 'annulled'`,
      [stationCode, dateFrom, dateTo]
    );
    returnedRows.forEach(r => {
      const n = Number(r.returned_to_kitchen_count) || 0;
      const parts: string[] = [];
      const motivo = (r.returned_to_kitchen_reason || '').trim();
      const obs = (r.returned_to_kitchen_observation || '').trim();
      if (motivo) parts.push(`Motivo: ${motivo}`);
      if (obs) parts.push(`Obs.: ${obs}`);
      results.push({
        type: 'Devolvida pelo salão', date: formatDate(r.created_at),
        demand_id: r.id, product_name: r.product_name,
        detail: parts.length > 0 ? parts.join(' · ') : 'Sem motivo informado',
        deduction: round2(n * weights.returned),
        station: r.station,
      });
    });
  }

  if (entity === 'salao' || entity === 'salao_jantar') {
    const tolerance = await getPickupTolerance();
    const stationLabel = entity === 'salao_jantar' ? 'Salão Jantar' : 'Salão';

    // Corte do turno jantar (mesma regra de computeDailyScores): no dia em que
    // o jantar foi iniciado, demandas criadas a partir do início pertencem ao
    // salao_jantar — o "Salão" (almoço/geral) não as contabiliza.
    const [startRow] = await query<{ value: string; start_day: string | null }>(
      `SELECT value,
         CASE WHEN value IS NULL OR value = '' THEN NULL
           ELSE (value::timestamptz AT TIME ZONE '${BR_TZ}')::date::text END AS start_day
       FROM system_settings WHERE key = 'shift_dinner_started_at'`
    );
    const dinnerCutoff = (startRow?.value || '').trim() || null;
    const dinnerCutoffDay = dinnerCutoff ? startRow?.start_day || null : null;
    if (entity === 'salao_jantar' && (!dinnerCutoff || !dinnerCutoffDay)) return results;

    // Só a data do início do jantar tem janela de jantar (demais dias ficam
    // inteiramente com o salão do almoço/turno geral).
    const dinnerWindowFilter = entity === 'salao_jantar'
      ? `AND created_at >= $3::timestamptz AND ${brDayOf('created_at')} = $4::date`
      : `AND NOT ($3::timestamptz IS NOT NULL AND $4::date IS NOT NULL AND created_at >= $3::timestamptz AND ${brDayOf('created_at')} = $4::date)`;
    const dinnerWindowParams = [dateFrom, dateTo, dinnerCutoff, dinnerCutoffDay];

    const sSlaRows = await query<{
      id: string; product_name: string; created_at: string | Date; ready_at: string | Date | null;
      retrieved_at: string | Date | null;
    }>(
      `SELECT id, product_name, created_at, ready_at, retrieved_at
       FROM demands WHERE ${brDayOf('created_at')} >= $1 AND ${brDayOf('created_at')} <= $2 AND sla_breached_salao = true AND status != 'annulled'
       ${dinnerWindowFilter}`,
      dinnerWindowParams
    );
    sSlaRows.forEach(r => {
      const factor = slaFactor(r.ready_at, r.retrieved_at, tolerance);
      results.push({
        type: 'Estouro de SLA', date: formatDate(r.created_at),
        demand_id: r.id, product_name: r.product_name,
        detail: `Excedeu em ${Math.max(0, (factor - 1) * tolerance).toFixed(1)} min (${formatFactor(factor)}× SLA)`,
        deduction: penaltyForSlaFactor(factor, weights.sla_min, weights.sla_max),
        station: stationLabel,
      });
    });

    const sCancelRows = await query<{ id: string; product_name: string; created_at: string | Date; cancel_reason: string | null }>(
      `SELECT id, product_name, created_at, cancel_reason
       FROM demands WHERE ${brDayOf('created_at')} >= $1 AND ${brDayOf('created_at')} <= $2 AND status = 'cancelled_salao'
       ${dinnerWindowFilter}`,
      dinnerWindowParams
    );
    sCancelRows.forEach(r => results.push({
      type: 'Cancelamento', date: formatDate(r.created_at),
      demand_id: r.id, product_name: r.product_name,
      detail: r.cancel_reason || 'Sem motivo registrado',
      deduction: round2(weights.cancellation_salao), station: stationLabel,
    }));

    const sStockRows = await query<{ id: string; product_name: string; created_at: string | Date }>(
      `SELECT id, product_name, created_at
       FROM demands WHERE ${brDayOf('created_at')} >= $1 AND ${brDayOf('created_at')} <= $2 AND stockout_reported = true
        AND (stockout_sla_factor IS NULL OR stockout_sla_factor <= 1) AND status != 'annulled'
       ${dinnerWindowFilter}`,
      dinnerWindowParams
    );
    sStockRows.forEach(r => results.push({
      type: 'Zerado', date: formatDate(r.created_at),
      demand_id: r.id, product_name: r.product_name, detail: 'Reportado pelo salão',
      deduction: round2(weights.stockout_salao), station: stationLabel,
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

  // Operação: ocorrências de todas as cozinhas + os dois turnos do salão
  // (salao = almoço/geral; salao_jantar = janela do jantar — sem duplicidade).
  if (entity === 'operacao') {
    const subEntities = ['cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'cozinha_jantar', 'salao', 'salao_jantar'];
    for (const sub of subEntities) {
      const subResults = await getDetractorDates(sub, dateFrom, dateTo);
      results.push(...subResults);
    }
  }

  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return results;
}
