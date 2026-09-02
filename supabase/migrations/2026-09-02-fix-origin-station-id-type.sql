-- Correção 2026-09-02: origin_station_id foi criado como text na migration
-- 2026-08-18, mas kitchen_station_id é uuid. Isso quebra o turno jantar com
-- "COALESCE types text and uuid cannot be matched" em POST /admin/shift/dinner.
-- Converte a coluna existente (dados são uuids em texto ou null, conversão segura).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'demands'
      AND column_name = 'origin_station_id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE demands ALTER COLUMN origin_station_id TYPE uuid USING origin_station_id::uuid;
  END IF;
END $$;
