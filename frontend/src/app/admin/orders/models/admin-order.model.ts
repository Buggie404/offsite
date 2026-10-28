import { OrderType } from '../../../shared/utils/order-type';

export type AdminOrderStatus =
  | 'pending'
  | 'processing'
  | 'shipping'
  | 'delivery_failed'
  | 'delivered'
  | 'canceled'
  | 'refund'
  | 'pending_refund'
  | 'refund_rejected';

export type AdminOrderStatusFilter =
  | 'all'
  | 'processing'
  | 'shipping'
  | 'delivery_failed'
  | 'delivered'
  | 'refund'
  | 'pending_refund'
  | 'refund_rejected';

/** Needs attention › flags the system sets on an order (?attention=). */
export type AdminOrderAttentionFilter = 'all' | 'ritual_box_not_started';

/** 'all' or one of the order types (same rule as the badge). */
export type AdminOrderTypeFilter = 'all' | OrderType;

export type AdminDateRange = 'today' | '7' | '30' | '90' | 'custom';

export interface AdminOrderListItem {
  _id: string;
  order_id: string;
  customer_name: string;
  customer_email: string | null;
  user_id: string | null;
  created_at: string;
  order_type: OrderType;
  order_status: AdminOrderStatus;
  total: number;
  currency: string;
  is_guest: boolean;
  /** Paid Ritual Box lines but no box could start (card removed). */
  subscription_start_failed?: boolean;
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
  order_type?: AdminOrderTypeFilter;
  attention?: AdminOrderAttentionFilter;
  search?: string;
  date_range?: AdminDateRange;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

export interface AdminOrderLineItem {
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  image_url: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  purchase_type?: 'one_time' | 'subscription';
  subscription_frequency_days?: number | null;
  /** Marked out of stock after ordering (the order was cancelled for it). */
  out_of_stock?: boolean;
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
  /** Set on orders billed by the Ritual Box charge job. */
  subscription_id?: string | null;
  subscription_cycle?: number | null;
  ritual_boxes?: AdminOrderRitualBox[];
  /** Paid Ritual Box lines but no box could start; cleared when the customer starts it. */
  subscription_start_failed?: boolean;
  subscription_start_failed_at?: string | null;
  pricing: {
    subtotal: number;
    shipping_cost: number;
    discount_amount?: number;
    total: number;
    currency: string;
  };
  payment_label: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_address: string;
  status_history: AdminOrderStatusHistoryEntry[];
  refund_request: AdminOrderRefundRequest | null;
  internal_notes: AdminInternalNote[];
}

export interface AdminOrderDetailResponse {
  data: AdminOrderDetail;
}

export type AdminOrderStatusUpdate = 'processing' | 'shipping' | 'delivery_failed' | 'canceled';

export interface AdminOrderRitualBox {
  subscription_id: string;
  relation: 'renewal' | 'started';
  product_name: string;
  variant_label: string;
  quantity: number;
  frequency_days: number;
  next_charge_at: string | null;
  status: string;
}
