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
  target_tier: { type: String, enum: ['seed', 'leaf', 'bloom', 'zen', null], default: null }
}, {
  collection: 'Vouchers'
});

module.exports = mongoose.model('Voucher', voucherSchema);
