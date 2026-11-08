const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');
const AiChatSession = require('../models/AiChatSession');
const { MAX_AGENT_CHATS, supportOpen } = require('./chat-policy');

function fail(status, message) { throw Object.assign(new Error(message), { status }); }

async function assignConversation({ conversationId, targetId, actorIds, actorRole, note = '', transfer = false }) {
  if (!supportOpen()) fail(409, 'Support is available 08:00–22:00 (Vietnam time).');
  const transaction = await ChatConversation.db.startSession();
  let result;
  try {
    await transaction.withTransaction(async () => {
      const staff = await User.findOne({ user_id: targetId, role: { $in: ['cskh', 'admin_cc'] }, status: 'active' }).session(transaction).lean();
      if (!staff) fail(404, 'Support agent not found or unavailable');
      // Serialize assignments to the same staff account across claim and transfer.
      await User.updateOne({ _id: staff._id }, { $inc: { chat_assignment_version: 1 } }, { session: transaction });
      const chat = await ChatConversation.findOne({ conversation_id: conversationId }).session(transaction);
      if (!chat || !['waiting', 'open'].includes(chat.status)) fail(409, 'Chat is closed or unavailable');
      if (transfer) {
        if (chat.status !== 'open' || (actorRole !== 'admin_cc' && !actorIds.includes(chat.agent_id))) fail(403, 'Only the assigned agent can transfer this chat');
        if ([staff.user_id, String(staff._id)].includes(chat.agent_id)) fail(409, 'Chat is already assigned to this agent');
      } else if (chat.agent_id && !actorIds.includes(chat.agent_id)) fail(409, 'Already claimed by another agent');
      const owned = [staff.user_id, String(staff._id)];
      const count = await ChatConversation.countDocuments({ status: 'open', agent_id: { $in: owned }, conversation_id: { $ne: conversationId } }).session(transaction);
      if (staff.role === 'cskh' && count >= MAX_AGENT_CHATS) fail(409, 'This agent already has 5 active conversations');
      const set = { agent_id: staff.user_id, status: 'open', claimed_at: new Date(), last_message_at: new Date() };
      const update = { $set: set };
      if (transfer) update.$push = { transfers: { $each: [{ from_agent_id: chat.agent_id, to_agent_id: staff.user_id, note, at: new Date() }], $slice: -100 } };
      result = await ChatConversation.findOneAndUpdate({ conversation_id: conversationId, status: chat.status, agent_id: chat.agent_id || null }, update, { new: true, session: transaction });
      if (!result) fail(409, 'Chat assignment changed. Please reload.');
      if (result.ai_session_id) await AiChatSession.updateOne({ session_id: result.ai_session_id }, { $set: { status: 'in_progress', assigned_admin_id: staff.user_id } }, { session: transaction });
    });
    return result;
  } finally { await transaction.endSession(); }
}
module.exports = { assignConversation };
