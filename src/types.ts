export interface Product {
  id: number;
  name: string;
  category: string;
  unit: string;
  active: number;
}

export type DemandStatus = 'pending' | 'completed'| 'cancelled';
export type DemandPriority = 'normal'| 'urgent';

export interface Demand {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  status: DemandStatus;
  priority: DemandPriority;
  notes: string | null;
  completed_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CreateDemandBody {
    product_id: number;
    quantity: number;
    priority?:DemandPriority;
    notes?:string;
}
export interface UpdateStatusBody {
    status : DemandStatus;
    completed_by?:string;
}