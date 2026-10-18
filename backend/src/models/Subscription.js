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

  frequency_days: { type: Number, required: true, enum: [7, 14, 30] }, // Every week / 2 weeks / month
  // Mỗi lần charge ứng với một lần giao. Job charge lấy active có next_charge_at <= now,
  // charge xong thì next_charge_at += frequency_days.
  next_charge_at: { type: Date, required: true, index: true },

  status: {
    type: String,
    enum: ['active', 'paused', 'payment_failed', 'suspended', 'cancelled', 'cancelled_by_admin'],
    default: 'active',
    index: true
  },

  pricing_snapshot:  { type: pricingSnapshotSchema, required: true },
  payment_method_id: { type: String, default: null },             // _id của Users.payment_methods[] dùng để auto-charge
  delivery_info:     { type: deliveryInfoSchema, required: true },
  shipping_method:   { type: String, enum: ['standard', 'express'], default: 'standard' },

  // Bỏ qua chu kỳ: không tính phí, tối đa 2 chu kỳ liên tiếp (reset khi charge thành công).
  consecutive_skips:  { type: Number, default: 0, min: 0, max: 2 },
  skipped_deliveries: { type: [Date], default: [] },             // các chu kỳ đã bỏ qua (hiện trong Delivery history)

  // Trong 48 giờ trước next_charge_at, đổi tần suất / bỏ qua / tạm dừng chỉ có tác dụng từ chu kỳ sau:
  // lưu ở đây để job áp dụng ngay sau lần charge sắp tới.
  pending_changes: {
    frequency_days: { type: Number, enum: [7, 14, 30, null], default: null },
    skip:           { type: Boolean, default: false },
    pause_option:   { type: String, enum: ['1_month', '2_months', 'until_reactivated', null], default: null }
  },

  // Điều chỉnh thông minh (SUBSCRIPTION_ADJUSTED): gợi ý rút ngắn chu kỳ kế tiếp một mức,
  // chỉ áp dụng khi khách xác nhận; quá 3 ngày thì bỏ gợi ý.
  suggested_frequency_days: { type: Number, enum: [7, 14, null], default: null },
  suggested_at:             { type: Date, default: null },

  failed_attempts:     { type: Number, default: 0, min: 0 },
  last_failure_reason: { type: String, default: null },
  last_failed_at:      { type: Date, default: null },
  next_retry_at:       { type: Date, default: null },             // thử lại sau 24h → 48h → 72h, rồi suspended
  last_charged_at:     { type: Date, default: null },
  source_order_id:     { type: String, default: null },           // đơn checkout tạo ra subscription này

  // Tạm dừng: 1 tháng, 2 tháng, hoặc đến khi khách kích hoạt lại (resume_at = null).
  pause_option: { type: String, enum: ['1_month', '2_months', 'until_reactivated', null], default: null },
  paused_at:    { type: Date, default: null },
  resume_at:    { type: Date, default: null },

  cancelled_at:  { type: Date, default: null },
  cancel_reason: { type: String, default: null },                 // tuỳ chọn với khách, bắt buộc với cancelled_by_admin
  cancelled_by:  { type: String, default: null }                  // user_id của admin khi cancelled_by_admin
}, {
  collection: 'Subscriptions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Charge job query: active subscriptions due for a charge
subscriptionSchema.index({ status: 1, next_charge_at: 1 });

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

  // 2. Stamp paused_at / cancelled_at on status transitions
  if (this.isModified('status')) {
    if (this.status === 'paused' && !this.paused_at) this.paused_at = new Date();
    if (this.status === 'active') {
      this.paused_at = null;
      this.resume_at = null;
      this.pause_option = null;
    }
    if (['cancelled', 'cancelled_by_admin'].includes(this.status) && !this.cancelled_at) {
      this.cancelled_at = new Date();
    }
  }
  next();
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
