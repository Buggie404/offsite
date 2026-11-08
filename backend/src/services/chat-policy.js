const MAX_AGENT_CHATS = 5;
const REOPEN_MS = 3 * 60 * 60 * 1000;
const IDLE_CLOSE_MS = REOPEN_MS;
function supportOpen(now = new Date()) {
  const hour = (now.getUTCHours() + 7) % 24;
  return hour >= 8 && hour < 22;
}
function warningFor(chat, now = Date.now()) {
  if (!['waiting', 'open'].includes(chat.status)) return null;
  const customerAt = chat.last_customer_message_at;
  const agentAt = chat.last_agent_message_at;
  if (customerAt && (!agentAt || new Date(customerAt) > new Date(agentAt))) {
    const minutes = (now - new Date(customerAt).getTime()) / 60000;
    return minutes >= 15 ? 'overdue' : minutes >= 5 ? 'waiting_reply' : null;
  }
  if (agentAt && (!customerAt || new Date(agentAt) >= new Date(customerAt))) {
    const minutes = (now - new Date(agentAt).getTime()) / 60000;
    return minutes >= 15 ? 'overdue' : minutes >= 5 ? 'waiting_reply' : null;
  }
  if (chat.status === 'waiting') {
    const minutes = (now - new Date(chat.waiting_since || chat.created_at).getTime()) / 60000;
    return minutes >= 15 ? 'overdue' : minutes >= 5 ? 'waiting_reply' : null;
  }
  return null;
}
function canReopen(chat, now = Date.now()) {
  const closedAt = new Date(chat.closed_at).getTime();
  return chat.status === 'closed' && chat.close_reason === 'resolved' && Number.isFinite(closedAt) && now >= closedAt && now - closedAt < REOPEN_MS;
}
module.exports = { MAX_AGENT_CHATS, REOPEN_MS, IDLE_CLOSE_MS, supportOpen, warningFor, canReopen };
