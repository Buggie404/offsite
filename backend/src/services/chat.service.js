const crypto = require('crypto');
const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');

const AGENT_ROLES = ['cskh', 'admin_cc'];

function newConversationId() {
  return `CHAT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

// customer owns it; admin_cc sees all; cskh only assigned customers (read fresh from DB, not the JWT).
async function canAccessConversation(authUser, conversation) {
  if (!authUser || !conversation) return false;
  if (conversation.customer_id === authUser.user_id) return true;
  if (authUser.role === 'admin_cc') return true;
  if (authUser.role === 'cskh') {
    const agent = await User.findOne({ user_id: authUser.user_id }, 'assigned_chat_customer_ids').lean();
    return (agent?.assigned_chat_customer_ids || []).includes(conversation.customer_id);
  }
  return false;
}

async function appendMessage(conversation, { sender_type, sender_id = null, content }) {
  const text = String(content || '').trim().slice(0, 4000);
  if (!text) return null;
  const message = await ChatMessage.create({
    conversation_id: conversation.conversation_id, sender_type, sender_id, content: text
  });
  const inc = sender_type === 'customer' ? { unread_agent: 1 }
    : sender_type === 'agent' ? { unread_customer: 1 } : {};
  await ChatConversation.updateOne(
    { conversation_id: conversation.conversation_id },
    { $set: { last_message_preview: text.slice(0, 120), last_message_at: new Date() }, $inc: inc }
  );
  return message;
}

module.exports = { AGENT_ROLES, newConversationId, canAccessConversation, appendMessage };
