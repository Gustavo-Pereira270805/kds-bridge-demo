// Dia operacional do restaurante: sempre America/Sao_Paulo (BRT).
// O banco de produção (Supabase) roda em UTC — usar `created_at::date` direto
// joga o "hoje" para o dia seguinte entre 21h e 24h BRT (bug do dashboard).
export const BR_TZ = 'America/Sao_Paulo';

export function brDayFrom(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(String(value));
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BR_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g: Record<string, string> = {};
  for (const p of parts) g[p.type] = p.value;
  return `${g.year}-${g.month}-${g.day}`;
}

export function brDay(offsetDays = 0): string {
  return brDayFrom(new Date(Date.now() + offsetDays * 86400000));
}

export function brDayOf(column: string): string {
  return `(${column} AT TIME ZONE '${BR_TZ}')::date`;
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().split('T')[0];
}
