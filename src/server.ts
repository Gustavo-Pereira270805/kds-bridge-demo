import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';

import { createTables } from './db/migrations';
import productRoutes from './routes/products';
import demandRoutes from './routes/demands';
import { registerSocketHandlers} from './socket/handlers';
import { seedDatabase } from './db/seed';

const fastify = Fastify({ logger: true });

fastify.register(cors, { origin: '*' });

createTables();

seedDatabase();

const io = new Server(fastify.server, {
    cors: {
        origin: '*',
    }
});

(fastify as any).io = io;

registerSocketHandlers(io);

const views = {
    salao: fs.readFileSync(path.join(__dirname, 'views', 'salao.html'), 'utf8'),
    cozinha: fs.readFileSync(path.join(__dirname, 'views', 'cozinha.html'), 'utf8'),
    gerente: fs.readFileSync(path.join(__dirname, 'views', 'gerente.html'), 'utf8'),
};

fastify.get('/salao', async (request, reply) => {
    return reply.type('text/html').send(views.salao);
});

fastify.get('/cozinha', async (request, reply) => {
    return reply.type('text/html').send(views.cozinha);
});

fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});

fastify.get('/gerente', async (request, reply) => {
    return reply.type('text/html').send(views.gerente);
});

fastify.register(productRoutes, { prefix: '/api/products'});
fastify.register(demandRoutes, { prefix: '/api/demands'});

const PORT = parseInt(process.env.PORT || '3000', 10);

const start = async () => {
    try {
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`KDS Bridge rodando na porta ${PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
