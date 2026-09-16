-- Devolucao pelo salao: contador e auditoria por demanda + categoria nas notas
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_count int NOT NULL DEFAULT 0;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_at timestamptz NULL;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_reason text NULL;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS returned_to_kitchen_observation text NULL;

ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS returned int NOT NULL DEFAULT 0;
ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS returned_deduction numeric NOT NULL DEFAULT 0;

INSERT INTO system_settings (key, value) VALUES ('score_weight_returned', '0.2')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demand_events_event_type_check'
      AND contype = 'c' AND conrelid = 'demand_events'::regclass
      AND pg_get_constraintdef(oid) LIKE '%returned_to_kitchen%'
  ) THEN
    ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
    ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
      CHECK (event_type IN (
        'created', 'marked_ready', 'retrieved',
        'cancelled_salao', 'cancelled_cozinha',
        'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
        'annulled', 'shift_transfer', 'step_rollback', 'returned_to_kitchen'
      ));
  END IF;
END $$;
