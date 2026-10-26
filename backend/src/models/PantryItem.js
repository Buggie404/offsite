const mongoose = require('mongoose');

const pantryItemSchema = new mongoose.Schema({
  pantry_item_id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  source: { type: String, enum: ['order', 'subscription', 'manual'], required: true },
  order_id: { type: String, default: null },
  subscription_id: { type: String, default: null },
  product_id: { type: String, default: null },
  variant_id: { type: String, default: null },
  name: { type: String, required: true },
  image_url: { type: String, default: null },
  category: {
    type: String,
    enum: ['matcha', 'coffee', 'tools', 'drinkware', 'sets_bundles', 'other', null],
    default: null
  },
  quantity: { type: Number, required: true, min: 0, default: 1 },
  unit: { type: String, default: '' },
  purchased_at: { type: Date, required: true },
  delivered_at: { type: Date, default: null },
  expiry_date: { type: Date, default: null },
  expiry_source: { type: String, enum: ['batch', 'estimated', 'manual', null], default: null },
  expiry_notified_at: { type: Date, default: null },
  // active = in the pantry. removed = refunded or deleted by the owner, kept out of the list.
  status: { type: String, enum: ['active', 'used_up', 'expired', 'removed'], default: 'active', index: true }
}, {
  collection: 'PantryItems',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

pantryItemSchema.index({ user_id: 1, status: 1 });
pantryItemSchema.index(
  { order_id: 1, product_id: 1, variant_id: 1 },
  {
    unique: true,
    partialFilterExpression: { order_id: { $type: 'string' } }
  }
);

module.exports = mongoose.model('PantryItem', pantryItemSchema);
