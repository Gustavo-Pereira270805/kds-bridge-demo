import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, roleFromUser } from '../middleware/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { email: string; password: string } }>(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const { email, password } = request.body;

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          request.log.info({ email }, 'Falha de login');
          return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
        }

        return {
          token: data.session.access_token,
          user: {
            id: data.user.id,
            email: data.user.email,
            role: roleFromUser(data.user),
          },
        };
      } catch (error) {
        request.log.error(error);
        reply.code(500).send({ error: 'Erro interno ao autenticar' });
      }
    }
  );

  fastify.get('/me', { preHandler: requireAuth }, async (request) => {
    try {
      return { user: request.user };
    } catch (error) {
      request.log.error(error);
      return { user: undefined };
    }
  });
}
