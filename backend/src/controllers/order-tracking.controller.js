const Order = require('../models/Order');

async function trackOrder(req, res) {
  try {
    const { order_id, email, mobile } = req.query;

    if (!order_id) {
      return res.status(400).json({ error: 'Order ID is required to track order.' });
    }

    if (!email && !mobile) {
      return res.status(400).json({ error: 'Please provide either email or mobile number for verification.' });
    }

    const order = await Order.findOne({ order_id });
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Verify ownership
    const emailMatch = email && order.delivery_info.email && email.trim().toLowerCase() === order.delivery_info.email.trim().toLowerCase();
    const mobileMatch = mobile && order.delivery_info.mobile && mobile.trim() === order.delivery_info.mobile.trim();

    if (!emailMatch && !mobileMatch) {
      return res.status(403).json({ error: 'Verification details do not match this order.' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error tracking order:', error);
    res.status(500).json({ error: 'Failed to track order' });
  }
}

module.exports = {
  trackOrder
};
