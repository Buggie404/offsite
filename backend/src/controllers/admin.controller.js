const Order = require('../models/Order');
const RefundRequest = require('../models/RefundRequest');
const subscriptionService = require('../services/subscription.service');
const { normalizeReason } = require('../services/activity-log.service');
const notificationService = require('../services/notification.service');
const { parseInternalNotes, appendInternalNote } = require('../utils/internal-notes');
const mongoose = require('mongoose');
const socketService = require('../services/socket.service');

function getDateFromRange(dateRange) {
  const days = { today: 1, '7': 7, '30': 30, '90': 90 }[dateRange] || 30;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  // The selected calendar day is included, so a 30-day range starts 29 days
  // ago. This matches the Dashboard filter and the label shown in the Orders UI.
  from.setDate(from.getDate() - (days - 1));
  return from;
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
  // Cancelled orders are left out of the admin listing entirely.
  if (!orderStatus || orderStatus === 'all' || orderStatus === 'cancelled') return null;
  if (orderStatus === 'processing') return ['pending', 'processing'];
  if (orderStatus === 'pending_refund') return 'pending_refund';
  if (orderStatus === 'refund_rejected') return 'refund_rejected';
  if (orderStatus === 'delivery_failed') return 'delivery_failed';
  return orderStatus;
}

// Older checkouts stored this placeholder when the customer left email blank.
const PLACEHOLDER_EMAIL = 'guest@example.com';

// Customer shown to admins is whoever the order was placed for (Orders.delivery_info),
// not the account profile — a user can order for someone else. Email may be missing.
function resolveCustomer(order) {
  const email = order.delivery_info?.email;
  return {
    customer_name: order.delivery_info?.recipient_name || 'Guest',
    customer_email: email && email !== PLACEHOLDER_EMAIL ? email : null,
    customer_phone: order.delivery_info?.mobile || null
  };
}

// Same rule as frontend shared/utils/order-type.ts: One-time / Subscription / Mixed.
function getOrderType(order) {
  if (order.subscription_id) return 'subscription';
  const items = order.items || [];
  const subs = items.filter((item) => item.purchase_type === 'subscription').length;
  if (subs === 0) return 'one_time';
  return subs === items.length ? 'subscription' : 'mixed';
}

function enrichOrders(orders) {
  return orders.map((order) => {
    const customer = resolveCustomer(order);
    return {
      _id: order._id,
      order_id: order.order_id,
      customer_name: customer.customer_name,
      customer_email: customer.customer_email,
      user_id: order.user_id || null,
      created_at: order.created_at,
      order_type: getOrderType(order),
      order_status: order.order_status,
      total: order.pricing?.total ?? 0,
      currency: order.pricing?.currency ?? 'USD',
      is_guest: order.is_guest,
      subscription_start_failed: !!order.subscription_start_failed,
      attention_reasons: attentionReasons(order),
      needs_attention: attentionReasons(order).length > 0
    };
  });
}

// The same rule as getOrderType, as a MongoDB filter, so the listing can page by type.
// purchase_type may be missing on older lines; { $ne: 'subscription' } counts those as one-time.
const NOT_SUBSCRIPTION_LINE = { purchase_type: { $ne: 'subscription' } };
const ORDER_TYPE_FILTERS = {
  subscription: {
    $or: [
      { subscription_id: { $ne: null } },
      { 'items.0': { $exists: true }, items: { $not: { $elemMatch: NOT_SUBSCRIPTION_LINE } } }
    ]
  },
  one_time: { subscription_id: null, 'items.purchase_type': { $ne: 'subscription' } },
  mixed: {
    subscription_id: null,
    $and: [
      { items: { $elemMatch: { purchase_type: 'subscription' } } },
      { items: { $elemMatch: NOT_SUBSCRIPTION_LINE } }
    ]
  }
};

function orderTypeCondition(orderType) {
  return ORDER_TYPE_FILTERS[orderType] || null;
}

// Urgent orders ("Needs attention"): a refund request waiting on staff, a failed delivery, or a
// paid Ritual Box that couldn't start. One definition for the stat card, the filter, the
// urgent-first sort and the row flag. Cancelled orders never reach the listing at all.
const URGENT_STATUSES = ['pending_refund', 'delivery_failed'];
const NEEDS_ATTENTION_FILTER = {
  $or: [{ order_status: { $in: URGENT_STATUSES } }, { subscription_start_failed: true }]
};
// Same rule as an aggregation expression (1 = urgent), for sorting in the database.
const URGENT_SORT_KEY = {
  $cond: [
    { $or: [{ $in: ['$order_status', URGENT_STATUSES] }, { $eq: ['$subscription_start_failed', true] }] },
    1,
    0
  ]
};

// Why an order is urgent, in the order the badges are shown.
function attentionReasons(order) {
  const reasons = [];
  if (URGENT_STATUSES.includes(order.order_status)) reasons.push(order.order_status);
  if (order.subscription_start_failed) reasons.push('ritual_box_not_started');
  return reasons;
}

// "Needs attention" filters (?attention=…): every urgent order, or one flag the system sets.
const ATTENTION_FILTERS = {
  needs_attention: NEEDS_ATTENTION_FILTER,
  ritual_box_not_started: { subscription_start_failed: true }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Phone search: "0901234567", "090 123 4567" and "+84 901 234 567" are the same number.
// Mobiles are stored as typed, so the pattern also allows separators and either prefix.
function phonePattern(query) {
  if (!/^[+\d\s().-]+$/.test(query)) return null;
  const digits = query.replace(/\D/g, '').replace(/^84(?=\d{9}$)/, '0');
  if (digits.length < 3) return null;
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  const body = local.split('').join('[\\s().-]*');
  const prefix = digits.startsWith('0') ? '(?:0|\\+?84)[\\s().-]*' : '';
  return { $regex: prefix + body };
}

// Search by order id, recipient name, email or mobile, in the query so paging stays in the database.
function searchCondition(search) {
  const query = String(search || '').trim();
  if (!query) return null;
  const pattern = { $regex: escapeRegex(query), $options: 'i' };
  const conditions = [
    { order_id: pattern },
    { 'delivery_info.recipient_name': pattern },
    { $and: [{ 'delivery_info.email': pattern }, { 'delivery_info.email': { $ne: PLACEHOLDER_EMAIL } }] }
  ];
  const mobile = phonePattern(query);
  if (mobile) conditions.push({ 'delivery_info.mobile': mobile });
  return { $or: conditions };
}

async function getLatestRefundRequest(orderId) {
  return RefundRequest.findOne({ order_id: orderId }).sort({ created_at: -1 }).lean();
}

function enrichRefundItemsForAdmin(refundItems, orderItems) {
  return (refundItems || []).map((item) => {
    const orderItem = (orderItems || []).find(
      (line) => line.product_id === item.product_id && line.variant_id === item.variant_id
    );

    const imageUrl =
      item.image?.url ||
      (typeof item.image === 'string' ? item.image : null) ||
      orderItem?.image?.url ||
      null;

    return {
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_name: item.product_name || orderItem?.product_name || 'Product',
      variant_name: item.variant_name || orderItem?.variant_name || '—',
      image: imageUrl ? { url: imageUrl, public_id: item.image?.public_id || null } : undefined,
      unit_price: item.unit_price ?? orderItem?.unit_price ?? 0,
      quantity: item.quantity ?? orderItem?.quantity ?? 1,
      subtotal:
        item.subtotal ??
        (item.unit_price ?? orderItem?.unit_price ?? 0) * (item.quantity ?? orderItem?.quantity ?? 1)
    };
  });
}

function formatRefundRequestForAdmin(doc, orderItems) {
  if (!doc) return null;
  const plain = doc.toObject ? doc.toObject() : doc;
  return {
    refund_request_id: plain.refund_request_id,
    order_id: plain.order_id,
    reason: plain.reason,
    other_reason: plain.other_reason,
    description: plain.description,
    evidence: plain.evidence || [],
    refund_item: enrichRefundItemsForAdmin(plain.refund_item, orderItems),
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
  // Prefer user_id already attached by auth middleware to avoid an extra DB round-trip
  return req.user?.user_id || req.user?.id || 'admin';
}

function activitySnapshot(order) {
  return {
    order_status: order.order_status,
    payment_status: order.payment_status,
    shipping: order.shipping?.toObject ? order.shipping.toObject() : order.shipping,
    internal_notes: parseInternalNotes(order.internal_notes)
  };
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
  const customer = resolveCustomer(order);
  const [refundRequestDoc, ritualBoxes] = await Promise.all([
    getLatestRefundRequest(order.order_id),
    subscriptionService.getOrderRitualBoxes(order).catch((err) => {
      console.error('Error loading order Ritual Boxes:', err);
      return [];
    })
  ]);

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
      variant_id: item.variant_id,
      product_name: item.product_name,
      variant_name: item.variant_name,
      image_url: item.image?.url || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      purchase_type: item.purchase_type || 'one_time',
      subscription_frequency_days: item.subscription_frequency_days ?? null,
      out_of_stock: !!item.out_of_stock
    })),
    subscription_id: order.subscription_id || null,
    subscription_cycle: order.subscription_cycle || null,
    subscription_start_failed: !!order.subscription_start_failed,
    subscription_start_failed_at: order.subscription_start_failed_at || null,
    ritual_boxes: ritualBoxes,
    pricing: order.pricing,
    removed_items: (order.removed_items || []).map((entry) => ({
      action: entry.action,
      product_name: entry.item?.product_name,
      variant_name: entry.item?.variant_name,
      quantity: entry.item?.quantity,
      subtotal: entry.item?.subtotal,
      replaced_by: entry.replaced_by
        ? { product_name: entry.replaced_by.product_name, variant_name: entry.replaced_by.variant_name, subtotal: entry.replaced_by.subtotal }
        : null,
      refunded_amount: entry.refunded_amount || 0,
      reason: entry.reason || null,
      changed_at: entry.changed_at
    })),
    refunded_amount: order.refunded_amount || 0,
    payment: order.payment,
    payment_label: formatPaymentLabel(order.payment),
    delivery_info: order.delivery_info,
    shipping: order.shipping,
    customer_name: customer.customer_name,
    customer_email: customer.customer_email,
    customer_phone: customer.customer_phone,
    shipping_address: formatShippingAddress(order.delivery_info),
    status_history: order.status_history || [],
    refund_request: formatRefundRequestForAdmin(refundRequestDoc, order.items),
    internal_notes: parseInternalNotes(order.internal_notes)
  };
}

// Admin listing never shows cancelled orders (nothing left to do on them).
const LISTED_STATUS = { $ne: 'canceled' };

async function computeStats(createdAtFilter, orderScope = {}, typeFilter = null) {
  const baseFilter = { ...orderScope, created_at: createdAtFilter, order_status: LISTED_STATUS };
  if (typeFilter) baseFilter.$and = [typeFilter];

  const [total, processing, shipped, needsAttention] = await Promise.all([
    Order.countDocuments(baseFilter),
    Order.countDocuments({ ...baseFilter, order_status: { $in: ['pending', 'processing'] } }),
    Order.countDocuments({ ...baseFilter, order_status: 'shipping' }),
    Order.countDocuments({ ...baseFilter, ...NEEDS_ATTENTION_FILTER })
  ]);

  return { total, processing, shipped, needsAttention };
}

const LIST_FIELDS = [
  'order_id', 'user_id', 'delivery_info', 'created_at', 'order_status', 'pricing', 'is_guest',
  'subscription_id', 'subscription_start_failed', 'items.purchase_type'
];

// Admin - View all orders (GET /api/admin/orders)
async function getAllOrders(req, res) {
  try {
    const {
      order_status,
      payment_status,
      order_type,
      search,
      date_range = '30',
      date_from,
      date_to,
      attention,
      limit = 50,
      page = 1
    } = req.query;

    const createdAtFilter = buildCreatedAtFilter(date_range, date_from, date_to);
    const orderScope = req.user.role === 'cskh'
      ? { user_id: { $in: req.user.assigned_chat_customer_ids || [] } }
      : {};
    const filter = {
      ...orderScope,
      created_at: createdAtFilter,
      order_status: LISTED_STATUS
    };

    const statusFilter = mapStatusFilter(order_status);
    if (statusFilter) {
      filter.order_status = Array.isArray(statusFilter) ? { $in: statusFilter } : statusFilter;
    }

    if (payment_status) {
      filter.payment_status = payment_status;
    }

    if (ATTENTION_FILTERS[attention]) {
      Object.assign(filter, ATTENTION_FILTERS[attention]);
    }

    // Type and search both use $or, so each goes in its own $and clause.
    const typeFilter = orderTypeCondition(order_type);
    const searchFilter = searchCondition(search);
    const clauses = [typeFilter, searchFilter].filter(Boolean);
    if (clauses.length) filter.$and = clauses;

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    // Default listing (no status filter): urgent orders first, then newest first, paged in the
    // database. A status filter keeps the plain newest-first order.
    const listQuery = statusFilter
      ? Order.find(filter)
        .sort({ created_at: -1, _id: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .select(LIST_FIELDS.join(' '))
        .lean()
      : Order.aggregate([
        { $match: filter },
        { $addFields: { _urgent: URGENT_SORT_KEY } },
        { $sort: { _urgent: -1, created_at: -1, _id: -1 } },
        { $skip: skip },
        { $limit: parsedLimit },
        { $project: Object.fromEntries(LIST_FIELDS.map((field) => [field, 1])) }
      ]);

    const [orders, total, stats] = await Promise.all([
      listQuery,
      Order.countDocuments(filter),
      computeStats(createdAtFilter, orderScope, typeFilter)
    ]);
    const data = enrichOrders(orders);

    res.json({
      total,
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
    // Use lean() for a faster plain object — buildOrderDetail only reads fields, no mongoose methods needed
    const order = await Order.findOne(findOrderQuery(req.params.id)).lean();
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (
      req.user.role === 'cskh' &&
      !(req.user.assigned_chat_customer_ids || []).includes(order.user_id)
    ) {
      return res.status(403).json({ error: 'Access denied', code: 'ROLE_FORBIDDEN' });
    }

    const data = await buildOrderDetail(order);
    res.json({ data });
  } catch (error) {
    console.error('Error fetching order detail for admin:', error);
    res.status(500).json({ error: 'Failed to retrieve order.' });
  }
}

// Status changes an admin may make. Delivered / cancelled-by-customer / refunds have their own flows.
// A failed delivery is either sent out again or cancelled (refunded when already paid).
const ADMIN_STATUS_TRANSITIONS = {
  pending: ['shipping'],
  processing: ['shipping'],
  shipping: ['delivery_failed'],
  delivery_failed: ['shipping', 'canceled']
};
// Kept in the order history, the customer notification and the activity log.
const STATUSES_REQUIRING_REASON = ['delivery_failed', 'canceled'];

// Route guard: adminActivityLog requires a reason only for these target statuses.
const statusChangeRequiresReason = (req) => STATUSES_REQUIRING_REASON.includes(req.body?.status);

// Registered customers only (guests have no notification inbox).
async function notifyCustomer(order, type, detail) {
  if (!order.user_id) return;
  try {
    await notificationService.createNotification({
      recipient_id: order.user_id,
      sender: null,
      type,
      post_id: order.order_id,
      comment_content: detail || null
    });
  } catch (notifError) {
    console.error(`Error creating ${type} notification:`, notifError);
  }
}

// Admin - Update Order Status & Info (PUT /api/admin/orders/:id/status)
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, tracking_number, payment_status, note } = req.body;
    const reason = normalizeReason(req.body.reason);

    const order = await Order.findOne(findOrderQuery(id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const adminId = await getAdminActorId(req);
    const oldValue = activitySnapshot(order);
    const currentStatus = order.order_status;

    if (status && status !== currentStatus) {
      const allowed = ADMIN_STATUS_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Admin cannot change order status from ${currentStatus} to ${status}. Customers must confirm delivery or cancellation. Refunds require approving a refund request.`
        });
      }
      if (status === 'shipping' && order.items.some((item) => item.out_of_stock)) {
        return res.status(409).json({
          error: 'Some lines are out of stock. Swap or remove them (as the customer chose) before shipping.',
          code: 'OUT_OF_STOCK_LINES'
        });
      }
      // The route already rejects these without a reason; this guards direct callers.
      if (STATUSES_REQUIRING_REASON.includes(status) && !reason) {
        return res.status(400).json({ error: 'A valid reason is required.' });
      }

      order._changedBy = adminId;
      order._statusChangeNote = reason || note || `Order status updated to ${status} by admin.`;
      order.order_status = status;
      if (status === 'canceled') {
        order.canceled_at = new Date();
        if (order.payment_status === 'paid') order.payment_status = 'refunded';
      }
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
    const newValue = activitySnapshot(order);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      await req.writeActivityLog({ actionType: 'order.update-status', targetEntity: 'Orders', targetId: order.order_id, oldValue, newValue });
    }
    socketService.emitOrderUpdated(order, 'status_change');

    if (status === 'delivery_failed') {
      await notifyCustomer(order, 'ORDER_DELIVERY_FAILED', reason);
    } else if (status === 'canceled') {
      await notifyCustomer(order, 'ORDER_CANCELED_BY_STORE', reason);
    }

    // Trigger ORDER_SHIPPING notification if registered customer and status is shipping
    // (also when a failed delivery is sent out again).
    if (status === 'shipping' && order.user_id) {
      try {
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + 3);
        const formattedExpectedDate = `${expectedDate.getDate()}/${expectedDate.getMonth() + 1}/${expectedDate.getFullYear()}`;

        const notificationService = require('../services/notification.service');
        await notificationService.createNotification({
          recipient_id: order.user_id,
          sender: null,
          type: 'ORDER_SHIPPING',
          post_id: order.order_id,
          comment_content: formattedExpectedDate
        });
      } catch (notifError) {
        console.error('Error creating shipping notification:', notifError);
      }
    }

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
    const oldValue = { status: refundRequest.status, admin_reason: refundRequest.admin_reason };

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
    order._refundItems = refundRequest.refund_item || [];
    order.$locals.refundItems = order._refundItems;
    order.order_status = 'refund';
    order.payment_status = 'refunded';
    await order.save();
    // Put the refunded quantities back on the shelf (every refundable order had its stock taken).
    await require('../services/inventory.service').releaseItems(refundRequest.refund_item);
    await req.writeActivityLog({
      actionType: 'refund.approve',
      targetEntity: 'RefundRequests',
      targetId: refundRequest.refund_request_id,
      oldValue,
      newValue: { status: refundRequest.status, admin_reason: refundRequest.admin_reason }
    });
    socketService.emitOrderUpdated(order, 'refund_approved');

    // Refunded order → take its purchase points back.
    try {
      await require('../services/points.service').reversePurchasePoints(order);
    } catch (pointsErr) {
      console.error('Error reversing purchase points:', pointsErr);
    }

    // Trigger REFUND_APPROVED notification if registered customer
    if (order.user_id) {
      try {
        const notificationService = require('../services/notification.service');
        await notificationService.createNotification({
          recipient_id: order.user_id,
          sender: null,
          type: 'REFUND_APPROVED',
          post_id: order.order_id
        });
      } catch (notifError) {
        console.error('Error creating refund approval notification:', notifError);
      }
    }

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
    const rejectionReason = String(reason).trim().replace(/\s+/g, ' ').slice(0, 500);
    const oldValue = { status: refundRequest.status, admin_reason: refundRequest.admin_reason };

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

    order.order_status = 'refund_rejected';
    order._changedBy = adminId;
    order._statusChangeNote = `Refund rejected: ${rejectionReason}`;
    await order.save();
    await req.writeActivityLog({
      actionType: 'refund.reject',
      targetEntity: 'RefundRequests',
      targetId: refundRequest.refund_request_id,
      oldValue,
      newValue: { status: refundRequest.status, admin_reason: refundRequest.admin_reason },
      reason: rejectionReason
    });
    socketService.emitOrderUpdated(order, 'refund_rejected');

    // Trigger REFUND_REJECTED notification if registered customer
    if (order.user_id) {
      try {
        const notificationService = require('../services/notification.service');
        await notificationService.createNotification({
          recipient_id: order.user_id,
          sender: null,
          type: 'REFUND_REJECTED',
          post_id: order.order_id,
          comment_content: rejectionReason
        });
      } catch (notifError) {
        console.error('Error creating refund rejection notification:', notifError);
      }
    }

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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lineName = (line) =>
  [line.product_name, isNamedVariant(line.variant_name) ? `(${line.variant_name})` : null].filter(Boolean).join(' ');
const sameLine = (item, sel) => item.product_id === String(sel?.product_id) && item.variant_id === String(sel?.variant_id);

// Admin - Lines out of stock after the order was placed (POST /api/admin/orders/:id/out-of-stock)
// - Every line of the order out of stock (a single-item order, a Ritual Box delivery): the order is
//   cancelled, refunded in full when paid.
// - Otherwise only the selected lines are flagged and the customer is asked to choose: swap for an
//   item of the same or lower price, or remove it. Staff apply that choice with
//   POST /api/admin/orders/:id/out-of-stock/resolve. The order stays processing and can't ship
//   until every flagged line is resolved.
// Out-of-stock lines are never put back in stock (see the Order save hook).
async function markItemsOutOfStock(req, res) {
  try {
    const requested = Array.isArray(req.body.items) ? req.body.items : [];
    if (!requested.length) {
      return res.status(400).json({ error: 'Select at least one line that is out of stock.' });
    }

    const order = await Order.findOne(findOrderQuery(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (order.order_status !== 'processing') {
      return res.status(409).json({
        error: `Lines can only be marked out of stock while the order is processing (it is ${order.order_status}).`,
        code: 'INVALID_ORDER_STATE',
        order_status: order.order_status
      });
    }

    const lines = requested.map((sel) => order.items.find((item) => sameLine(item, sel)));
    if (lines.some((line) => !line)) {
      return res.status(400).json({ error: 'One or more selected lines are not in this order.' });
    }
    const newLines = [...new Set(lines)].filter((line) => !line.out_of_stock);
    if (!newLines.length) {
      return res.status(400).json({ error: 'These lines are already marked out of stock.' });
    }

    const adminId = await getAdminActorId(req);
    if (order.items.every((item) => item.out_of_stock || newLines.includes(item))) {
      return cancelOutOfStockOrder(req, res, order, order.items.slice(), adminId);
    }

    const oldValue = activitySnapshot(order);
    const names = newLines.map(lineName);
    const reason = normalizeReason(req.body.reason) || `Out of stock: ${names.join(', ')}`;
    newLines.forEach((line) => { line.out_of_stock = true; });
    order.internal_notes = appendInternalNote(
      order.internal_notes,
      `Out of stock after ordering: ${names.join(', ')}. Customer asked to choose a replacement (same or lower price) or to remove ${names.length > 1 ? 'them' : 'it'}.`
        + (req.body.reason ? ` Reason: ${reason}` : ''),
      adminId
    );
    await order.save();

    await req.writeActivityLog({
      actionType: 'order.mark-out-of-stock',
      targetEntity: 'Orders',
      targetId: order.order_id,
      oldValue,
      newValue: { ...activitySnapshot(order), out_of_stock_items: newLines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id })) },
      reason
    });
    socketService.emitOrderUpdated(order, 'status_change');
    await notifyCustomer(order, 'ORDER_ITEM_OUT_OF_STOCK',
      `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} out of stock. Contact us to swap ${names.length > 1 ? 'them' : 'it'} `
        + `for an item of the same or lower price, or to remove ${names.length > 1 ? 'them' : 'it'} from your order.`);

    const data = await buildOrderDetail(order);
    res.json({ message: 'Lines marked out of stock: waiting for the customer to choose', data });
  } catch (error) {
    console.error('Error marking items out of stock:', error);
    res.status(500).json({ error: error.message || 'Failed to mark items out of stock.' });
  }
}

// Every line is out of stock: cancel the whole order (refunded in full when paid).
async function cancelOutOfStockOrder(req, res, order, lines, adminId) {
  const oldValue = activitySnapshot(order);
  const names = [...new Set(lines)].map(lineName);
  const reason = normalizeReason(req.body.reason) || `Out of stock: ${names.join(', ')}`;
  const wasPaid = order.payment_status === 'paid';

  lines.forEach((line) => { line.out_of_stock = true; });
  order.order_status = 'canceled';
  order.canceled_at = new Date();
  if (wasPaid) order.payment_status = 'refunded';
  order._changedBy = adminId;
  order._statusChangeNote = `Cancelled by store — ${reason}`;
  order.internal_notes = appendInternalNote(
    order.internal_notes,
    `Out of stock after ordering: ${names.join(', ')}. Order cancelled${wasPaid ? ' and refunded in full' : ''}.`
      + (req.body.reason ? ` Reason: ${reason}` : ''),
    adminId
  );
  await order.save();

  await req.writeActivityLog({
    actionType: 'order.mark-out-of-stock',
    targetEntity: 'Orders',
    targetId: order.order_id,
    oldValue,
    newValue: { ...activitySnapshot(order), out_of_stock_items: lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id })) },
    reason
  });
  socketService.emitOrderUpdated(order, 'status_change');
  await notifyCustomer(order, 'ORDER_CANCELED_BY_STORE', `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} out of stock`
    + (wasPaid ? '. Your payment will be refunded in full.' : '.'));

  // A Ritual Box delivery order: the box stays active (next_charge_at is already the next cycle),
  // but this cycle is recorded as skipped and the customer told. Cancelling the box itself is
  // done on purpose from Admin › Subscriptions, never here. The order is already cancelled, so a
  // failure here is logged rather than failing the request.
  if (order.subscription_id) {
    try {
      const skipped = await subscriptionService.skipCycleForCanceledOrder(order, {
        adminId, reason, itemNames: names, refunded: wasPaid
      });
      if (skipped) {
        await req.writeActivityLog({
          actionType: 'subscription.skip',
          targetEntity: 'Subscriptions',
          targetId: skipped.sub.subscription_id,
          oldValue: skipped.oldValue,
          newValue: skipped.newValue,
          reason
        });
      }
    } catch (err) {
      console.error(`Order ${order.order_id}: could not record the skipped Ritual Box cycle.`, err);
    }
  }

  const data = await buildOrderDetail(order);
  return res.json({ message: 'Order cancelled: items out of stock', data });
}

// Image for a new order line (order items require one).
function lineImage(product, variant) {
  const image = variant?.images?.[0] || product?.images?.[0] || {};
  return { url: image.url || 'none', public_id: image.public_id || 'none' };
}

// Order total after a line change. The voucher discount already applied is kept (never more than
// the new subtotal + shipping).
function repriceOrder(order) {
  const subtotal = round2(order.items.reduce((sum, item) => sum + (item.subtotal || 0), 0));
  const shipping = order.pricing?.shipping_cost || 0;
  const discount = Math.min(order.pricing?.discount_amount || 0, round2(subtotal + shipping));
  order.pricing.subtotal = subtotal;
  order.pricing.discount_amount = discount;
  order.pricing.total = Math.max(0, round2(subtotal + shipping - discount));
  if (order.coupon) order.coupon.discount_amount = discount;
}

// Admin - Items a line marked out of stock can be swapped for
// (GET /api/admin/orders/:id/out-of-stock/replacements?product_id=&variant_id=)
// Active variants priced at or below the line's unit price, with enough stock for its quantity,
// not already in the order. Same category first, then by price (highest first).
async function listOutOfStockReplacements(req, res) {
  try {
    const order = await Order.findOne(findOrderQuery(req.params.id)).lean();
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const line = (order.items || []).find((item) => sameLine(item, req.query) && item.out_of_stock);
    if (!line) return res.status(400).json({ error: 'This line is not marked out of stock.' });
    if (line.purchase_type === 'subscription') return res.json({ data: [] });

    const Product = require('../models/Product');
    const inOrder = new Set((order.items || []).map((item) => `${item.product_id}:${item.variant_id}`));
    const current = await require('../services/inventory.service').findProduct(line.product_id);
    const products = await Product.find({
      is_active: { $ne: false },
      variants: { $elemMatch: { price: { $lte: line.unit_price }, stock: { $gte: line.quantity } } }
    }).select('name category variants images').lean();

    const options = [];
    for (const product of products) {
      for (const variant of product.variants || []) {
        if (variant.price > line.unit_price || (variant.stock ?? 0) < line.quantity) continue;
        if (inOrder.has(`${product._id}:${variant.sku}`)) continue;
        options.push({
          product_id: String(product._id),
          variant_id: variant.sku,
          product_name: product.name,
          variant_name: variant.label || 'Default',
          category: product.category || null,
          unit_price: variant.price,
          stock: variant.stock ?? 0,
          same_category: !!current && product.category === current.category
        });
      }
    }
    options.sort((a, b) => (b.same_category - a.same_category) || (b.unit_price - a.unit_price) || a.product_name.localeCompare(b.product_name));
    res.json({ data: options.slice(0, 100) });
  } catch (error) {
    console.error('Error listing out-of-stock replacements:', error);
    res.status(500).json({ error: 'Failed to list replacement items.' });
  }
}

// Admin - Apply the customer's choice for a line marked out of stock
// (POST /api/admin/orders/:id/out-of-stock/resolve)
// Body: { product_id, variant_id, action: 'remove' | 'swap', replacement: { product_id, variant_id }, reason }
// - remove: the line leaves the order; the last line left cancels the order instead.
// - swap: replaced by another item of the same or lower unit price (one-time lines only), same quantity.
// The order total is recalculated; when paid, the difference is refunded (refunded_amount,
// payment_status stays 'paid'). Purchase points follow the new subtotal.
async function resolveOutOfStockLine(req, res) {
  let reserved = null;
  try {
    const { action } = req.body;
    if (!['remove', 'swap'].includes(action)) {
      return res.status(400).json({ error: "Choose 'remove' or 'swap'." });
    }

    const order = await Order.findOne(findOrderQuery(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (order.order_status !== 'processing') {
      return res.status(409).json({
        error: `Out-of-stock lines can only be changed while the order is processing (it is ${order.order_status}).`,
        code: 'INVALID_ORDER_STATE',
        order_status: order.order_status
      });
    }
    const line = order.items.find((item) => sameLine(item, req.body) && item.out_of_stock);
    if (!line) {
      return res.status(400).json({ error: 'This line is not marked out of stock.' });
    }

    const adminId = await getAdminActorId(req);
    if (action === 'remove' && order.items.length === 1) {
      return cancelOutOfStockOrder(req, res, order, [line], adminId);
    }

    let replacement = null;
    if (action === 'swap') {
      if (line.purchase_type === 'subscription') {
        return res.status(400).json({ error: "A Ritual Box line can't be swapped. Remove it instead." });
      }
      const target = req.body.replacement || {};
      const inventoryService = require('../services/inventory.service');
      const product = await inventoryService.findProduct(target.product_id);
      const variant = (product?.variants || []).find((v) => v.sku === String(target.variant_id));
      if (!product || product.is_active === false || !variant) {
        return res.status(400).json({ error: 'Choose an available replacement item.' });
      }
      const productId = String(product._id);
      if (order.items.some((item) => item.product_id === productId && item.variant_id === variant.sku)) {
        return res.status(400).json({ error: 'This item is already in the order. Remove the line instead.' });
      }
      if (variant.price > line.unit_price) {
        return res.status(400).json({ error: `Choose an item priced at $${line.unit_price} or less.` });
      }
      replacement = {
        product_id: productId,
        variant_id: variant.sku,
        product_name: product.name,
        variant_name: variant.label || 'Default',
        image: lineImage(product, variant),
        unit_price: variant.price,
        quantity: line.quantity,
        subtotal: round2(variant.price * line.quantity),
        purchase_type: 'one_time',
        subscription_frequency_days: null
      };
      const reservation = await inventoryService.reserveItems([replacement]);
      if (!reservation.ok) {
        return res.status(409).json({ error: `${product.name} doesn't have ${line.quantity} in stock.`, code: 'OUT_OF_STOCK' });
      }
      reserved = [replacement];
    }

    const oldValue = activitySnapshot(order);
    const reason = normalizeReason(req.body.reason) || null;
    const removedLine = line.toObject ? line.toObject() : { ...line };
    const totalBefore = order.pricing.total;
    const index = order.items.indexOf(line);
    if (replacement) order.items.splice(index, 1, replacement);
    else order.items.splice(index, 1);
    repriceOrder(order);

    const wasPaid = order.payment_status === 'paid';
    const refunded = wasPaid ? Math.max(0, round2(totalBefore - order.pricing.total)) : 0;
    order.refunded_amount = round2((order.refunded_amount || 0) + refunded);
    order.removed_items.push({
      item: removedLine,
      action: replacement ? 'swapped' : 'removed',
      replaced_by: replacement,
      refunded_amount: refunded,
      reason,
      changed_by: adminId,
      changed_at: new Date()
    });
    const what = replacement
      ? `${lineName(removedLine)} swapped for ${lineName(replacement)}`
      : `${lineName(removedLine)} removed`;
    const money = wasPaid
      ? (refunded > 0 ? ` $${refunded} refunded.` : '')
      : ` New total $${order.pricing.total}.`;
    order.internal_notes = appendInternalNote(order.internal_notes, `Out of stock: ${what} (customer agreed).${money}`
      + (reason ? ` Reason: ${reason}` : ''), adminId);
    await order.save();
    reserved = null;

    try {
      await require('../services/points.service').updatePurchasePoints(order);
    } catch (pointsErr) {
      console.error(`Updating purchase points for order ${order.order_id} failed:`, pointsErr);
    }
    await req.writeActivityLog({
      actionType: 'order.resolve-out-of-stock',
      targetEntity: 'Orders',
      targetId: order.order_id,
      oldValue,
      newValue: { ...activitySnapshot(order), action, item: { product_id: removedLine.product_id, variant_id: removedLine.variant_id }, replaced_by: replacement && { product_id: replacement.product_id, variant_id: replacement.variant_id }, refunded_amount: refunded, total: order.pricing.total },
      reason
    });
    socketService.emitOrderUpdated(order, 'status_change');
    await notifyCustomer(order, 'ORDER_ITEMS_UPDATED', `${what}.${money}`.trim());

    const data = await buildOrderDetail(order);
    res.json({ message: replacement ? 'Line swapped' : 'Line removed', data });
  } catch (error) {
    if (reserved) await require('../services/inventory.service').releaseItems(reserved);
    console.error('Error resolving out-of-stock line:', error);
    res.status(500).json({ error: error.message || 'Failed to update the order.' });
  }
}

const isNamedVariant = (name) => !!name && !/^default$/i.test(String(name).trim());

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
    const oldValue = activitySnapshot(order);
    order.internal_notes = appendInternalNote(order.internal_notes, String(note).trim(), adminId);
    await order.save();
    await req.writeActivityLog({
      actionType: 'order.add-internal-note',
      targetEntity: 'Orders',
      targetId: order.order_id,
      oldValue,
      newValue: activitySnapshot(order)
    });

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
  addInternalNote,
  markItemsOutOfStock,
  resolveOutOfStockLine,
  listOutOfStockReplacements,
  statusChangeRequiresReason
};
