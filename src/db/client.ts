import { Pool, PoolClient } from 'pg';
import { promises as dns } from 'dns';
import fs from 'fs';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL!;

function parseConnectionString(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 5432,
    database: parsed.pathname.slice(1),
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
  };
}

const dbConfig = parseConnectionString(DATABASE_URL);

let _pool: Pool | null = null;
let _initPromise: Promise<Pool> | null = null;

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function isLocalIp(ip: string): boolean {
  return ip === '::1' || ip === '127.0.0.1' || isPrivateV4(ip);
}

async function getPool(): Promise<Pool> {
  if (_pool) return _pool;
  if (!_initPromise) {
    _initPromise = (async () => {
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-f:]+)$/i;
      let ip: string;
      if (ipRegex.test(dbConfig.host)) {
        ip = dbConfig.host;
        console.log(`[db] Using direct IP: ${ip}`);
      } else if (dbConfig.host === 'localhost') {
        // dns.resolve4/resolve6 ignoram o arquivo hosts do Windows e falham
        // para "localhost" (ENOTFOUND). O driver pg resolve via hosts, então
        // usa o loopback direto e desliga o SSL (banco local).
        ip = '127.0.0.1';
        console.log(`[db] Host local detectado (localhost) -> ${ip}`);
      } else {
        ip = await dns
          .resolve4(dbConfig.host)
          .then((addrs) => addrs[0])
          .catch(() => dns.resolve6(dbConfig.host).then((addrs) => addrs[0]));
        console.log(`[db] Resolved ${dbConfig.host} -> ${ip}`);
      }
      const isLocal = isLocalIp(ip);
      const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
      const customCaPath = process.env.DB_SSL_CA_FILE;
      if (!isLocal && !rejectUnauthorized) {
        console.warn(
          '[db] ATENÇÃO: verificação TLS do banco DESLIGADA (DB_SSL_REJECT_UNAUTHORIZED=false). ' +
          'Use DB_SSL_CA_FILE com o CA do proxy em vez disso.'
        );
      }
      let ssl: false | { rejectUnauthorized: boolean; servername: string; ca?: string };
      if (isLocal) {
        ssl = false;
      } else if (customCaPath) {
        let ca: string;
        try {
          ca = fs.readFileSync(customCaPath, 'utf8');
        } catch (erro) {
          throw new Error(
            `[db] Falha ao ler o CA próprio do banco em DB_SSL_CA_FILE (${customCaPath}): ${(erro as Error).message}`
          );
        }
        console.log(`[db] Usando CA próprio do banco em ${customCaPath}`);
        ssl = { rejectUnauthorized: true, servername: dbConfig.host, ca };
      } else {
        ssl = { rejectUnauthorized, servername: dbConfig.host };
      }
      _pool = new Pool({
        host: ip,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl,
      });
      return _pool;
    })();
  }
  return _initPromise;
}

export async function query<T = unknown>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const p = await getPool();
  const result = await p.query(text, params);
  return result.rows as T[];
}

async function getClient(): Promise<PoolClient> {
  const p = await getPool();
  return p.connect();
}

export async function connectDatabase(): Promise<void> {
  const client = await getClient();
  try {
    await client.query('SELECT 1');
    console.log('✓ Banco de dados conectado');
  } finally {
    client.release();
  }
}

export const pool = {
  query: async (text: string, params?: unknown[]) => {
    const p = await getPool();
    return p.query(text, params);
  },
  connect: async () => {
    const p = await getPool();
    return p.connect();
  },
  on: (event: string | symbol, handler: (...args: any[]) => void) => {
    getPool().then((p) => p.on(event as any, handler));
    return pool;
  },
  end: async () => {
    if (_pool) {
      await _pool.end();
      _pool = null;
      _initPromise = null;
    }
  },
} as unknown as Pool;

export default pool;
