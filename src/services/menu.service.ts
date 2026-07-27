import { query } from '../db/client';

function getReferenceDate(): Date {
  if (process.env.REFERENCE_DATE) {
    const d = new Date(process.env.REFERENCE_DATE);
    if (!isNaN(d.getTime())) return d;
    console.warn(`[MenuService] REFERENCE_DATE inválida: "${process.env.REFERENCE_DATE}". Usando fallback 2025-01-01.`);
  }
  return new Date('2025-01-01');
}

const REFERENCE_DATE = getReferenceDate();
const TOTAL_MENUS = 14;
const DAY_MS = 1000 * 60 * 60 * 24;

export interface MenuForDate {
  menu_id: string;
  menu_number: number;
  menu_name: string;
  is_override: boolean;
}

// Rotação determinística: (dias desde REFERENCE_DATE % 14) + 1
function getMenuNumberForDate(date: string): number {
  const target = new Date(`${date}T00:00:00Z`);
  const diffDays = Math.floor(
    (target.getTime() - REFERENCE_DATE.getTime()) / DAY_MS
  );
  const normalized = ((diffDays % TOTAL_MENUS) + TOTAL_MENUS) % TOTAL_MENUS;
  return normalized + 1;
}

async function getMenuByNumber(menuNumber: number): Promise<MenuForDate> {
  const rows = await query<{ id: string; number: number; name: string }>(
    'SELECT id, number, name FROM menus WHERE number = $1',
    [menuNumber]
  );

  if (rows.length === 0) {
    throw new Error(`Cardápio número ${menuNumber} não encontrado na tabela menus`);
  }

  return {
    menu_id: rows[0].id,
    menu_number: rows[0].number,
    menu_name: rows[0].name,
    is_override: false,
  };
}

/**
 * v2.5 (§4.1-C) — Calcula o cardápio efetivo de uma data SEM persistir nada.
 * a) Override manual na própria data vence.
 * b) Senão, propaga sequencialmente a partir do override manual mais recente
 *    anterior à data: numero = ((overrideNumber - 1 + diffDias) % 14) + 1.
 * c) Sem override anterior, cai na rotação determinística (REFERENCE_DATE).
 */
export async function computeMenuForDate(date: string): Promise<MenuForDate> {
  const exact = await query<{ menu_id: string; menu_number: number; menu_name: string }>(
    `SELECT m.id AS menu_id, m.number AS menu_number, m.name AS menu_name
     FROM daily_menus dm
     JOIN menus m ON m.id = dm.menu_id
     WHERE dm.date = $1 AND dm.is_override = true`,
    [date]
  );

  if (exact.length > 0) {
    return { ...exact[0], is_override: true };
  }

  const previousOverride = await query<{ menu_number: number; diff_days: number }>(
    `SELECT m.number AS menu_number, ($1::date - dm.date) AS diff_days
     FROM daily_menus dm
     JOIN menus m ON m.id = dm.menu_id
     WHERE dm.date < $1 AND dm.is_override = true
     ORDER BY dm.date DESC
     LIMIT 1`,
    [date]
  );

  if (previousOverride.length > 0) {
    const { menu_number: overrideNumber, diff_days: diffDays } = previousOverride[0];
    const menuNumber = ((overrideNumber - 1 + diffDays) % TOTAL_MENUS) + 1;
    return getMenuByNumber(menuNumber);
  }

  return getMenuByNumber(getMenuNumberForDate(date));
}

/**
 * v2.5 (§4.1-C) — Como computeMenuForDate, mas persiste o resultado em
 * daily_menus. Nunca sobrescreve um override manual (is_override = true);
 * linhas não-override existentes são recalculadas (podem ter sido afetadas
 * por um override anterior mais recente).
 */
export async function getMenuForDate(date: string): Promise<MenuForDate & { daily_menu_id: string }> {
  const computed = await computeMenuForDate(date);

  if (computed.is_override) {
    const rows = await query<{ id: string }>(
      'SELECT id FROM daily_menus WHERE date = $1',
      [date]
    );
    if (rows.length === 0) {
      throw new Error(`Override de cardápio para ${date} não encontrado em daily_menus`);
    }
    return { ...computed, daily_menu_id: rows[0].id };
  }

  const upserted = await query<{ id: string }>(
    `INSERT INTO daily_menus (date, menu_id) VALUES ($1, $2)
     ON CONFLICT (date) DO UPDATE SET menu_id = EXCLUDED.menu_id, updated_at = now()
     WHERE daily_menus.is_override = false
     RETURNING id`,
    [date, computed.menu_id]
  );

  if (upserted.length > 0) {
    return { ...computed, daily_menu_id: upserted[0].id };
  }

  // Um override manual para a data surgiu entre o cálculo e o upsert (race) — não tocar nele
  const rows = await query<{ id: string }>(
    'SELECT id FROM daily_menus WHERE date = $1',
    [date]
  );
  if (rows.length === 0) {
    throw new Error('Falha ao criar ou recuperar cardápio da data');
  }
  return { ...computed, daily_menu_id: rows[0].id };
}

// "Hoje" segundo o banco (CURRENT_DATE) para evitar divergência de timezone
async function getTodayDateString(): Promise<string> {
  const rows = await query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  return rows[0].today;
}

export async function ensureTodayMenu(): Promise<string> {
  const today = await getTodayDateString();
  const menu = await getMenuForDate(today);
  return menu.daily_menu_id;
}
