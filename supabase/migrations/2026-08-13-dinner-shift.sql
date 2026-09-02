-- Modo Jantar: estação isolada do turno noturno
INSERT INTO kitchen_stations (code, name, capacity, theme)
VALUES ('jantar', 'Cozinha Jantar', 1, 'dark')
ON CONFLICT (code) DO NOTHING;

-- Estado do turno: data em que o jantar foi ativado ('' = inativo)
INSERT INTO system_settings (key, value)
VALUES ('shift_dinner_active_date', '')
ON CONFLICT (key) DO NOTHING;

-- Novo tipo de evento: transferência de demanda para o turno jantar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demand_events_event_type_check'
      AND contype = 'c'
      AND conrelid = 'demand_events'::regclass
      AND pg_get_constraintdef(oid) LIKE '%shift_transfer%'
  ) THEN
    ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
    ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
      CHECK (event_type IN (
        'created', 'marked_ready', 'retrieved',
        'cancelled_salao', 'cancelled_cozinha',
        'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao',
        'annulled', 'shift_transfer'
      ));
  END IF;
END $$;
