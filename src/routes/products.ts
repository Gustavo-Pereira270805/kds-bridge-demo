import {FastifyInstance} from 'fastify';
import db from '../db/client';
import {Product} from '../types';

export default async function productsRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const stmt = db.prepare('SELECT * FROM products WHERE active = 1');
        const products = stmt.all() as Product[];
        return products;
    });
    }