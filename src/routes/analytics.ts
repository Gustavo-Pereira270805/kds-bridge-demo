import { FastifyInstance } from 'fastify';
import { query } from '../db/client';
import {
  PeakHourRow,
  ProductRankingRow,
  ShiftStatsRow,
  SlaBreachRow,
  CancellationRow,
  StockoutRow,
  SpeedByHourRow,
  QueueTimeByStationRow,
  SlaByProductRow,
  PickupByHourRow,
  VolumeMARow,
  WeekdayRow,
  QtyVsTimeRow,
  HeatmapRow,
  WeekComparisonDay,
  QueueTimeByHourRow,
  DayIndicators,
  ReplacementRow,
  PerformanceScoreRow,
  PerformanceResponse,
  EntityScore,
  EntityPerformance,
  PerformanceEntity,
  PerformanceWeightVersion,
} from '../types';
import { ensureScoresForDate, buildDetractors, getPerformanceDetails } from '../services/performance.service';

// v2.5 (§5.6) — indicadores diários embutidos em cada dia do week_comparison;
// a data fica no objeto externo, então `day` é omitida do sub-objeto
type DayIndicatorValues = Omit<DayIndicators, 'day'>;
type WeekComparisonDayWithIndicators = WeekComparisonDay & { indicators: DayIndicatorValues };

export default async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/summary',
    async (request, reply) => {
      try {
        const { from, to } = request.query;

        let whereClause = '';
        const params: string[] = [];

        if (from && to) {
          whereClause = 'WHERE created_at >= $1 AND created_at <= $2';
          params.push(from, to);
        }
        // §4.2 — excluir demandas anuladas das agregações
        const annulledClause = whereClause ? "AND status != 'annulled'" : "WHERE status != 'annulled'";

        const [totalResult] = await query<{ count: string }>(
          `SELECT COUNT(*) as count FROM demands ${whereClause} ${annulledClause}`,
          params
        );

        const [avgResult] = await query<{ avg_minutes: string | null }>(
          `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at)) / 60)) as avg_minutes
           FROM demands
           WHERE status IN ('ready', 'retrieved')
             AND ready_at IS NOT NULL
             ${from && to ? 'AND created_at >= $1 AND created_at <= $2' : ''}`,
          params
        );

        const topResult = await query<{ product_name: string; total: string }>(
          `SELECT product_name, SUM(quantity) as total
           FROM demands ${whereClause} ${annulledClause}
           GROUP BY product_name ORDER BY total DESC LIMIT 5`,
          params
        );

        return {
          total: parseInt(totalResult.count, 10),
          avgTimeMinutes: parseInt(avgResult?.avg_minutes || '0', 10),
          topProducts: topResult,
        };
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar analytics' });
      }
    }
  );

  fastify.get<{ Querystring: { days?: string } }>(
    '/peak-hours',
    async (request, reply) => {
      try {
        const days = parseInt(request.query.days || '30', 10);

        const rows = await query<PeakHourRow>(
          `SELECT
            EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            COUNT(*)::int AS total
           FROM demands
           WHERE created_at >= NOW() - INTERVAL '1 day' * $1
             AND status != 'annulled'
           GROUP BY 1 ORDER BY 1`,
          [days]
        );

        return rows;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar horários de pico' });
      }
    }
  );

  fastify.get<{ Querystring: { days?: string } }>(
    '/by-product',
    async (request, reply) => {
      try {
        const days = parseInt(request.query.days || '30', 10);

        const rows = await query<ProductRankingRow>(
          `SELECT
            product_name,
            COUNT(*)::int AS total_demandas,
            ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at)) / 60), 1) AS tempo_medio_min
           FROM demands
           WHERE status IN ('ready', 'retrieved')
             AND created_at >= NOW() - INTERVAL '1 day' * $1
           GROUP BY product_name
           ORDER BY total_demandas DESC
           LIMIT 10`,
          [days]
        );

        return rows;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar ranking de produtos' });
      }
    }
  );

  fastify.get('/by-shift', async (request, reply) => {
    try {
      const shiftOrder: Record<string, number> = { 'Manhã': 1, 'Almoço': 2, 'Tarde': 3, 'Jantar': 4 };
      const rawRows = await query<ShiftStatsRow>(
        `SELECT
          CASE
            WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 6 AND 11 THEN 'Manhã'
            WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 12 AND 14 THEN 'Almoço'
            WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 15 AND 17 THEN 'Tarde'
            ELSE 'Jantar'
          END AS turno,
          ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at)) / 60), 1) AS tempo_medio_min,
          COUNT(*)::int AS total
        FROM demands
        WHERE status IN ('ready', 'retrieved')
        GROUP BY 1`
      );
      const rows = rawRows.sort((a, b) => (shiftOrder[a.turno] || 9) - (shiftOrder[b.turno] || 9));

      return rows;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar estatísticas por turno' });
    }
  });

  fastify.get<{ Querystring: { from?: string; to?: string; responsible?: string } }>(
    '/sla-breaches',
    async (request, reply) => {
      try {
        const days = parseInt(
          (request.query as any).days || '30',
          10
        );

        const rows = await query<SlaBreachRow>(
          `SELECT
            CASE
              WHEN sla_breached_cozinha THEN 'Cozinha'
              WHEN sla_breached_salao THEN 'Salão'
            END AS responsavel,
            COUNT(*)::int AS total_estouros,
            ROUND(AVG(COALESCE(sla_breach_minutes_cozinha, sla_breach_minutes_salao)), 1) AS media_min_excedidos
          FROM demands
          WHERE (sla_breached_cozinha OR sla_breached_salao)
            AND created_at >= NOW() - INTERVAL '1 day' * $1
            AND status != 'annulled'
          GROUP BY 1`,
          [days]
        );

        return rows;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar estouros de SLA' });
      }
    }
  );

  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/cancellations',
    async (request, reply) => {
      try {
        const days = parseInt(
          (request.query as any).days || '30',
          10
        );

        const rows = await query<CancellationRow>(
          `SELECT
            status AS origem_cancelamento,
            COUNT(*)::int AS total,
            cancel_reason
          FROM demands
          WHERE status IN ('cancelled_salao', 'cancelled_cozinha')
            AND created_at >= NOW() - INTERVAL '1 day' * $1
          GROUP BY status, cancel_reason
          ORDER BY total DESC`,
          [days]
        );

        return rows;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar cancelamentos' });
      }
    }
  );

  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/stockouts',
    async (request, reply) => {
      try {
        const days = parseInt(
          (request.query as any).days || '30',
          10
        );

        const rows = await query<StockoutRow>(
          `SELECT product_name, COUNT(*)::int AS total_roturas
          FROM demands
          WHERE stockout_reported = true
            AND created_at >= NOW() - INTERVAL '1 day' * $1
            AND status != 'annulled'
          GROUP BY product_name
          ORDER BY total_roturas DESC`,
          [days]
        );

        return rows;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar zerados' });
      }
    }
  );

  fastify.get<{ Querystring: { range?: string; from?: string; to?: string; station_id?: string } }>(
    '/dashboard',
    async (request, reply) => {
      try {
        const { range, from, to, station_id } = request.query;

        let dateFrom: string;
        let dateTo: string;
        const now = new Date();

        if (from || to) {
          // §5.1 — período customizado; se só `from` presente, assume dia único (to = from)
          dateFrom = (from || to) as string;
          dateTo = (to || from) as string;
          const diffDays = (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000;
          if (diffDays < 0) {
            return reply.code(400).send({ error: 'A data inicial deve ser anterior ou igual à data final' });
          }
          if (diffDays > 31) {
            return reply.code(400).send({ error: 'O período máximo é de 31 dias' });
          }
        } else if (range === 'week') {
          const d = new Date(now);
          d.setDate(d.getDate() - 7);
          dateFrom = d.toISOString().split('T')[0];
          dateTo = now.toISOString().split('T')[0];
        } else if (range === 'month') {
          const d = new Date(now);
          d.setDate(d.getDate() - 30);
          dateFrom = d.toISOString().split('T')[0];
          dateTo = now.toISOString().split('T')[0];
        } else {
          dateFrom = now.toISOString().split('T')[0];
          dateTo = dateFrom;
        }

        const params: unknown[] = [dateFrom];
        let dateFilter = 'created_at::date >= $1';
        if (dateFrom === dateTo) {
          dateFilter = 'created_at::date = $1';
        } else {
          params.push(dateTo);
          dateFilter = 'created_at::date >= $1 AND created_at::date <= $2';
        }
        const dateFilterD = dateFilter.replace(/\bcreated_at\b/g, 'd.created_at');

        // §5.4 — filtro opcional por estação; station_id é sempre o ÚLTIMO parâmetro posicional
        const stationParamIdx = params.length + 1;
        const stationFilter = station_id ? `AND kitchen_station_id = $${stationParamIdx}` : '';
        const stationFilterD = station_id ? `AND d.kitchen_station_id = $${stationParamIdx}` : '';
        const baseParams: unknown[] = station_id ? [...params, station_id] : params;

        const hasCustomRange = Boolean(from || to);
        const customSpanDays = Math.round(
          (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
        ) + 1;
        const rangeNum = Math.floor(
          dateFrom === dateTo ? 1
            : !hasCustomRange && range === 'week' ? 7
            : !hasCustomRange && range === 'month' ? 30
            : customSpanDays
        );

        async function safeQuery<T>(step: string, sql: string, p: unknown[]): Promise<T[]> {
          try {
            return await query<T>(sql, p);
          } catch (e: any) {
            const msg = e && typeof e === 'object' ? (e.message || String(e)) : String(e);
            throw new Error(`[Step ${step}] ${msg}`);
          }
        }

        // ── 1. KPIs ──
        const [totals] = await safeQuery<{
          total_pedidos: string;
          total_roturas: string;
          total_cancelados: string;
          total_entregues: string;
          atrasos_cozinha: string;
          atrasos_salao: string;
          urgentes_puros: string;
          urgentes_rotura: string;
          dentro_sla: string;
          avg_cooking_min: string;
          avg_pickup_min: string;
        }>('1.KPIs',
          `SELECT
            COUNT(*)::int AS total_pedidos,
            COUNT(*) FILTER (WHERE stockout_reported = true)::int AS total_roturas,
            COUNT(*) FILTER (WHERE status IN ('cancelled_salao','cancelled_cozinha'))::int AS total_cancelados,
            COUNT(*) FILTER (WHERE status = 'retrieved')::int AS total_entregues,
            COUNT(*) FILTER (WHERE sla_breached_cozinha = true)::int AS atrasos_cozinha,
            COUNT(*) FILTER (WHERE sla_breached_salao = true)::int AS atrasos_salao,
            COUNT(*) FILTER (WHERE priority = 'urgent' AND stockout_reported = false)::int AS urgentes_puros,
            COUNT(*) FILTER (WHERE stockout_reported = true)::int AS urgentes_rotura,
            COUNT(*) FILTER (WHERE (ready_at IS NOT NULL AND status IN ('ready','retrieved')) AND sla_breached_cozinha = false)::int AS dentro_sla,
            ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at)) / 60) FILTER (WHERE ready_at IS NOT NULL), 1) AS avg_cooking_min,
            ROUND(AVG(EXTRACT(EPOCH FROM (retrieved_at - ready_at)) / 60) FILTER (WHERE retrieved_at IS NOT NULL), 1) AS avg_pickup_min
          FROM demands
          WHERE ${dateFilter} AND status != 'annulled' ${stationFilter}`,
          baseParams
        );

        const totalPedidos = parseInt(totals?.total_pedidos || '0', 10);
        const totalConcluidos = parseInt(totals?.total_entregues || '0', 10);
        const totalCancelados = parseInt(totals?.total_cancelados || '0', 10);
        const terminadas = totalConcluidos + totalCancelados;

        const kpis = {
          total_pedidos: totalPedidos,
          total_roturas: parseInt(totals?.total_roturas || '0', 10),
          total_cancelados: totalCancelados,
          atrasos_cozinha: parseInt(totals?.atrasos_cozinha || '0', 10),
          atrasos_salao: parseInt(totals?.atrasos_salao || '0', 10),
          urgentes_puros: parseInt(totals?.urgentes_puros || '0', 10),
          urgentes_rotura: parseInt(totals?.urgentes_rotura || '0', 10),
          dentro_sla: parseInt(totals?.dentro_sla || '0', 10),
          pct_dentro_sla: terminadas > 0
            ? Math.round((parseInt(totals?.dentro_sla || '0', 10) / terminadas) * 1000) / 10
            : 0,
          pct_urgentes: totalPedidos > 0
            ? Math.round(((parseInt(totals?.urgentes_puros || '0', 10) + parseInt(totals?.urgentes_rotura || '0', 10)) / totalPedidos) * 1000) / 10
            : 0,
          pct_cancelados: terminadas > 0
            ? Math.round((totalCancelados / terminadas) * 1000) / 10
            : 0,
          pct_entregues: terminadas > 0
            ? Math.round((totalConcluidos / terminadas) * 1000) / 10
            : 0,
          tempo_medio_cozinha_min: parseFloat(totals?.avg_cooking_min || '0') || 0,
          tempo_medio_retirada_min: parseFloat(totals?.avg_pickup_min || '0') || 0,
        };

        // ── 2. Produtos (bar chart) ──
        const produtos = await safeQuery<{ product_name: string; total_qty: string; total_demandas: string }>(
          '2.Produtos',
          `SELECT product_name, SUM(quantity)::numeric(10,2) AS total_qty, COUNT(*)::int AS total_demandas
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter} GROUP BY product_name ORDER BY SUM(quantity) DESC`,
          baseParams
        );

        // ── 3. Trend ──
        const trend = dateFrom !== dateTo ? await safeQuery<{
          day: string; total: string; entregues: string; cancelados: string; roturas: string; atrasos_cozinha: string; atrasos_salao: string;
        }>('3.Trend',
          `SELECT created_at::date AS day, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'retrieved')::int AS entregues,
            COUNT(*) FILTER (WHERE status IN ('cancelled_salao','cancelled_cozinha'))::int AS cancelados,
            COUNT(*) FILTER (WHERE stockout_reported = true)::int AS roturas,
            COUNT(*) FILTER (WHERE sla_breached_cozinha = true)::int AS atrasos_cozinha,
            COUNT(*) FILTER (WHERE sla_breached_salao = true)::int AS atrasos_salao
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter} GROUP BY created_at::date ORDER BY day`,
          baseParams
        ) : [];

        // ── 4. Velocidade da cozinha por hora ──
        const speedByHour = await safeQuery<SpeedByHourRow>('4.SpeedByHour',
          `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at))/60)::numeric, 1) AS avg_min,
            COUNT(*)::int AS count
           FROM demands WHERE ${dateFilter} AND ready_at IS NOT NULL AND status IN ('ready','retrieved') ${stationFilter}
           GROUP BY 1 ORDER BY 1`, baseParams
        );

        // ── 5. Tempo de fila por estação ──
        const queueTime = await safeQuery<QueueTimeByStationRow>('5.QueueTime',
          `SELECT ks.name AS estacao,
            ROUND(AVG(EXTRACT(EPOCH FROM (d.cooking_started_at - d.created_at))/60) FILTER (WHERE d.cooking_started_at IS NOT NULL)::numeric, 1) AS avg_wait_min,
            ROUND(AVG(EXTRACT(EPOCH FROM (d.ready_at - d.created_at))/60) FILTER (WHERE d.ready_at IS NOT NULL)::numeric, 1) AS avg_cooking_min,
            COUNT(*)::int AS count
           FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
           WHERE ${dateFilterD} AND d.status != 'annulled' ${stationFilterD}
           GROUP BY ks.name ORDER BY ks.name`, baseParams
        );

         // ── 6. % Capacidade ociosa por turno ──
        const shiftOrder: Record<string, number> = { 'Manhã': 1, 'Almoço': 2, 'Tarde': 3, 'Jantar': 4 };
        const occRaw = await safeQuery<{ turno: string; pct_ociosa: string }>('6.Occupancy',
          `SELECT
            CASE
              WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 6 AND 11 THEN 'Manhã'
              WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 12 AND 14 THEN 'Almoço'
              WHEN EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 15 AND 17 THEN 'Tarde'
              ELSE 'Jantar'
            END AS turno,
            ROUND((1 - (COUNT(*) FILTER (WHERE status = 'pending')::numeric / NULLIF(COUNT(*),0))) * 100, 1) AS pct_ociosa
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter} GROUP BY 1`,
          baseParams
        );
        const occupancyByShift = occRaw
          .filter(r => r.turno)
          .sort((a, b) => (shiftOrder[a.turno] || 9) - (shiftOrder[b.turno] || 9));

        // ── 7. SLA por produto (Pareto) ──
        const slaByProduct = await safeQuery<SlaByProductRow>('7.SlaByProduct',
          `SELECT product_name, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE sla_breached_cozinha = true)::int AS breached,
            ROUND((COUNT(*) FILTER (WHERE sla_breached_cozinha = false AND ready_at IS NOT NULL)::numeric / NULLIF(COUNT(*) FILTER (WHERE ready_at IS NOT NULL),0)) * 100, 1) AS pct_ok,
            ROUND(COALESCE(AVG(sla_breach_minutes_cozinha) FILTER (WHERE sla_breached_cozinha = true), 0)::numeric, 1) AS avg_overage_min
           FROM demands WHERE ${dateFilter} AND (status IN ('ready','retrieved')) ${stationFilter}
           GROUP BY product_name ORDER BY breached DESC, total DESC`,
          baseParams
        );

        // ── 8. Motivos de cancelamento ──
        const cancelReasons = await safeQuery<{ label: string; category: string; total: string }>('8.CancelReasons',
          `SELECT COALESCE(cr.label, d.cancel_reason, 'Sem motivo') AS label, COALESCE(cr.category, 'outro') AS category, COUNT(*)::int AS total
           FROM demands d LEFT JOIN cancel_reasons cr ON cr.id = d.cancel_reason_id
           WHERE d.status IN ('cancelled_salao','cancelled_cozinha') AND ${dateFilterD} ${stationFilterD}
           GROUP BY cr.label, cr.category, d.cancel_reason ORDER BY total DESC`,
          baseParams
        );

        // ── 9. Tempo de retirada por hora ──
        const pickupByHour = await safeQuery<PickupByHourRow>('9.PickupByHour',
          `SELECT EXTRACT(HOUR FROM ready_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            ROUND(AVG(EXTRACT(EPOCH FROM (retrieved_at - ready_at))/60)::numeric, 1) AS avg_min,
            COUNT(*)::int AS count
           FROM demands WHERE ${dateFilter} AND retrieved_at IS NOT NULL AND ready_at IS NOT NULL AND status != 'annulled' ${stationFilter}
           GROUP BY 1 ORDER BY 1`, baseParams
        );

        // ── 10. Média móvel 7 dias ──
        const rawVolume = dateFrom !== dateTo ? await safeQuery<{ day: string; total: string }>('10.RawVolume',
          `SELECT created_at::date AS day, COUNT(*)::int AS total
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter} GROUP BY created_at::date ORDER BY day`, baseParams
        ) : [];
        const volumeMA: VolumeMARow[] = [];
        for (let i = 0; i < rawVolume.length; i++) {
          let sum = 0; let count = 0;
          for (let j = Math.max(0, i - 6); j <= i; j++) {
            sum += parseInt(rawVolume[j].total); count++;
          }
          volumeMA.push({ day: rawVolume[i].day, total: parseInt(rawVolume[i].total), ma7: Math.round((sum / count) * 10) / 10 });
        }

        // ── 11. Sazonalidade dia da semana ──
        const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
        const weekdayRaw = await safeQuery<{ dow: string; total: string }>('11.Weekday',
          `SELECT EXTRACT(DOW FROM created_at)::int AS dow, COUNT(*)::int AS total
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter} GROUP BY 1 ORDER BY 1`, baseParams
        );
        const weekdayData: WeekdayRow[] = diasSemana.map((dia, idx) => {
          const found = weekdayRaw.find((r: any) => parseInt(r.dow) === idx);
          return { dia, total: found ? parseInt(found.total) : 0, avg: rangeNum > 0 ? Math.round((found ? parseInt(found.total) : 0) / rangeNum * 10) / 10 : 0 };
        });

        // ── 12. Quantidade × tempo de preparo (scatter) ──
        const qtyVsTime = await safeQuery<QtyVsTimeRow>('12.QtyVsTime',
          `SELECT product_name, quantity AS qty,
            ROUND(EXTRACT(EPOCH FROM (ready_at - created_at))/60, 1) AS actual_min,
            sla_minutes AS sla_min
           FROM demands WHERE ${dateFilter} AND ready_at IS NOT NULL AND status IN ('ready','retrieved') ${stationFilter}
           ORDER BY quantity DESC LIMIT 200`, baseParams
        );

        // ── 13. Heatmap hora × dia da semana ──
        const heatmap = await safeQuery<HeatmapRow>('13.Heatmap',
          `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            EXTRACT(DOW FROM created_at)::int AS dia_semana,
            COUNT(*)::int AS total
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter}
           GROUP BY 1, 2 ORDER BY 2, 1`, baseParams
        );

        // ── 14. Funil de demandas ──
        const [funnel] = await safeQuery<{
          created: string; ready: string; retrieved: string; cancelled: string; pending_now: string;
        }>('14.Funnel',
          `SELECT
            COUNT(*)::int AS created,
            COUNT(*) FILTER (WHERE ready_at IS NOT NULL)::int AS ready,
            COUNT(*) FILTER (WHERE retrieved_at IS NOT NULL)::int AS retrieved,
            COUNT(*) FILTER (WHERE status IN ('cancelled_salao','cancelled_cozinha'))::int AS cancelled,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_now
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter}`, baseParams
        );

        // ── 15. Comparativo semana atual vs anterior ──
        let weekComparison: WeekComparisonDayWithIndicators[] = [];
        if (range === 'week' || range === 'month') {
          const prevStart = new Date(dateFrom);
          prevStart.setDate(prevStart.getDate() - rangeNum);
          const prevStartStr = prevStart.toISOString().split('T')[0];
          const compParams: unknown[] = [dateFrom, dateTo, prevStartStr, dateFrom, rangeNum];
          // §5.4 — nesta query station_id entra como $6 (após os 4 filtros de data + rangeNum)
          const stationFilter15 = station_id ? 'AND kitchen_station_id = $6' : '';
          if (station_id) compParams.push(station_id);

          const compData = await safeQuery<{ day: string; total: string; period: string }>('15.WeekComparison',
            `SELECT created_at::date AS day, COUNT(*)::int AS total, 'current' AS period
             FROM demands
             WHERE created_at::date >= $1 AND created_at::date <= $2 AND status != 'annulled' ${stationFilter15}
             GROUP BY 1
             UNION ALL
             SELECT (created_at::date + $5::integer)::date AS day, COUNT(*)::int AS total, 'previous' AS period
             FROM demands
             WHERE created_at::date >= $3 AND created_at::date < $4 AND status != 'annulled' ${stationFilter15}
             GROUP BY 1`,
            compParams
          );

          // §5.6 — indicadores diários do período ATUAL (query separada, merge em TypeScript)
          // Nota: sla_pct aqui é o % de ESTOURO de SLA (breach) — o frontend trata a semântica
          const indicatorRows = await safeQuery<{
            day: string;
            sla_pct: string | null;
            avg_time_min: string | null;
            cancel_rate: string | null;
            stockouts: number;
            urgent_pct: string | null;
          }>('15b.DayIndicators',
            `SELECT created_at::date AS day,
              ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - created_at)) / 60)::numeric, 1) AS avg_time_min,
              ROUND(100.0 * COUNT(*) FILTER (WHERE sla_breached_cozinha = true)
                / NULLIF(COUNT(*) FILTER (WHERE status IN ('ready','retrieved')), 0), 1) AS sla_pct,
              ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('cancelled_salao','cancelled_cozinha'))
                / NULLIF(COUNT(*), 0), 1) AS cancel_rate,
              COUNT(*) FILTER (WHERE stockout_reported = true)::int AS stockouts,
              ROUND(100.0 * COUNT(*) FILTER (WHERE priority = 'urgent')
                / NULLIF(COUNT(*), 0), 1) AS urgent_pct
             FROM demands
             WHERE ${dateFilter} AND status != 'annulled' ${stationFilter}
             GROUP BY 1 ORDER BY 1`,
            baseParams
          );

          const indicatorsByDay = new Map<string, DayIndicatorValues>();
          for (const r of indicatorRows) {
            const indDayStr = (r.day as any) instanceof Date ? (r.day as any).toISOString().split('T')[0] : String(r.day || '');
            indicatorsByDay.set(indDayStr, {
              sla_pct: r.sla_pct != null ? parseFloat(String(r.sla_pct)) : null,
              avg_time_min: r.avg_time_min != null ? parseFloat(String(r.avg_time_min)) : null,
              cancel_rate: r.cancel_rate != null ? parseFloat(String(r.cancel_rate)) : null,
              stockouts: Number(r.stockouts) || 0,
              urgent_pct: r.urgent_pct != null ? parseFloat(String(r.urgent_pct)) : null,
            });
          }

          const daysMap = new Map<string, { this_week: number; last_week: number }>();
          for (const r of compData) {
            const dayStr = (r.day as any) instanceof Date ? (r.day as any).toISOString().split('T')[0] : String(r.day || '');
            const entry = daysMap.get(dayStr) || { this_week: 0, last_week: 0 };
            if (r.period === 'current') entry.this_week = parseInt(r.total);
            else entry.last_week = parseInt(r.total);
            daysMap.set(dayStr, entry);
          }
          weekComparison = Array.from(daysMap.entries())
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .map(([day, v]) => ({
              day,
              this_week: v.this_week,
              last_week: v.last_week,
              indicators: indicatorsByDay.get(day) || {
                sla_pct: null, avg_time_min: null, cancel_rate: null, stockouts: 0, urgent_pct: null,
              },
            }))
            .filter(d => d.this_week > 0 || d.last_week > 0);
        }

        // ── 16. Scatter roturas × demanda ──
        const scatterRoturas = await safeQuery<{ product_name: string; total_demandas: string; total_roturas: string }>('16.ScatterRoturas',
          `SELECT product_name, COUNT(*)::int AS total_demandas,
            COUNT(*) FILTER (WHERE stockout_reported = true)::int AS total_roturas
           FROM demands WHERE ${dateFilter} AND status != 'annulled' ${stationFilter}
           GROUP BY product_name HAVING COUNT(*) > 0 ORDER BY total_demandas DESC`, baseParams
        );

        // ── 17. Tempo de fila por estação × hora (§5.5) ──
        const queueTimeByHour = await safeQuery<QueueTimeByHourRow>('17.QueueTimeByHour',
          `SELECT ks.name AS estacao,
            EXTRACT(HOUR FROM d.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            ROUND(AVG(EXTRACT(EPOCH FROM (d.ready_at - d.created_at)) / 60))::int AS tempo_medio_min
           FROM demands d JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
           WHERE ${dateFilterD} AND d.status IN ('ready','retrieved') AND d.ready_at IS NOT NULL
             AND d.status != 'annulled' ${stationFilterD}
           GROUP BY 1, 2 ORDER BY 1, 2`,
          baseParams
        );

        // ── 18. Análise de trocas por dia (§2.5 fase 2) ──
        const replacementsRaw = await safeQuery<ReplacementRow>('18.Replacements',
          `SELECT created_at::date AS day,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_replacement = true)::int AS replacements,
            ROUND(100.0 * COUNT(*) FILTER (WHERE is_replacement = true) / NULLIF(COUNT(*), 0), 1) AS replacement_pct
           FROM demands
           WHERE ${dateFilter} AND status != 'annulled' ${stationFilter}
           GROUP BY 1 ORDER BY 1`,
          baseParams
        );
        const replacements = replacementsRaw.map(r => ({
          ...r,
          day: (r.day as any) instanceof Date ? (r.day as any).toISOString().split('T')[0] : String(r.day || ''),
        }));

        return {
          kpis, produtos, trend,
          speed_by_hour: speedByHour,
          queue_time_by_station: queueTime,
          queue_time_by_hour: queueTimeByHour,
          occupancy_by_shift: occupancyByShift,
          sla_by_product: slaByProduct,
          cancel_reasons: cancelReasons,
          pickup_by_hour: pickupByHour,
          volume_ma: volumeMA,
          weekday_seasonality: weekdayData,
          qty_vs_time: qtyVsTime,
          heatmap,
          funnel,
          week_comparison: weekComparison,
          scatter_roturas: scatterRoturas,
          replacements,
        };
      } catch (error: any) {
        const msg = error && typeof error === 'object' ? (error.message || String(error)) : String(error);
        const stack = error && typeof error === 'object' && error.stack ? error.stack : '';
        console.error('=== DASHBOARD ERROR ===');
        console.error('Message:', msg);
        console.error('Stack:', stack);
        request.log.error(error, 'Dashboard query failed');
        reply.code(500).send({ error: 'Erro ao buscar dados do dashboard: ' + msg });
      }
    }
  );

  // ── Performance / Notas de Desempenho ──
  fastify.get<{ Querystring: { range?: string; from?: string; to?: string } }>(
    '/performance',
    async (request, reply) => {
      try {
        const { range, from, to } = request.query;
        const today = new Date();
        const isoDate = /^\d{4}-\d{2}-\d{2}$/;
        const validDate = (value: string): boolean => {
          if (!isoDate.test(value)) return false;
          const parsed = new Date(`${value}T00:00:00Z`);
          return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
        };
        const shiftDate = (days: number): string => {
          const date = new Date(today);
          date.setUTCDate(date.getUTCDate() + days);
          return date.toISOString().slice(0, 10);
        };
        let dateFrom = from || to || (range === 'week' ? shiftDate(-6) : range === 'month' ? shiftDate(-30) : shiftDate(0));
        let dateTo = to || from || shiftDate(0);
        if (range && !['week', 'month'].includes(range)) return reply.code(400).send({ error: 'O intervalo deve ser week ou month' });
        if (range && (from || to)) return reply.code(400).send({ error: 'Use range ou from/to, não os dois' });
        if (range === 'week') { dateFrom = shiftDate(-6); dateTo = shiftDate(0); }
        if (range === 'month') { dateFrom = shiftDate(-30); dateTo = shiftDate(0); }
        if (!validDate(dateFrom) || !validDate(dateTo)) return reply.code(400).send({ error: 'As datas devem estar no formato ISO YYYY-MM-DD e ser válidas' });
        const start = new Date(`${dateFrom}T00:00:00Z`).getTime();
        const end = new Date(`${dateTo}T00:00:00Z`).getTime();
        const days = Math.round((end - start) / 86400000) + 1;
        if (days < 1) return reply.code(400).send({ error: 'A data inicial deve ser anterior ou igual à data final' });
        if (days > 31) return reply.code(400).send({ error: 'O período máximo é de 31 dias' });

        const entities: PerformanceEntity[] = ['cozinha_geral', 'cozinha_quente_a', 'cozinha_quente_b', 'cozinha_fria', 'salao'];
        for (let index = 0; index < days; index += 1) {
          const currentDate = new Date(start);
          currentDate.setUTCDate(currentDate.getUTCDate() + index);
          const date = currentDate.toISOString().slice(0, 10);
          const rows = await query<{ entity: string; weight_version_id: string | null }>(
            `SELECT entity, weight_version_id FROM performance_scores WHERE date = $1 AND entity = ANY($2)`, [date, entities]
          );
          const complete = entities.every(entity => rows.some(row => row.entity === entity && row.weight_version_id));
          if (!complete) await ensureScoresForDate(date);
        }

        const scoreRows = await query<PerformanceScoreRow>(
          `SELECT * FROM performance_scores WHERE date >= $1 AND date <= $2 AND entity = ANY($3) ORDER BY date, entity`,
          [dateFrom, dateTo, entities]
        );
        const current: Record<string, EntityScore> = {};
        const historyMap = new Map<string, { date: string; [entity: string]: number | string }>();
        const averages: Record<string, EntityScore> = {};
        for (const entity of entities) {
          const rows = scoreRows.filter(row => row.entity === entity);
          const latest = rows[rows.length - 1];
          if (!latest) continue;
          const totalDeduction = rows.reduce((sum, row) => sum + Number(row.sla_breach_deduction) + Number(row.cancellation_deduction) + Number(row.stockout_deduction) + Number(row.slow_item_deduction), 0);
          const average: EntityScore = { ...latest, entity: entity as PerformanceEntity, final_score: Number((rows.reduce((sum, row) => sum + Number(row.final_score), 0) / rows.length).toFixed(1)), total_demands: rows.reduce((sum, row) => sum + Number(row.total_demands), 0), detractors: buildDetractors({ ...latest, final_score: Number((5 - totalDeduction).toFixed(1)) }) };
          averages[entity] = { ...average, entity: entity as PerformanceEntity };
          current[entity] = { ...latest, entity, detractors: buildDetractors(latest) };
          for (const row of rows) {
            const date = String(row.date).slice(0, 10);
            if (!historyMap.has(date)) historyMap.set(date, { date });
            historyMap.get(date)![entity] = Number(row.final_score);
          }
        }
        const operational: Record<string, EntityPerformance> = {};
        for (const entity of entities) {
          const details = await getPerformanceDetails(entity, dateFrom, dateTo);
          const rows = scoreRows.filter(row => row.entity === entity);
          const operationalScore = Math.max(0, Number((5 - details.total_deduction).toFixed(1)));
          operational[entity] = { entity, operational_score: operationalScore, daily_average_score: rows.length ? Number((rows.reduce((sum, row) => sum + Number(row.final_score), 0) / rows.length).toFixed(1)) : 5, total_demands: details.total_demands, open_demands: details.open_demands, total_deduction: details.total_deduction, criteria: details.criteria, occurrences: details.occurrences, weight_version: details.weight_versions.length === 1 ? details.weight_versions[0] : null };
        }
        const versions = new Map<string, PerformanceWeightVersion>();
        Object.values(operational).forEach(item => { if (item.weight_version) versions.set(item.weight_version.id, item.weight_version); });
        const response: PerformanceResponse = { current, history: Array.from(historyMap.values()).sort((a, b) => a.date.localeCompare(b.date)), averages, operational, detractor_dates: Object.fromEntries(entities.map(entity => [entity, operational[entity].occurrences])), date_from: dateFrom, date_to: dateTo, weight_versions: Array.from(versions.values()) };
        return response;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar performance: ' + msg });
      }
    }
  );

  // ── Cancel reasons ──
  fastify.get('/cancel-reasons', async (request, reply) => {
    try {
      const rows = await query('SELECT * FROM cancel_reasons WHERE active = true ORDER BY category, label');
      return rows;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar motivos de cancelamento' });
    }
  });
}
