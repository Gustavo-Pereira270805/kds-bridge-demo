ALTER TABLE kitchen_stations
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kitchen_stations_theme_check'
  ) THEN
    ALTER TABLE kitchen_stations
      ADD CONSTRAINT kitchen_stations_theme_check
      CHECK (theme IN ('dark', 'light'));
  END IF;
END $$;

UPDATE kitchen_stations
SET theme = 'dark'
WHERE theme IS NULL OR theme NOT IN ('dark', 'light');

INSERT INTO system_settings (key, value)
VALUES ('station_theme_salao', 'dark')
ON CONFLICT (key) DO NOTHING;
