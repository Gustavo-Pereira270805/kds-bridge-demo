import { FastifyInstance } from 'fastify';
import { getCurrentShift } from '../services/shift.service';

export default async function shiftRoutes(fastify: FastifyInstance) {
  fastify.get('/status', async (request, reply) => {
    try {
      const shift = await getCurrentShift();
      return { shift };
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao consultar turno atual' });
    }
  });
}
