-- KDS Bridge — Schema PostgreSQL para Supabase
-- Execute este arquivo COMPLETO no SQL Editor do Supabase
-- v2.2: SLA duplo, unidades por produto, priority-aware queue com cooking_started

-- ═══════════════════════════════════════════════════════
-- BLOCO 1: Tabelas sem dependências (criar primeiro)
-- ═══════════════════════════════════════════════════════

-- 1a — units (unidades de medida)
CREATE TABLE IF NOT EXISTS units (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code   VARCHAR(20) NOT NULL UNIQUE,
  label  VARCHAR(30) NOT NULL,
  active BOOLEAN DEFAULT true,
  featured BOOLEAN DEFAULT false
);

INSERT INTO units (code, label) VALUES
  ('kg', 'Quilos (kg)'),
  ('porcoes', 'Porções'),
  ('travessa_g', 'Travessa Grande'),
  ('travessa_m', 'Travessa Média'),
  ('travessa_p', 'Travessa Pequena'),
  ('bacia_g', 'Bacia Grande'),
  ('bacia_p', 'Bacia Pequena'),
  ('litro', 'Litros'),
  ('unidade', 'Unidades'),
  ('tigela', 'Tigela')
ON CONFLICT (code) DO NOTHING;

-- 1b — kitchen_stations (estações de cozinha com capacidade)
CREATE TABLE IF NOT EXISTS kitchen_stations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(20) NOT NULL UNIQUE,
  name       VARCHAR(50) NOT NULL,
  capacity   SMALLINT NOT NULL DEFAULT 1 CHECK (capacity > 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO kitchen_stations (code, name, capacity) VALUES
  ('quente_a', 'Cozinha Quente A', 2),
  ('quente_b', 'Cozinha Quente B', 2),
  ('fria',     'Cozinha Fria',     1)
ON CONFLICT (code) DO NOTHING;

-- 1c — system_settings (configurações globais)
CREATE TABLE IF NOT EXISTS system_settings (
  key   VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO system_settings (key, value) VALUES
  ('pickup_tolerance_minutes', '3')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- BLOCO 2: products (depende de kitchen_stations)
-- ═══════════════════════════════════════════════════════

-- Drop default_unit se existir da v2.0 (antes de recriar a tabela)
DO $$ BEGIN
  ALTER TABLE IF EXISTS products DROP COLUMN IF EXISTS default_unit;
  ALTER TABLE IF EXISTS products DROP COLUMN IF EXISTS sla_minutes;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL UNIQUE,
  category     VARCHAR(50),
  active       BOOLEAN DEFAULT true,
  sla_minutes_normal  SMALLINT NOT NULL DEFAULT 10 CHECK (sla_minutes_normal > 0),
  sla_minutes_urgente SMALLINT NOT NULL DEFAULT 7  CHECK (sla_minutes_urgente > 0),
  kitchen_station_id UUID REFERENCES kitchen_stations(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Adiciona colunas v2.2 em produtos existentes
DO $$ BEGIN
  ALTER TABLE products ADD COLUMN IF NOT EXISTS sla_minutes_normal  SMALLINT NOT NULL DEFAULT 10 CHECK (sla_minutes_normal > 0);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS sla_minutes_urgente SMALLINT NOT NULL DEFAULT 7  CHECK (sla_minutes_urgente > 0);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS kitchen_station_id UUID REFERENCES kitchen_stations(id);
END $$;

-- ═══════════════════════════════════════════════════════
-- BLOCO 3: product_units (depende de products + units)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_units (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id    UUID NOT NULL REFERENCES units(id),
  PRIMARY KEY (product_id, unit_id)
);

-- ═══════════════════════════════════════════════════════
-- BLOCO 4: menus e cardápios
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS menus (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number     SMALLINT NOT NULL UNIQUE CHECK (number BETWEEN 1 AND 14),
  name       VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO menus (number, name) VALUES
  (1,'Cardápio 1'),(2,'Cardápio 2'),(3,'Cardápio 3'),(4,'Cardápio 4'),
  (5,'Cardápio 5'),(6,'Cardápio 6'),(7,'Cardápio 7'),(8,'Cardápio 8'),
  (9,'Cardápio 9'),(10,'Cardápio 10'),(11,'Cardápio 11'),(12,'Cardápio 12'),
  (13,'Cardápio 13'),(14,'Cardápio 14')
ON CONFLICT (number) DO NOTHING;

CREATE TABLE IF NOT EXISTS menu_products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id    UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (menu_id, product_id)
);

-- ═══════════════════════════════════════════════════════
-- BLOCO 5: daily_menus (depende de menus + products)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_menus (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE NOT NULL UNIQUE,
  menu_id     UUID NOT NULL REFERENCES menus(id),
  is_override BOOLEAN DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_menus_date ON daily_menus(date);

CREATE TABLE IF NOT EXISTS daily_menu_overrides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_menu_id UUID NOT NULL REFERENCES daily_menus(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id),
  action        VARCHAR(10) NOT NULL CHECK (action IN ('add','remove')),
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (daily_menu_id, product_id)
);

-- ═══════════════════════════════════════════════════════
-- BLOCO 6: demands (depende de várias tabelas)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS demands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_menu_id UUID REFERENCES daily_menus(id),
  product_id    UUID REFERENCES products(id),
  product_name  VARCHAR(100) NOT NULL,
  quantity      NUMERIC(10,2) NOT NULL,
  unit_id       UUID REFERENCES units(id),
  unit_label    VARCHAR(30),
  kitchen_station_id UUID REFERENCES kitchen_stations(id),
  sla_minutes   SMALLINT,
  status        VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending','ready','retrieved','cancelled_salao','cancelled_cozinha','annulled')),
  priority      VARCHAR(10) DEFAULT 'normal'
                CHECK (priority IN ('normal','urgent')),
  notes         TEXT,
  ready_at      TIMESTAMPTZ,
  retrieved_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT,
  stockout_reported    BOOLEAN NOT NULL DEFAULT false,
  stockout_reported_at TIMESTAMPTZ,
  expected_ready_at        TIMESTAMPTZ,
  cooking_started    BOOLEAN NOT NULL DEFAULT false,
  cooking_started_at TIMESTAMPTZ,
  sla_breached_cozinha     BOOLEAN DEFAULT false,
  sla_breach_minutes_cozinha NUMERIC(6,2),
  sla_breached_salao       BOOLEAN DEFAULT false,
  sla_breach_minutes_salao NUMERIC(6,2),
  is_replacement       BOOLEAN NOT NULL DEFAULT false,
  replaced_product_id  UUID REFERENCES products(id),
  ready_out_of_order   BOOLEAN NOT NULL DEFAULT false,
  annulled_at          TIMESTAMPTZ,
  annulled_by          TEXT,
  annul_reason         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demands_status ON demands(status);
CREATE INDEX IF NOT EXISTS idx_demands_created_at ON demands(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demands_daily_menu_id ON demands(daily_menu_id);
CREATE INDEX IF NOT EXISTS idx_demands_kitchen_station ON demands(kitchen_station_id);
CREATE INDEX IF NOT EXISTS idx_demands_expected_ready ON demands(expected_ready_at);

-- Adiciona colunas v2.2 em demands existentes (se rodando como migração)
DO $$ BEGIN
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS cooking_started    BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS cooking_started_at TIMESTAMPTZ;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS kitchen_station_id UUID REFERENCES kitchen_stations(id);
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS sla_minutes SMALLINT;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS unit_label VARCHAR(30);
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS retrieved_at TIMESTAMPTZ;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS stockout_reported BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS stockout_reported_at TIMESTAMPTZ;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS expected_ready_at TIMESTAMPTZ;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS sla_breached_cozinha BOOLEAN DEFAULT false;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS sla_breach_minutes_cozinha NUMERIC(6,2);
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS sla_breached_salao BOOLEAN DEFAULT false;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS sla_breach_minutes_salao NUMERIC(6,2);
  ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_status_check;
  ALTER TABLE demands ADD CONSTRAINT demands_status_check CHECK (status IN ('pending','ready','retrieved','cancelled_salao','cancelled_cozinha','annulled'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════
-- BLOCO 7: demand_events (depende de demands)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS demand_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id  UUID NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
               'created', 'marked_ready', 'retrieved',
               'cancelled_salao', 'cancelled_cozinha',
               'stockout_reported',
               'sla_breach_cozinha', 'sla_breach_salao'
             )),
  actor      VARCHAR(10) CHECK (actor IN ('salao', 'cozinha', 'sistema')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_events_demand_id ON demand_events(demand_id);
CREATE INDEX IF NOT EXISTS idx_demand_events_type ON demand_events(event_type);

-- ═══════════════════════════════════════════════════════
-- BLOCO 7.5: cancel_reasons + performance_scores
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cancel_reasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      VARCHAR(100) NOT NULL,
  category   VARCHAR(10) NOT NULL CHECK (category IN ('salao', 'cozinha')),
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO cancel_reasons (label, category) VALUES
  ('Erro no pedido', 'salao'),
  ('Cliente desistiu', 'salao'),
  ('Pedido duplicado', 'salao'),
  ('Mudança de cardápio', 'salao'),
  ('Falta de insumo', 'cozinha'),
  ('Prato estragado/contaminado', 'cozinha'),
  ('Equipamento com defeito', 'cozinha'),
  ('Tempo de preparo inviável', 'cozinha')
ON CONFLICT DO NOTHING;

-- Adiciona coluna cancel_reason_id em demands
DO $$ BEGIN
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS cancel_reason_id UUID REFERENCES cancel_reasons(id);
END $$;

-- performance_scores: notas diárias de desempenho por entidade
CREATE TABLE IF NOT EXISTS performance_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity                VARCHAR(30) NOT NULL,
  date                  DATE NOT NULL,
  base_score            NUMERIC(3,1) NOT NULL DEFAULT 5.0,
  final_score           NUMERIC(3,1) NOT NULL DEFAULT 5.0,
  total_demands         INTEGER NOT NULL DEFAULT 0,
  sla_breaches          INTEGER NOT NULL DEFAULT 0,
  sla_breach_deduction  NUMERIC(4,2) NOT NULL DEFAULT 0,
  cancellations         INTEGER NOT NULL DEFAULT 0,
  cancellation_deduction NUMERIC(4,2) NOT NULL DEFAULT 0,
  stockouts             INTEGER NOT NULL DEFAULT 0,
  stockout_deduction    NUMERIC(4,2) NOT NULL DEFAULT 0,
  slow_items            INTEGER NOT NULL DEFAULT 0,
  slow_item_deduction   NUMERIC(4,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity, date)
);

-- Configurações de pontuação
INSERT INTO system_settings (key, value) VALUES
  ('score_weight_sla_breach', '0.15'),
  ('score_weight_cancellation', '0.30'),
  ('score_weight_stockout_kitchen', '0.20'),
  ('score_weight_stockout_salao', '0.10'),
  ('score_weight_slow_item', '0.10')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- BLOCO 8: view daily_menu_effective
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE VIEW daily_menu_effective AS
  SELECT dm.date, dm.id AS daily_menu_id,
         p.id AS product_id, p.name, p.category,
         'unidade' AS default_unit, 'base' AS origin
  FROM daily_menus dm
  JOIN menu_products mp ON mp.menu_id = dm.menu_id
  JOIN products p       ON p.id = mp.product_id
  WHERE p.active = true
    AND NOT EXISTS (
      SELECT 1 FROM daily_menu_overrides dmo
      WHERE dmo.daily_menu_id = dm.id
        AND dmo.product_id = p.id
        AND dmo.action = 'remove'
    )
  UNION ALL
  SELECT dm.date, dm.id AS daily_menu_id,
         p.id AS product_id, p.name, p.category,
         'unidade' AS default_unit, 'manual_add' AS origin
  FROM daily_menus dm
  JOIN daily_menu_overrides dmo ON dmo.daily_menu_id = dm.id
  JOIN products p               ON p.id = dmo.product_id
  WHERE dmo.action = 'add' AND p.active = true;

-- ═══════════════════════════════════════════════════════
-- BLOCO 9: migração v2.5 — trocas, pronto fora de sequência, anulação, retenção
-- ═══════════════════════════════════════════════════════

DO $$ BEGIN
  -- Novas colunas em demands (v2.5)
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS is_replacement      BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS replaced_product_id UUID REFERENCES products(id);
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS ready_out_of_order  BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS annulled_at         TIMESTAMPTZ;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS annulled_by         TEXT;
  ALTER TABLE demands ADD COLUMN IF NOT EXISTS annul_reason        TEXT;

  -- Status 'annulled' no CHECK de demands
  ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_status_check;
  ALTER TABLE demands ADD CONSTRAINT demands_status_check
    CHECK (status IN ('pending','ready','retrieved','cancelled_salao','cancelled_cozinha','annulled'));

  -- Evento 'annulled' no CHECK de demand_events
  ALTER TABLE demand_events DROP CONSTRAINT IF EXISTS demand_events_event_type_check;
  ALTER TABLE demand_events ADD CONSTRAINT demand_events_event_type_check
    CHECK (event_type IN (
      'created', 'marked_ready', 'retrieved',
      'cancelled_salao', 'cancelled_cozinha',
      'stockout_reported',
      'sla_breach_cozinha', 'sla_breach_salao',
      'annulled'
    ));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_demands_replaced_product ON demands(replaced_product_id);

-- Retenção de dados (dias) para o endpoint/job de limpeza
INSERT INTO system_settings (key, value) VALUES
  ('data_retention_days', '180')
ON CONFLICT (key) DO NOTHING;
