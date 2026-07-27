import { Pool, PoolClient } from 'pg';
import { promises as dns } from 'dns';
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

async function getPool(): Promise<Pool> {
  if (_pool) return _pool;
  if (!_initPromise) {
    _initPromise = (async () => {
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-f:]+)$/i;
      let ip: string;
      if (ipRegex.test(dbConfig.host)) {
        ip = dbConfig.host;
        console.log(`[db] Using direct IP: ${ip}`);
      } else {
        ip = await dns
          .resolve6(dbConfig.host)
          .then((addrs) => addrs[0])
          .catch(() => dns.resolve4(dbConfig.host).then((addrs) => addrs[0]));
        console.log(`[db] Resolved ${dbConfig.host} -> ${ip}`);
      }
      const isLocal = ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
      _pool = new Pool({
        host: ip,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: isLocal ? false : { rejectUnauthorized: false, servername: dbConfig.host },
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
