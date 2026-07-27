import pool from './client';

export async function seedDatabase() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM products');
  const count = parseInt(rows[0].count, 10);

  if (count === 0) {
    const mockProducts = [
      ['Arroz Branco', 'Guarnição', 'Bandeja'],
      ['Feijão Carioca', 'Guarnição', 'Cuba'],
      ['Frango Grelhado', 'Proteína', 'Bandeja'],
      ['Bife Acebolado', 'Proteína', 'Bandeja'],
      ['Batata Frita', 'Acompanhamento', 'Cuba'],
      ['Salada de Alface', 'Salada', 'Tigela'],
      ['Tomate Picado', 'Salada', 'Cuba'],
      ['Farofa', 'Acompanhamento', 'Cuba'],
      ['Macarrão ao Sugo', 'Massa', 'Bandeja'],
      ['Peixe Frito', 'Proteína', 'Bandeja'],
    ];

    for (const [name, category, unit] of mockProducts) {
      await pool.query(
        'INSERT INTO products (name, category) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [name, category]
      );
    }

    console.log('[Seed] Banco populado com 10 produtos de teste');
  }
}
