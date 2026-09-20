// backend/src/services/socket.service.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Order = require('../models/Order');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for dev / flexibility
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }
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
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
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
    // 1. Join Admin Room - Strictly requires role === 'admin'
    socket.on('join_admin', () => {
      if (!socket.user || socket.user.role !== 'admin') {
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

      if (socket.user.user_id !== data.user_id && socket.user.role !== 'admin') {
        console.warn(`[Socket.IO Security Alert] User ${socket.user.user_id} attempted unauthorized join_user for ${data.user_id}`);
        socket.emit('error', { message: 'Unauthorized: Cannot join room of another user.' });
        return;
      }

      socket.join(`user_${data.user_id}`);
      console.log(`[Socket.IO] User ${socket.user.user_id} joined 'user_${data.user_id}' room.`);
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

        // Admin can join any order room
        if (socket.user && socket.user.role === 'admin') {
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

module.exports = {
  initSocket,
  getIO,
  emitOrderUpdated,
  emitNewOrder
};
