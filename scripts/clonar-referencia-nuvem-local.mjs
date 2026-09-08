// KDS Bridge — clona os dados de REFERÊNCIA da nuvem para o banco local.
// Copia: estações, unidades, produtos, vínculos produto x unidade,
// cardápios, vínculos cardápio x produto, motivos de cancelamento,
// configurações neutras e versão de pesos vigente.
// NÃO copia dados operacionais: demandas, eventos, cardápios do dia,
// ajustes do dia, notas de desempenho nem eventos dos Pis.
// Uso: npm run db:local:clonar [-- --com-operacionais]
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const comOperacionais = process.argv.includes('--com-operacionais');

function urlLocalAtual() {
  // O .env já deve apontar para o local (npm run db:local:usar antes).
  const env = readFileSync(join(raiz, '.env'), 'utf8');
  const linha = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  return (linha || '').replace('DATABASE_URL=', '').trim();
}

function urlNuvemBackup() {
  const caminho = join(raiz, '.env.nuvem');
  if (!existsSync(caminho)) return '';
  const env = readFileSync(caminho, 'utf8');
  const linha = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  return (linha || '').replace('DATABASE_URL=', '').trim();
}

const urlLocal = urlLocalAtual();
const urlNuvem = process.env.CLOUD_DATABASE_URL || urlNuvemBackup();

if (!urlNuvem) {
  console.error('[clonar] URL da nuvem não encontrada. Rode "npm run db:local:usar" antes (gera o .env.nuvem) ou defina CLOUD_DATABASE_URL.');
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(urlLocal)) {
  console.error('[clonar] TRAVA DE SEGURANÇA: o .env atual não é local. Rode "npm run db:local:usar" antes.');
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/.test(urlNuvem)) {
  console.error('[clonar] URL da nuvem parece local. Abortado para evitar autocópia.');
  process.exit(1);
}

const nuvem = new Pool({ connectionString: urlNuvem, ssl: { rejectUnauthorized: false } });
const local = new Pool({ connectionString: urlLocal });

const TABELAS_REFERENCIA = [
  'kitchen_stations',
  'units',
  'products',
  'menus',
  'cancel_reasons',
  'system_settings',
  'performance_weight_versions',
  'product_units',
  'menu_products',
];

const TABELAS_OPERACIONAIS = [
  'daily_menus',
  'daily_menu_overrides',
  'demands',
  'demand_events',
  'performance_scores',
  'pi_events',
];

async function conta(pool, tabela) {
  const r = await pool.query(`SELECT COUNT(*)::int AS total FROM "${tabela}"`);
  return r.rows[0].total;
}

try {
  console.log('[clonar] Lendo referência da nuvem...');
  const dados = {};
  for (const tabela of TABELAS_REFERENCIA) {
    const r = await nuvem.query(`SELECT * FROM "${tabela}"`);
    dados[tabela] = r.rows;
    console.log(`[clonar] nuvem ${tabela}: ${r.rows.length} linhas`);
  }
  if (comOperacionais) {
    for (const tabela of TABELAS_OPERACIONAIS) {
      const r = await nuvem.query(`SELECT * FROM "${tabela}"`);
      dados[tabela] = r.rows;
      console.log(`[clonar] nuvem ${tabela}: ${r.rows.length} linhas (operacional)`);
    }
  }

  console.log('[clonar] Limpando banco local (ordem reversa por FK)...');
  const ordemLimpeza = [...TABELAS_OPERACIONAIS, 'menu_products', 'product_units', 'products', 'menus', 'units', 'kitchen_stations', 'cancel_reasons', 'performance_weight_versions'].filter(
    (t) => t !== 'system_settings'
  );
  const cliente = await local.connect();
  try {
    await cliente.query('BEGIN');
    for (const tabela of ordemLimpeza) {
      await cliente.query(`DELETE FROM "${tabela}"`);
    }
    // Configurações: preserva chaves locais e atualiza as vindas da nuvem, exceto estado do turno.
    const chavesTurno = ['shift_dinner_active_date', 'shift_dinner_started_at'];
    const configs = dados.system_settings.filter((c) => !chavesTurno.includes(c.key));
    for (const tabela of TABELAS_REFERENCIA) {
      if (tabela === 'system_settings') continue;
      const linhas = dados[tabela];
      if (linhas.length === 0) continue;
      const colunas = Object.keys(linhas[0]);
      for (const linha of linhas) {
        const valores = colunas.map((_, i) => `$${i + 1}`);
        await cliente.query(
          `INSERT INTO "${tabela}" (${colunas.map((c) => `"${c}"`).join(', ')}) VALUES (${valores.join(', ')}) ON CONFLICT DO NOTHING`,
          colunas.map((c) => linha[c])
        );
      }
      console.log(`[clonar] local ${tabela}: ${linhas.length} linhas inseridas`);
    }
    for (const cfg of configs) {
      await cliente.query(
        'INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [cfg.key, cfg.value]
      );
    }
    console.log(`[clonar] local system_settings: ${configs.length} chaves sincronizadas (turno preservado)`);
    if (comOperacionais) {
      for (const tabela of TABELAS_OPERACIONAIS) {
        const linhas = dados[tabela] || [];
        if (linhas.length === 0) continue;
        const colunas = Object.keys(linhas[0]);
        for (const linha of linhas) {
          const valores = colunas.map((_, i) => `$${i + 1}`);
          await cliente.query(
            `INSERT INTO "${tabela}" (${colunas.map((c) => `"${c}"`).join(', ')}) VALUES (${valores.join(', ')}) ON CONFLICT DO NOTHING`,
            colunas.map((c) => linha[c])
          );
        }
        console.log(`[clonar] local ${tabela}: ${linhas.length} linhas operacionais inseridas`);
      }
    }
    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }

  console.log('[clonar] Conferência do banco local:');
  for (const tabela of [...TABELAS_REFERENCIA, ...(comOperacionais ? TABELAS_OPERACIONAIS : [])]) {
    console.log(`[clonar] local ${tabela}: ${await conta(local, tabela)} linhas`);
  }
  console.log('[clonar] Clone concluído. Nenhum dado operacional foi enviado à nuvem.');
} catch (erro) {
  console.error('[clonar] FALHA:', erro.message);
  process.exitCode = 1;
} finally {
  await nuvem.end().catch(() => {});
  await local.end().catch(() => {});
}
