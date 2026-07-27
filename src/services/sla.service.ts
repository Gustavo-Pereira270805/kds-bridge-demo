import { query } from '../db/client';
import { logDemandEvent } from './demand-events.service';

export async function evaluateCookingSla(demandId: string): Promise<void> {
  const [d] = await query<{
    created_at: string;
    ready_at: string;
    sla_minutes: number;
  }>(
    `SELECT created_at, ready_at, sla_minutes FROM demands WHERE id = $1`,
    [demandId]
  );

  if (!d || !d.ready_at) return;

  const elapsedMin =
    (new Date(d.ready_at).getTime() - new Date(d.created_at).getTime()) / 60_000;
  const overageMin = elapsedMin - d.sla_minutes;

  if (overageMin > 0) {
    await query(
      `UPDATE demands SET sla_breached_cozinha = true, sla_breach_minutes_cozinha = $1 WHERE id = $2`,
      [overageMin.toFixed(2), demandId]
    );
    await logDemandEvent(
      demandId,
      'sla_breach_cozinha',
      'sistema',
      `Preparo levou ${elapsedMin.toFixed(1)} min (SLA: ${d.sla_minutes} min)`
    );
  }
}

export async function evaluatePickupSla(demandId: string): Promise<void> {
  const [{ value: toleranceStr }] = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'pickup_tolerance_minutes'`
  );
  const tolerance = Number(toleranceStr);

  const [d] = await query<{ ready_at: string; retrieved_at: string }>(
    `SELECT ready_at, retrieved_at FROM demands WHERE id = $1`,
    [demandId]
  );

  if (!d || !d.retrieved_at || !d.ready_at) return;

  const elapsedMin =
    (new Date(d.retrieved_at).getTime() - new Date(d.ready_at).getTime()) / 60_000;
  const overageMin = elapsedMin - tolerance;

  if (overageMin > 0) {
    await query(
      `UPDATE demands SET sla_breached_salao = true, sla_breach_minutes_salao = $1 WHERE id = $2`,
      [overageMin.toFixed(2), demandId]
    );
    await logDemandEvent(
      demandId,
      'sla_breach_salao',
      'sistema',
      `Prato ficou ${elapsedMin.toFixed(1)} min esperando retirada (tolerância: ${tolerance} min)`
    );
  }
}
