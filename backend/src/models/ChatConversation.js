const mongoose = require('mongoose');

const chatConversationSchema = new mongoose.Schema({
  conversation_id: { type: String, required: true, unique: true },
  customer_id: { type: String, required: true, index: true },
  agent_id: { type: String, default: null },
  // bot: still with the Dify chatbot, waiting: handed off & unclaimed, open: agent is chatting, closed
  status: { type: String, enum: ['bot', 'waiting', 'open', 'closed'], default: 'waiting', index: true },
  dify_conversation_id: { type: String, default: null },
  handoff_summary: { type: String, default: '' },
  last_message_preview: { type: String, default: '' },
  last_message_at: { type: Date, default: Date.now },
  unread_agent: { type: Number, default: 0 },
  unread_customer: { type: Number, default: 0 }
}, {
  collection: 'ChatConversations',
  timestamps: { createdAt: 'created_at', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('ChatConversation', chatConversationSchema);
