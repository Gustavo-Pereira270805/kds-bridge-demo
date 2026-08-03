import { FastifyInstance } from 'fastify';
import { query } from '../db/client';
import { KitchenStation } from '../types';
import { recomputeStationQueue } from '../services/queue.service';

export default async function kitchenStationsRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    try {
      const stations = await query<KitchenStation>(
        'SELECT * FROM kitchen_stations ORDER BY name'
      );
      return stations;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar estações da cozinha' });
    }
  });

  fastify.patch<{ Params: { id: string }; Body: { capacity?: number; theme?: 'dark' | 'light' } }>(
    '/:id',
    {
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            capacity: { type: 'number', minimum: 1 },
            theme: { type: 'string', enum: ['dark', 'light'] },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { capacity, theme } = request.body;

        if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
          return reply.code(400).send({ error: 'Capacidade inválida' });
        }
        if (theme !== undefined && theme !== 'dark' && theme !== 'light') {
          return reply.code(400).send({ error: 'Tema inválido' });
        }

        const station = await query<KitchenStation>(
          'SELECT * FROM kitchen_stations WHERE id = $1',
          [id]
        );
        if (station.length === 0) {
          return reply.code(404).send({ error: 'Estação não encontrada' });
        }

        const sets: string[] = [];
        const values: unknown[] = [];
        if (capacity !== undefined) {
          sets.push(`capacity = $${values.length + 1}`);
          values.push(capacity);
        }
        if (theme !== undefined) {
          sets.push(`theme = $${values.length + 1}`);
          values.push(theme);
        }
        values.push(id);
        await query(
          `UPDATE kitchen_stations SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
          values
        );
        if (capacity !== undefined) await recomputeStationQueue(id);

        fastify.io.to('cozinha_quente').emit('kitchen:capacity-updated', {
          stationId: id,
          ...(capacity !== undefined ? { capacity } : {}),
          ...(theme !== undefined ? { theme } : {}),
        });
        if (theme !== undefined) {
          fastify.io.to('cozinha_quente').emit('station:theme-updated', { stationCode: station[0].code, theme });
          fastify.io.to('cozinha_fria').emit('station:theme-updated', { stationCode: station[0].code, theme });
        }
        fastify.io.to('cozinha_fria').emit('kitchen:capacity-updated', {
          stationId: id,
          capacity,
        });
        fastify.io.to('gerente').emit('kitchen:capacity-updated', {
          stationId: id,
          capacity,
        });

        const [updated] = await query<KitchenStation>(
          'SELECT * FROM kitchen_stations WHERE id = $1',
          [id]
        );
        return updated;
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro ao atualizar estação' });
      }
    }
  );

  fastify.get('/queue-occupation', async (request, reply) => {
    try {
      const rows = await query<{
        estacao: string;
        demandas_pendentes_agora: number;
        capacidade_configurada: number;
      }>(
        `SELECT
          ks.name AS estacao,
          COUNT(*) FILTER (WHERE d.status = 'pending')::int AS demandas_pendentes_agora,
          ks.capacity::int AS capacidade_configurada
        FROM demands d
        JOIN kitchen_stations ks ON ks.id = d.kitchen_station_id
        GROUP BY ks.name, ks.capacity
        ORDER BY ks.name`
      );
      return rows;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send({ error: 'Erro ao buscar ocupação da fila' });
    }
  });
}
