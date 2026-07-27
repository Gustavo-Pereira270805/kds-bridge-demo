import { pool } from '../db/client';

export interface CleanupResult {
  demand_events: number;
  demands: number;
  daily_menu_overrides: number;
  daily_menus: number;
  performance_scores: number;
  retention_days: number;
}

export async function getRetentionDays(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT value FROM system_settings WHERE key = 'data_retention_days'`
  );
  const days = parseInt(rows[0]?.value ?? '180', 10);
  return Number.isFinite(days) && days > 0 ? days : 180;
}

/**
 * Remove dados mais antigos que `olderThanDays` (default: system_settings.data_retention_days).
 * Transacional: ou limpa tudo ou nada.
 */
export async function runCleanup(olderThanDays?: number): Promise<CleanupResult> {
  const days = olderThanDays ?? (await getRetentionDays());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ev = await client.query(
      `DELETE FROM demand_events WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [days]
    );
    const de = await client.query(
      `DELETE FROM demands WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [days]
    );
    const dmo = await client.query(
      `DELETE FROM daily_menu_overrides WHERE daily_menu_id IN (
         SELECT id FROM daily_menus WHERE date < CURRENT_DATE - $1
       )`,
      [days]
    );
    const dm = await client.query(
      `DELETE FROM daily_menus WHERE date < CURRENT_DATE - $1`,
      [days]
    );
    const ps = await client.query(
      `DELETE FROM performance_scores WHERE date < CURRENT_DATE - $1`,
      [days]
    );
    await client.query('COMMIT');
    return {
      demand_events: ev.rowCount ?? 0,
      demands: de.rowCount ?? 0,
      daily_menu_overrides: dmo.rowCount ?? 0,
      daily_menus: dm.rowCount ?? 0,
      performance_scores: ps.rowCount ?? 0,
      retention_days: days,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
