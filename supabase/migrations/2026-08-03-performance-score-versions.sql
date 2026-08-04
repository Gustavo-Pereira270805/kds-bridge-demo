CREATE TABLE IF NOT EXISTS performance_weight_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_breach_cozinha numeric NOT NULL,
  sla_breach_salao numeric NOT NULL,
  cancellation_cozinha numeric NOT NULL,
  cancellation_salao numeric NOT NULL,
  stockout_salao numeric NOT NULL,
  slow_item_cozinha numeric NOT NULL,
  slow_pickup_salao numeric NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS performance_weight_versions_validity_idx
  ON performance_weight_versions (valid_from, valid_to);

CREATE UNIQUE INDEX IF NOT EXISTS performance_weight_versions_one_open_idx
  ON performance_weight_versions ((valid_to IS NULL))
  WHERE valid_to IS NULL;

ALTER TABLE performance_scores
  ADD COLUMN IF NOT EXISTS weight_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'performance_scores_weight_version_id_fkey'
  ) THEN
    ALTER TABLE performance_scores
      ADD CONSTRAINT performance_scores_weight_version_id_fkey
      FOREIGN KEY (weight_version_id)
      REFERENCES performance_weight_versions (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS performance_scores_date_entity_idx
  ON performance_scores (date, entity);
