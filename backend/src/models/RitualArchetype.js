const mongoose = require('mongoose');

const AXES = ['brightness', 'boldness', 'sweetness', 'skill', 'tempo'];

const tasteProfileSchema = new mongoose.Schema(
  Object.fromEntries(AXES.map(axis => [axis, { type: Number, required: true, min: 0, max: 100 }])),
  { _id: false, strict: 'throw' }
);

const ritualArchetypeSchema = new mongoose.Schema({
  archetype_id: { type: String, required: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  tagline: { type: String, default: '', trim: true },
  taste_profile: { type: tasteProfileSchema, required: true },
  recommended_products: { type: [String], default: [] },
  badge_icon: { type: String, default: '' },
  level_thresholds: { type: [Number], default: [] },
  is_active: { type: Boolean, default: true },
  // Bump when the target vector changes; existing User snapshots retain their version.
  profile_version: { type: Number, default: 1, min: 1 }
}, {
  collection: 'RitualArchetypes',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ritualArchetypeSchema.index({ is_active: 1, archetype_id: 1 });

module.exports = mongoose.model('RitualArchetype', ritualArchetypeSchema);
