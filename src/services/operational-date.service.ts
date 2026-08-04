/**
 * O negócio atualmente opera em UTC. Toda data civil de performance deve usar
 * esta função, evitando que o timezone local do processo altere o dia apurado.
 */
export const TIMEZONE_OPERACIONAL = 'UTC';
export const DATA_OPERACIONAL_SQL = `(created_at AT TIME ZONE '${TIMEZONE_OPERACIONAL}')::date`;

export function dataOperacional(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function intervaloUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
