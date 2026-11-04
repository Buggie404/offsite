const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  version: { type: Number, required: true, unique: true },
  status: { type: String, required: true, enum: ['draft', 'testing', 'active', 'archived'] },
  questions: { type: [mongoose.Schema.Types.Mixed], required: true },
  source_version: { type: Number, default: null },
  created_by: { type: String, default: null },
  published_by: { type: String, default: null },
  published_at: { type: Date, default: null },
  tested_at: { type: Date, default: null }
}, { collection: 'RitualQuizReleases', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

schema.index({ status: 1, version: -1 });
schema.index({ status: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
module.exports = mongoose.model('RitualQuizRelease', schema);
