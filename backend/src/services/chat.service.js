const crypto = require('crypto');
const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');

const AGENT_ROLES = ['cskh', 'admin_cc'];

function newConversationId() {
  return `CHAT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

async function resolveChatUserId(id) {
  const value = String(id || '');
  if (!/^[0-9a-fA-F]{24}$/.test(value)) return value;
  const user = await User.findById(value, 'user_id').lean();
  return user?.user_id || value;
}

// customer owns it; admin_cc sees all; cskh only assigned customers (read fresh from DB, not the JWT).
async function canAccessConversation(authUser, conversation) {
  if (!authUser || !conversation) return false;
  const userId = await resolveChatUserId(authUser.user_id);
  if (conversation.customer_id === userId) return true;
  if (authUser.role === 'admin_cc') return true;
  if (authUser.role === 'cskh') {
    const agent = await User.findOne({ user_id: userId }, 'assigned_chat_customer_ids').lean();
    return (agent?.assigned_chat_customer_ids || []).includes(conversation.customer_id);
  }
  return false;
}

async function appendMessage(conversation, { sender_type, sender_id = null, content }) {
  const text = String(content || '').trim().slice(0, 4000);
  if (!text) return null;
  let message;
  const sourceMessageId = conversation.ai_session_id ? `support:${crypto.randomUUID()}` : null;
  const session = await ChatConversation.db.startSession();
  const inc = sender_type === 'customer' ? { unread_agent: 1 }
    : sender_type === 'agent' ? { unread_customer: 1 } : {};
  try {
    await session.withTransaction(async () => {
      [message] = await ChatMessage.create([{
        conversation_id: conversation.conversation_id, sender_type, sender_id, content: text,
        source_session_id: conversation.ai_session_id || null, source_message_id: sourceMessageId
      }], { session });
      await ChatConversation.updateOne(
        { conversation_id: conversation.conversation_id },
        { $set: { last_message_preview: text.slice(0, 120), last_message_at: message.created_at }, $inc: inc }, { session }
      );
      if (conversation.ai_session_id) {
        await require('../models/AiChatSession').updateOne({ session_id: conversation.ai_session_id }, {
          $push: { messages: {
            message_id: sourceMessageId, sender: ({ customer: 'user', agent: 'agent', bot: 'ai', system: 'system' })[sender_type],
            text, created_at: message.created_at, agent_id: sender_type === 'agent' ? sender_id : null
          } }, $set: { last_activity_at: message.created_at }
        }, { session });
      }
    });
  } finally { await session.endSession(); }
  return message;
}

module.exports = { AGENT_ROLES, newConversationId, canAccessConversation, appendMessage, resolveChatUserId };
