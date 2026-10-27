const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  message_id: { type: String, default: null },
  sender: {
    type: String,
    enum: ['user', 'ai', 'agent', 'system'],
    required: true
  },
  text: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  agent_id: { type: String, default: null }, // if sender === 'agent'
  metadata: { type: mongoose.Schema.Types.Mixed, default: null } // productCard, orderCard, quickReplies
}, { _id: false });

const aiChatSessionSchema = new mongoose.Schema({
  session_id: { type: String, required: true, unique: true },
  user_id: { type: String, default: null, index: true },
  dify_conversation_id: { type: String, default: null },
  support_conversation_id: { type: String, default: null },
  ip: { type: String, default: null },
  is_guest: { type: Boolean, default: true },
  retain_for_support: { type: Boolean, default: false },
  deleted_at: { type: Date, default: null },
  
  // Status: 'ai_active', 'waiting', 'in_progress', 'closed'
  status: {
    type: String,
    enum: ['ai_active', 'waiting', 'in_progress', 'closed'],
    default: 'ai_active',
    index: true
  },
  assigned_admin_id: { type: String, default: null },
  handover_reason: {
    type: String,
    enum: ['user_request', 'refund', 'complaint', 'order_change', 'no_answer', 'llm_error', null],
    default: null
  },
  summary: { type: String, maxlength: 300, default: '' },
  handover_notes: {
    type: [{
      note_id: { type: String, required: true },
      reason: {
        type: String,
        enum: ['user_request', 'refund', 'complaint', 'order_change', 'no_answer', 'llm_error'],
        required: true
      },
      summary: { type: String, maxlength: 300, default: '' },
      created_at: { type: Date, default: Date.now }
    }],
    default: []
  },
  messages: { type: [chatMessageSchema], default: [] },
  consecutive_misses: { type: Number, default: 0 },
  consecutive_errors: { type: Number, default: 0 },
  last_activity_at: { type: Date, default: Date.now },
  closed_at: { type: Date, default: null },
  close_reason: { type: String, default: null }
}, {
  collection: 'AiChatSessions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

aiChatSessionSchema.index({ user_id: 1, last_activity_at: -1 });
aiChatSessionSchema.index(
  { last_activity_at: 1 },
  {
    name: 'guest_session_ttl',
    expireAfterSeconds: 60 * 60 * 24 * 30,
    partialFilterExpression: { is_guest: true, retain_for_support: false }
  }
);

module.exports = mongoose.model('AiChatSession', aiChatSessionSchema);
