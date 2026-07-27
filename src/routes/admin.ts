import { FastifyInstance } from 'fastify';
import { query, pool } from '../db/client';
import { DailyMenu, Demand, Menu, Product } from '../types';
import { runCleanup } from '../services/cleanup.service';
import { logDemandEvent } from '../services/demand-events.service';
import { computeDailyScores } from '../services/performance.service';
import { recomputeStationQueue } from '../services/queue.service';

export default async function adminRoutes(fastify: FastifyInstance) {
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
    '/products/:id', async (request, reply) => {
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

      const annulledBy = (request as { user?: { email?: string } }).user?.email ?? 'gerente';
      const wasPending = demand.status === 'pending';
      const stationId = demand.kitchen_station_id;
      const demandDate = new Date(demand.created_at).toISOString().split('T')[0];

      await client.query('BEGIN');

      const { rows: [updated] } = await client.query<Demand>(
        `UPDATE demands SET status = 'annulled', annulled_at = NOW(), annulled_by = $1, annul_reason = $2
         WHERE id = $3 RETURNING *`,
        [annulledBy, reason, id]
      );

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

  // Limpeza manual de dados antigos (retenção configurável via system_settings.data_retention_days)
  fastify.post<{ Body: { older_than_days?: number } }>(
    '/cleanup', async (request, reply) => {
    try {
      const olderThanDays = request.body?.older_than_days;
      if (olderThanDays !== undefined && (!Number.isInteger(olderThanDays) || olderThanDays <= 0)) {
        return reply.code(400).send({ error: 'older_than_days deve ser um inteiro maior que zero' });
      }
      const result = await runCleanup(olderThanDays);
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
}
