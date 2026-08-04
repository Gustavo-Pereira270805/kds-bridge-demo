import { Server as SocketIOServer } from 'socket.io';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

export interface Unit {
  id: string;
  code: string;
  label: string;
  active: boolean;
  featured: boolean;
}

export interface KitchenStation {
  id: string;
  code: string;
  name: string;
  capacity: number;
  theme: 'dark' | 'light';
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  active: boolean;
  sla_minutes_normal: number;
  sla_minutes_urgente: number;
  kitchen_station_id: string | null;
  created_at: string;
}

export interface ProductUnit {
  product_id: string;
  unit_id: string;
}

export interface Menu {
  id: string;
  number: number;
  name: string;
  created_at: string;
}

export interface MenuProduct {
  id: string;
  menu_id: string;
  product_id: string;
}

export interface DailyMenu {
  id: string;
  date: string;
  menu_id: string;
  is_override: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyMenuOverride {
  id: string;
  daily_menu_id: string;
  product_id: string;
  action: 'add' | 'remove';
  reason: string | null;
}

export interface DailyMenuEffective {
  date: string;
  daily_menu_id: string;
  product_id: string;
  name: string;
  category: string;
  default_unit: string;
  origin: 'base' | 'manual_add';
}

export type DemandStatus =
  | 'pending'
  | 'ready'
  | 'retrieved'
  | 'cancelled_salao'
  | 'cancelled_cozinha'
  | 'annulled';
export type DemandPriority = 'normal' | 'urgent';

export interface Demand {
  id: string;
  daily_menu_id: string | null;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_id: string | null;
  unit_label: string | null;
  kitchen_station_id: string | null;
  sla_minutes: number | null;
  status: DemandStatus;
  priority: DemandPriority;
  notes: string | null;
  ready_at: string | null;
  retrieved_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  stockout_reported: boolean;
  stockout_reported_at: string | null;
  expected_ready_at: string | null;
  cooking_started: boolean;
  cooking_started_at: string | null;
  sla_breached_cozinha: boolean;
  sla_breach_minutes_cozinha: number | null;
  sla_breached_salao: boolean;
  sla_breach_minutes_salao: number | null;
  is_replacement: boolean;
  replaced_product_id: string | null;
  replaced_name?: string | null;
  ready_out_of_order: boolean;
  annulled_at: string | null;
  annulled_by: string | null;
  annul_reason: string | null;
  created_at: string;
}

export interface DemandEvent {
  id: string;
  demand_id: string;
  event_type: DemandEventType;
  actor: 'salao' | 'cozinha' | 'sistema' | null;
  notes: string | null;
  created_at: string;
}

export type DemandEventType =
  | 'created'
  | 'marked_ready'
  | 'retrieved'
  | 'cancelled_salao'
  | 'cancelled_cozinha'
  | 'stockout_reported'
  | 'sla_breach_cozinha'
  | 'sla_breach_salao'
  | 'annulled';

export interface CreateDemandBody {
  product_id: string;
  quantity: number;
  unit_id?: string;
  unit_label?: string;
  priority?: DemandPriority;
  notes?: string;
  is_replacement?: boolean;
  replaced_product_id?: string;
}

export interface AnalyticsSummary {
  total: number;
  avgTimeMinutes: number;
  topProduct: string;
}

export interface PeakHourRow {
  hora: number;
  total: number;
}

export interface ProductRankingRow {
  product_name: string;
  total_demandas: number;
  tempo_medio_min: number;
}

export interface ShiftStatsRow {
  turno: string;
  tempo_medio_min: number;
  total: number;
}

export interface SlaBreachRow {
  responsavel: string;
  total_estouros: number;
  media_min_excedidos: number;
}

export interface CancellationRow {
  origem_cancelamento: string;
  total: number;
  cancel_reason: string | null;
}

export interface StockoutRow {
  product_name: string;
  total_roturas: number;
}

export interface QueueOccupationRow {
  estacao: string;
  demandas_pendentes_agora: number;
  capacidade_configurada: number;
}

export interface CancelReason {
  id: string;
  label: string;
  category: 'salao' | 'cozinha';
  active: boolean;
  created_at: string;
}

// Dashboard response types
export interface SpeedByHourRow {
  hora: number;
  avg_min: number;
  count: number;
}
export interface QueueTimeByStationRow {
  estacao: string;
  avg_wait_min: number;
  avg_cooking_min: number;
  count: number;
}
export interface SlaByProductRow {
  product_name: string;
  total: number;
  breached: number;
  pct_ok: number;
  avg_overage_min: number;
}
export interface PickupByHourRow {
  hora: number;
  avg_min: number;
  count: number;
}
export interface VolumeMARow {
  day: string;
  total: number;
  ma7: number;
}
export interface WeekdayRow {
  dia: string;
  total: number;
  avg: number;
}
export interface QtyVsTimeRow {
  product_name: string;
  qty: number;
  actual_min: number;
  sla_min: number;
}
export interface HeatmapRow {
  hora: number;
  dia_semana: number;
  total: number;
}
export interface WeekComparisonDay {
  day: string;
  this_week: number;
  last_week: number;
}

// v2.5 — busca de produtos (salão)
export interface ProductSearchRow {
  id: string;
  name: string;
  category: string | null;
  kitchen_station_id: string | null;
  in_today_menu: boolean;
}

// v2.5 — calendário de cardápios (gerente)
export interface DailyMenuCalendarRow {
  date: string;
  menu_id: string;
  menu_number: number;
  menu_name: string;
  is_override: boolean;
}

// v2.5 — tempo de fila por estação com breakdown por hora
export interface QueueTimeByHourRow {
  estacao: string;
  hora: number;
  tempo_medio_min: number;
}

// v2.5 — indicadores diários para a linha do gráfico comparativo
export interface DayIndicators {
  day: string;
  sla_pct: number | null;
  avg_time_min: number | null;
  cancel_rate: number | null;
  stockouts: number;
  urgent_pct: number | null;
}

// v2.5 — análise de trocas (itens substituídos)
export interface ReplacementRow {
  day: string;
  total: number;
  replacements: number;
  replacement_pct: number | null;
}

// Performance / scoring types
export interface PerformanceScoreRow {
  id: string;
  entity: string;
  date: string;
  weight_version_id?: string | null;
  base_score: number;
  final_score: number;
  total_demands: number;
  sla_breaches: number;
  sla_breach_deduction: number;
  cancellations: number;
  cancellation_deduction: number;
  stockouts: number;
  stockout_deduction: number;
  slow_items: number;
  slow_item_deduction: number;
}

export interface PerformanceDetractor {
  label: string;
  count: number;
  deduction: number;
}

export interface EntityScore {
  entity: PerformanceEntity;
  final_score: number;
  base_score: number;
  total_demands: number;
  sla_breaches: number;
  sla_breach_deduction: number;
  cancellations: number;
  cancellation_deduction: number;
  stockouts: number;
  stockout_deduction: number;
  slow_items: number;
  slow_item_deduction: number;
  detractors: PerformanceDetractor[];
}

export type PerformanceEntity =
  | 'salao'
  | 'cozinha_quente_a'
  | 'cozinha_quente_b'
  | 'cozinha_fria'
  | 'cozinha_geral';

export interface PerformanceWeights {
  sla_breach_cozinha: number;
  sla_breach_salao: number;
  cancellation_cozinha: number;
  cancellation_salao: number;
  stockout_salao: number;
  slow_item_cozinha: number;
  slow_pickup_salao: number;
}

export interface PerformanceWeightVersion extends PerformanceWeights {
  id: string;
  valid_from: string;
  valid_to: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PerformanceCriterionSummary {
  criterion: string;
  count: number;
  eligible_base: number;
  rate: number;
  weight: number | null;
  weights?: { weight_version_id: string; weight: number; count: number; deduction: number }[];
  multi_version?: boolean;
  deduction: number;
}

export interface PerformanceOccurrence {
  entity: PerformanceEntity;
  station: string | null;
  type: string;
  date: string;
  demand_id: string;
  product_name: string;
  detail: string;
  weight: number | null;
  deduction: number | null;
  weight_version_id: string | null;
}

export interface EntityPerformance {
  entity: PerformanceEntity;
  operational_score: number;
  daily_average_score: number | null;
  daily_average_complete: boolean;
  total_demands: number;
  open_demands: number;
  total_deduction: number;
  criteria: PerformanceCriterionSummary[];
  occurrences: PerformanceOccurrence[];
  weight_versions: PerformanceWeightVersion[];
  weight_version?: PerformanceWeightVersion | null;
  legacy_unversioned: boolean;
}

export interface PerformanceAverage {
  entity: PerformanceEntity;
  final_score: number;
  total_demands: number;
  sla_breaches: number;
  cancellations: number;
  stockouts: number;
  slow_items: number;
}

export interface PerformanceResponse {
  current: Record<string, EntityScore>;
  history: { date: string; [entity: string]: number | string }[];
  averages?: Record<string, EntityScore>;
  operational?: Record<string, EntityPerformance>;
  validity?: PerformanceWeightVersion[];
  detractor_dates?: Record<string, PerformanceOccurrence[]>;
  date_from?: string;
  date_to?: string;
  weight_versions?: PerformanceWeightVersion[];
}
