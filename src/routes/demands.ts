import {FastifyInstance} from 'fastify';
import db from '../db/client';
import {Demand, CreateDemandBody, UpdateStatusBody} from '../types';

export default async function demandsRoutes(fastify : FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const stmt = db.prepare(`SELECT * FROM demands 
            WHERE status = 'pending'
            ORDER BY priority DESC, created_at ASC
            `);
            return stmt.all() as Demand[];
        });

fastify.post <{ Body: CreateDemandBody }> ('/', async (request, reply) => {
    const {product_id, quantity, priority = 'normal', notes = null} = request.body;

    const productStmt = db.prepare('SELECT name FROM products WHERE id = ?');
    const product = productStmt.get(product_id) as { name: string } | undefined;
    if (!product){
        return reply.status(404).send('Produto Não Encontrado... ');
    }
    const insertStmt = db.prepare(`INSERT INTO demands (product_id, product_name, quantity, priority, notes)
        VALUES (?, ?, ?, ?, ? )`);
    const result = insertStmt.run(product_id, product.name, quantity, priority, notes);
    const newDemand = db.prepare('SELECT * FROM demands WHERE id = ?').get(result.lastInsertRowid) as Demand;

    const eventName = priority ==='urgent' ? 'demand:urgent' : 'demand:new';
    console.log(`[📡 Radar] Emitindo evento '${eventName}' para o produto ID: ${product_id}...`);
    console.log(`[Emissor] Disparando Evento ${eventName} com demanda #${newDemand.id}`);
    
    (request.server as any).io.emit(eventName, newDemand);
    return reply.status(201).send(newDemand);
});

fastify.patch<{ Params: { id : string }, Body: UpdateStatusBody }> ('/:id', async (request, reply) => {
    const { id } = request.params;
    const {status, completed_by} = request.body;

    const updateStmt = db.prepare(`
        UPDATE demands
        SET status = ?, completed_by = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `);
        updateStmt.run(status, completed_by || null, id);

        const updatedDemand = db.prepare('SELECT * FROM demands WHERE id = ?').get(id) as Demand;

        fastify.io.emit('demand:updated', updatedDemand);
        return updatedDemand;
});

fastify.get('/history', async (request, reply) => {
    const stmt = db.prepare("SELECT * FROM demands ORDER BY created_at DESC LIMIT 100");
    return stmt.all() as Demand[];
});
}