import {FastifyInstance} from 'fastify';
import db from '../db/client';
import {Product} from '../types';

export default async function productsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const stmt = db.prepare('SELECT * FROM products WHERE active = 1');
        const products = stmt.all() as Product[];
        return products;
    });

    fastify.get('/all', async (request, reply) => {
        const stmt = db.prepare('SELECT * FROM products ORDER BY category, name');
        return stmt.all() as Product[];
    });

    fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const { id } = request.params;
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
        if (!product) {
            return reply.status(404).send('Produto não encontrado');
        }
        const newActive = product.active ? 0 : 1;
        db.prepare('UPDATE products SET active = ? WHERE id = ?').run(newActive, id);
        const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product;
        (fastify as any).io.emit('product:updated', updated);
        return updated;
    });
    }