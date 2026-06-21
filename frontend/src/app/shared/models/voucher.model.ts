export interface Voucher {
  _id: string;
  code: string;
  voucher_type: 'discount' | 'shipping';
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  is_active: boolean;
  usage_limit?: number;
  used_count: number;
  min_order_amount?: number;
  max_discount_value?: number | null;
  valid_from: string;
  valid_to: string;
  createdAt: string;
}
