-- KDS Bridge — esquema base idêntico ao Supabase nuvem (ambiente local)
-- Gerado por introspecção da nuvem em 2026-09-08. Uso: banco local de desenvolvimento.
-- Aplica com: psql $DATABASE_URL_LOCAL -f supabase/schema.sql
-- Depois rode as migrations em supabase/migrations/*.sql (idempotentes) e o seed do servidor.
-- Não apaga dados: usa CREATE TABLE IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Estações da cozinha
CREATE TABLE IF NOT EXISTS kitchen_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL UNIQUE,
  name varchar(50) NOT NULL,
  capacity smallint NOT NULL DEFAULT 1 CHECK (capacity > 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light'))
);

-- Cardápios (rotação fixa 1..14)
CREATE TABLE IF NOT EXISTS menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number smallint NOT NULL UNIQUE CHECK (number >= 1 AND number <= 14),
  name varchar(100),
  created_at timestamptz DEFAULT now()
);

-- Unidades de medida
CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL UNIQUE,
  label varchar(30) NOT NULL,
  active boolean DEFAULT true,
  featured boolean DEFAULT false
);

-- Motivos de cancelamento
CREATE TABLE IF NOT EXISTS cancel_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label varchar(100) NOT NULL,
  category varchar(10) NOT NULL CHECK (category IN ('salao', 'cozinha')),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Configurações do sistema
CREATE TABLE IF NOT EXISTS system_settings (
  key varchar(50) PRIMARY KEY,
  value text NOT NULL
);

-- Versões de pesos de desempenho
CREATE TABLE IF NOT EXISTS performance_weight_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_breach_cozinha numeric NOT NULL CHECK (sla_breach_cozinha >= 0 AND sla_breach_cozinha <= 5),
  sla_breach_salao numeric NOT NULL CHECK (sla_breach_salao >= 0 AND sla_breach_salao <= 5),
  cancellation_cozinha numeric NOT NULL CHECK (cancellation_cozinha >= 0 AND cancellation_cozinha <= 5),
  cancellation_salao numeric NOT NULL CHECK (cancellation_salao >= 0 AND cancellation_salao <= 5),
  stockout_salao numeric NOT NULL CHECK (stockout_salao >= 0 AND stockout_salao <= 5),
  slow_item_cozinha numeric NOT NULL CHECK (slow_item_cozinha >= 0 AND slow_item_cozinha <= 5),
  slow_pickup_salao numeric NOT NULL CHECK (slow_pickup_salao >= 0 AND slow_pickup_salao <= 5),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Produtos
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE,
  category varchar(50),
  active boolean DEFAULT true,
  sla_minutes_normal smallint NOT NULL DEFAULT 10 CHECK (sla_minutes_normal > 0),
  sla_minutes_urgente smallint NOT NULL DEFAULT 7 CHECK (sla_minutes_urgente > 0),
  kitchen_station_id uuid REFERENCES kitchen_stations(id),
  created_at timestamptz DEFAULT now()
);

-- Vínculo produto x unidade
CREATE TABLE IF NOT EXISTS product_units (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id),
  PRIMARY KEY (product_id, unit_id)
);

-- Vínculo cardápio x produto
CREATE TABLE IF NOT EXISTS menu_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (menu_id, product_id)
);

-- Cardápio do dia
CREATE TABLE IF NOT EXISTS daily_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  menu_id uuid NOT NULL REFERENCES menus(id),
  is_override boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_menus_date ON daily_menus(date);

-- Ajustes manuais do cardápio do dia
CREATE TABLE IF NOT EXISTS daily_menu_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_menu_id uuid NOT NULL REFERENCES daily_menus(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  action varchar(10) NOT NULL CHECK (action IN ('add', 'remove')),
  reason text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (daily_menu_id, product_id)
);

-- Demandas (pedidos salão -> cozinha)
CREATE TABLE IF NOT EXISTS demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_menu_id uuid REFERENCES daily_menus(id),
  product_id uuid REFERENCES products(id),
  product_name varchar(100) NOT NULL,
  quantity numeric(10,2) NOT NULL,
  unit_id uuid REFERENCES units(id),
  unit_label varchar(30),
  kitchen_station_id uuid REFERENCES kitchen_stations(id),
  sla_minutes smallint,
  status varchar(20) DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'retrieved', 'cancelled_salao', 'cancelled_cozinha', 'annulled')),
  priority varchar(10) DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  notes text,
  ready_at timestamptz,
  retrieved_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  stockout_reported boolean NOT NULL DEFAULT false,
  stockout_reported_at timestamptz,
  expected_ready_at timestamptz,
  cooking_started boolean NOT NULL DEFAULT false,
  cooking_started_at timestamptz,
  sla_breached_cozinha boolean DEFAULT false,
  sla_breach_minutes_cozinha numeric(6,2),
  sla_breached_salao boolean DEFAULT false,
  sla_breach_minutes_salao numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancel_reason_id uuid REFERENCES cancel_reasons(id),
  is_replacement boolean NOT NULL DEFAULT false,
  replaced_product_id uuid REFERENCES products(id),
  ready_out_of_order boolean NOT NULL DEFAULT false,
  annulled_at timestamptz,
  annulled_by text,
  annul_reason text,
  origin_station_id uuid,
  stockout_sla_factor numeric
);
CREATE INDEX IF NOT EXISTS idx_demands_created_at ON demands(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demands_daily_menu_id ON demands(daily_menu_id);
CREATE INDEX IF NOT EXISTS idx_demands_expected_ready ON demands(expected_ready_at);
CREATE INDEX IF NOT EXISTS idx_demands_kitchen_station ON demands(kitchen_station_id);
CREATE INDEX IF NOT EXISTS idx_demands_status ON demands(status);

-- Auditoria de eventos da demanda
CREATE TABLE IF NOT EXISTS demand_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  event_type varchar(30) NOT NULL CHECK (event_type IN ('created', 'marked_ready', 'retrieved', 'cancelled_salao', 'cancelled_cozinha', 'stockout_reported', 'sla_breach_cozinha', 'sla_breach_salao', 'annulled', 'shift_transfer', 'step_rollback')),
  actor varchar(10) CHECK (actor IN ('salao', 'cozinha', 'sistema')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  annulled_at timestamptz,
  annulled_by text,
  annul_reason text
);
CREATE INDEX IF NOT EXISTS idx_demand_events_demand_id ON demand_events(demand_id);
CREATE INDEX IF NOT EXISTS idx_demand_events_type ON demand_events(event_type);

-- Notas de desempenho por dia/entidade
CREATE TABLE IF NOT EXISTS performance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity varchar(30) NOT NULL,
  date date NOT NULL,
  base_score numeric(3,1) NOT NULL DEFAULT 5.0,
  final_score numeric(3,1) NOT NULL DEFAULT 5.0,
  total_demands integer NOT NULL DEFAULT 0,
  sla_breaches integer NOT NULL DEFAULT 0,
  sla_breach_deduction numeric(4,2) NOT NULL DEFAULT 0,
  cancellations integer NOT NULL DEFAULT 0,
  cancellation_deduction numeric(4,2) NOT NULL DEFAULT 0,
  stockouts integer NOT NULL DEFAULT 0,
  stockout_deduction numeric(4,2) NOT NULL DEFAULT 0,
  slow_items integer NOT NULL DEFAULT 0,
  slow_item_deduction numeric(4,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  weight_version_id uuid REFERENCES performance_weight_versions(id) ON DELETE SET NULL,
  UNIQUE (entity, date)
);
CREATE INDEX IF NOT EXISTS performance_scores_date_entity_idx ON performance_scores(date, entity);
CREATE INDEX IF NOT EXISTS performance_weight_versions_validity_idx ON performance_weight_versions(valid_from, valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS performance_weight_versions_one_open_idx ON performance_weight_versions ((valid_to IS NULL)) WHERE (valid_to IS NULL);

-- Eventos dos Pis (controle remoto)
CREATE TABLE IF NOT EXISTS pi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text NOT NULL CHECK (target IN ('quente', 'fria', 'ambos')),
  action text NOT NULL CHECK (action IN ('shutdown', 'reboot')),
  by text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  online boolean NOT NULL DEFAULT false
);

-- Visão do cardápio efetivo (base menos remoções + adições manuais)
CREATE OR REPLACE VIEW daily_menu_effective AS
SELECT dm.date,
  dm.id AS daily_menu_id,
  mp.product_id,
  p.name,
  p.category,
  'base'::text AS origin,
  NULL::text AS default_unit
FROM daily_menus dm
  JOIN menu_products mp ON mp.menu_id = dm.menu_id
  JOIN products p ON p.id = mp.product_id AND p.active = true
WHERE NOT EXISTS (
  SELECT 1 FROM daily_menu_overrides dmo
  WHERE dmo.daily_menu_id = dm.id
    AND dmo.product_id = mp.product_id
    AND dmo.action::text = 'remove'::text
)
UNION ALL
SELECT dm.date,
  dm.id AS daily_menu_id,
  dmo.product_id,
  p.name,
  p.category,
  'manual_add'::text AS origin,
  NULL::text AS default_unit
FROM daily_menus dm
  JOIN daily_menu_overrides dmo ON dmo.daily_menu_id = dm.id AND dmo.action::text = 'add'::text
  JOIN products p ON p.id = dmo.product_id AND p.active = true;
