import { FastifyInstance } from 'fastify';
import { query, pool } from '../db/client';
import { DailyMenu, Demand, Menu, PiAction, PiTarget, Product } from '../types';
import { runCleanup, getRetentionDays } from '../services/cleanup.service';
import { logDemandEvent } from '../services/demand-events.service';
import { computeDailyScores, getWeights } from '../services/performance.service';
import { recomputeStationQueue } from '../services/queue.service';
import { ensureTodayMenu } from '../services/menu.service';
import { requireAuth } from '../middleware/auth';
import { lastHeartbeat } from '../socket/handlers';

const PI_ONLINE_MS = 45_000;
const PI_HOSTS = {
  quente: 'kds-quente-1',
  fria: 'kds-fria-1',
} as const;

function getPiStatus() {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(PI_HOSTS).map(([key, hostname]) => {
      const lastAt = lastHeartbeat.get(hostname) ?? null;
      const parsedAt = lastAt ? new Date(lastAt).getTime() : NaN;
      const ageMs = Number.isFinite(parsedAt) ? now - parsedAt : null;
      return [hostname, {
        online: ageMs !== null && ageMs >= 0 && ageMs < PI_ONLINE_MS,
        lastAt,
        ageMs,
      }];
    })
  );
}

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0].replace(/^\/api\/v1\/admin/, '').replace(/^\//, '');
    // Leitura de motivos de cancelamento é pública: cozinha (kiosks sem token) e salão a usam.
    if (request.method === 'GET' && path === 'cancel-reasons') return;

    // O hook anterior verificava request.user sem nunca populá-lo (o requireAuth não era chamado),
    // então TODA rota admin retornava 401 "Token não fornecido" mesmo com token válido.
    await requireAuth(request, reply);
    if (reply.sent) return;

    const role = request.user?.role;
    if (role === 'admin' || role === 'gerente') return;
    return reply.code(403).send({ error: 'Permissão insuficiente para esta operação' });
  });

  // Produtos: criar
  fastify.post<{ Body: { name: string; category?: string; kitchen_station_id?: string | null; sla_minutes_normal?: number; sla_minutes_urgente?: number } }>(
    '/products', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          category: { type: 'string' },
          kitchen_station_id: { type: 'string' },
          sla_minutes_normal: { type: 'number', minimum: 1 },
          sla_minutes_urgente: { type: 'number', minimum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { name, category, kitchen_station_id, sla_minutes_normal, sla_minutes_urgente } = request.body;
      const [p] = await query<Product>(
        `INSERT INTO products (name, category, kitchen_station_id, sla_minutes_normal, sla_minutes_urgente)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, category || null, kitchen_station_id || null, sla_minutes_normal || 10, sla_minutes_urgente || 7]
      );
      reply.code(201);
      return p;
    } catch (error: any) {
      if (error.code === '23505') return reply.code(409).send({ error: 'Produto já existe' });
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao criar produto' });
    }
  });

  // Produtos: atualizar campos
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/products/:id', {
    schema: {
      body: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          category: { type: 'string' },
          kitchen_station_id: { type: ['string', 'null'] },
          sla_minutes_normal: { type: 'number', minimum: 1 },
          sla_minutes_urgente: { type: 'number', minimum: 1 },
          active: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const allowed = ['name', 'category', 'kitchen_station_id', 'sla_minutes_normal', 'sla_minutes_urgente', 'active'];
      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;
      for (const [k, v] of Object.entries(request.body)) {
        if (allowed.includes(k)) { sets.push(`${k} = $${idx++}`); vals.push(v); }
      }
      if (sets.length === 0) return reply.code(400).send({ error: 'Nenhum campo válido' });
      vals.push(id);
      const [p] = await query<Product>(
        `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        vals
      );
      if (!p) return reply.code(404).send({ error: 'Produto não encontrado' });
      fastify.io.emit('product:updated', p);
      return p;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao atualizar produto' });
    }
  });

  // Produtos: excluir
  fastify.delete<{ Params: { id: string } }>(
    '/products/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      await query('DELETE FROM products WHERE id = $1', [id]);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao excluir produto' });
    }
  });

  // Menus: listar todos
  fastify.get('/menus', async (request, reply) => {
    try {
      const menus = await query('SELECT * FROM menus ORDER BY number');
      return menus;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar cardápios' });
    }
  });

  // Menus: produtos de um cardápio + todos os produtos
  fastify.get<{ Params: { id: string } }>(
    '/menus/:id/products', async (request, reply) => {
    try {
      const { id } = request.params;
      const [menuProds, allProds] = await Promise.all([
        query(`SELECT mp.product_id, p.name, p.category FROM menu_products mp JOIN products p ON p.id = mp.product_id WHERE mp.menu_id = $1 ORDER BY p.category, p.name`, [id]),
        query('SELECT id, name, category FROM products WHERE active = true ORDER BY category, name'),
      ]);
      return { menu_products: menuProds, all_products: allProds };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar produtos do cardápio' });
    }
  });

  // Menus: adicionar produto
  fastify.post<{ Params: { id: string }; Body: { product_id: string } }>(
    '/menus/:id/products', async (request, reply) => {
    try {
      const { id } = request.params;
      const { product_id } = request.body;
      await query(
        'INSERT INTO menu_products (menu_id, product_id) VALUES ($1, $2) ON CONFLICT (menu_id, product_id) DO NOTHING',
        [id, product_id]
      );
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao adicionar produto ao cardápio' });
    }
  });

  // Menus: remover produto
  fastify.delete<{ Params: { id: string; productId: string } }>(
    '/menus/:id/products/:productId', async (request, reply) => {
    try {
      const { id, productId } = request.params;
      await query('DELETE FROM menu_products WHERE menu_id = $1 AND product_id = $2', [id, productId]);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao remover produto do cardápio' });
    }
  });

  // Menus: definir como cardápio de hoje
  fastify.post<{ Params: { id: string } }>(
    '/menus/:id/set-today', async (request, reply) => {
    try {
      const { id } = request.params;
      const today = new Date().toISOString().split('T')[0];
      await query(
        `INSERT INTO daily_menus (date, menu_id) VALUES ($1, $2)
         ON CONFLICT (date) DO UPDATE SET menu_id = $2, updated_at = now()`,
        [today, id]
      );
      fastify.io.to('salao').emit('menu:updated');
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao definir cardápio do dia' });
    }
  });

  // Unidades: criar
  fastify.post<{ Body: { code: string; label: string } }>(
    '/units', async (request, reply) => {
    try {
      const { code, label } = request.body;
      const [u] = await query(
        'INSERT INTO units (code, label) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING *',
        [code, label]
      );
      if (!u) return reply.code(409).send({ error: 'Código já existe' });
      reply.code(201);
      return u;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao criar unidade' });
    }
  });

  // Unidades: toggle featured
  fastify.patch<{ Params: { id: string } }>(
    '/units/:id/featured', async (request, reply) => {
    try {
      const [u] = await query(
        'UPDATE units SET featured = NOT featured WHERE id = $1 RETURNING *',
        [request.params.id]
      );
      if (!u) return reply.code(404).send({ error: 'Unidade não encontrada' });
      return u;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao alternar favorito' });
    }
  });

  // Unidades: toggle active (soft delete / reativar)
  fastify.patch<{ Params: { id: string } }>(
    '/units/:id/active', async (request, reply) => {
    try {
      const [u] = await query(
        'UPDATE units SET active = NOT active WHERE id = $1 RETURNING *',
        [request.params.id]
      );
      if (!u) return reply.code(404).send({ error: 'Unidade não encontrada' });
      return u;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao alternar status' });
    }
  });

  // Unidades: editar
  fastify.put<{ Params: { id: string }; Body: { code: string; label: string } }>(
    '/units/:id', async (request, reply) => {
    try {
      const { code, label } = request.body;
      const [u] = await query(
        'UPDATE units SET code = $1, label = $2 WHERE id = $3 RETURNING *',
        [code, label, request.params.id]
      );
      if (!u) return reply.code(404).send({ error: 'Unidade não encontrada' });
      return u;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao editar unidade' });
    }
  });

  // Unidades: excluir (soft delete)
  fastify.delete<{ Params: { id: string } }>(
    '/units/:id', async (request, reply) => {
    try {
      const [u] = await query('UPDATE units SET active = false WHERE id = $1 RETURNING id', [request.params.id]);
      if (!u) return reply.code(404).send({ error: 'Unidade não encontrada' });
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao excluir unidade' });
    }
  });

  // Unidades: vincular a produto (substitui todos os vínculos)
  fastify.post<{ Body: { product_id: string; unit_ids: string[] } }>(
    '/units/bind-product', async (request, reply) => {
    try {
      const { product_id, unit_ids } = request.body;
      const client = await (await import('../db/client')).pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM product_units WHERE product_id = $1', [product_id]);
        for (const uid of unit_ids) {
          await client.query(
            'INSERT INTO product_units (product_id, unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [product_id, uid]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao vincular unidades' });
    }
  });

  // Cancel reasons: listar ativos
  fastify.get('/cancel-reasons', async (request, reply) => {
    try {
      const rows = await query('SELECT * FROM cancel_reasons ORDER BY category, label');
      return rows;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar motivos de cancelamento' });
    }
  });

  // Cancel reasons: criar
  fastify.post<{ Body: { label: string; category: string } }>(
    '/cancel-reasons', async (request, reply) => {
    try {
      const { label, category } = request.body;
      if (!['salao','cozinha'].includes(category)) return reply.code(400).send({ error: 'Categoria inválida' });
      const [r] = await query('INSERT INTO cancel_reasons (label, category) VALUES ($1, $2) RETURNING *', [label, category]);
      reply.code(201);
      return r;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao criar motivo de cancelamento' });
    }
  });

  // Cancel reasons: toggle active
  fastify.patch<{ Params: { id: string } }>(
    '/cancel-reasons/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const [cr] = await query<{ active: boolean }>('SELECT active FROM cancel_reasons WHERE id = $1', [id]);
      if (!cr) return reply.code(404).send({ error: 'Motivo não encontrado' });
      const [r] = await query('UPDATE cancel_reasons SET active = $1 WHERE id = $2 RETURNING *', [!cr.active, id]);
      return r;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao alternar motivo de cancelamento' });
    }
  });

  // Cancel reasons: excluir
  fastify.delete<{ Params: { id: string } }>(
    '/cancel-reasons/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      await query('DELETE FROM cancel_reasons WHERE id = $1', [id]);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao excluir motivo de cancelamento' });
    }
  });

  // Demandas: anular (status 'annulled' — excluída dos indicadores, permanece no histórico)
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/demands/:id/annul', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const reason = request.body?.reason?.trim();
      if (!reason) { client.release(); return reply.code(400).send({ error: 'Informe o motivo da anulação' }); }

      const { rows: [demand] } = await client.query<Demand>('SELECT * FROM demands WHERE id = $1', [id]);
      if (!demand) { client.release(); return reply.code(404).send({ error: 'Demanda não encontrada' }); }
      if (demand.status === 'annulled') { client.release(); return reply.code(400).send({ error: 'Demanda já anulada' }); }

      const { rows: [dayRow] } = await client.query<{ is_today: boolean }>(
        `SELECT ($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date AS is_today`,
        [demand.created_at]
      );
      if (!dayRow.is_today) { client.release(); return reply.code(403).send({ error: 'Só é possível anular demandas do dia atual' }); }

      const annulledBy = request.user?.email ?? 'gerente';
      const wasPending = demand.status === 'pending';
      const stationId = demand.kitchen_station_id;
      const demandDate = new Date(demand.created_at).toISOString().split('T')[0];

      await client.query('BEGIN');

      const { rows: [updated] } = await client.query<Demand>(
        `UPDATE demands SET status = 'annulled', annulled_at = NOW(), annulled_by = $1, annul_reason = $2
         WHERE id = $3 AND status != 'annulled' RETURNING *`,
        [annulledBy, reason, id]
      );
      if (!updated) {
        await client.query('ROLLBACK');
        client.release();
        return reply.code(409).send({ error: 'Demanda não está mais pendente' });
      }

      await client.query(
        `INSERT INTO demand_events (demand_id, event_type, actor, notes) VALUES ($1, $2, $3, $4)`,
        [id, 'annulled', 'sistema', reason]
      );

      await client.query('COMMIT');
      client.release();

      if (wasPending && stationId) {
        recomputeStationQueue(stationId).catch(e => request.log.error(e));
      }
      computeDailyScores(demandDate).catch(e => request.log.error(e));

      fastify.io.emit('demand:annulled', updated);
      return updated;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao anular demanda' });
    }
  });

  // Demandas: anular passo específico com cascata (volta ao estado anterior)
  fastify.post<{ Params: { id: string }; Body: { step?: string; reason?: string } }>(
    '/demands/:id/annul-step', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const step = request.body?.step;
      const reason = request.body?.reason?.trim();
      const ANNULLABLE = ['created', 'marked_ready', 'retrieved', 'cancelled_salao', 'cancelled_cozinha'];
      if (!step || !ANNULLABLE.includes(step)) { client.release(); return reply.code(400).send({ error: 'Passo inválido para anulação' }); }
      if (!reason) { client.release(); return reply.code(400).send({ error: 'Informe o motivo da anulação' }); }

      const { rows: [demand] } = await client.query<Demand>('SELECT * FROM demands WHERE id = $1', [id]);
      if (!demand) { client.release(); return reply.code(404).send({ error: 'Demanda não encontrada' }); }
      if (demand.status === 'annulled') { client.release(); return reply.code(400).send({ error: 'Demanda já anulada' }); }

      const { rows: [stepDayRow] } = await client.query<{ is_today: boolean }>(
        `SELECT ($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date AS is_today`,
        [demand.created_at]
      );
      if (!stepDayRow.is_today) { client.release(); return reply.code(403).send({ error: 'Só é possível anular demandas do dia atual' }); }

      const by = request.user?.email ?? 'gerente';
      const demandDate = new Date(demand.created_at).toISOString().split('T')[0];

      // Passo 'created' equivale à anulação total (mesmo efeito do botão Anular)
      if (step === 'created') {
        await client.query('BEGIN');
        const { rows: [annulled] } = await client.query<Demand>(
          `UPDATE demands SET status = 'annulled', annulled_at = NOW(), annulled_by = $1, annul_reason = $2
           WHERE id = $3 AND status != 'annulled' RETURNING *`,
          [by, reason, id]
        );
        if (!annulled) { await client.query('ROLLBACK'); client.release(); return reply.code(409).send({ error: 'Demanda mudou de estado, recarregue o histórico' }); }
        await client.query(
          `INSERT INTO demand_events (demand_id, event_type, actor, notes) VALUES ($1, 'annulled', 'sistema', $2)`,
          [id, reason]
        );
        await client.query('COMMIT');
        client.release();
        if (demand.kitchen_station_id) { recomputeStationQueue(demand.kitchen_station_id).catch((e) => request.log.error(e)); }
        computeDailyScores(demandDate).catch((e) => request.log.error(e));
        fastify.io.emit('demand:annulled', annulled);
        return annulled;
      }

      let setClauses: string[] = [];
      let cascade: string[] = [];
      let backTo = '';
      if (step === 'retrieved') {
        if (demand.status !== 'retrieved') { client.release(); return reply.code(409).send({ error: 'A retirada só pode ser anulada em demanda retirada' }); }
        setClauses = [`status = 'ready'`, `retrieved_at = NULL`, `sla_breached_salao = false`, `sla_breach_minutes_salao = NULL`];
        cascade = ['retrieved', 'sla_breach_salao'];
        backTo = 'pronta (aguardando retirada)';
      } else if (step === 'marked_ready') {
        if (demand.status !== 'ready' && demand.status !== 'retrieved') { client.release(); return reply.code(409).send({ error: 'A pronta só pode ser anulada em demanda pronta ou retirada' }); }
        setClauses = [`status = 'pending'`, `ready_at = NULL`, `ready_out_of_order = false`, `sla_breached_cozinha = false`, `sla_breach_minutes_cozinha = NULL`];
        cascade = ['marked_ready', 'sla_breach_cozinha', 'retrieved', 'sla_breach_salao'];
        if (demand.status === 'retrieved') {
          setClauses.push(`retrieved_at = NULL`, `sla_breached_salao = false`, `sla_breach_minutes_salao = NULL`);
        }
        backTo = 'em preparo';
      } else {
        if (demand.status !== step) { client.release(); return reply.code(409).send({ error: 'Este cancelamento não é o estado atual da demanda' }); }
        const reopen = demand.ready_at ? `'ready'` : `'pending'`;
        backTo = demand.ready_at ? 'pronta (aguardando retirada)' : 'em preparo';
        setClauses = [`status = ${reopen}`, `cancelled_at = NULL`, `cancel_reason = NULL`, `cancel_reason_id = NULL`];
        cascade = [step];
      }

      await client.query('BEGIN');
      const { rows: [updated] } = await client.query<Demand>(
        `UPDATE demands SET ${setClauses.join(', ')} WHERE id = $1 AND status = $2 RETURNING *`,
        [id, demand.status]
      );
      if (!updated) { await client.query('ROLLBACK'); client.release(); return reply.code(409).send({ error: 'Demanda mudou de estado, recarregue o histórico' }); }
      await client.query(
        `UPDATE demand_events SET annulled_at = NOW(), annulled_by = $2, annul_reason = $3
         WHERE demand_id = $1 AND event_type = ANY($4) AND annulled_at IS NULL`,
        [id, by, reason, cascade]
      );
      await client.query(
        `INSERT INTO demand_events (demand_id, event_type, actor, notes) VALUES ($1, 'step_rollback', 'sistema', $2)`,
        [id, `Passo '${step}' anulado por ${by}; voltou para ${backTo}. Motivo: ${reason}`]
      );
      await client.query('COMMIT');
      client.release();

      if (updated.kitchen_station_id) { recomputeStationQueue(updated.kitchen_station_id).catch((e) => request.log.error(e)); }
      computeDailyScores(demandDate).catch((e) => request.log.error(e));
      fastify.io.emit('demand:step-rollback', updated);
      fastify.io.emit('demand:queue-updated');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao anular passo' });
    }
  });

  // Limpeza manual de dados antigos (retenção configurável via system_settings.data_retention_days)
  fastify.post<{ Body: { older_than_days?: number } }>(
    '/cleanup', async (request, reply) => {
    try {
      const olderThanDays = request.body?.older_than_days;
      if (olderThanDays !== undefined && (!Number.isInteger(olderThanDays) || olderThanDays <= 0)) {
        return reply.code(400).send({ error: 'older_than_days deve ser um inteiro maior que zero' });
      }
      const floor = await getRetentionDays();
      const effective = Math.max(olderThanDays ?? floor, floor);
      const result = await runCleanup(effective);
      return result;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao executar limpeza' });
    }
  });

  // Cardápio diário: override manual de uma data específica
  fastify.put<{ Params: { date: string }; Body: { menu_id?: string } }>(
    '/daily-menu/:date', async (request, reply) => {
    try {
      const { date } = request.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.code(400).send({ error: 'Data inválida. Use o formato YYYY-MM-DD' });
      }
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().split('T')[0] !== date) {
        return reply.code(400).send({ error: 'Data inválida. Use o formato YYYY-MM-DD' });
      }

      const menuId = request.body?.menu_id;
      if (!menuId) return reply.code(400).send({ error: 'Informe o menu_id' });

      const [menu] = await query<Menu>(
        'SELECT id, number, name FROM menus WHERE id = $1',
        [menuId]
      );
      if (!menu) return reply.code(404).send({ error: 'Cardápio não encontrado' });

      await query<DailyMenu>(
        `INSERT INTO daily_menus (date, menu_id, is_override, updated_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (date) DO UPDATE SET menu_id = $2, is_override = true, updated_at = NOW()
         RETURNING *`,
        [date, menuId]
      );

      fastify.io.emit('menu:updated', { date, menu_id: menuId });
      return {
        date,
        menu_id: menuId,
        menu_number: menu.number,
        menu_name: menu.name,
        is_override: true,
      };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao definir cardápio da data' });
    }
  });

  // Turno jantar: ativação com transferência de pendências do almoço
  fastify.post('/shift/dinner', async (request, reply) => {
    const client = await pool.connect();
    try {
      const dailyMenuId = await ensureTodayMenu();

      const { rows: stationRows } = await client.query<{ id: string }>(
        `SELECT id FROM kitchen_stations WHERE code = 'jantar'`
      );
      if (stationRows.length === 0) {
        client.release();
        return reply.code(500).send({ error: 'Estação jantar não encontrada' });
      }
      const jantarId = stationRows[0].id;

      const today = (await client.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`)).rows[0].today;

      await client.query('BEGIN');

      // Produtos flexíveis: ficam no quente no almoço e migram para jantar no turno noturno
      await client.query(
        `UPDATE products SET kitchen_station_id = $1
         WHERE name = ANY($2::text[]) AND kitchen_station_id <> $1`,
        [jantarId, ['INHAME COZIDO', 'DEL\u00CDCIA DE PEIXE', 'DEL\u00CDCIA DE FRANGO']]
      );

      const { rows: addedRows } = await client.query(
        `INSERT INTO daily_menu_overrides (daily_menu_id, product_id, action, reason)
         SELECT $1, p.id, 'add', 'Turno jantar ativado'
         FROM products p
         WHERE p.active = true AND p.kitchen_station_id = $2
         ON CONFLICT (daily_menu_id, product_id) DO NOTHING
         RETURNING id`,
        [dailyMenuId, jantarId]
      );

      const { rows: sourceRows } = await client.query<{ kitchen_station_id: string | null }>(
        `SELECT DISTINCT kitchen_station_id FROM demands
         WHERE status = 'pending' AND created_at::date = $1 AND kitchen_station_id <> $2`,
        [today, jantarId]
      );

      const { rows: countRows } = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::int AS cnt FROM demands
         WHERE status = 'pending' AND created_at::date = $1 AND kitchen_station_id <> $2`,
        [today, jantarId]
      );
      const pendingLunchDemands = parseInt(countRows[0].cnt, 10);

      const { rows: transferred } = await client.query<{ id: string }>(
        `UPDATE demands SET origin_station_id = COALESCE(origin_station_id, kitchen_station_id), kitchen_station_id = $1
         WHERE status = 'pending' AND created_at::date = $2 AND kitchen_station_id <> $1
         RETURNING id`,
        [jantarId, today]
      );

      for (const t of transferred) {
        await client.query(
          `INSERT INTO demand_events (demand_id, event_type, actor, notes)
           VALUES ($1, 'shift_transfer', 'sistema',
             'Transferida para a Cozinha Jantar na ativação do turno jantar')`,
          [t.id]
        );
      }

      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ('shift_dinner_active_date', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [today]
      );
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ('shift_dinner_started_at', now()::text)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );

      await client.query('COMMIT');
      client.release();

      await recomputeStationQueue(jantarId);
      for (const s of sourceRows) {
        if (s.kitchen_station_id && s.kitchen_station_id !== jantarId) {
          await recomputeStationQueue(s.kitchen_station_id);
        }
      }
      computeDailyScores(today).catch((e) => request.log.error(e));

      fastify.io.emit('menu:updated', { date: today, shift: 'dinner' });
      fastify.io.emit('shift:updated', { shift: 'dinner' });
      fastify.io.emit('demand:queue-updated');

      return {
        shift: 'dinner' as const,
        added_products: addedRows.length,
        transferred_demands: transferred.length,
        pending_lunch_demands: pendingLunchDemands,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch((e) => request.log.error(e));
      client.release();
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao ativar turno jantar' });
    }
  });

  // Turno jantar: encerramento manual (revert para o almoço)
  fastify.post('/shift/lunch', async (request, reply) => {
    const client = await pool.connect();
    try {
      const dailyMenuId = await ensureTodayMenu();

      const { rows: jantarRows } = await client.query<{ id: string }>(
        `SELECT id FROM kitchen_stations WHERE code = 'jantar'`
      );
      const { rows: quenteARows } = await client.query<{ id: string }>(
        `SELECT id FROM kitchen_stations WHERE code = 'quente_a'`
      );
      if (jantarRows.length === 0 || quenteARows.length === 0) {
        client.release();
        return reply.code(500).send({ error: 'Estação não encontrada' });
      }
      const jantarId = jantarRows[0].id;
      const quenteAId = quenteARows[0].id;

      const today = (await client.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`)).rows[0].today;

      await client.query('BEGIN');

      const { rows: removedRows } = await client.query(
        `DELETE FROM daily_menu_overrides
         WHERE daily_menu_id = $1 AND action = 'add'
           AND product_id IN (SELECT id FROM products WHERE kitchen_station_id = $2)
         RETURNING id`,
        [dailyMenuId, jantarId]
      );

      // Reverte produtos flexíveis para a estação do almoço
      await client.query(
        `UPDATE products SET kitchen_station_id = CASE
           WHEN name = 'INHAME COZIDO' THEN (SELECT id FROM kitchen_stations WHERE code = 'quente_b')
           WHEN name = 'DEL\u00CDCIA DE PEIXE' THEN (SELECT id FROM kitchen_stations WHERE code = 'quente_a')
           WHEN name = 'DEL\u00CDCIA DE FRANGO' THEN (SELECT id FROM kitchen_stations WHERE code = 'quente_b')
         END
         WHERE name = ANY($1::text[]) AND kitchen_station_id = $2`,
        [['INHAME COZIDO', 'DEL\u00CDCIA DE PEIXE', 'DEL\u00CDCIA DE FRANGO'], jantarId]
      );

      const { rows: transferred } = await client.query<{ id: string; kitchen_station_id: string }>(
        `UPDATE demands SET kitchen_station_id = origin_station_id, origin_station_id = NULL
         WHERE status = 'pending' AND created_at::date = $1 AND kitchen_station_id = $2
           AND origin_station_id IS NOT NULL
         RETURNING id, kitchen_station_id`,
        [today, jantarId]
      );
      const { rows: stationNameRows } = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM kitchen_stations`
      );
      const stationNames = new Map(stationNameRows.map((s) => [s.id, s.name]));
      for (const t of transferred) {
        const nome = stationNames.get(t.kitchen_station_id) ?? 'a estação de origem';
        await client.query(
          `INSERT INTO demand_events (demand_id, event_type, actor, notes)
           VALUES ($1, 'shift_transfer', 'sistema', $2)`,
          [t.id, `Revertida para ${nome} no encerramento do turno jantar`]
        );
      }

      await client.query(
        `UPDATE system_settings SET value = '' WHERE key = 'shift_dinner_active_date'`
      );
      // shift_dinner_started_at é propositalmente mantido: a janela do jantar
      // continua valendo para a nota salao_jantar e as ocorrências do dia.

      await client.query('COMMIT');
      client.release();

      await recomputeStationQueue(jantarId);
      // Recomputa cada estação de destino distinta revertida (espelha a ativação).
      // quenteAId continua verificado acima; se quente_a estiver entre os destinos,
      // já é coberta pelo conjunto — sem recompute hardcoded quando não recebeu nada.
      for (const destino of new Set(
        transferred
          .map((t) => t.kitchen_station_id)
          .filter((id) => id && id !== jantarId)
      )) {
        await recomputeStationQueue(destino);
      }
      computeDailyScores(today).catch((e) => request.log.error(e));

      fastify.io.emit('menu:updated', { date: today, shift: 'lunch' });
      fastify.io.emit('shift:updated', { shift: 'lunch' });
      fastify.io.emit('demand:queue-updated');

      return {
        shift: 'lunch' as const,
        removed_products: removedRows.length,
        transferred_demands: transferred.length,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch((e) => request.log.error(e));
      client.release();
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao encerrar turno jantar' });
    }
  });

  // GET: Configuração dos Pesos de Desempenho
  fastify.get('/settings/weights', async (request, reply) => {
    try {
      return await getWeights();
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar pesos' });
    }
  });

  // PUT: Atualiza a configuração de pesos de desempenho
  fastify.put<{
    Body: Partial<{
      cancellation_cozinha: number;
      cancellation_salao: number;
      stockout_salao: number;
      sla_min: number;
      sla_max: number;
    }>
  }>('/settings/weights', async (request, reply) => {
    try {
      const body = request.body || {};
      const values = [
        body.cancellation_cozinha,
        body.cancellation_salao,
        body.stockout_salao,
        body.sla_min,
        body.sla_max,
      ];
      const invalidValue = values.some(value =>
        typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 5
      );
      if (invalidValue || (body.sla_min as number) > (body.sla_max as number)) {
        return reply.code(400).send({ error: 'Valores inválidos: confira mínimo ≤ máximo e limites 0–5' });
      }

      const round2 = (value: number): number => Math.round(value * 100) / 100;

      const queries = [
        { key: 'score_weight_cancellation_cozinha', val: round2(body.cancellation_cozinha as number) },
        { key: 'score_weight_cancellation_salao', val: round2(body.cancellation_salao as number) },
        { key: 'score_weight_stockout_salao', val: round2(body.stockout_salao as number) },
        { key: 'score_weight_sla_min', val: round2(body.sla_min as number) },
        { key: 'score_weight_sla_max', val: round2(body.sla_max as number) },
      ];

      for (const q of queries) {
        await query(
          `INSERT INTO system_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [q.key, q.val.toString()]
        );
      }

      await query(
        `DELETE FROM system_settings
         WHERE key IN ('score_weight_sla_breach', 'score_weight_cancellation', 'score_weight_slow_item')`
      );

      // Recálculo retroativo: dispara o recálculo em background
      // sem travar a request HTTP do usuário
      query<{ date: any }>(
        `SELECT DISTINCT date FROM performance_scores ORDER BY date`
      ).then(async (dates) => {
        request.log.info(`Iniciando recálculo retroativo para ${dates.length} datas...`);
        for (const row of dates) {
          const dateStr = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date);
          await computeDailyScores(dateStr).catch(e => request.log.error(e));
        }
        request.log.info('Recálculo retroativo concluído.');
      }).catch(e => request.log.error('Erro ao buscar datas para recálculo', e));

      return { success: true, message: 'Recálculo em background iniciado.' };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao salvar pesos' });
    }
  });

  // Pis: status online via heartbeat recebido pelo servidor.
  fastify.get('/pis/status', async (request, reply) => {
    try {
      return getPiStatus();
    } catch (e) {
      request.log.error(e);
      return reply.code(500).send({ error: 'Erro ao buscar status dos Pis' });
    }
  });

  // Pis: controle remoto (gerente/admin) — emite pi:power na sala kds-pis e audita em pi_events
  fastify.post<{ Params: { target: string; action: string } }>('/pis/:target/:action', {
    schema: {
      params: {
        type: 'object',
        required: ['target', 'action'],
        properties: {
          target: { type: 'string', enum: ['quente', 'fria', 'ambos'] },
          action: { type: 'string', enum: ['shutdown', 'reboot'] },
        },
      },
    },
  }, async (request, reply) => {
    const { target, action } = request.params as { target: PiTarget; action: PiAction };
    const by = request.user!.email ?? request.user!.id;
    const at = new Date().toISOString();
    const room = 'kds-pis';
    const payload = { target, action, by, at };
    const status = getPiStatus();
    const targetKeys = target === 'ambos' ? ['quente', 'fria'] as const : [target];
    const onlineTargets = targetKeys.filter((key) => status[PI_HOSTS[key]].online);
    const anyOnline = onlineTargets.length > 0;
    request.log.info({ piPower: payload, onlineTargets }, 'pi:power emit');
    if (anyOnline) fastify.io.to(room).emit('pi:power', payload);
    await query(`INSERT INTO pi_events (target, action, by, online) VALUES ($1,$2,$3,$4)`, [target, action, by, anyOnline]);
    return reply.code(anyOnline ? 200 : 202).send({
      status: anyOnline ? 'sent' : 'offline',
      target,
      action,
      by,
      at,
      online_targets: onlineTargets,
    });
  });

}
