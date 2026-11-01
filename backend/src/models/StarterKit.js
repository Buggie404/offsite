const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  slot_id: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, required: true, enum: ['matcha', 'coffee', 'tools', 'drinkware'] },
  attribute: { type: String, default: 'Any' },
  constraint: { type: String, default: 'Any price' },
  hero: { type: Boolean, default: false }
}, { _id: false });

const starterKitSchema = new mongoose.Schema({
  kit_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  tier: { type: String, default: 'Everyday Sip' },
  description: { type: String, default: '' },
  image_url: { type: String, default: '' },
  slots: { type: [slotSchema], default: [] },
  drink: { type: String, required: true, enum: ['matcha', 'coffee', 'mixed', 'any'] },
  level: { type: String, required: true, enum: ['beginner', 'ritual', 'craft', 'any'] },
  budget: { type: String, required: true, enum: ['under_60', 'mid_60_120', 'over_120'] },
  discount_percent: { type: Number, default: 20, min: 0, max: 100 },
  status: { type: String, enum: ['active', 'suspended', 'draft'], default: 'draft' },
  order: { type: Number, default: 0 }
}, {
  collection: 'StarterKits',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.models.StarterKit || mongoose.model('StarterKit', starterKitSchema);
