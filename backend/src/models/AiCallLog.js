const mongoose = require('mongoose');

const ritualDnaLogSchema = new mongoose.Schema({
  surface: { type: String, enum: ['account', 'product_detail'], required: true },
  prompt_version: { type: String, required: true },
  viewed_product_id: { type: Number, default: null },
  candidate_product_ids: { type: [String], default: [] },
  candidate_recipe_ids: { type: [String], default: [] },
  selected_product_ids: { type: [String], default: [] },
  selected_recipe_ids: { type: [String], default: [] }
}, { _id: false });

const aiCallLogSchema = new mongoose.Schema({
  feature: {
    type: String,
    enum: ['concierge', 'community_bridge', 'ritual_dna'],
    default: 'concierge',
    index: true
  },
  user_id: { type: String, default: null, index: true },
  session_id: { type: String, default: null, index: true },
  ip: { type: String, default: null },
  model: { type: String, default: 'dify' },
  prompt_tokens: { type: Number, default: 0 },
  completion_tokens: { type: Number, default: 0 },
  total_tokens: { type: Number, default: 0 },
  latency_ms: { type: Number, default: 0 },
  cost_usd: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['success', 'error', 'timeout', 'rate_limited', 'budget_exceeded', 'order_lookup'],
    default: 'success'
  },
  input_summary: { type: String, default: '' },
  output_summary: { type: String, default: '' },
  // Existing Dify logs keep this null; Ritual DNA logs only store IDs and counts, never prompts.
  ritual_dna: { type: ritualDnaLogSchema, default: null }
}, {
  collection: 'AiCallLogs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Auto delete log contents after 90 days as requested in spec
aiCallLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AiCallLog', aiCallLogSchema);
