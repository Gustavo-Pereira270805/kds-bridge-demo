-- Anulação por passo: marca passos derrubados sem apagar auditoria
ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annulled_at timestamptz NULL;
ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annulled_by text NULL;
ALTER TABLE demand_events ADD COLUMN IF NOT EXISTS annul_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demand_events_event_type_check'
      AND contype = 'c' AND conrelid = 'demand_events'::regclass
      AND pg_get_constraintdef(oid) LIKE '%step_rollback%'
  ) THEN
    ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
    ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
      CHECK (event_type IN (
        'created', 'marked_ready', 'retrieved',
        'cancelled_salao', 'cancelled_cozinha',
        'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
        'annulled', 'shift_transfer', 'step_rollback'
      ));
  END IF;
END $$;
