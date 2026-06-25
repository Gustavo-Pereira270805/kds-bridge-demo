import Fastify from 'fastify'
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';

import { createTables } from './db/migrations';
import productRoutes from './routes/products';
import demandRoutes from './routes/demands';
import { registerSocketHandlers} from './socket/handlers';
import { seedDatabase } from './db/seed';
const fastify = Fastify({ logger: true });

createTables();

seedDatabase();

const io = new Server(fastify.server, {
    cors: {
        origin: '*',
    }
});

(fastify as any).io = io;

registerSocketHandlers(io);

fastify.get('/salao', async (request, reply) => {
    const html = fs.readFileSync(path.join(__dirname, 'views', 'salao.html'), 'utf8');
    return reply.type('text/html').send(html);
});

fastify.get('/cozinha', async (request, reply) => {
    const html = fs.readFileSync(path.join(__dirname, 'views', 'cozinha.html'), 'utf8');
    return reply.type('text/html').send(html);
});

fastify.get('/gerente', async (request, reply) => {
    const html = fs.readFileSync(path.join(__dirname, 'views', 'gerente.html'), 'utf8');
    return reply.type('text/html').send(html);
});

fastify.register(productRoutes, { prefix: '/api/products'});
fastify.register(demandRoutes, { prefix: '/api/demands'});

const start = async () => {
    try {
        await fastify.listen({port: 3000, host: '0.0.0.0'});
        console.log('KDS Bridgge rodando na porta 3000');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
