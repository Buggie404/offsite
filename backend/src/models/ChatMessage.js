const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  conversation_id: { type: String, required: true, index: true },
  sender_type: { type: String, enum: ['customer', 'agent', 'bot', 'system'], required: true },
  sender_id: { type: String, default: null },
  content: { type: String, required: true, maxlength: 4000 },
  source_session_id: { type: String, default: null },
  source_message_id: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null }
}, {
  collection: 'ChatMessages',
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

chatMessageSchema.index({ conversation_id: 1, created_at: 1 });
chatMessageSchema.index({ source_session_id: 1, source_message_id: 1 }, {
  unique: true, partialFilterExpression: { source_session_id: { $type: 'string' }, source_message_id: { $type: 'string' } }
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
