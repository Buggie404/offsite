const mongoose = require('mongoose');

const aiCallLogSchema = new mongoose.Schema({
  feature: {
    type: String,
    enum: ['concierge', 'community_bridge'],
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
  output_summary: { type: String, default: '' }
}, {
  collection: 'AiCallLogs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Auto delete log contents after 90 days as requested in spec
aiCallLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AiCallLog', aiCallLogSchema);
