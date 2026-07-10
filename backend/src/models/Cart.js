const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product_id:   { type: String, required: true },                    // Lấy mẫu đọc từ collection Products
  variant_id:   { type: String, required: true },                    // matches products.variants[].variant_id
  quantity:     { type: Number, required: true, min: 1 },
  price_at_add: { type: Number, required: true, min: 0 },            // snapshot of variant price
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
  next();
});

// Composite uniqueness: same (product_id, variant_id) cannot appear twice in items
cartSchema.path('items').validate(function(items) {
  const keys = items.map(i => `${i.product_id}::${i.variant_id}`);
  return new Set(keys).size === keys.length;
}, 'Duplicate product+variant in cart items');

module.exports = mongoose.model('Cart', cartSchema);
