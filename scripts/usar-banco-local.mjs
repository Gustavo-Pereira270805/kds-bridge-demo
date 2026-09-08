// KDS Bridge — isola o ambiente dev no banco local.
// Faz backup do .env atual em .env.nuvem (só se apontar para a nuvem) e
// reescreve o DATABASE_URL para o Postgres local do Docker.
// Mantém SUPABASE_URL/ANON_KEY (o login continua validando o JWT na nuvem,
// mas nenhum dado operacional vai para lá).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const caminhoEnv = join(raiz, '.env');
const caminhoNuvem = join(raiz, '.env.nuvem');

const URL_LOCAL = 'postgresql://kds:kds_local_123@localhost:5432/kds';

function ehLocal(url) {
  return /localhost|127\.0\.0\.1/.test(url || '');
}

if (!existsSync(caminhoEnv)) {
  console.error('[usar-local] .env não encontrado. Copie o .env.example antes.');
  process.exit(1);
}

const conteudo = readFileSync(caminhoEnv, 'utf8');
const linhaBanco = conteudo.split('\n').find((l) => l.startsWith('DATABASE_URL='));
const bancoAtual = (linhaBanco || '').replace('DATABASE_URL=', '').trim();

if (bancoAtual && !ehLocal(bancoAtual) && !existsSync(caminhoNuvem)) {
  writeFileSync(caminhoNuvem, conteudo, 'utf8');
  console.log('[usar-local] Backup da nuvem salvo em .env.nuvem (não versionado).');
} else if (bancoAtual && !ehLocal(bancoAtual) && existsSync(caminhoNuvem)) {
  console.log('[usar-local] .env.nuvem já existe — mantido (não sobrescrito).');
}

if (ehLocal(bancoAtual)) {
  console.log('[usar-local] .env já aponta para o banco local. Nada a fazer.');
  process.exit(0);
}

const novo = conteudo
  .split('\n')
  .map((linha) => (linha.startsWith('DATABASE_URL=') ? `DATABASE_URL=${URL_LOCAL}` : linha))
  .join('\n');

writeFileSync(caminhoEnv, novo, 'utf8');
console.log('[usar-local] .env agora aponta para o banco LOCAL:');
console.log(`[usar-local] DATABASE_URL=${URL_LOCAL}`);
console.log('[usar-local] Próximos passos: npm run db:local:subir && npm run db:local:esquema && npm run db:local:clonar');
