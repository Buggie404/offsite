const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const AiChatSession = require('../models/AiChatSession');
const User = require('../models/User');
const { newConversationId } = require('./chat.service');

async function customerIdFor(session) {
  if (!session.user_id) return `guest:${session.session_id}`;
  const id = String(session.user_id);
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return id;
  const user = await User.findById(id, 'user_id').lean();
  if (!user) throw new Error('Handover customer not found');
  return user.user_id;
}

// Repeated requests update the same conversation and copy each source message once.
async function handoverAiSession(session) {
  const customerId = await customerIdFor(session);
  let conversation;
  for (let attempt = 0; attempt < 2; attempt++) {
    const transaction = await ChatConversation.db.startSession();
    try {
      await transaction.withTransaction(async () => {
        conversation = await ChatConversation.findOne({ ai_session_id: session.session_id }).session(transaction);
        if (!conversation) {
          [conversation] = await ChatConversation.create([{
            conversation_id: newConversationId(), customer_id: customerId,
            ai_session_id: session.session_id, status: 'waiting'
          }], { session: transaction });
        }
        if (['closed', 'bot'].includes(conversation.status)) {
          conversation.status = 'waiting';
          conversation.agent_id = null;
        }
        conversation.summary = session.summary || '';
        conversation.handoff_summary = conversation.summary;
        conversation.handover_reason = session.handover_reason || 'user_request';
        conversation.dify_conversation_id = session.dify_conversation_id || null;
        const transcript = (session.messages || []).map((message, index) => ({
          conversation_id: conversation.conversation_id,
          source_session_id: session.session_id,
          source_message_id: message.message_id || `${session.session_id}:${index}`,
          sender_type: ({ user: 'customer', ai: 'bot', agent: 'agent', system: 'system' })[message.sender],
          sender_id: message.sender === 'user' ? customerId : message.agent_id || null,
          content: message.text || '', metadata: message.metadata || null,
          created_at: message.created_at || session.created_at || new Date()
        })).filter(message => message.sender_type && (message.content || message.metadata));
        if (transcript.length) {
          const copied = await ChatMessage.bulkWrite(transcript.map(message => ({ updateOne: {
            filter: { source_session_id: message.source_session_id, source_message_id: message.source_message_id },
            update: { $setOnInsert: message }, upsert: true
          } })), { session: transaction });
          if (copied.upsertedCount) conversation.unread_agent += 1;
          const last = transcript[transcript.length - 1];
          conversation.last_message_preview = last.content.slice(0, 120);
          conversation.last_message_at = last.created_at;
        }
        await conversation.save({ session: transaction });
        await AiChatSession.updateOne({ session_id: session.session_id }, { $set: {
          support_conversation_id: conversation.conversation_id,
          status: conversation.status === 'open' ? 'in_progress' : 'waiting', retain_for_support: true
        } }, { session: transaction });
      });
      break;
    } catch (error) {
      if (error.code !== 11000 || attempt === 1) throw error;
    } finally { await transaction.endSession(); }
  }
  session.support_conversation_id = conversation.conversation_id;
  session.status = conversation.status === 'open' ? 'in_progress' : 'waiting';
  require('./socket.service').emitChatEvent('chat_handoff', conversation.toObject());
  return conversation;
}

module.exports = { handoverAiSession };
