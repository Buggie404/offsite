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
  createdAt: { type: String, required: true }
}, {
  collection: 'Vouchers'
});

module.exports = mongoose.model('Voucher', voucherSchema);
