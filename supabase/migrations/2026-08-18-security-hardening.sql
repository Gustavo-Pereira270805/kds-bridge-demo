-- Endurecimento de segurança (auditoria 2026-08-18)
-- Rastreia a estação de origem nas transferências do turno jantar para reversão correta.
-- CORRIGIDO 2026-09-02: tipo deve ser uuid (mesmo de kitchen_station_id). text causava
-- "COALESCE types text and uuid cannot be matched" em POST /admin/shift/dinner.

ALTER TABLE demands ADD COLUMN IF NOT EXISTS origin_station_id uuid;
