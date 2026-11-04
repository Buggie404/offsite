const mongoose = require('mongoose');

const archetypeSchema = new mongoose.Schema({
  archetype_id: { type: String, required: true },
  name: { type: String, required: true },
  tagline: { type: String, default: '' },
  description: { type: String, required: true },
  badge_icon: { type: String, default: '' },
  taste_profile: { type: mongoose.Schema.Types.Mixed, required: true },
  is_active: { type: Boolean, default: true }
}, { _id: false });

const schema = new mongoose.Schema({
  version: { type: Number, required: true, unique: true },
  status: { type: String, required: true, enum: ['draft', 'testing', 'active', 'archived'] },
  archetypes: { type: [archetypeSchema], required: true },
  source_version: { type: Number, default: null },
  created_by: { type: String, default: null },
  published_by: { type: String, default: null },
  published_at: { type: Date, default: null }
}, { collection: 'RitualArchetypeReleases', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

schema.index({ status: 1, version: -1 });
module.exports = mongoose.model('RitualArchetypeRelease', schema);
