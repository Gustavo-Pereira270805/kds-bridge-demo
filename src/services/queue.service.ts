import { query, pool } from '../db/client';

interface QueueDemand {
  id: string;
  sla_minutes: number;
  priority: 'normal' | 'urgent';
  created_at: string;
  cooking_started: boolean;
  expected_ready_at: string | null;
}

// Cadeia de promessas por estação: serializa os recomputes dentro do processo.
const queueChains = new Map<string, Promise<void>>();

export async function recomputeStationQueue(stationId: string): Promise<void> {
  // Serializa recomputes da mesma estação dentro deste processo: as rotas
  // disparam recompute sem await (fire-and-forget), então dois POSTs rápidos
  // liam o mesmo snapshot e travavam itens diferentes, estourando a
  // capacidade. A cadeia por estação garante um recompute por vez.
  const prev = queueChains.get(stationId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  queueChains.set(stationId, prev.then(() => current));
  await prev;
  try {
    await recomputeStationQueueInner(stationId);
  } finally {
    release();
    if (queueChains.get(stationId) === current) queueChains.delete(stationId);
  }
}
async function recomputeStationQueueInner(stationId: string): Promise<void> {
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

  // Invariante: em preparo (cooking_started=true) nunca supera a capacidade
  // da estação, mesmo com ETAs atrasados. ETA é previsão, não liberação de
  // boca — o cozinheiro segue ocupado enquanto a demanda está pendente.
  const etaOf = (d: QueueDemand) => {
    const t = d.expected_ready_at ? new Date(d.expected_ready_at).getTime() : NaN;
    return Number.isFinite(t) ? (t as number) : Number.POSITIVE_INFINITY;
  };
  const sortWaiting = (a: QueueDemand, b: QueueDemand) => {
    if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  };
  const slaOf = (d: QueueDemand) =>
    Number.isFinite(d.sla_minutes) && (d.sla_minutes as number) > 0
      ? (d.sla_minutes as number)
      : 10;

  // Teto rígido de capacidade: se há mais itens em preparo do que bocas
  // (capacidade encolheu, retorno de anulação, resíduo de corrida antiga),
  // mantém os urgentes e os de ETA mais próximo; o excedente volta à espera.
  const toUnlock: string[] = [];
  if (locked.length > station.capacity) {
    locked.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
      const diff = etaOf(a) - etaOf(b);
      if (diff !== 0) return diff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const excess = locked.splice(station.capacity);
    for (const d of excess) {
      d.cooking_started = false;
      waiting.push(d);
      toUnlock.push(d.id);
    }
  }

  waiting.sort(sortWaiting);

  // Preempção: urgente passa na frente — troca 1:1 com normais em preparo
  // (o total em preparo não muda aqui). Vítima = normal com ETA mais distante.
  const urgentWaiting = waiting.filter((d) => d.priority === 'urgent');
  const nonUrgentLocked = locked.filter((d) => d.priority !== 'urgent');
  const freeSlotsCount = Math.max(0, station.capacity - locked.length);
  const neededPreemptions = Math.max(0, urgentWaiting.length - freeSlotsCount);

  if (neededPreemptions > 0 && nonUrgentLocked.length > 0) {
    nonUrgentLocked.sort((a, b) => etaOf(b) - etaOf(a));

    const preemptCount = Math.min(neededPreemptions, nonUrgentLocked.length);
    for (let i = 0; i < preemptCount; i++) {
      const victim = nonUrgentLocked[i];
      const lockIdx = locked.findIndex((l) => l.id === victim.id);
      if (lockIdx === -1) continue;
      locked.splice(lockIdx, 1);
      victim.cooking_started = false;
      waiting.push(victim);
      toUnlock.push(victim.id);
    }
    waiting.sort(sortWaiting);
  }

  // Travamento limitado às bocas livres: só os `free` primeiros da espera
  // (urgente primeiro, depois FIFO) entram em preparo. O restante recebe
  // apenas projeção de ETA encadeada (informativa, sem travar).
  const freeAfter = Math.max(0, station.capacity - locked.length);
  const toLock: { id: string; expectedReadyAt: string }[] = [];
  const toUpdate: { id: string; expectedReadyAt: string }[] = [];
  const lockSet = new Set(waiting.slice(0, freeAfter).map((d) => d.id));

  // Projeção encadeada por boca para a espera (só exibição): parte do maior
  // entre agora e o ETA de cada boca ocupada; ETA inválido conta como agora.
  const slots: number[] = locked.map((d) => {
    const t = etaOf(d);
    return t === Number.POSITIVE_INFINITY ? now : t;
  });
  while (slots.length < station.capacity) slots.push(now);

  for (const demand of waiting) {
    if (lockSet.has(demand.id)) {
      const expectedReadyAt = new Date(now + slaOf(demand) * 60_000).toISOString();
      toLock.push({ id: demand.id, expectedReadyAt });
      // A boca recém-ocupada projeta o próximo ETA a partir deste término.
      let earliestIdx = 0;
      for (let i = 1; i < slots.length; i++) {
        if (slots[i] < slots[earliestIdx]) earliestIdx = i;
      }
      slots[earliestIdx] = now + slaOf(demand) * 60_000;
      continue;
    }
    let earliestIdx = 0;
    for (let i = 1; i < slots.length; i++) {
      if (slots[i] < slots[earliestIdx]) earliestIdx = i;
    }
    const start = Math.max(now, slots[earliestIdx]);
    const expectedReadyAtMs = start + slaOf(demand) * 60_000;
    slots[earliestIdx] = expectedReadyAtMs;
    toUpdate.push({ id: demand.id, expectedReadyAt: new Date(expectedReadyAtMs).toISOString() });
  }

  const relockedIds = new Set(toLock.map((l) => l.id));
  const unlockOnly = toUnlock.filter((id) => !relockedIds.has(id));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const id of unlockOnly) {
      await client.query(
        `UPDATE demands SET cooking_started = false, cooking_started_at = NULL WHERE id = $1`,
        [id]
      );
    }
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
