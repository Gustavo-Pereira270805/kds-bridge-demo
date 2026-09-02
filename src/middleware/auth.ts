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
