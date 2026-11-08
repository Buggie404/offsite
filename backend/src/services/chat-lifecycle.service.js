const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');
const AiChatSession = require('../models/AiChatSession');
const { canReopen, supportOpen, MAX_AGENT_CHATS, IDLE_CLOSE_MS, REOPEN_MS } = require('./chat-policy');

async function closeResolvedChat(chat, { outcome = 'resolved', summary = '', actorId = null, actorName = null, actorRole = null } = {}) {
  if (!['resolved', 'forwarded', 'no_response', 'spam'].includes(outcome) || typeof summary !== 'string' || summary.length > 1000) throw Object.assign(new Error('Select a valid outcome and keep the summary within 1000 characters.'), { status: 400 });
  if (!['waiting', 'open'].includes(chat.status)) throw Object.assign(new Error('Conversation is already closed'), { status: 409 });
  const transaction = await ChatConversation.db.startSession();
  let closed;
  try {
    await transaction.withTransaction(async () => {
      const now = new Date();
      closed = await ChatConversation.findOneAndUpdate({ conversation_id: chat.conversation_id, status: chat.status, agent_id: chat.agent_id }, { $set: { status: 'closed', closed_at: now, close_reason: 'resolved', close_outcome: outcome, closed_by_name: actorName } }, { new: true, session: transaction });
      if (!closed) throw Object.assign(new Error('Chat changed. Please reload.'), { status: 409 });
      if (summary.trim() && actorId && actorRole && !chat.customer_id.startsWith('guest:')) await require('../models/CustomerNote').create([{
        customer_id: chat.customer_id, author_id: actorId, author_name: actorName, author_role: actorRole,
        content: summary.trim()
      }], { session: transaction });
      if (closed.ai_session_id) await AiChatSession.updateOne({ session_id: closed.ai_session_id }, { $set: { status: 'ai_active', assigned_admin_id: null, support_reopen_until: new Date(now.getTime() + REOPEN_MS) } }, { session: transaction });
    });
    return closed;
  } finally { await transaction.endSession(); }
}

async function reopenForCustomer(chat, customerId) {
  if (!chat || chat.customer_id !== customerId || !canReopen(chat) || !supportOpen()) return null;
  const transaction = await ChatConversation.db.startSession();
  let reopened = null;
  try {
    await transaction.withTransaction(async () => {
      reopened = null;
      const current = await ChatConversation.findOne({ conversation_id: chat.conversation_id, status: 'closed' }).session(transaction);
      if (!current || !canReopen(current)) return;
      const id = String(current.agent_id || '');
      const staff = id ? await User.findOne({ $or: [{ user_id: id }, ...(/^[a-f0-9]{24}$/i.test(id) ? [{ _id: id }] : [])], role: { $in: ['cskh', 'admin_cc'] }, status: 'active' }).session(transaction).lean() : null;
      let agentId = null;
      if (staff) {
        await User.updateOne({ _id: staff._id }, { $inc: { chat_assignment_version: 1 } }, { session: transaction });
        const count = await ChatConversation.countDocuments({ status: 'open', agent_id: { $in: [staff.user_id, String(staff._id)] } }).session(transaction);
        if (staff.role === 'admin_cc' || count < MAX_AGENT_CHATS) agentId = staff.user_id;
      }
      reopened = await ChatConversation.findOneAndUpdate({ conversation_id: current.conversation_id, status: 'closed' }, { $set: {
        status: agentId ? 'open' : 'waiting', agent_id: agentId, closed_at: null, close_reason: null, close_outcome: null, closed_by_name: null,
        waiting_since: new Date(), last_message_at: new Date()
      } }, { new: true, session: transaction });
      if (reopened?.ai_session_id) await AiChatSession.updateOne({ session_id: reopened.ai_session_id }, { $set: { status: agentId ? 'in_progress' : 'waiting', assigned_admin_id: agentId } }, { session: transaction });
    });
  } finally { await transaction.endSession(); }
  if (reopened) require('./socket.service').emitChatEvent('chat_updated', reopened.toObject());
  return reopened;
}

async function closeIdleChats(now = new Date()) {
  const cutoff = new Date(now.getTime() - IDLE_CLOSE_MS);
  // Keep unclaimed/offline leave-message requests in the queue until staff take them.
  const chats = await ChatConversation.find({ status: 'open', last_message_at: { $lte: cutoff } }).limit(200).lean();
  for (const chat of chats) {
    const transaction = await ChatConversation.db.startSession();
    let closed;
    try {
      await transaction.withTransaction(async () => {
        closed = await ChatConversation.findOneAndUpdate({ conversation_id: chat.conversation_id, status: chat.status, last_message_at: { $lte: cutoff } }, { $set: { status: 'closed', closed_at: now, close_reason: 'idle' } }, { new: true, session: transaction });
        if (closed?.ai_session_id) await AiChatSession.updateOne({ session_id: closed.ai_session_id }, { $set: { status: 'ai_active', assigned_admin_id: null } }, { session: transaction });
      });
    } finally { await transaction.endSession(); }
    if (closed) require('./socket.service').emitChatEvent('chat_updated', closed.toObject());
  }
}
function startChatLifecycleJob() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await closeIdleChats(); }
    catch (error) { console.error('Chat idle expiry failed:', error.message); }
    finally { running = false; }
  };
  run();
  const timer = setInterval(run, 60000); timer.unref(); return timer;
}
module.exports = { reopenForCustomer, closeIdleChats, startChatLifecycleJob, closeResolvedChat };
