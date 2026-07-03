const Order = require('../models/Order');
const User = require('../models/User');
const RefundRequest = require('../models/RefundRequest');
const mongoose = require('mongoose');

function getDateFromRange(dateRange) {
  const now = new Date();
  const from = new Date();

  switch (dateRange) {
    case 'today':
      from.setHours(0, 0, 0, 0);
      return from;
    case '7':
      from.setDate(now.getDate() - 7);
      return from;
    case '90':
      from.setDate(now.getDate() - 90);
      return from;
    case 'custom':
      from.setDate(now.getDate() - 30);
      return from;
    case '30':
    default:
      from.setDate(now.getDate() - 30);
      return from;
  }
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildCreatedAtFilter(dateRange, dateFrom, dateTo) {
  if (dateRange === 'custom') {
    const from = parseDateInput(dateFrom);
    const to = parseDateInput(dateTo);

    if (from && to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      if (from <= end) {
        return { $gte: from, $lte: end };
      }
    }

    return { $gte: getDateFromRange('30') };
  }

  return { $gte: getDateFromRange(dateRange) };
}

function mapStatusFilter(orderStatus) {
  if (!orderStatus || orderStatus === 'all') return null;
  if (orderStatus === 'cancelled') return 'canceled';
  if (orderStatus === 'processing') return ['pending', 'processing'];
  return orderStatus;
}

function resolveCustomer(order, userMap) {
  const user = order.user_id ? userMap.get(order.user_id) : null;
  return {
    customer_name: user?.profile_name || order.delivery_info?.recipient_name || 'Guest',
    customer_email: user?.email || order.delivery_info?.email || ''
  };
}

function enrichOrders(orders, userMap) {
  return orders.map((order) => {
    const customer = resolveCustomer(order, userMap);
    return {
      _id: order._id,
      order_id: order.order_id,
      customer_name: customer.customer_name,
      customer_email: customer.customer_email,
      created_at: order.created_at,
      order_status: order.order_status,
      total: order.pricing?.total ?? 0,
      currency: order.pricing?.currency ?? 'USD',
      is_guest: order.is_guest
    };
  });
}

function filterBySearch(orders, search) {
  if (!search) return orders;
  const query = String(search).trim().toLowerCase();
  if (!query) return orders;

  return orders.filter((order) => {
    return (
      order.order_id?.toLowerCase().includes(query) ||
      order.customer_name?.toLowerCase().includes(query) ||
      order.customer_email?.toLowerCase().includes(query)
    );
  });
}

async function buildUserMap(orders) {
  const userIds = [...new Set(orders.filter((order) => order.user_id).map((order) => order.user_id))];
  if (userIds.length === 0) return new Map();

  const users = await User.find({ user_id: { $in: userIds } }).select('user_id profile_name email');
  return new Map(users.map((user) => [user.user_id, user]));
}

async function getLatestRefundRequest(orderId) {
  return RefundRequest.findOne({ order_id: orderId }).sort({ created_at: -1 });
}

function formatRefundRequestForAdmin(doc) {
  if (!doc) return null;
  const plain = doc.toObject ? doc.toObject() : doc;
  return {
    refund_request_id: plain.refund_request_id,
    order_id: plain.order_id,
    reason: plain.reason,
    other_reason: plain.other_reason,
    description: plain.description,
    evidence: plain.evidence || [],
    refund_item: plain.refund_item || [],
    payment: plain.payment,
    status: plain.status,
    admin_reason: plain.admin_reason,
    status_history: plain.status_history || [],
    created_at: plain.created_at,
    reviewed_at: plain.reviewed_at,
    reviewed_by: plain.reviewed_by
  };
}

function findOrderQuery(id) {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return { _id: id };
  }
  return { order_id: id };
}

async function getAdminActorId(req) {
  const adminUser = await User.findById(req.user.user_id);
  return adminUser?.user_id || 'admin';
}

function parseInternalNotes(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value
      ? [{ text: String(value), author: 'Admin', created_at: new Date().toISOString() }]
      : [];
  }
}

function appendInternalNote(value, note, author) {
  const notes = parseInternalNotes(value);
  notes.unshift({
    text: note,
    author: author || 'Admin',
    created_at: new Date().toISOString()
  });
  return JSON.stringify(notes);
}

function formatPaymentLabel(payment) {
  if (!payment) return '—';
  if (payment.method === 'card' && payment.card_info) {
    const brand = payment.card_info.brand || 'Card';
    const last4 = payment.card_info.last4 || '****';
    return `${brand} ···· ${last4}`;
  }
  const labels = {
    cod: 'Cash on delivery',
    qr: 'QR payment',
    bank_transfer: 'Bank transfer',
    card: 'Card'
  };
  return labels[payment.method] || payment.method;
}

function formatShippingAddress(deliveryInfo) {
  if (!deliveryInfo) return '';
  return [deliveryInfo.address, deliveryInfo.city].filter(Boolean).join('\n');
}

async function buildOrderDetail(order) {
  let customerName = order.delivery_info?.recipient_name || 'Guest';
  let customerEmail = order.delivery_info?.email || '';
  let customerPhone = order.delivery_info?.mobile || '';

  if (order.user_id) {
    const user = await User.findOne({ user_id: order.user_id }).select('profile_name email phone');
    if (user) {
      customerName = user.profile_name || customerName;
      customerEmail = user.email || customerEmail;
      customerPhone = user.phone || customerPhone;
    }
  }

  const refundRequestDoc = await getLatestRefundRequest(order.order_id);

  return {
    _id: order._id,
    order_id: order.order_id,
    order_status: order.order_status,
    payment_status: order.payment_status,
    created_at: order.created_at,
    updated_at: order.updated_at,
    delivered_at: order.delivered_at,
    canceled_at: order.canceled_at,
    is_guest: order.is_guest,
    items: (order.items || []).map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      variant_name: item.variant_name,
      image_url: item.image?.url || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal
    })),
    pricing: order.pricing,
    payment: order.payment,
    payment_label: formatPaymentLabel(order.payment),
    delivery_info: order.delivery_info,
    shipping: order.shipping,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    shipping_address: formatShippingAddress(order.delivery_info),
    status_history: order.status_history || [],
    refund_request: formatRefundRequestForAdmin(refundRequestDoc),
    internal_notes: parseInternalNotes(order.internal_notes)
  };
}

async function computeStats(createdAtFilter) {
  const baseFilter = { created_at: createdAtFilter };

  const [total, processing, shipped, canceledOrRefund, pendingRefundOrders] = await Promise.all([
    Order.countDocuments(baseFilter),
    Order.countDocuments({ ...baseFilter, order_status: { $in: ['pending', 'processing'] } }),
    Order.countDocuments({ ...baseFilter, order_status: 'shipping' }),
    Order.countDocuments({
      ...baseFilter,
      order_status: { $in: ['canceled', 'refund'] }
    }),
    RefundRequest.distinct('order_id', { status: 'pending' })
  ]);

  const needsAttention = canceledOrRefund + pendingRefundOrders.length;

  return { total, processing, shipped, needsAttention };
}

// Admin - View all orders (GET /api/admin/orders)
async function getAllOrders(req, res) {
  try {
    const {
      order_status,
      payment_status,
      search,
      date_range = '30',
      date_from,
      date_to,
      limit = 50,
      page = 1
    } = req.query;

    const createdAtFilter = buildCreatedAtFilter(date_range, date_from, date_to);
    const filter = {
      created_at: createdAtFilter
    };

    const statusFilter = mapStatusFilter(order_status);
    if (statusFilter) {
      filter.order_status = Array.isArray(statusFilter) ? { $in: statusFilter } : statusFilter;
    }

    if (payment_status) {
      filter.payment_status = payment_status;
    }

    const [orders, stats] = await Promise.all([
      Order.find(filter).sort({ created_at: -1 }).select('order_id user_id delivery_info created_at order_status pricing is_guest').lean(),
      computeStats(createdAtFilter)
    ]);

    const userMap = await buildUserMap(orders);
    const enriched = filterBySearch(enrichOrders(orders, userMap), search);

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;
    const data = enriched.slice(skip, skip + parsedLimit);

    res.json({
      total: enriched.length,
      page: parsedPage,
      limit: parsedLimit,
      stats,
      data
    });
  } catch (error) {
    console.error('Error fetching all orders for admin:', error);
    res.status(500).json({ error: 'Failed to retrieve orders.' });
  }
}

// Admin - Get single order (GET /api/admin/orders/:id)
async function getOrderById(req, res) {
  try {
    const order = await Order.findOne(findOrderQuery(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const data = await buildOrderDetail(order);
    res.json({ data });
  } catch (error) {
    console.error('Error fetching order detail for admin:', error);
    res.status(500).json({ error: 'Failed to retrieve order.' });
  }
}

// Admin - Update Order Status & Info (PUT /api/admin/orders/:id/status)
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, tracking_number, payment_status, note } = req.body;

    const order = await Order.findOne(findOrderQuery(id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const adminId = await getAdminActorId(req);
    const currentStatus = order.order_status;

    if (status && status !== currentStatus) {
      const allowedTransitions = {
        processing: ['shipping']
      };

      const allowed = allowedTransitions[currentStatus] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Admin cannot change order status from ${currentStatus} to ${status}. Customers must confirm delivery or cancellation. Refunds require approving a refund request.`
        });
      }

      order._changedBy = adminId;
      order._statusChangeNote = note || `Order status updated to ${status} by admin.`;
      order.order_status = status;
    } else if (note) {
      order._changedBy = adminId;
      order._statusChangeNote = note;
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

    const data = await buildOrderDetail(order);
    res.json({
      message: 'Order updated successfully',
      data
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: error.message || 'Failed to update order status.' });
  }
}

// Admin - Approve refund request (POST /api/admin/orders/:id/refund/approve)
async function approveRefundRequest(req, res) {
  try {
    const order = await Order.findOne(findOrderQuery(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const refundRequest = await RefundRequest.findOne({
      order_id: order.order_id,
      status: 'pending'
    }).sort({ created_at: -1 });

    if (!refundRequest) {
      return res.status(400).json({ error: 'No pending refund request found for this order.' });
    }

    const adminId = await getAdminActorId(req);
    const now = new Date();

    refundRequest.status = 'approved';
    refundRequest.reviewed_by = adminId;
    refundRequest.reviewed_at = now;
    refundRequest.status_history.push({
      status: 'approved',
      changed_at: now,
      changed_by: adminId,
      note: 'Refund request approved by admin'
    });
    await refundRequest.save();

    order._changedBy = adminId;
    order._statusChangeNote = 'Refund approved by admin';
    order.order_status = 'refund';
    order.payment_status = 'refunded';
    await order.save();

    const data = await buildOrderDetail(order);
    res.json({
      message: 'Refund approved successfully',
      data
    });
  } catch (error) {
    console.error('Error approving refund:', error);
    res.status(500).json({ error: error.message || 'Failed to approve refund.' });
  }
}

// Admin - Reject refund request (POST /api/admin/orders/:id/refund/reject)
async function rejectRefundRequest(req, res) {
  try {
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'Rejection reason is required.' });
    }

    const order = await Order.findOne(findOrderQuery(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const refundRequest = await RefundRequest.findOne({
      order_id: order.order_id,
      status: 'pending'
    }).sort({ created_at: -1 });

    if (!refundRequest) {
      return res.status(400).json({ error: 'No pending refund request found for this order.' });
    }

    const adminId = await getAdminActorId(req);
    const now = new Date();
    const rejectionReason = String(reason).trim();

    refundRequest.status = 'rejected';
    refundRequest.admin_reason = rejectionReason;
    refundRequest.reviewed_by = adminId;
    refundRequest.reviewed_at = now;
    refundRequest.status_history.push({
      status: 'rejected',
      changed_at: now,
      changed_by: adminId,
      note: rejectionReason
    });
    await refundRequest.save();

    const data = await buildOrderDetail(order);
    res.json({
      message: 'Refund request rejected',
      data
    });
  } catch (error) {
    console.error('Error rejecting refund:', error);
    res.status(500).json({ error: error.message || 'Failed to reject refund.' });
  }
}

// Admin - Add internal note (POST /api/admin/orders/:id/notes)
async function addInternalNote(req, res) {
  try {
    const { note } = req.body;
    if (!note || !String(note).trim()) {
      return res.status(400).json({ error: 'Note content is required.' });
    }

    const order = await Order.findOne(findOrderQuery(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const adminId = await getAdminActorId(req);
    order.internal_notes = appendInternalNote(order.internal_notes, String(note).trim(), adminId);
    await order.save();

    const data = await buildOrderDetail(order);
    res.json({
      message: 'Note saved successfully',
      data
    });
  } catch (error) {
    console.error('Error saving internal note:', error);
    res.status(500).json({ error: error.message || 'Failed to save note.' });
  }
}

module.exports = {
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  approveRefundRequest,
  rejectRefundRequest,
  addInternalNote
};
