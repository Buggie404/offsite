const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');

// Admin - View all orders (GET /api/admin/orders)
async function getAllOrders(req, res) {
  try {
    const { order_status, payment_status, limit = 50, page = 1 } = req.query;
    
    const filter = {};
    if (order_status) filter.order_status = order_status;
    if (payment_status) filter.payment_status = payment_status;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    
    const orders = await Order.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Order.countDocuments(filter);

    res.json({
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      data: orders
    });
  } catch (error) {
    console.error('Error fetching all orders for admin:', error);
    res.status(500).json({ error: 'Failed to retrieve orders.' });
  }
}

// Admin - Update Order Status & Info (PUT /api/admin/orders/:id/status)
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, tracking_number, payment_status, note } = req.body;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { order_id: id };
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Identify the admin making the change
    const adminUser = await User.findById(req.user.user_id);
    const adminId = adminUser ? adminUser.user_id : 'system';
    
    order._changedBy = adminId;
    order._statusChangeNote = note || `Order updated by admin.`;

    // Apply updates
    if (status) {
      order.order_status = status;
      if (status === 'delivered') {
        order.delivered_at = new Date();
      } else if (status === 'canceled') {
        order.canceled_at = new Date();
      }
    }
    
    if (payment_status) {
      order.payment_status = payment_status;
    }
    
    if (tracking_number) {
      if (!order.shipping) {
        order.shipping = { method: 'standard', cost: 0, tracking_number, carrier: 'GHN' };
      } else {
        order.shipping.tracking_number = tracking_number;
      }
    }

    await order.save();

    res.json({
      message: 'Order updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: error.message || 'Failed to update order status.' });
  }
}

module.exports = {
  getAllOrders,
  updateOrderStatus
};
