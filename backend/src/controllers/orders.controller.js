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

    // Enforce that delivery address and card details already exist in User profile if registered customer, otherwise save the new address
    if (!is_guest && userDoc && payment.method !== 'cod') {
      // 1. Verify Address
      const addressExists = userDoc.addresses.some(addr => 
        addr.recipient_name === delivery_info.recipient_name &&
        addr.phone === delivery_info.mobile &&
        addr.city === delivery_info.city &&
        addr.detail_address === delivery_info.address
      );

      if (!addressExists) {
        const newAddress = {
          recipient_name: delivery_info.recipient_name,
          phone: delivery_info.mobile,
          city: delivery_info.city,
          detail_address: delivery_info.address,
          label: null,
          is_default: userDoc.addresses.length === 0
        };
        userDoc.addresses.push(newAddress);
        await userDoc.save();
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
          if (payment.full_card_info) {
            // Add the new card to user's payment methods
            userDoc.payment_methods.push(payment.full_card_info);
            await userDoc.save();
          } else {
            return res.status(400).json({ error: 'Payment card must match one of your saved payment methods.' });
          }
        }

        // Clean up before saving to Order
        if (payment.full_card_info) {
          delete payment.full_card_info;
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
      order_status: 'pending', // defaults to pending initially for verification
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

// Confirm COD Order (PUT /api/orders/:id/confirm)
async function confirmOrder(req, res) {
  try {
    const { id } = req.params;
    const { session_id } = req.body;

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

    if (order.payment.method !== 'cod') {
      return res.status(400).json({ error: 'Only COD orders can be confirmed via this endpoint.' });
    }

    if (order.order_status !== 'pending') {
      return res.status(400).json({ error: `Order is already in ${order.order_status} status.` });
    }

    let userDoc = null;

    // Access control
    if (order.is_guest) {
      if (order.session_id !== session_id) {
        return res.status(403).json({ error: 'Access denied. Invalid session for guest order.' });
      }
    } else {
      if (!req.user || !req.user.user_id) {
        return res.status(401).json({ error: 'Authentication required for registered order.' });
      }
      userDoc = await User.findById(req.user.user_id);
      if (!userDoc || order.user_id !== userDoc.user_id) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
      }
    }

    order.order_status = 'processing';
    order._changedBy = order.is_guest ? 'guest' : order.user_id;
    order._statusChangeNote = 'Order confirmed by user via COD verification modal';
    await order.save();

    // Save address if registered customer and it doesn't exist yet
    if (!order.is_guest && userDoc) {
      const delivery_info = order.delivery_info;
      const addressExists = userDoc.addresses.some(addr => 
        addr.recipient_name === delivery_info.recipient_name &&
        addr.phone === delivery_info.mobile &&
        addr.city === delivery_info.city &&
        addr.detail_address === delivery_info.address
      );

      if (!addressExists) {
        const newAddress = {
          recipient_name: delivery_info.recipient_name,
          phone: delivery_info.mobile,
          city: delivery_info.city,
          detail_address: delivery_info.address,
          label: null,
          is_default: userDoc.addresses.length === 0
        };
        userDoc.addresses.push(newAddress);
        await userDoc.save();
      }
    }

    res.json({
      message: 'Order confirmed successfully',
      data: order
    });
  } catch (error) {
    console.error('Error confirming order:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm order' });
  }
}

// Cancel Pending Order (PUT /api/orders/:id/cancel)
async function cancelPendingOrder(req, res) {
  try {
    const { id } = req.params;
    const { session_id } = req.body;

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

    if (order.order_status !== 'pending' && order.order_status !== 'processing') {
      return res.status(400).json({ error: `Order is in ${order.order_status} status and cannot be canceled.` });
    }

    // Access control
    if (order.is_guest) {
      if (order.session_id !== session_id) {
        return res.status(403).json({ error: 'Access denied. Invalid session for guest order.' });
      }
    } else {
      if (!req.user || !req.user.user_id) {
        return res.status(401).json({ error: 'Authentication required for registered order.' });
      }
      const userDoc = await User.findById(req.user.user_id);
      if (!userDoc || order.user_id !== userDoc.user_id) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
      }
    }

    order.order_status = 'canceled';
    order.canceled_at = new Date();
    order._changedBy = order.is_guest ? 'guest' : order.user_id;
    order._statusChangeNote = 'Order canceled by user via COD verification modal';
    await order.save();

    res.json({
      message: 'Order canceled successfully',
      data: order
    });
  } catch (error) {
    console.error('Error canceling order:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel order' });
  }
}

module.exports = {
  createOrder,
  getOrderById,
  getOrderHistory,
  confirmOrder,
  cancelPendingOrder
};
