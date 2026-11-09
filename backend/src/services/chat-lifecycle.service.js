const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');
const AiChatSession = require('../models/AiChatSession');
const { canReopen, supportOpen, IDLE_CLOSE_MS, REOPEN_MS } = require('./chat-policy');

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

// A follow-up is a new unassigned session; the closed conversation stays immutable.
async function reopenForCustomer(chat, customerId) {
  if (!chat || chat.customer_id !== customerId || !canReopen(chat) || !supportOpen()) return null;
  const transaction = await ChatConversation.db.startSession();
  let next = null;
  try {
    await transaction.withTransaction(async () => {
      const current = await ChatConversation.findOne({ conversation_id: chat.conversation_id, status: 'closed' }).session(transaction);
      if (!current || !canReopen(current)) return;
      next = await ChatConversation.findOne({ customer_id: customerId, status: { $in: ['waiting', 'open'] } }).session(transaction);
      if (next) return;
      const aiSessionId = current.ai_session_id;
      if (aiSessionId) {
        await ChatConversation.updateOne({ conversation_id: current.conversation_id, ai_session_id: aiSessionId }, { $set: { archived_ai_session_id: aiSessionId, ai_session_id: null } }, { session: transaction });
      }
      [next] = await ChatConversation.create([{
        conversation_id: require('./chat.service').newConversationId(), customer_id: customerId,
        status: 'waiting', agent_id: null, ai_session_id: aiSessionId || null
      }], { session: transaction });
      if (aiSessionId) await AiChatSession.updateOne({ session_id: aiSessionId }, { $set: {
        status: 'waiting', assigned_admin_id: null, support_conversation_id: next.conversation_id, support_reopen_until: null
      } }, { session: transaction });
    });
  } finally { await transaction.endSession(); }
  if (next) require('./socket.service').emitChatEvent('chat_handoff', next.toObject());
  return next;
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
