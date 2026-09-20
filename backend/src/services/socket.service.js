// backend/src/services/socket.service.js
const { Server } = require('socket.io');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for dev / flexibility
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }
  });

  io.on('connection', (socket) => {
    // Client joins admin room
    socket.on('join_admin', () => {
      socket.join('admin');
    });

    // Client joins user room
    socket.on('join_user', (data) => {
      if (data && data.user_id) {
        socket.join(`user_${data.user_id}`);
      }
    });

    // Client joins order room
    socket.on('join_order', (data) => {
      if (data && data.order_id) {
        socket.join(`order_${data.order_id}`);
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
