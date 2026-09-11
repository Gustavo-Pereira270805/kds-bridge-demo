import { query, pool } from '../db/client';
import { DinnerAutoConfig, DinnerTrigger, DinnerActivationResult } from '../types';
import { ensureTodayMenu } from './menu.service';
import { recomputeStationQueue } from './queue.service';
import { computeDailyScores } from './performance.service';

// Jantar automático (spec docs/superpowers/specs/2026-09-11-jantar-auto-design.md).
// Dia/hora canônicos: America/Sao_Paulo, calculados no banco para não depender
// do fuso do SO da VM nem do navegador do gerente.
export const DINNER_AUTO_TZ = 'America/Sao_Paulo';
export const DINNER_AUTO_DEFAULT_TIME = '15:00';
const DINNER_AUTO_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function todaySP(): Promise<string> {
  const rows = await query<{ today_sp: string }>(
    `SELECT (now() AT TIME ZONE '${DINNER_AUTO_TZ}')::date::text AS today_sp`
  );
  return rows[0].today_sp;
}

export async function timeSP(): Promise<string> {
  const rows = await query<{ time_sp: string }>(
    `SELECT to_char(now() AT TIME ZONE '${DINNER_AUTO_TZ}', 'HH24:MI') AS time_sp`
  );
  return rows[0].time_sp;
}

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = $1`,
    [key]
  );
  if (rows.length === 0 || rows[0].value == null) return fallback;
  return rows[0].value;
}

async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

export async function getCurrentShift(): Promise<'lunch' | 'dinner'> {
  const rows = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'shift_dinner_active_date'`
  );
  const activeDate = rows.length > 0 ? rows[0].value : '';
  const today = await todaySP();
  return activeDate === today ? 'dinner' : 'lunch';
}

export function isValidDinnerAutoTime(value: unknown): value is string {
  return typeof value === 'string' && DINNER_AUTO_TIME_RE.test(value);
}

export async function getDinnerAutoConfig(): Promise<DinnerAutoConfig> {
  const timeRaw = await getSetting('dinner_auto_time', DINNER_AUTO_DEFAULT_TIME);
  const time = isValidDinnerAutoTime(timeRaw) ? timeRaw : DINNER_AUTO_DEFAULT_TIME;
  const disabledDate = await getSetting('dinner_auto_disabled_date', '');
  const firedDate = await getSetting('dinner_auto_fired_date', '');
  const today = await todaySP();
  const now = await timeSP();
  const shift = await getCurrentShift();
  return {
    time,
    enabled: disabledDate !== today,
    fired: firedDate === today,
    shift,
    today,
    now,
    timeSource: DINNER_AUTO_TZ,
  };
}

export async function setDinnerAutoTime(time: string): Promise<DinnerAutoConfig> {
  if (!isValidDinnerAutoTime(time)) {
    throw Object.assign(new Error('Horário inválido: use HH:MM entre 00:00 e 23:59'), { statusCode: 400 });
  }
  await setSetting('dinner_auto_time', time);
  return getDinnerAutoConfig();
}

export async function setDinnerAutoEnabled(enabled: boolean): Promise<DinnerAutoConfig> {
  const today = await todaySP();
  await setSetting('dinner_auto_disabled_date', enabled ? '' : today);
  return getDinnerAutoConfig();
}

// Ativação do turno jantar — mesma lógica do botão manual (POST /admin/shift/dinner).
// Extraída para cá para que o agendador automático execute exatamente o mesmo fluxo.
export async function activateDinnerShift(
  trigger: DinnerTrigger,
  emit: (event: string, payload?: unknown) => void,
  onError: (err: unknown) => void = (e) => console.error(e),
): Promise<DinnerActivationResult> {
  const client = await pool.connect();
  try {
    const dailyMenuId = await ensureTodayMenu();

    const { rows: stationRows } = await client.query<{ id: string }>(
      `SELECT id FROM kitchen_stations WHERE code = 'jantar'`
    );
    if (stationRows.length === 0) {
      client.release();
      throw Object.assign(new Error('Estação jantar não encontrada'), { statusCode: 500 });
    }
    const jantarId = stationRows[0].id;

    const today = await todaySP();
    const transferNote = trigger === 'auto'
      ? 'Transferida para a Cozinha Jantar na ativação automática do turno jantar'
      : 'Transferida para a Cozinha Jantar na ativação do turno jantar';

    await client.query('BEGIN');

    // Produtos flexíveis: ficam no quente no almoço e migram para jantar no turno noturno
    await client.query(
      `UPDATE products SET kitchen_station_id = $1
       WHERE name = ANY($2::text[]) AND kitchen_station_id <> $1`,
      [jantarId, ['INHAME COZIDO', 'DELÍCIA DE PEIXE', 'DELÍCIA DE FRANGO']]
    );

    const { rows: addedRows } = await client.query(
      `INSERT INTO daily_menu_overrides (daily_menu_id, product_id, action, reason)
       SELECT $1, p.id, 'add', 'Turno jantar ativado'
       FROM products p
       WHERE p.active = true AND p.kitchen_station_id = $2
       ON CONFLICT (daily_menu_id, product_id) DO NOTHING
       RETURNING id`,
      [dailyMenuId, jantarId]
    );

    const { rows: sourceRows } = await client.query<{ kitchen_station_id: string | null }>(
      `SELECT DISTINCT kitchen_station_id FROM demands
       WHERE status = 'pending' AND created_at::date = $1 AND kitchen_station_id <> $2`,
      [today, jantarId]
    );

    const { rows: countRows } = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::int AS cnt FROM demands
       WHERE status = 'pending' AND created_at::date = $1 AND kitchen_station_id <> $2`,
      [today, jantarId]
    );
    const pendingLunchDemands = parseInt(countRows[0].cnt, 10);

    const { rows: transferred } = await client.query<{ id: string }>(
      `UPDATE demands SET origin_station_id = COALESCE(origin_station_id, kitchen_station_id), kitchen_station_id = $1
       WHERE status = 'pending' AND created_at::date = $2 AND kitchen_station_id <> $1
       RETURNING id`,
      [jantarId, today]
    );

    for (const t of transferred) {
      await client.query(
        `INSERT INTO demand_events (demand_id, event_type, actor, notes)
         VALUES ($1, 'shift_transfer', 'sistema', $2)`,
        [t.id, transferNote]
      );
    }

    await client.query(
      `INSERT INTO system_settings (key, value) VALUES ('shift_dinner_active_date', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [today]
    );
    await client.query(
      `INSERT INTO system_settings (key, value) VALUES ('shift_dinner_started_at', now()::text)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );
    if (trigger === 'auto') {
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ('dinner_auto_fired_date', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [today]
      );
    }

    await client.query('COMMIT');
    client.release();

    await recomputeStationQueue(jantarId);
    for (const s of sourceRows) {
      if (s.kitchen_station_id && s.kitchen_station_id !== jantarId) {
        await recomputeStationQueue(s.kitchen_station_id);
      }
    }
    computeDailyScores(today).catch(onError);

    emit('menu:updated', { date: today, shift: 'dinner' });
    emit('shift:updated', { shift: 'dinner' });
    emit('demand:queue-updated');
    if (trigger === 'auto') {
      emit('dinner:auto-updated', await getDinnerAutoConfig());
    }

    return {
      shift: 'dinner' as const,
      added_products: addedRows.length,
      transferred_demands: transferred.length,
      pending_lunch_demands: pendingLunchDemands,
      trigger,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(onError);
    client.release();
    throw error;
  }
}

// Tick do jantar automático (chamado a cada 60s). Idempotente no dia via fired_date.
export async function maybeAutoActivateDinner(
  emit: (event: string, payload?: unknown) => void,
  onError: (err: unknown) => void = (e) => console.error(e),
): Promise<{ fired: boolean; result?: DinnerActivationResult }> {
  const cfg = await getDinnerAutoConfig();
  if (!cfg.enabled || cfg.fired) return { fired: false };
  if (cfg.now < cfg.time) return { fired: false };
  if (cfg.shift === 'dinner') {
    await setSetting('dinner_auto_fired_date', cfg.today);
    return { fired: true };
  }
  const result = await activateDinnerShift('auto', emit, onError);
  return { fired: true, result };
}

// Produtos que ficam no quente no almoço e migram para jantar no turno noturno
const FLEXIBLE_PRODUCTS: Array<{ name: string; lunchCode: string }> = [
  { name: 'INHAME COZIDO', lunchCode: 'quente_b' },
  { name: 'DELÍCIA DE PEIXE', lunchCode: 'quente_a' },
  { name: 'DELÍCIA DE FRANGO', lunchCode: 'quente_b' },
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
