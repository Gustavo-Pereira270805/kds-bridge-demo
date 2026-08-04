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

export function diasInclusivos(dateFrom: string, dateTo: string): number {
  return Math.round((intervaloUtc(dateTo).getTime() - intervaloUtc(dateFrom).getTime()) / 86400000) + 1;
}

export function deslocarDataUtc(dateStr: string, days: number): string {
  const date = intervaloUtc(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function validarIntervaloInclusivo(dateFrom: string, dateTo: string): string | null {
  const days = diasInclusivos(dateFrom, dateTo);
  if (days < 1) return 'A data inicial deve ser anterior ou igual à data final';
  if (days > 31) return 'O período máximo é de 31 dias';
  return null;
}
