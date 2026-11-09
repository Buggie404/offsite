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

// Agents share the unclaimed queue; assigned conversations belong to their agent.
async function canAccessConversation(authUser, conversation) {
  if (!authUser || !conversation) return false;
  const userId = await resolveChatUserId(authUser.user_id);
  if (authUser.role === 'admin_cc') return true;
  if (authUser.role === 'customer') return conversation.customer_id === userId;
  if (AGENT_ROLES.includes(authUser.role)) {
    if (conversation.status === 'waiting' && !conversation.agent_id) return true;
    return [userId, String(authUser.user_id), authUser.mongo_user_id].filter(Boolean).includes(conversation.agent_id);
  }
  return false;
}

async function appendMessage(conversation, { sender_type, sender_id = null, content, metadata = {} }) {
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
        source_session_id: conversation.ai_session_id || null, source_message_id: sourceMessageId,
        metadata: { ...metadata, ...(sender_type === 'customer' ? { delivery_status: 'sent' } : {}) }
      }], { session });
      const updated = await ChatConversation.updateOne(
        { conversation_id: conversation.conversation_id,
          ...(sender_type === 'agent' ? { status: 'open', agent_id: conversation.agent_id } : sender_type === 'customer' ? { status: { $ne: 'closed' } } : {}) },
        { $set: { ...(sender_type !== 'system' ? { last_message_preview: text.slice(0, 120) } : {}), last_message_at: message.created_at,
          ...(sender_type === 'customer' ? { last_customer_message_at: message.created_at } : sender_type === 'agent' ? { last_agent_message_at: message.created_at } : {}) }, $inc: inc }, { session }
      );
      if (updated?.matchedCount === 0) throw Object.assign(new Error('Conversation changed. Please reload.'), { status: 409 });
      if (conversation.ai_session_id) {
        await require('../models/AiChatSession').updateOne({ session_id: conversation.ai_session_id }, {
          $push: { messages: {
            message_id: sourceMessageId, sender: ({ customer: 'user', agent: 'agent', bot: 'ai', system: 'system' })[sender_type],
            text, created_at: message.created_at, agent_id: sender_type === 'agent' ? sender_id : null,
            metadata: { ...metadata, ...(sender_type === 'customer' ? { delivery_status: 'sent' } : {}) }
          } }, $set: { last_activity_at: message.created_at }
        }, { session });
      }
    });
  } finally { await session.endSession(); }
  return message;
}

module.exports = { AGENT_ROLES, newConversationId, canAccessConversation, appendMessage, resolveChatUserId };
