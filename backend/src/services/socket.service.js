// backend/src/services/socket.service.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, corsOptions, isAllowedOrigin } = require('../config/auth');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const ChatConversation = require('../models/ChatConversation');
const { AGENT_ROLES, canAccessConversation, appendMessage, resolveChatUserId } = require('./chat.service');
const {
  hasAdminRole,
  ADMIN_ORDER_UNSCOPED_ROLES,
  ADMIN_CROSS_USER_ROLES
} = require('../middleware/auth.middleware');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    // Same origins as the REST API (CLIENT_URL + localhost:4200 in dev).
    cors: corsOptions,
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin))
  });

  // Socket.IO Handshake Authentication Middleware (JWT Decode)
  io.use((socket, next) => {
    try {
      const authHeader = socket.handshake.headers.authorization;
      let token = socket.handshake.auth?.token;

      if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }

      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          socket.user = decoded; // { user_id, email, role }
        } catch (err) {
          console.warn('[Socket.IO Auth] Invalid or expired JWT token supplied during handshake:', err.message);
          socket.user = null;
        }
      } else {
        socket.user = null;
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    // 1. The global order room is only for roles with unscoped order access.
    socket.on('join_admin', () => {
      if (!hasAdminRole(socket.user, ADMIN_ORDER_UNSCOPED_ROLES)) {
        console.warn(`[Socket.IO Security Alert] Unauthorized join_admin attempt from socket ${socket.id}, user: ${socket.user?.user_id || 'unauthenticated'}`);
        socket.emit('error', { message: 'Unauthorized: Admin privileges required.' });
        return;
      }
      socket.join('admin');
      console.log(`[Socket.IO] Admin ${socket.user.user_id} joined 'admin' room.`);
    });

    // 2. Join User Room - Strictly requires socket.user.user_id === data.user_id (or role === 'admin')
    socket.on('join_user', (data) => {
      if (!data || !data.user_id) return;
      if (!socket.user) {
        console.warn(`[Socket.IO Security Alert] Unauthenticated join_user attempt for ${data.user_id} from socket ${socket.id}`);
        socket.emit('error', { message: 'Unauthorized: Authentication required.' });
        return;
      }

      const isAssignedChatCustomer = socket.user.role === 'cskh' &&
        (socket.user.assigned_chat_customer_ids || []).includes(data.user_id);
      if (
        socket.user.user_id !== data.user_id &&
        !hasAdminRole(socket.user, ADMIN_CROSS_USER_ROLES) &&
        !isAssignedChatCustomer
      ) {
        console.warn(`[Socket.IO Security Alert] User ${socket.user.user_id} attempted unauthorized join_user for ${data.user_id}`);
        socket.emit('error', { message: 'Unauthorized: Cannot join room of another user.' });
        return;
      }

      socket.join(`user_${data.user_id}`);
      console.log(`[Socket.IO] User ${socket.user.user_id} joined 'user_${data.user_id}' room.`);
    });


    // ── CSKH live chat ──
    // Agents join the shared queue room to hear about new handoffs.
    socket.on('join_chat_agents', () => {
      if (!socket.user || !AGENT_ROLES.includes(socket.user.role)) {
        socket.emit('error', { message: 'Unauthorized: CSKH privileges required.' });
        return;
      }
      socket.join('chat_agents');
    });

    socket.on('join_chat', async (data) => {
      try {
        const conversation = data?.conversation_id &&
          await ChatConversation.findOne({ conversation_id: data.conversation_id });
        if (!conversation || !(await canAccessConversation(socket.user, conversation))) {
          socket.emit('error', { message: 'Unauthorized access to chat.' });
          return;
        }
        socket.join(`chat_${conversation.conversation_id}`);
      } catch (err) {
        console.error('[Socket.IO] join_chat error:', err);
      }
    });

    socket.on('chat_message', async (data) => {
      try {
        const conversation = data?.conversation_id &&
          await ChatConversation.findOne({ conversation_id: data.conversation_id });
        if (!conversation || conversation.status === 'closed' ||
            !(await canAccessConversation(socket.user, conversation))) {
          socket.emit('error', { message: 'Cannot send to this chat.' });
          return;
        }
        const senderId = await resolveChatUserId(socket.user.user_id);
        const isCustomer = conversation.customer_id === senderId;
        const message = await appendMessage(conversation, {
          sender_type: isCustomer ? 'customer' : 'agent',
          sender_id: senderId,
          content: data.content
        });
        if (message) emitChatEvent('chat_message', message.toObject(), conversation);
      } catch (err) {
        console.error('[Socket.IO] chat_message error:', err);
      }
    });

    socket.on('chat_typing', (data) => {
      if (!data?.conversation_id || !socket.rooms.has(`chat_${data.conversation_id}`)) return;
      socket.to(`chat_${data.conversation_id}`).emit('chat_typing', {
        conversation_id: data.conversation_id, user_id: socket.user?.user_id, typing: !!data.typing
      });
    });

    // 3. Join Order Room - Requires user_id match OR guest session_id match OR role === 'admin'
    socket.on('join_order', async (data) => {
      if (!data || !data.order_id) return;
      const orderId = data.order_id;
      const sessionId = data.session_id;

      try {
        const queryConditions = [{ order_id: orderId }];
        if (mongoose.Types.ObjectId.isValid(orderId)) {
          queryConditions.push({ _id: orderId });
        }

        const order = await Order.findOne({ $or: queryConditions }).select('user_id session_id order_id').lean();

        if (!order) {
          socket.emit('error', { message: 'Order not found.' });
          return;
        }

        let isAuthorized = false;

        // Admin CC and QLSP can join any order room; CSKH is limited to assigned customers.
        if (hasAdminRole(socket.user, ADMIN_ORDER_UNSCOPED_ROLES)) {
          isAuthorized = true;
        }
        else if (
          socket.user?.role === 'cskh' &&
          (socket.user.assigned_chat_customer_ids || []).includes(order.user_id)
        ) {
          isAuthorized = true;
        }
        // Registered user owns the order
        else if (socket.user && socket.user.user_id && order.user_id === socket.user.user_id) {
          isAuthorized = true;
        }
        // Guest session matches order's session_id
        else if (sessionId && order.session_id === sessionId) {
          isAuthorized = true;
        }

        if (!isAuthorized) {
          console.warn(`[Socket.IO Security Alert] Unauthorized join_order attempt for ${orderId} from socket ${socket.id}`);
          socket.emit('error', { message: 'Unauthorized access to order room.' });
          return;
        }

        socket.join(`order_${order.order_id}`);
        console.log(`[Socket.IO] Socket ${socket.id} joined 'order_${order.order_id}' room.`);
      } catch (err) {
        console.error('[Socket.IO] Error authorizing join_order:', err);
      }
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    console.warn('Socket.io has not been initialized yet!');
  }
  return io;
}

function emitOrderUpdated(order, eventType = 'status_change') {
  if (!io || !order) return;

  const payload = {
    order_id: order.order_id || order._id,
    order_status: order.order_status,
    payment_status: order.payment_status,
    order,
    eventType,
    updated_at: new Date().toISOString()
  };

  // Emit to admin room
  io.to('admin').emit('order_updated', payload);

  // Emit to user room if order belongs to a registered user
  if (order.user_id) {
    io.to(`user_${order.user_id}`).emit('order_updated', payload);
  }

  // Emit to specific order room
  if (order.order_id) {
    io.to(`order_${order.order_id}`).emit('order_updated', payload);
  }
}

function emitNewOrder(order) {
  if (!io || !order) return;

  const payload = {
    order_id: order.order_id || order._id,
    order,
    eventType: 'new_order',
    created_at: new Date().toISOString()
  };

  // Emit to admin room
  io.to('admin').emit('new_order', payload);
  io.to('admin').emit('order_updated', payload);

  // Emit to user room if registered user
  if (order.user_id) {
    io.to(`user_${order.user_id}`).emit('order_updated', payload);
  }
}

// Chat events: new handoffs / status changes go to the agent queue; messages go to the conversation room.
function emitChatEvent(event, payload, conversation = null) {
  if (!io || !payload) return;
  if (event === 'chat_message') {
    io.to(`chat_${payload.conversation_id}`).emit(event, payload);
    // Let agents' list refresh previews even if they haven't opened the thread.
    io.to('chat_agents').emit('chat_updated_hint', { conversation_id: payload.conversation_id });
    return;
  }
  io.to('chat_agents').emit(event, payload);
  if (payload.conversation_id) io.to(`chat_${payload.conversation_id}`).emit(event, payload);
  if (payload.customer_id) io.to(`user_${payload.customer_id}`).emit(event, payload);
}

function emitChatHandover(chatSession, agentUserIds = [], note = null) {
  if (!io || !chatSession) return;

  const createdAt = note?.created_at ? new Date(note.created_at) : new Date();
  const notes = (chatSession.handover_notes || []).map(entry => ({
    note_id: entry.note_id,
    reason: entry.reason,
    summary: entry.summary,
    created_at: entry.created_at ? new Date(entry.created_at).toISOString() : null
  }));
  const payload = {
    notification_id: note?.note_id || `${chatSession.session_id}_${createdAt.getTime()}`,
    session_id: chatSession.session_id,
    user_id: chatSession.user_id,
    handover_reason: note?.reason || chatSession.handover_reason,
    summary: note?.summary || chatSession.summary,
    notes,
    messages_count: chatSession.messages?.length || 0,
    created_at: createdAt.toISOString()
  };

  io.to('admin').emit('chat_handover', payload);
  for (const userId of agentUserIds) {
    io.to(`user_${userId}`).emit('chat_handover', payload);
  }
  console.log(`[Socket.IO] Chat session ${chatSession.session_id} handed over to support: ${chatSession.handover_reason}`);
}

function emitLlmBudgetWarning(adminUserIds, payload) {
  if (!io) return;

  io.to('admin').emit('llm_budget_warning', payload);
  for (const userId of adminUserIds || []) {
    io.to(`user_${userId}`).emit('llm_budget_warning', payload);
  }
  console.warn(`[Socket.IO] Admin CC budget warning: ${payload.count}/${payload.limit} (${payload.percent}%)`);
}

module.exports = {
  initSocket,
  getIO,
  emitOrderUpdated,
  emitNewOrder,
  emitChatEvent,
  emitChatHandover,
  emitLlmBudgetWarning
};
