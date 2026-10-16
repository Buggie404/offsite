const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product_id:   { type: String, required: true },                    // Lấy mẫu đọc từ collection Products
  variant_id:   { type: String, required: true },                    // matches products.variants[].variant_id
  quantity:     { type: Number, required: true, min: 1 },
  price_at_add: { type: Number, required: true, min: 0 },            // snapshot of price actually charged (after subscribe discount)
  original_price_at_add: { type: Number, default: null, min: 0 },    // giá gốc gạch ngang; chỉ có khi purchase_type = subscription
  purchase_type: { type: String, enum: ['one_time', 'subscription'], default: 'one_time' },
  subscription_frequency_days: {                                     // 7 / 14 / 30 — bắt buộc khi purchase_type = subscription
    type: Number,
    enum: [7, 14, 30, null],
    default: null,
    validate: {
      validator: function(value) {
        if (this.purchase_type === 'subscription') return value != null;
        return value == null;
      },
      message: 'subscription_frequency_days is required for subscription items and must be null otherwise'
    }
  },
  is_selected:  { type: Boolean, default: false },                   // checkbox state, default OFF
  bundle:       { type: mongoose.Schema.Types.Mixed, default: null }, // bundle metadata for sets/bundles
  added_at:     { type: Date,    default: Date.now }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  cart_id:    { type: String, required: true, unique: true },        // CRT0000X (X là số thứ tự từ 0)

  // Owner — exactly ONE of these is set
  user_id:    { type: String, default: null, ref: 'User' },          // logged-in: user_id từ collection Users. Lưu ý không lấy role admin
  session_id: { type: String, default: null },                       // guest: SS0000X

  items:      { type: [cartItemSchema], default: [] },

  expires_at: { type: Date, default: null }                          // null = persist forever (logged-in), Date = TTL (guest)
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'Carts'
});

// Mutual exclusivity: must have exactly one of user_id / session_id
cartSchema.pre('validate', function(next) {
  const hasUser  = !!this.user_id;
  const hasGuest = !!this.session_id;
  if (hasUser === hasGuest) {
    return next(new Error('Cart must have exactly one of user_id or session_id'));
  }
  // Subscribe & Save chỉ dành cho tài khoản đã đăng ký
  if (hasGuest && this.items.some(i => i.purchase_type === 'subscription')) {
    return next(new Error('Guest carts cannot contain subscription items'));
  }
  next();
});

// Composite uniqueness: same (product_id, variant_id, purchase_type) cannot appear twice in items.
// The same variant may sit in the cart once as one_time and once as subscription.
cartSchema.path('items').validate(function(items) {
  const keys = items.map(i => `${i.product_id}::${i.variant_id}::${i.purchase_type || 'one_time'}`);
  return new Set(keys).size === keys.length;
}, 'Duplicate product+variant+purchase_type in cart items');

module.exports = mongoose.model('Cart', cartSchema);
