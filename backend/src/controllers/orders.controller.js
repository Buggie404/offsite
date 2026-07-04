const Order = require('../models/Order');
const User = require('../models/User');
const RefundRequest = require('../models/RefundRequest');
const mongoose = require('mongoose');

const REFUND_REASONS = ['Damaged item', 'Wrong item', 'Size/color mismatch', 'Other'];

async function getLatestRefundRequest(orderId) {
  return RefundRequest.findOne({ order_id: orderId })
    .sort({ created_at: -1 })
    .lean();
}

function formatRefundRequestForClient(doc) {
  if (!doc) return null;
  return {
    refund_request_id: doc.refund_request_id,
    order_id: doc.order_id,
    reason: doc.reason,
    other_reason: doc.other_reason,
    description: doc.description,
    evidence: doc.evidence || [],
    refund_item: doc.refund_item || [],
    payment: doc.payment,
    status: doc.status,
    admin_reason: doc.admin_reason,
    created_at: doc.created_at,
    reviewed_at: doc.reviewed_at,
    reviewed_by: doc.reviewed_by
  };
}

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

      // 2. Verify Payment Method (only for card and bank transfer payments)
      if (payment.method === 'card' || payment.method === 'bank_transfer') {
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
      session_id: session_id || null,
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

    // Auto cancel pending payment order after 24h
    const createdTime = new Date(order.created_at || order.createdAt).getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (order.order_status === 'pending' && order.payment?.method !== 'cod' && (Date.now() - createdTime) >= twentyFourHours) {
      order.order_status = 'canceled';
      order._changedBy = 'system';
      order._statusChangeNote = 'Order automatically canceled: Payment pending for more than 24 hours';
      await order.save();
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
    let isAuthorized = false;
    if (session_id && order.session_id === session_id) {
      isAuthorized = true;
    }
    
    if (req.user && req.user.user_id) {
      const uDoc = await User.findById(req.user.user_id);
      if (uDoc && order.user_id === uDoc.user_id) {
        isAuthorized = true;
        userDoc = uDoc;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
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

    if (!['pending', 'processing'].includes(order.order_status)) {
      return res.status(400).json({ error: `Order is in ${order.order_status} status and cannot be canceled.` });
    }

    // Access control
    let isAuthorized = false;
    if (session_id && order.session_id === session_id) {
      isAuthorized = true;
    } else if (req.user && req.user.user_id) {
      const userDoc = await User.findById(req.user.user_id);
      if (userDoc && order.user_id === userDoc.user_id) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    order.order_status = 'canceled';
    order.canceled_at = new Date();
    order._changedBy = order.is_guest ? 'guest' : order.user_id;
    order._statusChangeNote = 'Order canceled by customer';
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

// Fail Pending QR Order Payment (PUT /api/orders/:id/fail-payment)
async function failPayment(req, res) {
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

    // Access control
    let isAuthorized = false;
    if (session_id && order.session_id === session_id) {
      isAuthorized = true;
    } else if (req.user && req.user.user_id) {
      const userDoc = await User.findById(req.user.user_id);
      if (userDoc && order.user_id === userDoc.user_id) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    order.payment_status = 'failed';
    order.order_status = 'pending';
    order._changedBy = order.is_guest ? 'guest' : order.user_id;
    order._statusChangeNote = 'Payment failed: QR code expired and exceeded maximum reloads';
    await order.save();

    res.json({
      message: 'Order payment status updated to failed',
      data: order
    });
  } catch (error) {
    console.error('Error failing payment:', error);
    res.status(500).json({ error: error.message || 'Failed to update payment status' });
  }
}

// Confirm QR/Card Payment (PUT /api/orders/:id/confirm-payment)
async function confirmPayment(req, res) {
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

    // Access control
    let isAuthorized = false;
    if (session_id && order.session_id === session_id) {
      isAuthorized = true;
    } else if (req.user && req.user.user_id) {
      const userDoc = await User.findById(req.user.user_id);
      if (userDoc && order.user_id === userDoc.user_id) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    order.payment_status = 'paid';
    order.order_status = 'processing';
    order._changedBy = order.is_guest ? 'guest' : order.user_id;
    order._statusChangeNote = 'Payment confirmed by user via mobile QR scan';
    await order.save();

    res.json({
      message: 'Payment confirmed successfully',
      data: order
    });
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm payment' });
  }
}

// Get Order Status (GET /api/orders/:id/status)
async function getOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { session_id } = req.query;

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

    // Auto cancel pending payment order after 24h
    const createdTime = new Date(order.created_at || order.createdAt).getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (order.order_status === 'pending' && order.payment?.method !== 'cod' && (Date.now() - createdTime) >= twentyFourHours) {
      order.order_status = 'canceled';
      order._changedBy = 'system';
      order._statusChangeNote = 'Order automatically canceled: Payment pending for more than 24 hours';
      await order.save();
    }

    // Access control
    let isAuthorized = false;
    if (session_id && order.session_id === session_id) {
      isAuthorized = true;
    } else if (req.user && req.user.user_id) {
      const userDoc = await User.findById(req.user.user_id);
      if (userDoc && order.user_id === userDoc.user_id) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const refundRequest = await getLatestRefundRequest(order.order_id);

    res.json({
      order_id: order.order_id,
      order_status: order.order_status,
      payment_status: order.payment_status,
      payment: order.payment,
      pricing: order.pricing,
      items: order.items,
      coupon: order.coupon,
      delivery_info: order.delivery_info,
      shipping: order.shipping,
      session_id: order.session_id,
      user_id: order.user_id,
      created_at: order.created_at,
      delivered_at: order.delivered_at,
      canceled_at: order.canceled_at,
      updated_at: order.updated_at,
      refund_request: formatRefundRequestForClient(refundRequest)
    });
  } catch (error) {
    console.error('Error fetching order status:', error);
    res.status(500).json({ error: 'Failed to retrieve order status' });
  }
}

// Receive Order (PUT /api/orders/:id/receive)
async function receiveOrder(req, res) {
  try {
    const { id } = req.params;
    const { session_id, email, mobile } = req.body;

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

    if (order.order_status !== 'shipping') {
      return res.status(400).json({
        error: `Order must be in shipping status to confirm receipt. Current status: ${order.order_status}.`
      });
    }

    // Access control
    let isAuthorized = false;
    if (session_id && order.session_id === session_id) {
      isAuthorized = true;
    } else if (order.user_id && req.user && req.user.user_id) {
      const userDoc = await User.findById(req.user.user_id);
      if (userDoc && order.user_id === userDoc.user_id) {
        isAuthorized = true;
      }
    } else if (!order.user_id && session_id && order.session_id === session_id) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to modify this order.' });
    }

    order.order_status = 'delivered';
    order.delivered_at = new Date();
    order._changedBy = 'user';
    order._statusChangeNote = 'Order received by user';
    await order.save();

    const refundRequest = await getLatestRefundRequest(order.order_id);

    res.json({
      message: 'Order status updated to delivered',
      data: {
        ...order.toObject(),
        refund_request: formatRefundRequestForClient(refundRequest)
      }
    });
  } catch (error) {
    console.error('Error receiving order:', error);
    res.status(500).json({ error: error.message || 'Failed to update order status' });
  }
}

// Request Refund (POST /api/orders/:id/refund)
async function requestRefund(req, res) {
  try {
    const { id } = req.params;
    const {
      reason,
      other_reason,
      description,
      items,
      refund_item,
      evidence,
      session_id
    } = req.body;

    const selectedItems = refund_item || items;
    if (!selectedItems || !selectedItems.length) {
      return res.status(400).json({ error: 'Please select at least one item to return.' });
    }

    if (!reason || !REFUND_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'A valid refund reason is required.' });
    }

    if (reason === 'Other' && !String(other_reason || '').trim()) {
      return res.status(400).json({ error: 'Please specify your refund reason.' });
    }

    if (!evidence || !evidence.length) {
      return res.status(400).json({ error: 'Supporting evidence is required for refund requests.' });
    }

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

    // Access control
    let isAuthorized = false;
    let userId = null;
    let sessionId = null;

    if (order.user_id) {
      if (req.user && req.user.user_id) {
        const userDoc = await User.findById(req.user.user_id);
        if (userDoc && order.user_id === userDoc.user_id) {
          isAuthorized = true;
          userId = userDoc.user_id;
        }
      }
    } else if (session_id && order.session_id === session_id) {
      isAuthorized = true;
      sessionId = session_id;
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to request refund for this order.' });
    }

    if (order.order_status !== 'delivered' && order.order_status !== 'refund_rejected') {
      return res.status(400).json({ error: 'Refund/return can only be requested for delivered orders.' });
    }

    const existingPending = await RefundRequest.findOne({
      order_id: order.order_id,
      status: 'pending'
    });

    if (existingPending) {
      return res.status(400).json({ error: 'A refund request is already pending review for this order.' });
    }

    const refundItems = selectedItems.map((selected) => {
      const orderItem = order.items.find(
        (item) =>
          item.product_id === selected.product_id && item.variant_id === selected.variant_id
      );

      if (!orderItem) {
        throw new Error('One or more selected items were not found in this order.');
      }

      const quantity = selected.quantity || orderItem.quantity;
      return {
        product_id: orderItem.product_id,
        variant_id: orderItem.variant_id,
        product_name: orderItem.product_name,
        variant_name: orderItem.variant_name,
        image: orderItem.image,
        unit_price: orderItem.unit_price,
        quantity,
        subtotal: orderItem.unit_price * quantity
      };
    });

    const refundRequest = new RefundRequest({
      order_id: order.order_id,
      user_id: userId,
      session_id: sessionId,
      reason,
      other_reason: reason === 'Other' ? String(other_reason).trim() : null,
      payment: order.payment,
      description: description ? String(description).trim() : null,
      evidence,
      refund_item: refundItems
    });

    await refundRequest.save();

    order.order_status = 'pending_refund';
    order._changedBy = userId || sessionId || 'customer';
    order._statusChangeNote = 'Refund request submitted by customer';
    await order.save();

    res.json({
      message: 'Refund request submitted successfully.',
      data: {
        ...order.toObject(),
        refund_request: formatRefundRequestForClient(refundRequest.toObject())
      }
    });
  } catch (error) {
    console.error('Error requesting refund:', error);
    res.status(500).json({ error: error.message || 'Failed to submit refund request.' });
  }
}

module.exports = {
  createOrder,
  getOrderById,
  getOrderHistory,
  confirmOrder,
  cancelPendingOrder,
  failPayment,
  confirmPayment,
  getOrderStatus,
  receiveOrder,
  requestRefund
};

