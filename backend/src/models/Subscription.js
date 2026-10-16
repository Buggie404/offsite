const mongoose = require('mongoose');

// Mỗi bản ghi là một sản phẩm đang đăng ký Subscribe & Save.
// Các đơn do scheduler tạo ra gắn subscription_id trên Orders.

const pricingSnapshotSchema = new mongoose.Schema({
  original_price:   { type: Number, required: true, min: 0 },
  subscribe_price:  { type: Number, required: true, min: 0 },
  discount_percent: { type: Number, required: true, min: 0, max: 100 }
}, { _id: false });

// Same shape as Orders.delivery_info
const deliveryInfoSchema = new mongoose.Schema({
  recipient_name: { type: String, required: true },
  mobile:         { type: String, required: true },
  email:          { type: String, required: true },
  city:           { type: String, required: true },
  address:        { type: String, required: true },
  note:           { type: String, default: '' }
}, { _id: false });

const subscriptionSchema = new mongoose.Schema({
  subscription_id: { type: String, unique: true, index: true },    // SUB000X, generated in pre-validate hook

  user_id:    { type: String, required: true, index: true },       // chỉ user đã đăng ký
  product_id: { type: String, required: true },
  variant_id: { type: String, required: true },                    // SKU
  quantity:   { type: Number, required: true, min: 1 },

  frequency_days:   { type: Number, required: true, enum: [7, 14, 30] }, // Every week / 2 weeks / month
  next_delivery_at: { type: Date, required: true, index: true },

  status: {
    type: String,
    enum: ['active', 'paused', 'payment_failed', 'canceled'],
    default: 'active',
    index: true
  },

  pricing_snapshot:  { type: pricingSnapshotSchema, required: true },
  payment_method_id: { type: String, default: null },             // _id của payment method dùng để auto-charge
  delivery_info:     { type: deliveryInfoSchema, required: true },
  shipping_method:   { type: String, enum: ['standard', 'express'], default: 'standard' },

  skip_next:                { type: Boolean, default: false },    // bỏ qua một chu kỳ, không tính phí
  suggested_frequency_days: { type: Number, enum: [7, 14, 30, null], default: null }, // chờ khách xác nhận

  failed_attempts:     { type: Number, default: 0, min: 0 },
  last_failure_reason: { type: String, default: null },
  last_delivery_at:    { type: Date, default: null },
  source_order_id:     { type: String, default: null },           // đơn checkout tạo ra subscription này

  paused_at:   { type: Date, default: null },
  canceled_at: { type: Date, default: null }
}, {
  collection: 'Subscriptions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Scheduler query: active subscriptions due for delivery
subscriptionSchema.index({ status: 1, next_delivery_at: 1 });

subscriptionSchema.pre('validate', async function(next) {
  // 1. Auto-generate sequential subscription_id: SUB0001, SUB0002, ...
  if (!this.subscription_id) {
    try {
      const latest = await this.constructor.findOne(
        { subscription_id: /^SUB\d+$/ },
        { subscription_id: 1 },
        { sort: { created_at: -1 } }
      );
      let nextNum = 1;
      if (latest && latest.subscription_id) {
        const lastNum = parseInt(latest.subscription_id.slice(3), 10);
        if (!isNaN(lastNum)) nextNum = lastNum + 1;
      }
      this.subscription_id = `SUB${String(nextNum).padStart(4, '0')}`;
    } catch (err) {
      return next(err);
    }
  }

  // 2. Stamp paused_at / canceled_at on status transitions
  if (this.isModified('status')) {
    if (this.status === 'paused' && !this.paused_at) this.paused_at = new Date();
    if (this.status === 'active') this.paused_at = null;
    if (this.status === 'canceled' && !this.canceled_at) this.canceled_at = new Date();
  }
  next();
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
