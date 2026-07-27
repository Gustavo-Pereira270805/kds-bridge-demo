import { FastifyInstance } from 'fastify';
import { query } from '../db/client';
import { Demand, CreateDemandBody } from '../types';
import { ensureTodayMenu } from '../services/menu.service';
import { recomputeStationQueue } from '../services/queue.service';
import { evaluateCookingSla, evaluatePickupSla } from '../services/sla.service';
import { logDemandEvent } from '../services/demand-events.service';
import { computeDailyScores } from '../services/performance.service';

function getStationRoom(code: string): string {
  if (code === 'fria') return 'cozinha_fria';
  return 'cozinha_quente';
}

export default async function demandsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    try {
      const demands = await query<Demand>(
        `SELECT d.*, rp.name AS replaced_name
         FROM demands d
         LEFT JOIN products rp ON rp.id = d.replaced_product_id
         WHERE d.status IN ('pending', 'ready')
         ORDER BY d.priority DESC, d.created_at ASC`
      );
      return demands;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar demandas' });
    }
  });

  fastify.post<{ Body: CreateDemandBody }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['product_id', 'quantity'],
        properties: {
          product_id: { type: 'string', minLength: 1 },
          quantity: { type: 'number', minimum: 0.01 },
          unit_id: { type: 'string' },
          unit_label: { type: 'string' },
          priority: { type: 'string', enum: ['normal', 'urgent'] },
          notes: { type: 'string' },
          is_replacement: { type: 'boolean' },
          replaced_product_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const {
        product_id,
        quantity,
        unit_id,
        unit_label,
        priority = 'normal',
        notes = null,
        is_replacement,
        replaced_product_id,
      } = request.body;

      const products = await query<{
        name: string;
        sla_minutes_normal: number;
        sla_minutes_urgente: number;
        kitchen_station_id: string;
      }>(
        'SELECT name, sla_minutes_normal, sla_minutes_urgente, kitchen_station_id FROM products WHERE id = $1',
        [product_id]
      );

      if (products.length === 0) {
        return reply.code(404).send({ error: 'Produto não encontrado' });
      }

      const product = products[0];
      const productName = product.name;

      if (!product.kitchen_station_id) {
        return reply.code(400).send({
          error: 'Produto não está vinculado a uma estação de cozinha',
        });
      }

      // Troca (§2.5): replaced_product_id sem is_replacement explícito implica troca
      const isReplacement = is_replacement ?? !!replaced_product_id;
      if (isReplacement && !replaced_product_id) {
        return reply.code(400).send({
          error: 'Selecione o item do cardápio que foi substituído',
        });
      }
      if (replaced_product_id) {
        const replacedExists = await query<{ exists: number }>(
          'SELECT 1 as exists FROM products WHERE id = $1',
          [replaced_product_id]
        );
        if (replacedExists.length === 0) {
          return reply.code(400).send({ error: 'Produto substituído não encontrado' });
        }
      }

      const slaMinutes =
        priority === 'urgent'
          ? product.sla_minutes_urgente
          : product.sla_minutes_normal;

      const unitIdToStore = unit_id || null;
      if (unit_id) {
        const unitRows = await query<{ id: string }>(
          'SELECT id FROM units WHERE id = $1 AND active = true',
          [unit_id]
        );
        if (unitRows.length === 0) {
          return reply.code(400).send({ error: 'Unidade de medida inválida' });
        }
        const [puValid] = await query<{ exists: number }>(
          'SELECT 1 as exists FROM product_units WHERE product_id = $1 AND unit_id = $2',
          [product_id, unit_id]
        );
        if (!puValid) {
          return reply.code(400).send({
            error: 'Esta unidade não é válida para este produto',
          });
        }
      }

      const dailyMenuId = await ensureTodayMenu();

      const [newDemand] = await query<Demand>(
        `INSERT INTO demands (
           daily_menu_id, product_id, product_name, quantity,
           unit_id, unit_label, kitchen_station_id, sla_minutes,
           priority, notes, is_replacement, replaced_product_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *, (SELECT name FROM products WHERE id = replaced_product_id) AS replaced_name`,
        [
          dailyMenuId,
          product_id,
          productName,
          quantity,
          unitIdToStore,
          unit_label,
          product.kitchen_station_id,
          slaMinutes,
          priority,
          notes,
          isReplacement,
          replaced_product_id || null,
        ]
      );

      await logDemandEvent(newDemand.id, 'created', 'salao');

      const station = await query<{ code: string }>(
        'SELECT code FROM kitchen_stations WHERE id = $1',
        [product.kitchen_station_id]
      );
      const room = station.length > 0 ? getStationRoom(station[0].code) : 'cozinha_quente';

      const eventName = priority === 'urgent' ? 'demand:urgent' : 'demand:new';
      fastify.io.emit(eventName, newDemand);
      console.log('[Demand] Emitido ' + eventName + ' (broadcast) para ' + room);

      recomputeStationQueue(product.kitchen_station_id).then(() => {
        fastify.io.emit('demand:queue-updated');
      }).catch((err) => request.log.error(err));

      return reply.code(201).send(newDemand);
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao criar demanda' });
    }
  });

  // Cozinha marca pronto
  fastify.patch<{ Params: { id: string } }>(
    '/:id/ready',
    async (request, reply) => {
      try {
        const { id } = request.params;

        const [demand] = await query<{
          status: string;
          kitchen_station_id: string;
          cooking_started_at: string | null;
        }>(
          'SELECT status, kitchen_station_id, cooking_started_at FROM demands WHERE id = $1',
          [id]
        );
        if (!demand) {
          return reply.code(404).send({ error: 'Demanda não encontrada' });
        }
        if (demand.status !== 'pending') {
          return reply.code(409).send({
            error: `Não é possível marcar pronto: status atual é ${demand.status}`,
          });
        }

        await query(
          `UPDATE demands SET status = 'ready', ready_at = now() WHERE id = $1`,
          [id]
        );

        // Flag "pronto fora de sequência": há itens mais antigos ainda em preparo na estação?
        if (demand.kitchen_station_id && demand.cooking_started_at) {
          const [older] = await query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt FROM demands
             WHERE kitchen_station_id = $1 AND status = 'pending'
               AND cooking_started = true AND cooking_started_at < $2`,
            [demand.kitchen_station_id, demand.cooking_started_at]
          );
          if (older && older.cnt > 0) {
            await query(
              'UPDATE demands SET ready_out_of_order = true WHERE id = $1',
              [id]
            );
          }
        }

        await logDemandEvent(id, 'marked_ready', 'cozinha');
        await evaluateCookingSla(id);
        await recomputeStationQueue(demand.kitchen_station_id);

        const [updated] = await query<Demand>(
          'SELECT * FROM demands WHERE id = $1',
          [id]
        );
        computeDailyScores(new Date(updated.created_at).toISOString().slice(0, 10)).catch(err => request.log.error(err));
        fastify.io.to('salao').emit('demand:ready', updated);

        const station = await query<{ code: string }>(
          'SELECT code FROM kitchen_stations WHERE id = $1',
          [demand.kitchen_station_id]
        );
        const room = station.length > 0 ? getStationRoom(station[0].code) : 'cozinha_quente';
        fastify.io.to(room).emit('demand:queue-updated');
        fastify.io.to('salao').emit('demand:queue-updated');

        return updated;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao marcar demanda como pronta' });
      }
    }
  );

  // Salão confirma retirada
  fastify.patch<{ Params: { id: string } }>(
    '/:id/retrieve',
    async (request, reply) => {
      try {
        const { id } = request.params;

        const [demand] = await query<{ status: string }>(
          'SELECT status FROM demands WHERE id = $1',
          [id]
        );

        if (!demand) {
          return reply.code(404).send({ error: 'Demanda não encontrada' });
        }
        if (demand.status !== 'ready') {
          return reply.code(409).send({
            error: 'Esta demanda ainda não foi marcada como pronta pela cozinha',
          });
        }

        await query(
          `UPDATE demands SET status = 'retrieved', retrieved_at = now() WHERE id = $1`,
          [id]
        );
        await logDemandEvent(id, 'retrieved', 'salao');
        await evaluatePickupSla(id);

        const [updated] = await query<Demand>(
          'SELECT * FROM demands WHERE id = $1',
          [id]
        );
        computeDailyScores(new Date(updated.created_at).toISOString().slice(0, 10)).catch(err => request.log.error(err));
        fastify.io.emit('demand:retrieved', updated);
        return updated;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao confirmar retirada' });
      }
    }
  );

  // Salão cancela (só se pending)
  fastify.patch<{ Params: { id: string }; Body: { reason?: string; cancel_reason_id?: string } }>(
    '/:id/cancel-salao',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            cancel_reason_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { reason, cancel_reason_id } = request.body || {};

        const [demand] = await query<{
          status: string;
          kitchen_station_id: string;
          cooking_started: boolean;
        }>(
          'SELECT status, kitchen_station_id, cooking_started FROM demands WHERE id = $1',
          [id]
        );

        if (!demand) {
          return reply.code(404).send({ error: 'Demanda não encontrada' });
        }
        if (demand.status !== 'pending') {
          return reply.code(409).send({
            error: `Cancelamento do salão só é permitido em demandas pendentes. Status atual: ${demand.status}`,
          });
        }

        const reasonLabel = cancel_reason_id
          ? ((await query<{ label: string }>('SELECT label FROM cancel_reasons WHERE id = $1', [cancel_reason_id]))[0]?.label || reason || null)
          : reason || null;

        await query(
          `UPDATE demands SET status = 'cancelled_salao', cancelled_at = now(), cancel_reason = $1, cancel_reason_id = $2 WHERE id = $3`,
          [reasonLabel, cancel_reason_id || null, id]
        );
        await logDemandEvent(id, 'cancelled_salao', 'salao', reasonLabel || undefined);

        if (demand.kitchen_station_id) {
          await recomputeStationQueue(demand.kitchen_station_id);
        }

        const [updated] = await query<Demand>(
          'SELECT * FROM demands WHERE id = $1',
          [id]
        );
        computeDailyScores(new Date(updated.created_at).toISOString().slice(0, 10)).catch(err => request.log.error(err));
        fastify.io.emit('demand:cancelled', updated);
        if (demand.cooking_started) {
          fastify.io.emit('demand:cross-cancel', {
            ...updated,
            cancelled_by: 'salao',
            message: 'Item cancelado pelo salão já estava em preparo!',
          });
        }
        return updated;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao cancelar demanda' });
      }
    }
  );

  // Cozinha cancela (pending ou ready)
  fastify.patch<{ Params: { id: string }; Body: { reason?: string; cancel_reason_id?: string } }>(
    '/:id/cancel-cozinha',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            cancel_reason_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { reason, cancel_reason_id } = request.body || {};

        const [demand] = await query<{
          status: string;
          kitchen_station_id: string;
          cooking_started: boolean;
        }>(
          'SELECT status, kitchen_station_id, cooking_started FROM demands WHERE id = $1',
          [id]
        );

        if (!demand) {
          return reply.code(404).send({ error: 'Demanda não encontrada' });
        }
        if (demand.status !== 'pending' && demand.status !== 'ready') {
          return reply.code(409).send({
            error: `Cancelamento da cozinha não permitido. Status atual: ${demand.status}`,
          });
        }

        const reasonLabel = cancel_reason_id
          ? ((await query<{ label: string }>('SELECT label FROM cancel_reasons WHERE id = $1', [cancel_reason_id]))[0]?.label || reason || null)
          : reason || null;

        await query(
          `UPDATE demands SET status = 'cancelled_cozinha', cancelled_at = now(), cancel_reason = $1, cancel_reason_id = $2 WHERE id = $3`,
          [reasonLabel, cancel_reason_id || null, id]
        );
        await logDemandEvent(id, 'cancelled_cozinha', 'cozinha', reasonLabel || undefined);

        if (demand.kitchen_station_id) {
          await recomputeStationQueue(demand.kitchen_station_id);
        }

        const [updated] = await query<Demand>(
          'SELECT * FROM demands WHERE id = $1',
          [id]
        );
        computeDailyScores(new Date(updated.created_at).toISOString().slice(0, 10)).catch(err => request.log.error(err));
        fastify.io.emit('demand:cancelled', updated);
        if (demand.cooking_started) {
          fastify.io.emit('demand:cross-cancel', {
            ...updated,
            cancelled_by: 'cozinha',
            message: 'Item cancelado pela cozinha já estava em preparo!',
          });
        }
        return updated;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao cancelar demanda' });
      }
    }
  );

  // Salão reporta rotura (não muda status, mas escala prioridade)
  fastify.post<{ Params: { id: string } }>(
    '/:id/stockout',
    async (request, reply) => {
      try {
        const { id } = request.params;

        const [demand] = await query<{
          status: string;
          priority: string;
          sla_minutes: number | null;
          product_id: string | null;
        }>(
          'SELECT status, priority, sla_minutes, product_id FROM demands WHERE id = $1',
          [id]
        );

        if (!demand) {
          return reply.code(404).send({ error: 'Demanda não encontrada' });
        }

        await query(
          `UPDATE demands SET stockout_reported = true, stockout_reported_at = now() WHERE id = $1`,
          [id]
        );

        // Ao promover de normal para urgente, ajusta o SLA para o SLA urgente do produto
        if (demand.status === 'pending' && demand.priority === 'normal' && demand.product_id) {
          const [product] = await query<{ sla_minutes_urgente: number | null }>(
            'SELECT sla_minutes_urgente FROM products WHERE id = $1',
            [demand.product_id]
          );
          const urgente = product?.sla_minutes_urgente;
          const novoSla = (urgente != null && Number(urgente) > 0)
            ? Math.min(demand.sla_minutes ?? Infinity, Number(urgente))
            : demand.sla_minutes;
          await query(
            `UPDATE demands SET priority = 'urgent', sla_minutes = $1 WHERE id = $2`,
            [novoSla, id]
          );
        } else if (demand.status === 'pending') {
          await query(
            `UPDATE demands SET priority = 'urgent' WHERE id = $1`,
            [id]
          );
        }
        await logDemandEvent(id, 'stockout_reported', 'salao');

        const demandAfterPriority = await query<Demand>(
          'SELECT * FROM demands WHERE id = $1',
          [id]
        );
        const current = demandAfterPriority[0];

        if (current && current.kitchen_station_id) {
          await recomputeStationQueue(current.kitchen_station_id);
        }

        const [updated] = await query<Demand>(
          `SELECT d.*, rp.name AS replaced_name
           FROM demands d LEFT JOIN products rp ON rp.id = d.replaced_product_id
           WHERE d.id = $1`,
          [id]
        );

        computeDailyScores(new Date(updated.created_at).toISOString().slice(0, 10)).catch(err => request.log.error(err));

        const station = updated.kitchen_station_id
          ? await query<{ code: string }>(
              'SELECT code FROM kitchen_stations WHERE id = $1',
              [updated.kitchen_station_id]
            )
          : [];
        const room =
          station.length > 0 ? getStationRoom(station[0].code) : 'cozinha_quente';
        fastify.io.to(room).emit('demand:stockout', updated);
        fastify.io.to('salao').emit('demand:stockout', updated);
        fastify.io.emit('demand:queue-updated');

        return updated;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao reportar zerou' });
      }
    }
  );

  fastify.get('/history', async (request, reply) => {
    try {
      const demands = await query<Demand>(
        'SELECT * FROM demands ORDER BY created_at DESC LIMIT 100'
      );
      return demands;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar histórico' });
    }
  });

  fastify.get('/metrics', async (request, reply) => {
    try {
      const [totalResult] = await query<{ count: string }>(
        "SELECT COUNT(*) as count FROM demands WHERE date(created_at) = date(now()) AND status != 'annulled'"
      );
      const total = parseInt(totalResult.count, 10);

      const [avgResult] = await query<{ avg_minutes: string | null }>(
        `SELECT ROUND(AVG(
          EXTRACT(EPOCH FROM (ready_at - created_at)) / 60
        )) as avg_minutes
         FROM demands
         WHERE status IN ('ready', 'retrieved')
           AND ready_at IS NOT NULL
           AND date(created_at) = date(now())`
      );

      const topResult = await query<{ product_name: string; total_qty: string }>(
        `SELECT product_name, SUM(quantity) as total_qty
         FROM demands
         WHERE date(created_at) = date(now())
           AND status != 'annulled'
         GROUP BY product_name
         ORDER BY total_qty DESC
         LIMIT 1`
      );

      return {
        total,
        avgTimeMinutes: parseInt(avgResult?.avg_minutes || '0', 10),
        topProduct: topResult[0]?.product_name || '-',
      };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar métricas' });
    }
  });
}
