-- Veredito do zeramento em relação ao SLA vigente no momento do reporte.
-- stockout_sla_factor = (minutos entre created_at e stockout_reported_at) / sla_minutes em vigor.
-- NULL (zeramentos antigos) mantém o comportamento anterior: conta para o salão.
-- factor <= 1: dentro do SLA -> detrator do salão.
-- factor > 1: SLA já estourado -> detrator de estouro de SLA da cozinha.
ALTER TABLE demands ADD COLUMN IF NOT EXISTS stockout_sla_factor numeric;
COMMENT ON COLUMN demands.stockout_sla_factor IS 'Fator elapsed/SLA no momento do zeramento; >1 indica SLA estourado (culpa da cozinha)';
