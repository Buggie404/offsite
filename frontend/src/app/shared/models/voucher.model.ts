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
  applies_to?: 'all' | 'category' | 'product';
  applicable_categories?: string[] | null;
  applicable_product_ids?: string[] | null;
}

/** Line sent to POST /api/vouchers/quote. key comes back on each quoted line. */
export interface VoucherQuoteItem {
  key: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  purchase_type: 'one_time' | 'subscription';
  from_quiz_bundle?: boolean;
}

export interface VoucherQuoteLine {
  key: string;
  product_id: string;
  variant_id: string | null;
  eligible: boolean;
  reason: 'ritual_box' | 'starter_kit' | 'unavailable' | 'out_of_scope' | null;
}

/** Server-priced voucher for the current cart. The client only shows it. */
export interface VoucherQuote {
  voucher: Voucher;
  discount_amount: number;
  eligible_subtotal: number;
  applies_to: 'all' | 'category' | 'product';
  lines: VoucherQuoteLine[];
}
