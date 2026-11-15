const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  voucher_type: { 
    type: String, 
    required: true, 
    enum: ['discount', 'shipping'] 
  },
  discount_type: { 
    type: String, 
    required: true, 
    enum: ['percentage', 'fixed'] 
  },
  discount_value: { type: Number, required: true },
  is_active: { type: Boolean, default: true },
  usage_limit: { type: Number, default: null },
  used_count: { type: Number, default: 0 },
  min_order_amount: { type: Number, default: 0 },
  max_discount_value: { type: Number, default: null },
  valid_from: { type: String, required: true },
  valid_to: { type: String, required: true },
  createdAt: { type: String, required: true },
  title: { type: String, default: null },
  subtitle: { type: String, default: null },
  // Admin who created the voucher (Users.user_id). Null on vouchers issued by the system.
  created_by: { type: String, default: null },
  purpose: {
    type: String,
    enum: ['campaign', 'complaint', 'loyalty_redeem', 'referral', 'archetype'],
    default: 'campaign'
  },
  // Personal voucher (points, a complaint, a referral). Null means anyone can use it.
  assigned_user_id: { type: String, default: null },
  // Order id or support conversation id recorded on a complaint voucher.
  related_ref: { type: String, default: null },
  // Uses per account. Null means no per-account cap; omitted on older rows is treated as 1.
  usage_limit_per_user: { type: Number, default: 1 },
  // seed | leaf | bloom | zen. Null means every tier.
  target_tier: { type: String, enum: ['seed', 'leaf', 'bloom', 'zen', null], default: null },
  // Scope (Campaign and Loyalty only). Shipping, Referral and Complaint vouchers are always 'all'.
  applies_to: { type: String, enum: ['all', 'category', 'product'], default: 'all' },
  // Values of Products.category. Set only when applies_to is 'category'.
  applicable_categories: { type: [String], default: undefined },
  // Products._id as strings, at most 50. Set only when applies_to is 'product'.
  applicable_product_ids: { type: [String], default: undefined },
  // Points a customer spends to redeem this voucher (Campaign and Loyalty only).
  // Null or 0: no redemption needed, the code is open to every eligible customer.
  // A redeemable voucher is a template: redeeming issues a personal one-use copy, and the template
  // code itself is refused at checkout.
  points_cost: { type: Number, default: null },
  // On a personal copy issued by redeeming points: the template voucher's _id.
  source_voucher_id: { type: String, default: null }
}, {
  collection: 'Vouchers'
});

voucherSchema.index({ createdAt: -1, code: 1 });
voucherSchema.index({ is_active: 1, valid_from: 1, valid_to: 1, createdAt: -1 });

module.exports = mongoose.model('Voucher', voucherSchema);
