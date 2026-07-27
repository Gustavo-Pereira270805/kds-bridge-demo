import { FastifyInstance } from 'fastify';
import { query } from '../db/client';
import { Unit } from '../types';

export default async function unitsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { all?: string } }>('/', async (request, reply) => {
    try {
      const showAll = request.query.all === 'true';
      const units = await query<Unit>(
        showAll
          ? 'SELECT * FROM units ORDER BY active DESC, featured DESC, label'
          : 'SELECT * FROM units WHERE active = true ORDER BY featured DESC, label'
      );
      return units;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar unidades de medida' });
    }
  });

  fastify.get<{ Params: { productId: string } }>(
    '/by-product/:productId',
    async (request, reply) => {
      try {
        const { productId } = request.params;
        const units = await query<Unit>(
          `SELECT u.* FROM product_units pu
           JOIN units u ON u.id = pu.unit_id
           WHERE pu.product_id = $1 AND u.active = true
           ORDER BY u.featured DESC, u.label`,
          [productId]
        );
        return units;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao buscar unidades do produto' });
      }
    }
  );
}
