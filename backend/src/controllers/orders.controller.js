const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');

// Create Order (POST /api/orders)
async function createOrder(req, res) {
  try {
    const { items, delivery_info, shipping, payment, pricing, coupon, session_id } = req.body;

    if (!items || !items.length || !delivery_info || !shipping || !payment || !pricing) {
      return res.status(400).json({ error: 'Missing required order fields: items, delivery_info, shipping, payment, pricing.' });
    }

    let user_id = null;
    let is_guest = true;
    let userDoc = null;

    // Check if the user is authenticated (req.user is populated by optionalAuthMiddleware)
    if (req.user && req.user.user_id) {
      userDoc = await User.findById(req.user.user_id);
      if (userDoc) {
        user_id = userDoc.user_id;
        is_guest = false;
      }
    }

    // Validation for guests
    if (is_guest && !session_id) {
      return res.status(400).json({ error: 'session_id is required for guest checkout.' });
    }

    // Enforce that delivery address and card details already exist in User profile if registered customer
    if (!is_guest && userDoc) {
      // 1. Verify Address
      const addressExists = userDoc.addresses.some(addr => 
        addr.recipient_name === delivery_info.recipient_name &&
        addr.phone === delivery_info.mobile &&
        addr.city === delivery_info.city &&
        addr.detail_address === delivery_info.address
      );

      if (!addressExists) {
        return res.status(400).json({ error: 'Delivery address must match one of your saved addresses.' });
      }

      // 2. Verify Payment Method (only for card payments)
      if (payment.method === 'card') {
        const brand = payment.card_info && payment.card_info.brand;
        const last4 = payment.card_info && payment.card_info.last4;
        
        if (!brand || !last4) {
          return res.status(400).json({ error: 'Card brand and last4 digits are required for card payments.' });
        }

        const cardExists = userDoc.payment_methods.some(p => {
          const endsWithLast4 = p.card_number.endsWith(last4);
          
          let brandMatches = false;
          const type = p.card_type; // 'NAPAS', 'credit', 'debit'
          const brandUpper = brand.toUpperCase();
          if (brandUpper === 'NAPAS' && type === 'NAPAS') brandMatches = true;
          else if (brandUpper !== 'NAPAS' && (type === 'credit' || type === 'debit')) brandMatches = true;

          return endsWithLast4 && brandMatches;
        });

        if (!cardExists) {
          return res.status(400).json({ error: 'Payment card must match one of your saved payment methods.' });
        }
      }
    }

    // Build order fields
    const orderData = {
      order_id: null,
      user_id,
      session_id: is_guest ? session_id : null,
      is_guest,
      items,
      delivery_info,
      shipping,
      payment,
      pricing,
      coupon,
      payment_status: 'pending' // defaults to pending initially
    };

    // Instantiate and save Order (pre-save hook generates order_id & updates order_status)
    const newOrder = new Order(orderData);
    await newOrder.save();

    res.status(201).json({
      message: 'Order created successfully',
      data: newOrder
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message || 'Failed to create order' });
  }
}

// Get Order Details (GET /api/orders/:id)
async function getOrderById(req, res) {
  try {
    const { id } = req.params;

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

    // Access control: only admin or the order owner can view the details
    if (req.user.role !== 'admin') {
      const userDoc = await User.findById(req.user.user_id);
      if (!userDoc || order.user_id !== userDoc.user_id) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to view this order.' });
      }
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to retrieve order details' });
  }
}

// Get Logged-in User's Order History (GET /api/orders)
async function getOrderHistory(req, res) {
  try {
    const userDoc = await User.findById(req.user.user_id);
    if (!userDoc) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const orders = await Order.find({ user_id: userDoc.user_id }).sort({ created_at: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching order history:', error);
    res.status(500).json({ error: 'Failed to retrieve order history' });
  }
}

module.exports = {
  createOrder,
  getOrderById,
  getOrderHistory
};
