import { query } from '../db/client';

export async function getCurrentShift(): Promise<'lunch' | 'dinner'> {
  const rows = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'shift_dinner_active_date'`
  );
  const activeDate = rows.length > 0 ? rows[0].value : '';
  const [{ today }] = await query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  return activeDate === today ? 'dinner' : 'lunch';
}
