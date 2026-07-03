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

export interface AdminOrderLineItem {
  product_id: string;
  product_name: string;
  variant_name: string;
  image_url: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface AdminOrderStatusHistoryEntry {
  status: string;
  changed_at: string;
  changed_by: string;
  note?: string;
}

export interface AdminOrderRefundItem {
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  image?: { url: string; public_id?: string | null };
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface AdminOrderRefundRequest {
  refund_request_id?: string;
  order_id?: string;
  reason?: string | null;
  other_reason?: string | null;
  description?: string | null;
  evidence?: string[];
  refund_item?: AdminOrderRefundItem[];
  payment?: {
    method: string;
    card_info?: { brand?: string | null; last4?: string | null };
  };
  status?: 'pending' | 'approved' | 'rejected' | null;
  admin_reason?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
}

export interface AdminInternalNote {
  text: string;
  author: string;
  created_at: string;
}

export interface AdminOrderDetail {
  _id: string;
  order_id: string;
  order_status: AdminOrderStatus;
  payment_status: string;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  canceled_at: string | null;
  is_guest: boolean;
  items: AdminOrderLineItem[];
  pricing: {
    subtotal: number;
    shipping_cost: number;
    discount_amount?: number;
    total: number;
    currency: string;
  };
  payment_label: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_address: string;
  status_history: AdminOrderStatusHistoryEntry[];
  refund_request: AdminOrderRefundRequest | null;
  internal_notes: AdminInternalNote[];
}

export interface AdminOrderDetailResponse {
  data: AdminOrderDetail;
}

export type AdminOrderStatusUpdate = 'processing' | 'shipping';
