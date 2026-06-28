const Order = require('../models/Order');
const User = require('../models/User');
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

async function computeStats(createdAtFilter) {
  const baseFilter = { created_at: createdAtFilter };

  const [total, processing, shipped, needsAttention] = await Promise.all([
    Order.countDocuments(baseFilter),
    Order.countDocuments({ ...baseFilter, order_status: { $in: ['pending', 'processing'] } }),
    Order.countDocuments({ ...baseFilter, order_status: 'shipping' }),
    Order.countDocuments({
      ...baseFilter,
      $or: [
        { order_status: 'canceled' },
        { order_status: 'refund' },
        { 'refund_request.status': 'pending' }
      ]
    })
  ]);

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

    const adminUser = await User.findById(req.user.user_id);
    const adminId = adminUser ? adminUser.user_id : 'system';

    order._changedBy = adminId;
    order._statusChangeNote = note || `Order updated by admin.`;

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
