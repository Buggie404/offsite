const AiChatSession = require('../models/AiChatSession');
const {
  CLAIM_NOTICE,
  ROTATE_NOTICE,
  decisionFor,
  historyLimit,
  newSessionId,
  normalizeCloseReason,
  ownsSession,
  previewText,
  publicMessages,
  shouldRotate
} = require('./ai-chat-session.policy');

function notFound() {
  return { http: 404, body: { success: false, status: 'not_found', message: 'Chat not found.' } };
}

function closedBody() {
  return { http: 409, body: { success: false, status: 'closed', message: 'This chat is closed.' } };
}

function blankSession({ sessionId, userId, clientIp }) {
  return new AiChatSession({
    session_id: sessionId || newSessionId(),
    user_id: userId || null,
    ip: clientIp || null,
    is_guest: !userId,
    retain_for_support: false,
    messages: []
  });
}

function appendMessage(session, { sender, text, metadata = null, agent_id = null }) {
  const message = {
    message_id: newSessionId(),
    sender,
    text: text == null ? '' : String(text),
    created_at: new Date(),
    agent_id,
    metadata
  };
  session.messages.push(message);
  return message;
}

async function loadSession(sessionId) {
  if (!sessionId) return null;
  return AiChatSession.findOne({ session_id: sessionId });
}

async function prepareSession({ sessionId, userId, clientIp, holdIdle }) {
  if (!sessionId) {
    return { session: blankSession({ sessionId: null, userId, clientIp }) };
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return { session: blankSession({ sessionId, userId, clientIp }) };
  }

  if (!ownsSession(session, userId) || session.deleted_at) return notFound();
  if (session.status === 'closed') return closedBody();

  const decision = decisionFor(session);
  if (decision === 'rotate' || (holdIdle && decision === 'idle')) {
    return { hold: true, decision, session };
  }

  return { session, decision };
}

async function closeOwned({ sessionId, userId, closeReason }) {
  if (!sessionId) return { closed: false, session: null };
  const session = await loadSession(sessionId);
  if (!session) return { closed: false, session: null };
  if (!ownsSession(session, userId)) return notFound();
  if (session.deleted_at || session.status === 'closed') return { closed: false, session };

  const hasMessages = Array.isArray(session.messages) && session.messages.length > 0;
  if (!hasMessages) return { closed: false, session };

  session.status = 'closed';
  session.closed_at = new Date();
  session.close_reason = normalizeCloseReason(closeReason);
  await session.save();
  return { closed: true, session };
}

async function openFreshSession({ userId, clientIp, withRotateNotice, rotatable }) {
  const sessionId = newSessionId();
  if (!withRotateNotice || !rotatable) {
    return { session_id: sessionId, messages: [] };
  }

  const session = await AiChatSession.create({
    session_id: sessionId,
    user_id: userId || null,
    ip: clientIp || null,
    is_guest: !userId,
    retain_for_support: false,
    messages: [{
      message_id: newSessionId(),
      sender: 'system',
      text: ROTATE_NOTICE,
      created_at: new Date(),
      metadata: { kind: 'status' }
    }]
  });

  return { session_id: sessionId, messages: publicMessages(session) };
}

function presentSession(session) {
  return {
    success: true,
    session_id: session.session_id,
    status: session.status,
    decision: decisionFor(session),
    created_at: session.created_at,
    last_activity_at: session.last_activity_at,
    messages: publicMessages(session)
  };
}

async function readSession({ sessionId, userId }) {
  const session = await loadSession(sessionId);
  if (!session || !ownsSession(session, userId) || session.deleted_at) return notFound();
  return { body: presentSession(session) };
}

async function resumeSession({ sessionId, userId }) {
  const session = await loadSession(sessionId);
  if (!session || !ownsSession(session, userId) || session.deleted_at) return notFound();
  if (session.status === 'closed') return closedBody();
  if (shouldRotate(session)) return { body: { success: true, decision: 'rotate' } };

  session.last_activity_at = new Date();
  await session.save();
  return {
    body: {
      success: true,
      decision: 'continue',
      last_activity_at: session.last_activity_at
    }
  };
}

async function claimSession({ sessionId, userId }) {
  if (!userId) {
    return { http: 401, body: { success: false, message: 'Sign in to keep this chat.' } };
  }
  if (!sessionId) return { body: { success: true, claimed: false } };

  const session = await loadSession(sessionId);
  if (!session || session.deleted_at) return { body: { success: true, claimed: false } };
  if (session.user_id && String(session.user_id) === String(userId)) {
    return { body: { success: true, claimed: false } };
  }
  if (session.user_id) return notFound();
  if (session.status === 'closed') return closedBody();

  session.user_id = String(userId);
  session.is_guest = false;
  session.dify_conversation_id = null;
  appendMessage(session, {
    sender: 'system',
    text: CLAIM_NOTICE,
    metadata: { kind: 'status' }
  });
  session.last_activity_at = new Date();
  await session.save();
  return { body: { success: true, claimed: true } };
}

async function listSessions({ userId, limit, cursor }) {
  if (!userId) {
    return { http: 401, body: { success: false, message: 'Sign in to see chat history.' } };
  }

  const pageSize = historyLimit(limit);
  const match = {
    user_id: String(userId),
    deleted_at: null,
    'messages.0': { $exists: true }
  };
  if (cursor) {
    const date = new Date(cursor);
    if (!Number.isNaN(date.getTime())) match.last_activity_at = { $lt: date };
  }

  const rows = await AiChatSession.aggregate([
    { $match: match },
    { $sort: { last_activity_at: -1, _id: -1 } },
    { $limit: pageSize + 1 },
    {
      $project: {
        session_id: 1,
        status: 1,
        last_activity_at: 1,
        created_at: 1,
        countable: {
          $size: {
            $filter: {
              input: { $ifNull: ['$messages', []] },
              as: 'message',
              cond: { $in: ['$$message.sender', ['user', 'ai']] }
            }
          }
        },
        preview_text: {
          $let: {
            vars: {
              firstUser: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: { $ifNull: ['$messages', []] },
                      as: 'message',
                      cond: { $eq: ['$$message.sender', 'user'] }
                    }
                  },
                  0
                ]
              }
            },
            in: { $ifNull: ['$$firstUser.text', ''] }
          }
        },
        first_text: { $ifNull: [{ $arrayElemAt: ['$messages.text', 0] }, ''] }
      }
    }
  ]);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    body: {
      success: true,
      sessions: page.map(row => ({
        session_id: row.session_id,
        preview: previewText([
          { sender: 'user', text: row.preview_text },
          { sender: 'system', text: row.preview_text ? '' : row.first_text }
        ]),
        last_activity_at: row.last_activity_at,
        created_at: row.created_at,
        status: row.status,
        decision: decisionFor({
          status: row.status,
          created_at: row.created_at,
          last_activity_at: row.last_activity_at,
          messages: Array.from({ length: row.countable || 0 }, () => ({ sender: 'user' }))
        })
      })),
      next_cursor: hasMore && page.length ? page[page.length - 1].last_activity_at : null
    }
  };
}

async function deleteSession({ sessionId, userId }) {
  const session = await loadSession(sessionId);
  if (!session || !ownsSession(session, userId)) return notFound();
  if (session.deleted_at) return { body: { success: true, deleted: 'soft' } };

  const guest = !session.user_id;
  if (guest && !session.retain_for_support) {
    await session.deleteOne();
    return { body: { success: true, deleted: 'hard' } };
  }

  session.deleted_at = new Date();
  await session.save();
  return { body: { success: true, deleted: 'soft' } };
}

function sanitizeOrderCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
  const items = Array.isArray(card.items)
    ? card.items.slice(0, 30).map(item => ({
      name: String(item?.name || '').slice(0, 200),
      quantity: Number(item?.quantity) || 1
    })).filter(item => item.name)
    : [];

  return {
    code: String(card.code || '').slice(0, 40),
    orderId: String(card.orderId || card.order_id || '').replace(/^#/, '').slice(0, 40),
    contact: card.contact ? String(card.contact).slice(0, 120) : undefined,
    status: String(card.status || card.order_status || '').slice(0, 40),
    progressPercent: Number(card.progressPercent) || 0,
    expectedDate: String(card.expectedDate || '').slice(0, 80),
    city: String(card.city || '').slice(0, 80),
    items,
    total: Number(card.total ?? card.total_amount) || 0,
    currency: String(card.currency || 'USD').slice(0, 8)
  };
}

async function saveOrderCard({ sessionId, messageId, userId, orderCard, text }) {
  const session = await loadSession(sessionId);
  if (!session || !ownsSession(session, userId) || session.deleted_at) return notFound();
  if (session.status === 'closed') return closedBody();

  const index = (session.messages || []).findIndex((message, messageIndex) => (
    message.message_id === messageId || `${session.session_id}:${messageIndex}` === messageId
  ));
  if (index < 0) return notFound();

  const message = session.messages[index];
  if (!message || message.sender !== 'ai') return notFound();

  const card = sanitizeOrderCard(orderCard);
  if (!card || !card.orderId) {
    return { http: 400, body: { success: false, message: 'Order card is required.' } };
  }

  const nextText = typeof text === 'string' && text.trim()
    ? text.trim().slice(0, 500)
    : (message.text || 'Here is that order:');
  message.text = nextText;
  message.metadata = {
    ...(message.metadata || {}),
    showOrderForm: false,
    orderCard: card
  };
  session.markModified('messages');
  session.last_activity_at = new Date();
  await session.save();
  return { body: { success: true } };
}

async function syncSessionIndexes() {
  await AiChatSession.syncIndexes();
  const result = await AiChatSession.updateMany(
    { is_guest: true, retain_for_support: { $exists: false } },
    { $set: { retain_for_support: false } }
  );
  if (result.modifiedCount) {
    console.log(`Marked ${result.modifiedCount} guest chats for the 30-day retention filter.`);
  }
}

module.exports = {
  appendMessage,
  blankSession,
  claimSession,
  closeOwned,
  deleteSession,
  listSessions,
  openFreshSession,
  prepareSession,
  presentSession,
  readSession,
  resumeSession,
  saveOrderCard,
  syncSessionIndexes
};
