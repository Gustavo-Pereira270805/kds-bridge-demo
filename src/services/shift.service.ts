import { query } from '../db/client';

export async function getCurrentShift(): Promise<'lunch' | 'dinner'> {
  const rows = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'shift_dinner_active_date'`
  );
  const activeDate = rows.length > 0 ? rows[0].value : '';
  const [{ today }] = await query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  return activeDate === today ? 'dinner' : 'lunch';
}

// Produtos que ficam no quente no almoço e migram para jantar no turno noturno
const FLEXIBLE_PRODUCTS: Array<{ name: string; lunchCode: string }> = [
  { name: 'INHAME COZIDO', lunchCode: 'quente_b' },
  { name: 'DEL\u00CDCIA DE PEIXE', lunchCode: 'quente_a' },
  { name: 'DEL\u00CDCIA DE FRANGO', lunchCode: 'quente_b' },
];

export async function syncFlexibleProducts(): Promise<void> {
  const shift = await getCurrentShift();
  if (shift === 'dinner') {
    const jantar = await query<{ id: string }>(`SELECT id FROM kitchen_stations WHERE code = 'jantar'`);
    if (jantar.length === 0) return;
    await query(
      `UPDATE products SET kitchen_station_id = $1
       WHERE name = ANY($2::text[]) AND kitchen_station_id <> $1`,
      [jantar[0].id, FLEXIBLE_PRODUCTS.map(p => p.name)]
    );
  } else {
    for (const p of FLEXIBLE_PRODUCTS) {
      await query(
        `UPDATE products SET kitchen_station_id = (SELECT id FROM kitchen_stations WHERE code = $1)
         WHERE name = $2 AND kitchen_station_id <> (SELECT id FROM kitchen_stations WHERE code = $1)`,
        [p.lunchCode, p.name]
      );
    }
  }
}
