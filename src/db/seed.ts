import db from './client';

export function seedDatabase() {

  const checkProducts = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };

  if (checkProducts.count === 0) {
    const insertProduct = db.prepare(`
      INSERT INTO products (name, category, unit, active)
      VALUES (?, ?, ?, ?)
    `);

    const mockProducts = [
      ['Arroz Branco', 'Guarnição', 'Bandeja', 1],
      ['Feijão Carioca', 'Guarnição', 'Cuba', 1],
      ['Frango Grelhado', 'Proteína', 'Bandeja', 1],
      ['Bife Acebolado', 'Proteína', 'Bandeja', 1],
      ['Batata Frita', 'Acompanhamento', 'Cuba', 1],
      ['Salada de Alface', 'Salada', 'Tigela', 1],
      ['Tomate Picado', 'Salada', 'Cuba', 1],
      ['Farofa', 'Acompanhamento', 'Cuba', 1],
      ['Macarrão ao Sugo', 'Massa', 'Bandeja', 1],
      ['Peixe Frito', 'Proteína', 'Bandeja', 1],
    ];

  
    const insertManyProducts = db.transaction((products) => {
      for (const product of products) {
        insertProduct.run(...product);
      }
    });
    

    insertManyProducts(mockProducts);

    const insertDailyMenus = db.prepare(`
      INSERT INTO daily_menus (date, menu_name)
      VALUES (date('now'), 'Cardápio Base 1')
      `);

    try {
      insertDailyMenus.run();
    } catch (error) {
      console.log('[Seed] Cardápio do dia já existe, pulando...');
  }
  console.log('[Seed] Banco Populado com 10 produtos de teste');
}
}