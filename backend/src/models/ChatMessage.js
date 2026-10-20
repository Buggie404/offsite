const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  conversation_id: { type: String, required: true, index: true },
  sender_type: { type: String, enum: ['customer', 'agent', 'bot', 'system'], required: true },
  sender_id: { type: String, default: null },
  content: { type: String, required: true, maxlength: 4000 }
}, {
  collection: 'ChatMessages',
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

chatMessageSchema.index({ conversation_id: 1, created_at: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
