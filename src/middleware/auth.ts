import { FastifyRequest, FastifyReply } from 'fastify';
import { createClient, User } from '@supabase/supabase-js';
import { AuthUser, UserRole } from '../types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const VALID_ROLES: UserRole[] = ['salao', 'cozinha', 'gerente', 'admin'];

export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

function roleFromUser(user: User): UserRole | null {
  const candidate = user.app_metadata?.role as unknown;
  if (typeof candidate === 'string' && (VALID_ROLES as string[]).includes(candidate)) {
    return candidate as UserRole;
  }
  return null;
}

export { roleFromUser };

export async function getUserByToken(token: string): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const role = roleFromUser(data.user);
  if (!role) return null;
  return { id: data.user.id, email: data.user.email, role };
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const token = extractToken(request);

  if (!token) {
    reply.code(401).send({ error: 'Token não fornecido' });
    return;
  }

  const user = await getUserByToken(token);

  if (!user) {
    reply.code(401).send({ error: 'Token inválido ou expirado' });
    return;
  }

  request.user = user;
}

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!request.user || !roles.includes(request.user.role)) {
      reply.code(403).send({ error: 'Permissão insuficiente para esta operação' });
    }
  };
}

import { isKioskIp, clientIpFromHeaders } from './kiosk';

function requestIp(request: FastifyRequest): string {
  return clientIpFromHeaders(
    request.headers['x-forwarded-for'],
    request.ip ?? request.socket?.remoteAddress ?? ''
  );
}

export async function isKitchenAllowed(request: FastifyRequest): Promise<boolean> {
  if (isKioskIp(requestIp(request))) return true;
  const token = extractToken(request);
  if (!token) return false;
  const user = await getUserByToken(token);
  return !!user && (user.role === 'gerente' || user.role === 'admin');
}

export async function requireKitchen(request: FastifyRequest, reply: FastifyReply) {
  if (isKioskIp(requestIp(request))) return;
  const token = extractToken(request);
  if (!token) {
    reply.code(401).send({ error: 'Autenticação necessária para a cozinha' });
    return;
  }
  const user = await getUserByToken(token);
  if (!user) {
    reply.code(401).send({ error: 'Token inválido ou expirado' });
    return;
  }
  if (user.role !== 'gerente' && user.role !== 'admin') {
    reply.code(403).send({ error: 'Acesso à cozinha restrito à gerência' });
    return;
  }
  request.user = user;
}

// Cookie `kds_token` (espelho do login, ver security.js): usado SOMENTE pelo
// guarda das views da cozinha, pois a navegação do navegador não envia
// Authorization. NUNCA usar na API — credencial por cookie em rota de
// escrita abriria CSRF via navegador.
export function extractCookieToken(request: FastifyRequest): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const partes = raw.split(';');
  for (const parte of partes) {
    const idx = parte.indexOf('=');
    if (idx < 0) continue;
    if (parte.slice(0, idx).trim() === 'kds_token') {
      const valor = parte.slice(idx + 1).trim();
      try {
        return decodeURIComponent(valor);
      } catch (e) {
        return valor;
      }
    }
  }
  return null;
}

export async function isKitchenCookieAllowed(request: FastifyRequest): Promise<boolean> {
  const token = extractCookieToken(request);
  if (!token) return false;
  const user = await getUserByToken(token);
  return !!user && (user.role === 'gerente' || user.role === 'admin');
}
