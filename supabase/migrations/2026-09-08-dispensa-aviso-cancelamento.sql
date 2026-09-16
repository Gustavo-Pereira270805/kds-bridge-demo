-- Dispensa global do aviso "cancelada pela cozinha" no salão.
-- Quando um operador clica "Esquecer" (ou conclui a troca), a demanda é marcada
-- aqui e some do endpoint /cancelled-cozinha para TODAS as telas do salão.
-- O status continua 'cancelled_cozinha': histórico, notas e métricas não mudam.
ALTER TABLE demands ADD COLUMN IF NOT EXISTS cancel_notice_dismissed_at timestamptz NULL;
COMMENT ON COLUMN demands.cancel_notice_dismissed_at IS 'Aviso de cancelamento da cozinha dispensado no salão (vale para todas as telas)';
