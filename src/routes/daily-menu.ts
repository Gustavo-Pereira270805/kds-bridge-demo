import { FastifyInstance } from 'fastify';
import { query } from '../db/client';
import { DailyMenuEffective, DailyMenu, DailyMenuCalendarRow } from '../types';
import { computeMenuForDate, ensureTodayMenu, getMenuForDate } from '../services/menu.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CALENDAR_RANGE_DAYS = 62;

function isValidDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
  );
}

export default async function dailyMenuRoutes(fastify: FastifyInstance) {
  fastify.get('/today', async (request, reply) => {
    try {
      // "Hoje" segundo o banco (CURRENT_DATE) para evitar divergência de timezone
      const [{ today }] = await query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
      const menu = await getMenuForDate(today);

      const products = await query<DailyMenuEffective>(
        `SELECT * FROM daily_menu_effective WHERE daily_menu_id = $1 ORDER BY category, name`,
        [menu.daily_menu_id]
      );

      // v2.5 (§2.4) — metadata do cardápio envelopando os produtos
      return {
        menu: { number: menu.menu_number, name: menu.menu_name },
        date: today,
        products,
      };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar cardápio do dia' });
    }
  });

  fastify.patch<{
    Body: { product_id: string; action: 'add' | 'remove'; reason?: string };
  }>('/today', {
    schema: {
      body: {
        type: 'object',
        required: ['product_id', 'action'],
        properties: {
          product_id: { type: 'string', minLength: 1 },
          action: { type: 'string', enum: ['add', 'remove'] },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    try {
      const { product_id, action, reason } = request.body;
      const dailyMenuId = await ensureTodayMenu();

      if (action === 'remove') {
        await query(
          `INSERT INTO daily_menu_overrides (daily_menu_id, product_id, action, reason)
           VALUES ($1, $2, 'remove', $3)
           ON CONFLICT (daily_menu_id, product_id) DO UPDATE SET action = 'remove', reason = $3`,
          [dailyMenuId, product_id, reason || null]
        );
      } else {
        await query(
          `INSERT INTO daily_menu_overrides (daily_menu_id, product_id, action, reason)
           VALUES ($1, $2, 'add', $3)
           ON CONFLICT (daily_menu_id, product_id) DO UPDATE SET action = 'add', reason = $3`,
          [dailyMenuId, product_id, reason || null]
        );
      }

      fastify.io.to('salao').emit('menu:updated');

      const products = await query<DailyMenuEffective>(
        `SELECT * FROM daily_menu_effective WHERE daily_menu_id = $1 ORDER BY category, name`,
        [dailyMenuId]
      );

      return { daily_menu_id: dailyMenuId, products };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao ajustar cardápio do dia' });
    }
  });

  // v2.5 (§4.1-A) — registrada ANTES de '/:date' para não ser capturada como parâmetro
  fastify.get<{ Querystring: { from?: string; to?: string } }>('/calendar', async (request, reply) => {
    try {
      const { from, to } = request.query;

      if (!from || !isValidDateString(from)) {
        return reply.code(400).send({ error: "Parâmetro 'from' é obrigatório no formato YYYY-MM-DD" });
      }

      const toDate = to || addDays(from, 13);
      if (!isValidDateString(toDate)) {
        return reply.code(400).send({ error: "Parâmetro 'to' inválido, use o formato YYYY-MM-DD" });
      }

      const rangeDays = diffDays(from, toDate);
      if (rangeDays < 0 || rangeDays > MAX_CALENDAR_RANGE_DAYS) {
        return reply.code(400).send({
          error: `Intervalo inválido: 'to' deve ser maior ou igual a 'from' e no máximo ${MAX_CALENDAR_RANGE_DAYS} dias após 'from'`,
        });
      }

      // computeMenuForDate é puro: dias futuros NÃO são persistidos
      const rows: DailyMenuCalendarRow[] = [];
      for (let i = 0; i <= rangeDays; i++) {
        const date = addDays(from, i);
        const menu = await computeMenuForDate(date);
        rows.push({
          date,
          menu_id: menu.menu_id,
          menu_number: menu.menu_number,
          menu_name: menu.menu_name,
          is_override: menu.is_override,
        });
      }

      return rows;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar calendário de cardápios' });
    }
  });

  fastify.get<{ Params: { date: string } }>('/:date', async (request, reply) => {
    try {
      const { date } = request.params;

      const dailyMenu = await query<DailyMenu>(
        'SELECT * FROM daily_menus WHERE date = $1',
        [date]
      );

      if (dailyMenu.length === 0) {
        return reply.code(404).send({ error: 'Nenhum cardápio para esta data' });
      }

      const products = await query<DailyMenuEffective>(
        `SELECT * FROM daily_menu_effective WHERE daily_menu_id = $1 ORDER BY category, name`,
        [dailyMenu[0].id]
      );

      return { ...dailyMenu[0], products };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar cardápio da data' });
    }
  });
}
