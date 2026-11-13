const Order = require('../models/Order');
const RefundRequest = require('../models/RefundRequest');
const subscriptionService = require('../services/subscription.service');
const { normalizeReason } = require('../services/activity-log.service');
const notificationService = require('../services/notification.service');
const { parseInternalNotes, appendInternalNote } = require('../utils/internal-notes');
const mongoose = require('mongoose');
const socketService = require('../services/socket.service');
const { supportOrderCustomerIds } = require('../services/support-order-scope.service');
const redelivery = require('../services/redelivery.service');

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
  if (REDELIVERY_FILTERS[orderStatus]) return 'delivery_failed';
  return orderStatus;
}

// Failed deliveries by redelivery state (?order_status=…): waiting on the customer's answer, or
// confirmed by the customer and waiting for staff to ship again.
const REDELIVERY_FILTERS = {
  redelivery_awaiting: 'awaiting_customer',
  redelivery_confirmed: 'confirmed'
};

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
    const reasons = attentionReasons(order);
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
      redelivery_status: order.order_status === 'delivery_failed' ? (order.redelivery?.status || null) : null,
      refund_status: order.refund_status || null,
      attention_reasons: reasons,
      needs_attention: reasons.length > 0
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

// Urgent orders ("Needs attention"): a refund request waiting on staff, a failed delivery, a
// paid Ritual Box that couldn't start, or an order still being prepared URGENT_PROCESSING_DAYS
// after it was placed (the bell's "Urgent preparation needed"). One definition for the stat card,
// the filter, the urgent-first sort and the row flag. Cancelled orders never reach the listing.
const URGENT_STATUSES = ['pending_refund', 'delivery_failed'];
const URGENT_PROCESSING_DAYS = 3; // same threshold as admin-notification.service.ts
const DAY_MS = 86_400_000;

function urgentProcessingCutoff(now = Date.now()) {
  return new Date(now - URGENT_PROCESSING_DAYS * DAY_MS);
}

function needsAttentionFilter(now = Date.now()) {
  return {
    $or: [
      { order_status: { $in: URGENT_STATUSES } },
      { subscription_start_failed: true },
      { order_status: 'processing', created_at: { $lte: urgentProcessingCutoff(now) } }
    ]
  };
}

// Same rule as an aggregation expression (1 = urgent), for sorting in the database.
function urgentSortKey(now = Date.now()) {
  return {
    $cond: [
      {
        $or: [
          { $in: ['$order_status', URGENT_STATUSES] },
          { $eq: ['$subscription_start_failed', true] },
          { $and: [{ $eq: ['$order_status', 'processing'] }, { $lte: ['$created_at', urgentProcessingCutoff(now)] }] }
        ]
      },
      1,
      0
    ]
  };
}

// Why an order is urgent, in the order the badges are shown.
function attentionReasons(order, now = Date.now()) {
  const reasons = [];
  if (URGENT_STATUSES.includes(order.order_status)) reasons.push(order.order_status);
  if (order.order_status === 'processing' && new Date(order.created_at) <= urgentProcessingCutoff(now)) {
    reasons.push('urgent_preparation');
  }
  if (order.subscription_start_failed) reasons.push('ritual_box_not_started');
  return reasons;
}

// "Needs attention" filters (?attention=…): every urgent order, or one flag the system sets.
const ATTENTION_FILTERS = {
  needs_attention: needsAttentionFilter,
  ritual_box_not_started: () => ({ subscription_start_failed: true })
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

// Note of the latest status_history entry with this status (older orders kept reasons there).
function latestNote(order, status) {
  return [...(order.status_history || [])].reverse().find((h) => h.status === status)?.note || null;
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
    internal_notes: parseInternalNotes(order.internal_notes),
    // Failed delivery / redelivery (absent on older orders).
    delivery_failed_reason_code: order.delivery_failed_reason_code || null,
    delivery_failed_reason: order.delivery_failed_reason || latestNote(order, 'delivery_failed'),
    delivery_attempts: order.delivery_attempts || 0,
    max_redelivery_attempts: redelivery.MAX_REDELIVERY_ATTEMPTS,
    redelivery: order.redelivery ? (order.redelivery.toObject ? order.redelivery.toObject() : order.redelivery) : null,
    can_redeliver: redelivery.canRedeliver(order),
    refund_status: order.refund_status || null,
    refund_destination: order.refund_destination ? (order.refund_destination.toObject ? order.refund_destination.toObject() : order.refund_destination) : null
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
    Order.countDocuments({ ...baseFilter, ...needsAttentionFilter() })
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
    const customerIds = await supportOrderCustomerIds(req.user);
    const orderScope = customerIds ? { user_id: { $in: customerIds } } : {};
    const filter = {
      ...orderScope,
      created_at: createdAtFilter,
      order_status: LISTED_STATUS
    };

    const statusFilter = mapStatusFilter(order_status);
    if (statusFilter) {
      filter.order_status = Array.isArray(statusFilter) ? { $in: statusFilter } : statusFilter;
    }
    if (REDELIVERY_FILTERS[order_status]) filter['redelivery.status'] = REDELIVERY_FILTERS[order_status];

    if (payment_status) {
      filter.payment_status = payment_status;
    }

    if (ATTENTION_FILTERS[attention]) {
      Object.assign(filter, ATTENTION_FILTERS[attention]());
    }

    // Type and search both use $or, so each goes in its own $and clause.
    const typeFilter = orderTypeCondition(order_type);
    const searchFilter = searchCondition(search);
    const clauses = [typeFilter, searchFilter].filter(Boolean);
    if (clauses.length) filter.$and = clauses;

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    // Urgent orders first (also within a status filter, e.g. Processing), then newest first,
    // paged in the database.
    const listQuery = Order.aggregate([
      { $match: filter },
      { $addFields: { _urgent: urgentSortKey() } },
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

    const customerIds = await supportOrderCustomerIds(req.user);
    if (customerIds && !customerIds.includes(order.user_id)) {
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

    let order = await Order.findOne(findOrderQuery(id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const adminId = await getAdminActorId(req);
    const oldValue = activitySnapshot(order);
    const currentStatus = order.order_status;
    let failure = null; // what the delivery_failed change asks of the customer

    if (status && status !== currentStatus) {
      const allowed = ADMIN_STATUS_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Admin cannot change order status from ${currentStatus} to ${status}. Customers must confirm delivery or cancellation. Refunds require approving a refund request.`
        });
      }
      // The route already rejects these without a reason; this guards direct callers.
      if (STATUSES_REQUIRING_REASON.includes(status) && !reason) {
        return res.status(400).json({ error: 'A valid reason is required.' });
      }
      if (status === 'delivery_failed' && !redelivery.REASON_CODES.includes(req.body.reason_code)) {
        return res.status(400).json({ error: 'Choose why the delivery failed.', code: 'REASON_CODE_REQUIRED' });
      }
      // Ship again: only with a redelivery left and the customer's confirmation (or a carrier fault).
      if (status === 'shipping' && currentStatus === 'delivery_failed' && !redelivery.canRedeliver(order)) {
        return res.status(409).json({
          error: !redelivery.hasRedeliveryLeft(order)
            ? 'No redeliveries left for this order. Cancel it instead.'
            : 'Waiting for the customer to confirm the redelivery.',
          code: 'REDELIVERY_NOT_ALLOWED'
        });
      }
      // Cancelling a failed delivery races the customer's own cancel and the expiry job: claim it.
      if (status === 'canceled' && currentStatus === 'delivery_failed') {
        const claimed = await redelivery.claimForStaffCancel(order._id, new Date());
        if (!claimed) {
          return res.status(409).json({ error: 'This order is being updated. Reload and try again.', code: 'ORDER_BUSY' });
        }
        order = claimed;
        order.cancel_lock_until = null;
      }

      order._changedBy = adminId;
      order._statusChangeNote = reason || note || `Order status updated to ${status} by admin.`;
      order.order_status = status;
      if (status === 'canceled') {
        order.canceled_at = new Date();
        // Same refund rule as the customer's cancel: card / bank_transfer back to the same
        // account, paid QR waits for a payout (the Order hook marks a paid order refunded).
        redelivery.applyCancelRefund(order);
      }
      if (status === 'delivery_failed') {
        failure = redelivery.recordDeliveryFailure(order, { reasonCode: req.body.reason_code, note: reason, now: new Date() });
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
      const ask = {
        awaiting_customer: `Confirm the redelivery or cancel within ${redelivery.REDELIVERY_CONFIRM_HOURS} hours.`,
        carrier_issue: "We'll send it out again.",
        exhausted: 'No redeliveries left: this order will be cancelled and refunded.'
      }[failure];
      await notifyCustomer(order, 'ORDER_DELIVERY_FAILED', [reason, ask].filter(Boolean).join(' · '));
    } else if (status === 'canceled') {
      const refund = order.refund_status === 'pending_payout'
        ? ' · Add the bank account for your refund on the order page.'
        : order.refund_status === 'completed' ? ' · Refunded to your card.' : '';
      await notifyCustomer(order, 'ORDER_CANCELED_BY_STORE', `${reason}${refund}`);
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

    // Claim the request atomically: of two concurrent approvals only one moves it out of
    // 'pending', so the refunded quantities go back on the shelf exactly once.
    const approved = await RefundRequest.findOneAndUpdate(
      { _id: refundRequest._id, status: 'pending' },
      {
        $set: { status: 'approved', reviewed_by: adminId, reviewed_at: now },
        $push: {
          status_history: {
            status: 'approved',
            changed_at: now,
            changed_by: adminId,
            note: 'Refund request approved by admin'
          }
        }
      },
      { new: true }
    );
    if (!approved) {
      return res.status(409).json({ error: 'This refund request has already been reviewed.' });
    }

    order._changedBy = adminId;
    order._statusChangeNote = 'Refund approved by admin';
    order._refundItems = approved.refund_item || [];
    order.$locals.refundItems = order._refundItems;
    order.order_status = 'refund';
    order.payment_status = 'refunded';
    await order.save();
    // Put the refunded quantities back on the shelf (every refundable order had its stock taken).
    await require('../services/inventory.service').releaseItems(approved.refund_item);
    await req.writeActivityLog({
      actionType: 'refund.approve',
      targetEntity: 'RefundRequests',
      targetId: refundRequest.refund_request_id,
      oldValue,
      newValue: { status: approved.status, admin_reason: approved.admin_reason }
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

// Admin - QR refund paid out (POST /api/admin/orders/:id/refunds/mark-paid)
// For a cancelled paid QR order waiting on a manual transfer (refund_status pending_payout):
// staff transferred the money to refund_destination; the customer is told.
async function markRefundPaid(req, res) {
  try {
    const order = await Order.findOne(findOrderQuery(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.refund_status !== 'pending_payout') {
      return res.status(409).json({ error: 'This order has no refund waiting to be paid out.', code: 'NO_PENDING_PAYOUT' });
    }
    if (!order.refund_destination?.account_number) {
      return res.status(409).json({ error: 'The customer has not added the bank account for the refund yet.', code: 'NO_REFUND_DESTINATION' });
    }
    const adminId = await getAdminActorId(req);
    const now = new Date();
    const dest = order.refund_destination;
    const paid = await Order.findOneAndUpdate(
      { _id: order._id, refund_status: 'pending_payout' },
      {
        $set: {
          refund_status: 'completed',
          internal_notes: appendInternalNote(order.internal_notes,
            `Refund of $${order.pricing?.total ?? 0} paid out to ${dest.bank_name} ${dest.account_number} (${dest.account_holder}).`, adminId)
        }
      },
      { new: true }
    );
    if (!paid) return res.status(409).json({ error: 'This refund was already marked as paid.', code: 'NO_PENDING_PAYOUT' });

    await req.writeActivityLog({
      actionType: 'order.refund-mark-paid',
      targetEntity: 'Orders',
      targetId: paid.order_id,
      oldValue: { refund_status: 'pending_payout' },
      newValue: { refund_status: 'completed', bank_name: dest.bank_name, account_last4: String(dest.account_number).slice(-4) }
    });
    socketService.emitOrderUpdated(paid, 'refund_paid');
    await notifyCustomer(paid, 'ORDER_REFUND_PAID', `$${paid.pricing?.total ?? 0} to ${dest.bank_name} ····${String(dest.account_number).slice(-4)}`);
    const data = await buildOrderDetail(paid);
    res.json({ message: 'Refund marked as paid', data });
  } catch (error) {
    console.error('Error marking refund paid:', error);
    res.status(500).json({ error: error.message || 'Failed to mark the refund as paid.' });
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
  markRefundPaid,
  statusChangeRequiresReason
};
