import { query, pool } from '../db/client';

interface QueueDemand {
  id: string;
  sla_minutes: number;
  priority: 'normal' | 'urgent';
  created_at: string;
  cooking_started: boolean;
  expected_ready_at: string | null;
}

export async function recomputeStationQueue(stationId: string): Promise<void> {
  const [station] = await query<{ capacity: number }>(
    'SELECT capacity FROM kitchen_stations WHERE id = $1',
    [stationId]
  );
  if (!station) return;

  const pending = await query<QueueDemand>(
    `SELECT id, sla_minutes, priority, created_at, cooking_started, expected_ready_at
       FROM demands
      WHERE kitchen_station_id = $1 AND status = 'pending'
      ORDER BY created_at ASC`,
    [stationId]
  );

  const now = Date.now();
  const locked = pending.filter((d) => d.cooking_started);
  const waiting = pending.filter((d) => !d.cooking_started);

  waiting.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const slots: number[] = locked.map((d) =>
    new Date(d.expected_ready_at!).getTime()
  );
  while (slots.length < station.capacity) slots.push(now);

  const toLock: { id: string; expectedReadyAt: string }[] = [];
  const toUpdate: { id: string; expectedReadyAt: string }[] = [];

  for (const demand of waiting) {
    let earliestIdx = 0;
    for (let i = 1; i < slots.length; i++) {
      if (slots[i] < slots[earliestIdx]) earliestIdx = i;
    }

    const start = Math.max(now, slots[earliestIdx]);
    const expectedReadyAtMs = start + demand.sla_minutes * 60_000;
    slots[earliestIdx] = expectedReadyAtMs;
    const expectedReadyAt = new Date(expectedReadyAtMs).toISOString();

    if (start === now) {
      toLock.push({ id: demand.id, expectedReadyAt });
    } else {
      toUpdate.push({ id: demand.id, expectedReadyAt });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of toLock) {
      await client.query(
        `UPDATE demands SET expected_ready_at = $1, cooking_started = true, cooking_started_at = now()
         WHERE id = $2`,
        [u.expectedReadyAt, u.id]
      );
    }
    for (const u of toUpdate) {
      await client.query(
        'UPDATE demands SET expected_ready_at = $1 WHERE id = $2',
        [u.expectedReadyAt, u.id]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
