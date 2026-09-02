import { pool } from './db/client';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: productCount } = await client.query('SELECT COUNT(*) as count FROM products');
    if (parseInt(productCount[0].count) === 0) {
      const products = [
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

      for (const [name, category, unit] of products) {
        await client.query(
          'INSERT INTO products (name, category, sla_minutes_normal, sla_minutes_urgente) VALUES ($1, $2, 10, 7) ON CONFLICT (name) DO NOTHING',
          [name, category]
        );
      }
      console.log(`[Seed] ${products.length} produtos inseridos`);
    }

    const { rows: menuCount } = await client.query('SELECT COUNT(*) as count FROM menus');
    if (parseInt(menuCount[0].count) === 0) {
      for (let i = 1; i <= 14; i++) {
        await client.query(
          'INSERT INTO menus (number, name) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING',
          [i, `Cardápio ${i}`]
        );
      }
      console.log('[Seed] 14 cardápios base inseridos');
    }

    const { rows: ksCount } = await client.query('SELECT COUNT(*) as count FROM kitchen_stations');
    if (parseInt(ksCount[0].count) === 0) {
      await client.query(
        `INSERT INTO kitchen_stations (code, name, capacity, theme) VALUES
         ('quente_a', 'Cozinha Quente A', 2, 'dark'),
         ('quente_b', 'Cozinha Quente B', 2, 'dark'),
         ('fria',     'Cozinha Fria',     1, 'dark')
         ON CONFLICT (code) DO NOTHING`
      );
      console.log('[Seed] 3 estações de cozinha inseridas');
    }
    await client.query(
      `INSERT INTO system_settings (key, value) VALUES ('station_theme_salao', 'dark')
       ON CONFLICT (key) DO NOTHING`
    );

    const { rows: unitCount } = await client.query('SELECT COUNT(*) as count FROM units');
    if (parseInt(unitCount[0].count) === 0) {
      await client.query(
        `INSERT INTO units (code, label) VALUES
         ('kg', 'Quilos'),
         ('porcoes', 'Porções'),
         ('travessa', 'Travessas'),
         ('bacia', 'Bacias'),
         ('litro', 'Litros'),
         ('unidade', 'Unidades')
         ON CONFLICT (code) DO NOTHING`
      );
      console.log('[Seed] 6 unidades de medida inseridas');
    }

    const { rows: settingsCount } = await client.query('SELECT COUNT(*) as count FROM system_settings');
    if (parseInt(settingsCount[0].count) === 0) {
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ('pickup_tolerance_minutes', '3')
         ON CONFLICT (key) DO NOTHING`
      );
      console.log('[Seed] Configurações do sistema inseridas');
    }

    const { rows: puCount } = await client.query('SELECT COUNT(*) as count FROM product_units');
    if (parseInt(puCount[0].count) === 0) {
      const { rows: allProducts } = await client.query('SELECT id FROM products');
      const { rows: allUnits } = await client.query('SELECT id, code FROM units');
      const porcoesUnit = allUnits.find((u: any) => u.code === 'porcoes');
      const kgUnit = allUnits.find((u: any) => u.code === 'kg');
      const unidadeUnit = allUnits.find((u: any) => u.code === 'unidade');

      for (const p of allProducts) {
        const unitIds = [porcoesUnit.id, unidadeUnit.id, kgUnit.id];
        for (const uid of unitIds) {
          await client.query(
            'INSERT INTO product_units (product_id, unit_id) VALUES ($1, $2) ON CONFLICT (product_id, unit_id) DO NOTHING',
            [p.id, uid]
          );
        }
      }
      console.log(`[Seed] ${allProducts.length * 3} vínculos product_units inseridos`);
    }

    const { rows: mpCount } = await client.query('SELECT COUNT(*) as count FROM menu_products');
    if (parseInt(mpCount[0].count) === 0) {
      const { rows: allProducts } = await client.query('SELECT id FROM products');
      for (let menuNum = 1; menuNum <= 14; menuNum++) {
        const { rows: menu } = await client.query('SELECT id FROM menus WHERE number = $1', [menuNum]);
        if (menu.length === 0) continue;

        const productIds = allProducts.map((p: any) => p.id);
        for (let k = 0; k < productIds.length; k++) {
          if ((menuNum + k) % 3 !== 0) continue;
          await client.query(
            'INSERT INTO menu_products (menu_id, product_id) VALUES ($1, $2) ON CONFLICT (menu_id, product_id) DO NOTHING',
            [menu[0].id, productIds[k]]
          );
        }
      }
      console.log('[Seed] Produtos vinculados aos cardápios');
    }

    await client.query('COMMIT');
    console.log('[Seed] Concluído com sucesso!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Seed] Erro:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
