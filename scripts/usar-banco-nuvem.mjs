// KDS Bridge — volta o ambiente dev para a nuvem (restaura o backup).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const caminhoEnv = join(raiz, '.env');
const caminhoNuvem = join(raiz, '.env.nuvem');

if (!existsSync(caminhoNuvem)) {
  console.error('[usar-nuvem] .env.nuvem não encontrado — nada para restaurar.');
  process.exit(1);
}

const backup = readFileSync(caminhoNuvem, 'utf8');
writeFileSync(caminhoEnv, backup, 'utf8');
console.log('[usar-nuvem] .env restaurado para a nuvem a partir de .env.nuvem.');
console.log('[usar-nuvem] Confira com: Get-Content .env | Select-String DATABASE_URL');
