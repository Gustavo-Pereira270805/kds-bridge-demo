import { FastifyInstance } from 'fastify';
import { query } from '../db/client';
import { Product, ProductSearchRow } from '../types';

export default async function productsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    try {
      const products = await query<Product>(
        'SELECT * FROM products WHERE active = true'
      );
      return products;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar produtos' });
    }
  });

  // Registrada ANTES de rotas com parâmetro curinga para não ser capturada por elas
  fastify.get<{ Querystring: { q?: string } }>('/search', async (request, reply) => {
    try {
      const q = request.query.q ?? '';
      const rows = await query<ProductSearchRow>(
        `SELECT p.id, p.name, p.category, p.kitchen_station_id,
          EXISTS(
            SELECT 1 FROM daily_menu_effective dme
            WHERE dme.product_id = p.id AND dme.date = CURRENT_DATE
          ) AS in_today_menu
        FROM products p
        WHERE p.active = true AND p.name ILIKE $1
        ORDER BY in_today_menu DESC, p.name
        LIMIT 15`,
        [`%${q}%`]
      );
      return rows;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar produtos' });
    }
  });

  fastify.get('/all', async (request, reply) => {
    try {
      const products = await query<Product>(
        'SELECT * FROM products ORDER BY category, name'
      );
      return products;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar produtos' });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const products = await query<Product>(
        'SELECT * FROM products WHERE id = $1',
        [id]
      );
      if (products.length === 0) {
        return reply.code(404).send({ error: 'Produto não encontrado' });
      }
      const newActive = !products[0].active;
      await query(
        'UPDATE products SET active = $1 WHERE id = $2',
        [newActive, id]
      );
      const updated = await query<Product>(
        'SELECT * FROM products WHERE id = $1',
        [id]
      );
      fastify.io.emit('product:updated', updated[0]);
      return updated[0];
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao alternar produto' });
    }
  });
}
