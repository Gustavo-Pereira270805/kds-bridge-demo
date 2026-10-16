import { query } from '../db/client';
import { Product } from '../types';
import { getCurrentShift } from './shift.service';
import { ensureTodayMenu } from './menu.service';

// Cardápio Jantar: pseudo-cardápio = produtos ATIVOS da Cozinha Jantar (estação
// `jantar`). O jantar não é uma linha da tabela `menus` (rotação fixa 1..14) —
// o turno jantar injeta esses produtos no cardápio do dia via
// daily_menu_overrides (ver shift.service.ts). O gerente edita essa lista na aba
// Cardápios do /admin com o mesmo contrato dos cardápios numerados.

export interface DinnerMenuProduct {
  product_id: string;
  name: string;
  category: string | null;
}

export interface DinnerMenuAvailableProduct {
  id: string;
  name: string;
  category: string | null;
}

export interface DinnerMenuList {
  menu_products: DinnerMenuProduct[];
  all_products: DinnerMenuAvailableProduct[];
}

export interface DinnerMenuUpdate {
  product: Product;
  shift: 'lunch' | 'dinner';
  today_menu_changed: boolean;
}

async function getJantarStationId(): Promise<string> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM kitchen_stations WHERE code = 'jantar'`
  );
  if (rows.length === 0) {
    throw Object.assign(new Error('Estação jantar não encontrada'), { statusCode: 500 });
  }
  return rows[0].id;
}

export async function listDinnerMenu(): Promise<DinnerMenuList> {
  const jantarId = await getJantarStationId();

  const [inDinner, available] = await Promise.all([
    query<DinnerMenuProduct>(
      `SELECT p.id AS product_id, p.name, p.category
       FROM products p
       WHERE p.active = true AND p.kitchen_station_id = $1
       ORDER BY p.category, p.name`,
      [jantarId]
    ),
    query<DinnerMenuAvailableProduct>(
      `SELECT p.id, p.name, p.category
       FROM products p
       WHERE p.active = true AND (p.kitchen_station_id IS NULL OR p.kitchen_station_id <> $1)
       ORDER BY p.category, p.name`,
      [jantarId]
    ),
  ]);

  return { menu_products: inDinner, all_products: available };
}

/**
 * Adiciona ('add') ou remove ('remove') um produto do cardápio jantar.
 * Adicionar move o produto para a Cozinha Jantar; remover deixa o produto
 * "Sem cozinha" (ajustável depois na aba Produtos).
 *
 * No turno jantar a mudança também vale para o cardápio de HOJE: quem injeta os
 * produtos do jantar no cardápio do dia é a ativação do turno, então sem o
 * override o produto novo só apareceria no salão no próximo turno.
 */
export async function setDinnerMenuProduct(
  productId: string,
  action: 'add' | 'remove'
): Promise<DinnerMenuUpdate> {
  const jantarId = await getJantarStationId();
  const stationId = action === 'add' ? jantarId : null;

  const [product] = await query<Product>(
    'UPDATE products SET kitchen_station_id = $1 WHERE id = $2 RETURNING *',
    [stationId, productId]
  );
  if (!product) {
    throw Object.assign(new Error('Produto não encontrado'), { statusCode: 404 });
  }

  const shift = await getCurrentShift();
  let todayMenuChanged = false;
  if (shift === 'dinner') {
    const dailyMenuId = await ensureTodayMenu();
    await query(
      `INSERT INTO daily_menu_overrides (daily_menu_id, product_id, action, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (daily_menu_id, product_id)
       DO UPDATE SET action = EXCLUDED.action, reason = EXCLUDED.reason`,
      [
        dailyMenuId,
        productId,
        action,
        action === 'add' ? 'Adicionado ao cardápio jantar' : 'Removido do cardápio jantar',
      ]
    );
    todayMenuChanged = true;
  }

  return { product, shift, today_menu_changed: todayMenuChanged };
}
