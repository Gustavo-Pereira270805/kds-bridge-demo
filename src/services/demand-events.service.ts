import { query } from '../db/client';
import { DemandEventType } from '../types';

export async function logDemandEvent(
  demandId: string,
  eventType: DemandEventType,
  actor: 'salao' | 'cozinha' | 'sistema' | null,
  notes?: string
): Promise<void> {
  await query(
    `INSERT INTO demand_events (demand_id, event_type, actor, notes)
     VALUES ($1, $2, $3, $4)`,
    [demandId, eventType, actor, notes || null]
  );
}
