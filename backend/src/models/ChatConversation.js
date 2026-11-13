const mongoose = require('mongoose');

const chatConversationSchema = new mongoose.Schema({
  conversation_id: { type: String, required: true, unique: true },
  customer_id: { type: String, required: true, index: true },
  agent_id: { type: String, default: null },
  claimed_at: { type: Date, default: null },
  waiting_since: { type: Date, default: Date.now },
  closed_at: { type: Date, default: null },
  closed_by_name: { type: String, default: null },
  close_outcome: { type: String, enum: ['resolved', 'forwarded', 'no_response', 'spam', null], default: null },
  close_reason: { type: String, enum: ['resolved', 'idle', 'return_to_bot', null], default: null },
  last_customer_message_at: { type: Date, default: null },
  last_agent_message_at: { type: Date, default: null },
  transfers: { type: [{ from_agent_id: String, to_agent_id: String, note: String, at: Date }], default: [] },
  // bot: still with the Dify chatbot, waiting: handed off & unclaimed, open: agent is chatting, closed
  status: { type: String, enum: ['bot', 'waiting', 'open', 'closed'], default: 'waiting', index: true },
  dify_conversation_id: { type: String, default: null },
  handoff_summary: { type: String, default: '' },
  summary: { type: String, default: '' },
  handover_reason: { type: String, default: null },
  // Order the customer opened this chat from (e.g. "Chat with a human" on a failed delivery), so
  // CSKH see it without asking. Set only for the order's owner.
  context_order_id: { type: String, default: null },
  ai_session_id: { type: String, default: null },
  archived_ai_session_id: { type: String, default: null },
  last_message_preview: { type: String, default: '' },
  last_message_at: { type: Date, default: Date.now },
  unread_agent: { type: Number, default: 0 },
  unread_customer: { type: Number, default: 0 }
}, {
  collection: 'ChatConversations',
  timestamps: { createdAt: 'created_at', updatedAt: 'updatedAt' }
});

chatConversationSchema.index({ ai_session_id: 1 }, { unique: true, partialFilterExpression: { ai_session_id: { $type: 'string' } } });

module.exports = mongoose.model('ChatConversation', chatConversationSchema);
