const mongoose = require('mongoose');

const starterQuizDraftSchema = new mongoose.Schema({
  _id: { type: String },
  enabled: { type: Boolean, default: true },
  questions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  kits: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, {
  collection: 'StarterQuizDrafts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.models.StarterQuizDraft || mongoose.model('StarterQuizDraft', starterQuizDraftSchema);
