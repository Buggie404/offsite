const crypto = require('crypto');

const IDLE_MS = 30 * 60 * 1000;
const ROTATE_MS = 24 * 60 * 60 * 1000;
const MESSAGE_LIMIT = 40;
const PREVIEW_LENGTH = 80;
const HISTORY_LIMIT_MAX = 50;

const ROTATE_NOTICE = 'Started a new chat so the next answer is not based on the previous order.';
const CLAIM_NOTICE = "You're signed in. The next reply will use this account's orders.";
const CLOSE_REASONS = new Set(['new_chat', 'idle', 'rotate']);

function countableMessages(messages) {
  return (messages || []).filter(message => message && (message.sender === 'user' || message.sender === 'ai')).length;
}

function shouldRotate(session, now = Date.now()) {
  if (!session) return false;
  if (session.support_conversation_id && ['waiting', 'in_progress'].includes(session.status)) return false;
  if (countableMessages(session.messages) >= MESSAGE_LIMIT) return true;
  if (!session.created_at) return false;
  const created = new Date(session.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return now - created >= ROTATE_MS;
}

function isIdle(session, now = Date.now()) {
  if (session?.support_conversation_id && ['waiting', 'in_progress'].includes(session.status)) return false;
  if (!session || session.status === 'closed' || shouldRotate(session, now)) return false;
  const last = session.last_activity_at || session.created_at;
  if (!last) return false;
  const at = new Date(last).getTime();
  if (Number.isNaN(at)) return false;
  return now - at >= IDLE_MS;
}

function decisionFor(session, now = Date.now()) {
  if (!session) return 'continue';
  if (session.status === 'closed') return 'closed';
  if (shouldRotate(session, now)) return 'rotate';
  if (isIdle(session, now)) return 'idle';
  return 'continue';
}

function ownsSession(session, userId) {
  if (!session) return false;
  const owner = session.user_id == null || session.user_id === '' ? null : String(session.user_id);
  if (userId) return owner === String(userId);
  return owner == null;
}

function normalizeCloseReason(reason) {
  const value = String(reason || '').trim();
  return CLOSE_REASONS.has(value) ? value : 'new_chat';
}

function previewText(messages) {
  const list = messages || [];
  const firstUser = list.find(message => message && message.sender === 'user' && String(message.text || '').trim());
  const source = firstUser || list.find(message => message && String(message.text || '').trim());
  const text = String(source?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Chat';
  if (text.length <= PREVIEW_LENGTH) return text;
  return `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function publicMessage(message, index, sessionId) {
  return {
    message_id: message.message_id || `${sessionId}:${index}`,
    sender: message.sender,
    text: message.text || '',
    created_at: message.created_at || null,
    metadata: message.metadata || null
  };
}

function publicMessages(session) {
  return (session.messages || []).map((message, index) => publicMessage(message, index, session.session_id));
}

function historyLimit(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 20;
  return Math.min(HISTORY_LIMIT_MAX, parsed);
}

function newSessionId() {
  return crypto.randomUUID();
}

module.exports = {
  IDLE_MS,
  ROTATE_MS,
  MESSAGE_LIMIT,
  ROTATE_NOTICE,
  CLAIM_NOTICE,
  countableMessages,
  shouldRotate,
  isIdle,
  decisionFor,
  ownsSession,
  normalizeCloseReason,
  previewText,
  publicMessage,
  publicMessages,
  historyLimit,
  newSessionId
};
