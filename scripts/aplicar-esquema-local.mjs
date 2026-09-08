// KDS Bridge — aplica o esquema idêntico da nuvem no banco local.
// Lê supabase/schema.sql + supabase/migrations/*.sql e executa no DATABASE_URL atual.
// Exige que o DATABASE_URL aponte para localhost (trava de segurança contra escrita na nuvem).
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function ehLocal(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.');
  } catch {
    return false;
  }
}

const urlBanco = process.env.DATABASE_URL;
if (!urlBanco) {
  console.error('[esquema-local] DATABASE_URL ausente no .env. Rode "npm run db:local:usar" antes.');
  process.exit(1);
}
if (!ehLocal(urlBanco)) {
  console.error('[esquema-local] TRAVA DE SEGURANÇA: DATABASE_URL não é localhost. Recuso aplicar esquema fora do banco local.');
  console.error('[esquema-local] Atual: ' + urlBanco.replace(/:[^:@]+@/, ':***@'));
  process.exit(1);
}

const pool = new Pool({ connectionString: urlBanco });

const arquivos = [join(raiz, 'supabase', 'schema.sql')];
const pastaMigracoes = join(raiz, 'supabase', 'migrations');
for (const nome of readdirSync(pastaMigracoes).sort()) {
  if (nome.endsWith('.sql')) arquivos.push(join(pastaMigracoes, nome));
}

for (const caminho of arquivos) {
  const sql = readFileSync(caminho, 'utf8');
  console.log(`[esquema-local] Aplicando ${caminho.replace(raiz + '\\', '')} (${sql.length} caracteres)...`);
  try {
    await pool.query(sql);
    console.log(`[esquema-local] OK: ${caminho.split('\\').pop()}`);
  } catch (erro) {
    console.error(`[esquema-local] FALHA em ${caminho}:`, erro.message);
    await pool.end();
    process.exit(1);
  }
}

await pool.end();
console.log('[esquema-local] Esquema local idêntico à nuvem aplicado com sucesso.');
