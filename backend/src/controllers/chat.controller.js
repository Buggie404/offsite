const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const { newConversationId, canAccessConversation, appendMessage, resolveChatUserId } = require('../services/chat.service');
const { emitChatEvent } = require('../services/socket.service');
const { assignConversation } = require('../services/chat-assignment.service');
const { supportOpen, warningFor } = require('../services/chat-policy');
const { SUPPORT_JOINED, englishSystemText } = require('../services/chat-system-messages');

// POST /api/chat/handoff  (called by the Dify chatbot / Bao Nguyen's service)
// Header: x-chat-secret = CHAT_HANDOFF_SECRET. Body: { customer_id, dify_conversation_id?, summary?, transcript?: [{role, content}] }
async function handoffFromBot(req, res) {
  try {
    const secret = process.env.CHAT_HANDOFF_SECRET;
    if (!secret || req.headers['x-chat-secret'] !== secret) {
      return res.status(401).json({ error: 'Invalid handoff secret' });
    }
    if (!supportOpen()) return res.status(409).json({ error: 'Support is available 08:00–22:00 (Vietnam time).' });
    const { customer_id, dify_conversation_id = null, summary = '', transcript = [] } = req.body || {};
    const customer = await User.findOne({ user_id: customer_id }, 'user_id').lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    let conversation = await ChatConversation.findOne({ customer_id, status: { $ne: 'closed' } });
    if (!conversation) {
      conversation = await ChatConversation.create({
        conversation_id: newConversationId(), customer_id, status: 'waiting',
        dify_conversation_id, handoff_summary: String(summary).slice(0, 1000)
      });
    }
    // Carry over the bot transcript so the agent sees the context.
    for (const turn of Array.isArray(transcript) ? transcript.slice(-30) : []) {
      await appendMessage(conversation, {
        sender_type: turn.role === 'user' ? 'customer' : 'bot', sender_id: null, content: turn.content
      });
    }
    await ChatConversation.updateOne({ conversation_id: conversation.conversation_id }, { $set: { unread_agent: 0 } });
    emitChatEvent('chat_handoff', conversation.toObject());
    res.status(201).json({ conversation_id: conversation.conversation_id });
  } catch (error) {
    console.error('Chat handoff error:', error);
    res.status(500).json({ error: 'Failed to hand off chat' });
  }
}

// GET /api/chat/me  -> customer's active conversation (or null)
async function getMyConversation(req, res) {
  try {
    const conversation = await ChatConversation.findOne({ customer_id: req.user.user_id, status: { $ne: 'closed' } }).lean();
    if (conversation) delete conversation.transfers;
    res.json({ data: conversation || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load conversation' });
  }
}

// POST /api/chat/start  -> customer opens a conversation without the bot
async function startConversation(req, res) {
  try {
    if (!supportOpen()) return res.status(409).json({ error: 'Support is available 08:00–22:00 (Vietnam time).' });
    let conversation = await ChatConversation.findOne({ customer_id: req.user.user_id, status: { $ne: 'closed' } });
    if (!conversation) {
      const previous = await ChatConversation.findOne({ customer_id: req.user.user_id, status: 'closed' }).sort({ closed_at: -1 });
      conversation = await require('../services/chat-lifecycle.service').reopenForCustomer(previous, req.user.user_id);
    }
    if (!conversation) {
      conversation = await ChatConversation.create({
        conversation_id: newConversationId(), customer_id: req.user.user_id, status: 'waiting'
      });
      emitChatEvent('chat_handoff', conversation.toObject());
    }
    const data = conversation.toObject(); delete data.transfers;
    res.status(201).json({ data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start conversation' });
  }
}

// GET /api/chat/conversations (agents: unclaimed queue and own conversations)
async function listConversations(req, res) {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.user.role === 'cskh') {
      const userId = await resolveChatUserId(req.user.user_id);
      query.$or = [
        { agent_id: { $in: [...new Set([userId, String(req.user.user_id), req.user.mongo_user_id].filter(Boolean))] } },
        { status: 'waiting', agent_id: null }
      ];
    }
    const data = await ChatConversation.find(query).sort({ last_message_at: -1 }).limit(100).lean();
    const customerIds = data.map(c => c.customer_id);
    const objectIds = customerIds.filter(id => /^[0-9a-fA-F]{24}$/.test(id));
    const users = await User.find({ $or: [
      { user_id: { $in: customerIds } }, { _id: { $in: objectIds } }
    ] }, 'user_id profile_name avatar_url membership_tier').lean();
    const byId = new Map(users.flatMap(u => [[u.user_id, u], [String(u._id), u]]));
    const staff = req.user.role === 'admin_cc'
      ? await User.find({ role: { $in: ['cskh', 'admin_cc'] } }, 'user_id profile_name').lean() : [];
    const agents = new Map(staff.flatMap(user => [[user.user_id, user], [String(user._id), user]]));
    res.json({ data: data.map(c => ({ ...c, closed_by_name: req.user.role === 'admin_cc' ? c.closed_by_name : null, ...(req.user.role === 'admin_cc' ? { agent_name: agents.get(c.agent_id)?.profile_name || c.agent_id || null, agent_user_id: agents.get(c.agent_id)?.user_id || c.agent_id || null } : {}), response_warning: warningFor(c), waiting_on: c.last_agent_message_at && (!c.last_customer_message_at || new Date(c.last_agent_message_at) >= new Date(c.last_customer_message_at)) ? 'customer' : 'agent', customer: byId.get(c.customer_id) || null })), support_open: supportOpen(), support_hours: '08:00–22:00 (Vietnam time)' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list conversations' });
  }
}

// GET /api/chat/conversations/:id/messages
async function getMessages(req, res) {
  try {
    let conversation = await ChatConversation.findOne({ conversation_id: req.params.id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (!(await canAccessConversation(req.user, conversation))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const messages = await ChatMessage.find({ conversation_id: conversation.conversation_id }).sort({ created_at: 1 }).limit(500).lean();
    const isCustomer = conversation.customer_id === req.user.user_id;
    await ChatConversation.updateOne({ conversation_id: conversation.conversation_id },
      { $set: isCustomer ? { unread_customer: 0 } : { unread_agent: 0 } });
    res.json({ data: messages.map(message => message.sender_type === 'system' ? { ...message, content: englishSystemText(message.content) } : message) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
}

// PATCH /api/chat/conversations/:id/claim  (agent takes a waiting chat)
async function claimConversation(req, res) {
  try {
    const conversation = await ChatConversation.findOne({ conversation_id: req.params.id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (!(await canAccessConversation(req.user, conversation))) return res.status(403).json({ error: 'Access denied' });
    const agentId = await resolveChatUserId(req.user.user_id);
    const agentIds = [agentId, String(req.user.user_id), req.user.mongo_user_id].filter(Boolean);
    if (conversation.agent_id && !agentIds.includes(conversation.agent_id)) {
      return res.status(409).json({ error: 'Already claimed by another agent' });
    }
    const claimed = await assignConversation({ conversationId: conversation.conversation_id, targetId: agentId, actorIds: agentIds, actorRole: req.user.role });
    Object.assign(conversation, claimed.toObject());
    const sys = await appendMessage(conversation, { sender_type: 'system', content: SUPPORT_JOINED });
    emitChatEvent('chat_updated', conversation.toObject());
    if (sys) emitChatEvent('chat_message', sys.toObject(), conversation);
    const data = conversation.toObject();
    if (!['cskh', 'admin_cc'].includes(req.user.role)) delete data.transfers;
    res.json({ data });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to claim conversation' });
  }
}

// PATCH /api/chat/conversations/:id/close
async function closeConversation(req, res) {
  try {
    const conversation = await ChatConversation.findOne({ conversation_id: req.params.id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (!(await canAccessConversation(req.user, conversation))) return res.status(403).json({ error: 'Access denied' });
    const actorId = await resolveChatUserId(req.user.user_id);
    if (req.user.role === 'cskh' && ![actorId, req.user.user_id, req.user.mongo_user_id].includes(conversation.agent_id)) return res.status(403).json({ error: 'Only the assigned agent can close this chat' });
    const isAgent = ['cskh', 'admin_cc'].includes(req.user.role);
    const actor = isAgent ? await User.findOne({ user_id: actorId }, 'profile_name').lean() : null;
    const options = isAgent ? { outcome: req.body?.outcome || 'resolved', summary: req.body?.summary || '', actorId, actorName: actor?.profile_name || actorId, actorRole: req.user.role } : {};
    const closed = await require('../services/chat-lifecycle.service').closeResolvedChat(conversation, options);
    Object.assign(conversation, closed.toObject());
    if (req.body?.send_closing_message !== false) {
      const message = await appendMessage(conversation, { sender_type: 'system', content: 'This chat is closed. Send another message during support hours to start a new request in the waiting queue, or choose Back to chatbot.' });
      if (message) emitChatEvent('chat_message', message.toObject(), conversation);
    }
    emitChatEvent('chat_updated', conversation.toObject());
    const data = conversation.toObject();
    if (!['cskh', 'admin_cc'].includes(req.user.role)) delete data.transfers;
    res.json({ data });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to close conversation' });
  }
}

async function receipt(req, res) {
  try {
    const conversation = await ChatConversation.findOne({ conversation_id: req.params.id });
    if (!conversation || !(await canAccessConversation(req.user, conversation))) return res.sendStatus(403);
    const status = req.body.status;
    if (!['delivered', 'seen'].includes(status)) return res.sendStatus(400);
    const through = new Date(req.body.through);
    if (!Number.isFinite(through.getTime())) return res.sendStatus(400);
    const messages = await ChatMessage.find({
      conversation_id: conversation.conversation_id, sender_type: 'customer', created_at: { $lte: through },
      'metadata.delivery_status': { $nin: status === 'seen' ? ['seen'] : ['seen', 'delivered'] }
    }).lean();
    if (messages.length) {
      await ChatMessage.updateMany({ _id: { $in: messages.map(m => m._id) }, 'metadata.delivery_status': { $ne: 'seen' } }, [
        { $set: { metadata: { $mergeObjects: ['$metadata', { delivery_status: status }] } } }
      ]);
      const ids = messages.map(m => m.source_message_id).filter(Boolean);
      if (conversation.ai_session_id && ids.length) {
        await require('../models/AiChatSession').updateOne({ session_id: conversation.ai_session_id }, [{
          $set: { messages: { $map: { input: '$messages', as: 'message', in: { $cond: [
            { $and: [{ $in: ['$$message.message_id', ids] }, { $ne: ['$$message.metadata.delivery_status', 'seen'] }] },
            { $mergeObjects: ['$$message', { metadata: { $mergeObjects: ['$$message.metadata', { delivery_status: status }] } }] },
            '$$message'
          ] } } } }
        }]);
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Chat receipt error:', error);
    res.status(500).json({ error: 'Could not update message receipt' });
  }
}

async function listAgents(req, res) {
  try {
    const staff = await User.find({ role: { $in: ['cskh', 'admin_cc'] }, status: 'active' }, 'user_id profile_name role').lean();
    const sockets = await require('../services/socket.service').getIO()?.in('chat_agents').fetchSockets() || [];
    const online = new Set(sockets.flatMap(socket => [socket.user?.chat_user_id, socket.user?.user_id].filter(Boolean).map(String)));
    const counts = await ChatConversation.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$agent_id', total: { $sum: 1 } } }]);
    const totals = new Map(counts.map(row => [row._id, row.total]));
    res.json({ data: staff.map(user => {
      const active_chats = (totals.get(user.user_id) || 0) + (totals.get(String(user._id)) || 0);
      const isOnline = online.has(user.user_id) || online.has(String(user._id));
      return { user_id: user.user_id, name: user.profile_name || user.user_id, online: isOnline, active_chats, available: isOnline && (user.role === 'admin_cc' || active_chats < 5) };
    }) });
  } catch (error) { res.status(500).json({ error: 'Could not load agents' }); }
}

async function transferConversation(req, res) {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note || note.length > 1000) return res.status(400).json({ error: 'A transfer note of 1–1000 characters is required' });
    const actorId = await resolveChatUserId(req.user.user_id);
    const io = require('../services/socket.service').getIO();
    const peers = await io?.in('chat_agents').fetchSockets() || [];
    const targetId = String(req.body?.agent_id || '');
    if (!peers.some(socket => [socket.user?.chat_user_id, socket.user?.user_id].includes(targetId))) return res.status(409).json({ error: 'This support agent is offline. Choose an online colleague.' });
    const conversation = await assignConversation({ conversationId: req.params.id, targetId: String(req.body?.agent_id || ''), actorIds: [actorId, req.user.user_id, req.user.mongo_user_id].filter(Boolean), actorRole: req.user.role, note, transfer: true });
    const target = await User.findOne({ user_id: conversation.agent_id }, 'profile_name').lean();
    const notice = await appendMessage(conversation, { sender_type: 'system', content: `You are being connected to ${target?.profile_name || 'another support agent'} from Offsite. Your conversation history stays with the chat.` });
    if (notice) emitChatEvent('chat_message', notice.toObject(), conversation);
    if (io) {
      const sockets = await io.in(`chat_${conversation.conversation_id}`).fetchSockets();
      for (const socket of sockets) if (!(await canAccessConversation(socket.user, conversation))) socket.leave(`chat_${conversation.conversation_id}`);
    }
    emitChatEvent('chat_updated', conversation.toObject());
    res.json({ data: conversation });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not transfer this conversation' }); }
}

async function shareOrder(req, res) {
  try {
    const conversation = await ChatConversation.findOne({ conversation_id: req.params.id });
    const actorId = await resolveChatUserId(req.user.user_id);
    if (!conversation || !(await canAccessConversation(req.user, conversation)) || (req.user.role !== 'admin_cc' && ![actorId, req.user.user_id, req.user.mongo_user_id].includes(conversation.agent_id))) return res.status(403).json({ error: 'Only the assigned agent can share orders in this chat.' });
    if (conversation.status !== 'open') return res.status(409).json({ error: 'Claim an open conversation before sharing an order.' });
    const order = await require('../models/Order').findOne({ order_id: String(req.body?.order_id || ''), user_id: conversation.customer_id }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found for this customer.' });
    const orderCard = { order_id: order.order_id, order_status: order.order_status, total_amount: order.pricing?.total || 0, currency: order.pricing?.currency || 'USD', image_url: order.items?.[0]?.image?.url || null, item_count: (order.items || []).reduce((total, item) => total + (item.quantity || 0), 0), items: (order.items || []).map(item => ({ name: item.product_name, quantity: item.quantity })) };
    const message = await appendMessage(conversation, { sender_type: 'agent', sender_id: actorId, content: `Order #${order.order_id}`, metadata: { orderCard } });
    if (message) emitChatEvent('chat_message', message.toObject(), conversation);
    res.status(201).json({ data: message?.toObject() || null });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not share this order.' }); }
}

module.exports = { handoffFromBot, getMyConversation, startConversation, listConversations, getMessages, claimConversation, closeConversation, receipt, listAgents, transferConversation, shareOrder };
