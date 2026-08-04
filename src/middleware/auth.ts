import { FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email?: string;
      app_metadata: Record<string, unknown>;
      user_metadata: Record<string, unknown>;
    };
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const token = request.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    reply.code(401).send({ error: 'Token não fornecido' });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    reply.code(401).send({ error: 'Token inválido ou expirado' });
    return;
  }

  request.user = data.user;
}

export async function requireAdminOrManager(
  request: FastifyRequest,
  reply: FastifyReply
) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  // O papel administrativo precisa vir do app_metadata confirmado pelo getUser.
  // user_metadata é editável pelo usuário e nunca pode conceder privilégio.
  const role = request.user?.app_metadata?.role;
  const allowed = role === 'admin' || role === 'gerente';
  if (!allowed) {
    reply.code(403).send({ error: 'Usuário autenticado sem permissão administrativa' });
  }
}
