export type AdminOrderStatus =
  | 'pending'
  | 'processing'
  | 'shipping'
  | 'delivered'
  | 'canceled'
  | 'refund';

export type AdminOrderStatusFilter =
  | 'all'
  | 'processing'
  | 'shipping'
  | 'delivered'
  | 'cancelled'
  | 'refund';

export type AdminDateRange = 'today' | '7' | '30' | '90' | 'custom';

export interface AdminOrderListItem {
  _id: string;
  order_id: string;
  customer_name: string;
  customer_email: string;
  created_at: string;
  order_status: AdminOrderStatus;
  total: number;
  currency: string;
  is_guest: boolean;
}

export interface AdminOrderStats {
  total: number;
  processing: number;
  shipped: number;
  needsAttention: number;
}

export interface AdminOrdersResponse {
  total: number;
  page: number;
  limit: number;
  stats: AdminOrderStats;
  data: AdminOrderListItem[];
}

export interface AdminOrdersQuery {
  order_status?: AdminOrderStatusFilter;
  search?: string;
  date_range?: AdminDateRange;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}
