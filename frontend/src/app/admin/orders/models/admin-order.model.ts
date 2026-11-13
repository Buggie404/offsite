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
  /** Failed delivery waiting on the customer's answer / confirmed, waiting to ship again. */
  | 'redelivery_awaiting'
  | 'redelivery_confirmed'
  | 'delivered'
  | 'refund'
  | 'pending_refund'
  | 'refund_rejected';

/**
 * Needs attention (?attention=): every urgent order, or only paid Ritual Boxes that couldn't
 * start (dashboard to-do links use that one).
 */
export type AdminOrderAttentionFilter = 'all' | 'needs_attention' | 'ritual_box_not_started';

/**
 * Why an order is urgent: refund request waiting, failed delivery, still being prepared 3+ days
 * after it was placed (the bell's "Urgent preparation needed"), Ritual Box not started.
 */
export type AdminOrderAttentionReason = 'pending_refund' | 'delivery_failed' | 'urgent_preparation' | 'ritual_box_not_started';

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
  /** Urgent order: listed first by default and highlighted in the table. */
  needs_attention?: boolean;
  attention_reasons?: AdminOrderAttentionReason[];
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
  /** Out of stock after ordering: waiting for the customer to swap or remove it
   *  (or the reason the order was cancelled, when every line was out of stock). */
  out_of_stock?: boolean;
}

/** A line taken off a processing order because it was out of stock. */
export interface AdminOrderRemovedItem {
  action: 'removed' | 'swapped';
  product_name: string;
  variant_name?: string | null;
  quantity: number;
  subtotal: number;
  replaced_by: { product_name: string; variant_name?: string | null; subtotal: number } | null;
  refunded_amount: number;
  reason: string | null;
  changed_at: string;
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
  removed_items?: AdminOrderRemovedItem[];
  /** Money returned for out-of-stock lines removed or swapped (payment stays 'paid'). */
  refunded_amount?: number;
  delivery_failed_reason_code?: DeliveryFailedReasonCode | null;
  delivery_failed_reason?: string | null;
  delivery_attempts?: number;
  max_redelivery_attempts?: number;
  redelivery?: AdminOrderRedelivery | null;
  /** Server rule: redeliveries left and (customer confirmed or carrier fault). */
  can_redeliver?: boolean;
  refund_status?: 'pending_payout' | 'completed' | null;
  refund_destination?: { bank_name: string; account_number: string; account_holder: string } | null;
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

export type DeliveryFailedReasonCode = 'customer_unreachable' | 'wrong_address' | 'refused' | 'carrier_issue';

/** Customer's answer after a failed delivery (null on older orders). */
export interface AdminOrderRedelivery {
  status: 'awaiting_customer' | 'confirmed' | 'expired';
  requested_at: string | null;
  expires_at: string | null;
  reminder_sent_at: string | null;
  confirmed_at: string | null;
  contact_phone: string | null;
  shipping_address: { recipient_name: string | null; mobile: string | null; city: string | null; address: string | null } | null;
  note: string;
}
