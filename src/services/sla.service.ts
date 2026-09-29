import { query } from '../db/client';
import { logDemandEvent } from './demand-events.service';
import { getPickupTolerance } from './performance.service';

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

// Reescreve os flags de SLA de retirada com a tolerância vigente. Usado pelo
// recálculo retroativo do admin (pesos/tolerância) para o KPI, os painéis e as
// notas contarem a mesma história. O log de eventos (demand_events) é preservado
// como auditoria do que o sistema avaliou na hora da retirada.
export async function recomputePickupSlaFlags(): Promise<number> {
  const tolerance = await getPickupTolerance();
  const rows = await query<{ id: string }>(
    `UPDATE demands d
     SET sla_breached_salao = c.breached, sla_breach_minutes_salao = c.overage
     FROM (
       SELECT id,
         (EXTRACT(EPOCH FROM (retrieved_at - ready_at)) / 60) > $1::numeric AS breached,
         CASE WHEN (EXTRACT(EPOCH FROM (retrieved_at - ready_at)) / 60) > $1::numeric
              THEN ROUND((EXTRACT(EPOCH FROM (retrieved_at - ready_at)) / 60) - $1::numeric, 2)
              ELSE NULL END AS overage
       FROM demands
       WHERE retrieved_at IS NOT NULL AND ready_at IS NOT NULL AND status != 'annulled'
     ) c
     WHERE d.id = c.id
       AND (d.sla_breached_salao IS DISTINCT FROM c.breached
         OR d.sla_breach_minutes_salao IS DISTINCT FROM c.overage)
     RETURNING d.id`,
    [tolerance]
  );
  return rows.length;
}

export async function evaluatePickupSla(demandId: string): Promise<void> {
  const tolerance = await getPickupTolerance();

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
