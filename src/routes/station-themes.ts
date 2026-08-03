import { FastifyInstance } from 'fastify';
import { query } from '../db/client';

type Theme = 'dark' | 'light';

function normalizeTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark';
}

export default async function stationThemeRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { stationCode: string } }>('/:stationCode', async (request, reply) => {
    const { stationCode } = request.params;
    try {
      if (stationCode === 'salao') {
        const [setting] = await query<{ value: string }>(
          "SELECT value FROM system_settings WHERE key = 'station_theme_salao'"
        );
        return { stationCode, theme: normalizeTheme(setting?.value) };
      }

      if (!['quente_a', 'quente_b', 'fria'].includes(stationCode)) {
        return reply.code(404).send({ error: 'Estação não encontrada' });
      }

      const [station] = await query<{ theme: string }>(
        'SELECT theme FROM kitchen_stations WHERE code = $1',
        [stationCode]
      );
      if (!station) return reply.code(404).send({ error: 'Estação não encontrada' });
      return { stationCode, theme: normalizeTheme(station.theme) };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Erro ao buscar tema da estação' });
    }
  });

  fastify.patch<{ Body: { theme?: Theme } }>('/salao', async (request, reply) => {
    const { theme } = request.body;
    if (theme !== 'dark' && theme !== 'light') {
      return reply.code(400).send({ error: 'Tema inválido' });
    }
    try {
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('station_theme_salao', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [theme]
      );
      fastify.io.to('salao').emit('station:theme-updated', { stationCode: 'salao', theme });
      return { stationCode: 'salao', theme };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Erro ao atualizar tema do salão' });
    }
  });
}
