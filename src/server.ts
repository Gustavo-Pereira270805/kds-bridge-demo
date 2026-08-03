import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';

import { connectDatabase, pool } from './db/client';
import productRoutes from './routes/products';
import demandRoutes from './routes/demands';
import dailyMenuRoutes from './routes/daily-menu';
import analyticsRoutes from './routes/analytics';
import authRoutes from './routes/auth';
import kitchenStationsRoutes from './routes/kitchen-stations';
import stationThemeRoutes from './routes/station-themes';
import unitsRoutes from './routes/units';
import adminRoutes from './routes/admin';
import { registerSocketHandlers } from './socket/handlers';
import { runCleanup } from './services/cleanup.service';

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.RETOOL_URL || '*']
    : '*',
});

const io = new Server(fastify.server, {
  cors: {
    origin: '*',
  },
});

fastify.io = io;

registerSocketHandlers(io);

function getView(filename: string): string {
  return fs.readFileSync(path.join(__dirname, 'views', filename), 'utf8');
}

fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'views', 'styles'),
  prefix: '/styles/',
  prefixAvoidTrailingSlash: true,
});

fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'views', 'scripts'),
  prefix: '/scripts/',
  prefixAvoidTrailingSlash: true,
  decorateReply: false,
});

fastify.get('/salao', async (_request, reply) => {
  return reply.type('text/html').send(getView('salao.html'));
});

fastify.get('/cozinha', async (_request, reply) => {
  return reply.type('text/html').send(getView('cozinha.html'));
});

fastify.get('/cozinha-quente', async (_request, reply) => {
  return reply.type('text/html').send(getView('cozinha-quente.html'));
});

fastify.get('/cozinha-fria', async (_request, reply) => {
  return reply.type('text/html').send(getView('cozinha-fria.html'));
});

fastify.get('/gerente', async (_request, reply) => {
  return reply.type('text/html').send(getView('gerente.html'));
});

fastify.get('/admin', async (_request, reply) => {
  return reply.type('text/html').send(getView('admin.html'));
});

fastify.get('/dashboard', async (_request, reply) => {
  return reply.type('text/html').send(getView('dashboard.html'));
});

fastify.get('/health', async (_request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

fastify.register(productRoutes, { prefix: '/api/v1/products' });
fastify.register(demandRoutes, { prefix: '/api/v1/demands' });
fastify.register(dailyMenuRoutes, { prefix: '/api/v1/daily-menu' });
fastify.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
fastify.register(authRoutes, { prefix: '/api/v1/auth' });
fastify.register(kitchenStationsRoutes, { prefix: '/api/v1/kitchen-stations' });
fastify.register(stationThemeRoutes, { prefix: '/api/v1/station-themes' });
fastify.register(unitsRoutes, { prefix: '/api/v1/units' });
fastify.register(adminRoutes, { prefix: '/api/v1/admin' });

const PORT = parseInt(process.env.PORT || '3000', 10);

const start = async () => {
  try {
    await connectDatabase();
    await seedDatabase();
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    scheduleDailyCleanup();
    console.log('┌─────────────────────────────────────────┐');
    console.log('│         KDS Bridge — Servidor (v2.5)    │');
    console.log(`│  HTTP  →  http://0.0.0.0:${PORT}            │`);
    console.log('└─────────────────────────────────────────┘');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

async function seedDatabase() {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Keep local/dev databases aligned with the versioned station-theme migration.
      await client.query(
        `ALTER TABLE kitchen_stations
         ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark'`
      );
      await client.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conname = 'kitchen_stations_theme_check'
           ) THEN
             ALTER TABLE kitchen_stations
               ADD CONSTRAINT kitchen_stations_theme_check
               CHECK (theme IN ('dark', 'light'));
           END IF;
         END $$`
      );
      await client.query(
        `UPDATE kitchen_stations SET theme = 'dark'
         WHERE theme IS NULL OR theme NOT IN ('dark', 'light')`
      );
      await client.query(
        `INSERT INTO system_settings (key, value)
         VALUES ('station_theme_salao', 'dark')
         ON CONFLICT (key) DO NOTHING`
      );

      const { rows: ksRows } = await client.query('SELECT id, code FROM kitchen_stations');
      const stationMap: Record<string, string> = {};
      for (const ks of ksRows) { stationMap[ks.code] = ks.id; }

      const { rows: prodCount } = await client.query('SELECT COUNT(*) as count FROM products');
      if (parseInt(prodCount[0].count) === 0) {
        const products: [string, string, string, number, number][] = [
          ['Arroz Branco',       'Guarnição',       'quente_a', 15, 10],
          ['Feijão Carioca',     'Guarnição',       'quente_a', 15, 10],
          ['Frango Grelhado',    'Proteína',        'quente_a', 20, 12],
          ['Bife Acebolado',     'Proteína',        'quente_a', 25, 15],
          ['Batata Frita',       'Acompanhamento',  'quente_b', 12, 8],
          ['Farofa',             'Acompanhamento',  'quente_b', 10, 7],
          ['Macarrão ao Sugo',   'Massa',           'quente_b', 18, 12],
          ['Peixe Frito',        'Proteína',        'quente_b', 20, 12],
          ['Salada de Alface',   'Salada',          'fria',     5,  5],
          ['Tomate Picado',      'Salada',          'fria',     5,  5],
        ];

        for (const [name, category, station, slaN, slaU] of products) {
          await client.query(
            `INSERT INTO products (name, category, kitchen_station_id, sla_minutes_normal, sla_minutes_urgente)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING`,
            [name, category, stationMap[station], slaN, slaU]
          );
        }
        console.log('[Seed] 10 produtos inseridos com estações e SLA');
      } else {
        await client.query(
          `UPDATE products SET kitchen_station_id = (SELECT id FROM kitchen_stations WHERE code = 'quente_a')
           WHERE kitchen_station_id IS NULL AND category IN ('Guarnição','Proteína')`
        );
        await client.query(
          `UPDATE products SET kitchen_station_id = (SELECT id FROM kitchen_stations WHERE code = 'fria')
           WHERE kitchen_station_id IS NULL AND category = 'Salada'`
        );
        console.log('[Seed] kitchen_station_id corrigido nos produtos existentes');
      }

      const { rows: allP } = await client.query('SELECT id, name, category FROM products');
      const { rows: allU } = await client.query('SELECT id, code FROM units');

      const { rows: puCount } = await client.query('SELECT COUNT(*) as count FROM product_units');
      if (parseInt(puCount[0].count) === 0) {
        const unitByCode: Record<string, string> = {};
        for (const u of allU) { unitByCode[u.code] = u.id; }

        const productUnits: Record<string, string[]> = {
          'Arroz Branco':      ['kg','porcoes','travessa_g','travessa_p','bacia_g','bacia_p'],
          'Feijão Carioca':    ['kg','porcoes','travessa_g','travessa_p','bacia_g','bacia_p'],
          'Frango Grelhado':   ['kg','porcoes','unidade'],
          'Bife Acebolado':    ['kg','porcoes','unidade'],
          'Batata Frita':      ['kg','porcoes','travessa_g','travessa_p'],
          'Farofa':            ['kg','porcoes','travessa_g','travessa_p'],
          'Macarrão ao Sugo':  ['kg','porcoes','travessa_g','travessa_p','bacia_g','bacia_p'],
          'Peixe Frito':       ['kg','porcoes','unidade'],
          'Salada de Alface':  ['travessa_g','travessa_m','travessa_p','tigela'],
          'Tomate Picado':     ['travessa_g','travessa_m','travessa_p','tigela'],
        };

        let puInserted = 0;
        for (const p of allP) {
          const codes = productUnits[p.name] || ['kg','porcoes','unidade'];
          for (const code of codes) {
            const uid = unitByCode[code];
            if (uid) {
              await client.query(
                'INSERT INTO product_units (product_id, unit_id) VALUES ($1, $2) ON CONFLICT (product_id, unit_id) DO NOTHING',
                [p.id, uid]
              );
              puInserted++;
            }
          }
        }
        console.log(`[Seed] ${puInserted} vínculos product_units criados`);
      }

      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ('data_retention_days', '180')
         ON CONFLICT (key) DO NOTHING`
      );

      const { rows: menuCount } = await client.query('SELECT COUNT(*) as count FROM menus');
      if (parseInt(menuCount[0].count) === 0) {
        for (let i = 1; i <= 14; i++) {
          await client.query(
            'INSERT INTO menus (number, name) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING',
            [i, `Cardápio ${i}`]
          );
        }
        console.log('[Seed] 14 cardápios inseridos');
      }

      const { rows: mpCount } = await client.query('SELECT COUNT(*) as count FROM menu_products');
      if (parseInt(mpCount[0].count) === 0) {
        for (let menuNum = 1; menuNum <= 14; menuNum++) {
          const { rows: menu } = await client.query('SELECT id FROM menus WHERE number = $1', [menuNum]);
          if (menu.length === 0) continue;
          for (let k = 0; k < allP.length; k++) {
            if ((menuNum + k) % 3 !== 0) continue;
            await client.query(
              'INSERT INTO menu_products (menu_id, product_id) VALUES ($1, $2) ON CONFLICT (menu_id, product_id) DO NOTHING',
              [menu[0].id, allP[k].id]
            );
          }
        }
        console.log('[Seed] Produtos vinculados aos cardápios');
      }

      await client.query('COMMIT');
      console.log('[Seed] Banco populado com sucesso');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Seed] Erro (não crítico):', err);
  }
}

// Limpeza automática diária (03:00) de dados além da retenção configurada — v2.5
function scheduleDailyCleanup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    void runCleanupJob();
    setInterval(() => { void runCleanupJob(); }, 24 * 60 * 60 * 1000);
  }, delay).unref();
}

async function runCleanupJob() {
  try {
    const result = await runCleanup();
    console.log(`[Cleanup] Limpeza automática (>${result.retention_days}d):`, result);
  } catch (err) {
    console.error('[Cleanup] Erro na limpeza automática (não crítico):', err);
  }
}

start();
