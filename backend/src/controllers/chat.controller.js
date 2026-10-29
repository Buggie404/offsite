const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const { newConversationId, canAccessConversation, appendMessage } = require('../services/chat.service');
const { emitChatEvent } = require('../services/socket.service');

// POST /api/chat/handoff  (called by the Dify chatbot / Bao Nguyen's service)
// Header: x-chat-secret = CHAT_HANDOFF_SECRET. Body: { customer_id, dify_conversation_id?, summary?, transcript?: [{role, content}] }
async function handoffFromBot(req, res) {
  try {
    const secret = process.env.CHAT_HANDOFF_SECRET;
    if (!secret || req.headers['x-chat-secret'] !== secret) {
      return res.status(401).json({ error: 'Invalid handoff secret' });
    }
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
    res.json({ data: conversation || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load conversation' });
  }
}

// POST /api/chat/start  -> customer opens a conversation without the bot
async function startConversation(req, res) {
  try {
    let conversation = await ChatConversation.findOne({ customer_id: req.user.user_id, status: { $ne: 'closed' } });
    if (!conversation) {
      conversation = await ChatConversation.create({
        conversation_id: newConversationId(), customer_id: req.user.user_id, status: 'waiting'
      });
      emitChatEvent('chat_handoff', conversation.toObject());
    }
    res.status(201).json({ data: conversation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start conversation' });
  }
}

// GET /api/chat/conversations  (cskh: assigned customers only; admin_cc: all)
async function listConversations(req, res) {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.user.role === 'cskh') {
      const agent = await User.findOne({ user_id: req.user.user_id }, 'assigned_chat_customer_ids').lean();
      query.customer_id = { $in: agent?.assigned_chat_customer_ids || [] };
    }
    const data = await ChatConversation.find(query).sort({ last_message_at: -1 }).limit(100).lean();
    const users = await User.find({ user_id: { $in: data.map(c => c.customer_id) } }, 'user_id profile_name avatar_url membership_tier').lean();
    const byId = new Map(users.map(u => [u.user_id, u]));
    res.json({ data: data.map(c => ({ ...c, customer: byId.get(c.customer_id) || null })) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list conversations' });
  }
}

// GET /api/chat/conversations/:id/messages
async function getMessages(req, res) {
  try {
    const conversation = await ChatConversation.findOne({ conversation_id: req.params.id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (!(await canAccessConversation(req.user, conversation))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const messages = await ChatMessage.find({ conversation_id: conversation.conversation_id }).sort({ created_at: 1 }).limit(500).lean();
    const isCustomer = conversation.customer_id === req.user.user_id;
    await ChatConversation.updateOne({ conversation_id: conversation.conversation_id },
      { $set: isCustomer ? { unread_customer: 0 } : { unread_agent: 0 } });
    res.json({ data: messages });
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
    if (conversation.agent_id && conversation.agent_id !== req.user.user_id) {
      return res.status(409).json({ error: 'Already claimed by another agent' });
    }
    conversation.agent_id = req.user.user_id;
    conversation.status = 'open';
    await conversation.save();
    if (conversation.ai_session_id) await require('../models/AiChatSession').updateOne({ session_id: conversation.ai_session_id }, {
      $set: { status: 'in_progress', assigned_admin_id: req.user.user_id }
    });
    const sys = await appendMessage(conversation, { sender_type: 'system', content: 'Một nhân viên CSKH đã tham gia cuộc trò chuyện.' });
    emitChatEvent('chat_updated', conversation.toObject());
    if (sys) emitChatEvent('chat_message', sys.toObject(), conversation);
    res.json({ data: conversation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to claim conversation' });
  }
}

// PATCH /api/chat/conversations/:id/close
async function closeConversation(req, res) {
  try {
    const conversation = await ChatConversation.findOne({ conversation_id: req.params.id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (!(await canAccessConversation(req.user, conversation))) return res.status(403).json({ error: 'Access denied' });
    conversation.status = 'closed';
    await conversation.save();
    if (conversation.ai_session_id) {
      await require('../models/AiChatSession').updateOne({ session_id: conversation.ai_session_id }, {
        $set: { status: 'ai_active', assigned_admin_id: null }
      });
      const message = await appendMessage(conversation, { sender_type: 'system', content: 'The support conversation has ended. You can continue with the AI Concierge.' });
      if (message) emitChatEvent('chat_message', message.toObject(), conversation);
    }
    emitChatEvent('chat_updated', conversation.toObject());
    res.json({ data: conversation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close conversation' });
  }
}

module.exports = { handoffFromBot, getMyConversation, startConversation, listConversations, getMessages, claimConversation, closeConversation };
