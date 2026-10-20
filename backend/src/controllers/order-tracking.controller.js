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

    const emailMatch = email && order.delivery_info.email && email.trim().toLowerCase() === order.delivery_info.email.trim().toLowerCase();
    let typedDigits = String(mobile || '').replace(/\D/g, '');
    let storedDigits = String(order.delivery_info.mobile || '').replace(/\D/g, '');
    if (typedDigits.startsWith('84') && typedDigits.length > 9) typedDigits = typedDigits.slice(2);
    if (storedDigits.startsWith('84') && storedDigits.length > 9) storedDigits = storedDigits.slice(2);
    if (typedDigits.startsWith('0')) typedDigits = typedDigits.slice(1);
    if (storedDigits.startsWith('0')) storedDigits = storedDigits.slice(1);
    const mobileMatch = typedDigits.length >= 8 && (storedDigits === typedDigits || storedDigits.endsWith(typedDigits) || typedDigits.endsWith(storedDigits));

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
