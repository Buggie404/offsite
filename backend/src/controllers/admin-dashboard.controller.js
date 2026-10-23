const Order = require('../models/Order');
const RefundRequest = require('../models/RefundRequest');
const PostReport = require('../models/PostReport');
const CommentReport = require('../models/CommentReport');
const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const Product = require('../models/Product');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Voucher = require('../models/Voucher');
const Recipe = require('../models/Recipe');

// The app has no separate Payment collection. A paid, non-cancelled/non-refunded
// order is therefore the single source of truth for recognised revenue.
const REVENUE_ORDER_FILTER = {
  payment_status: 'paid',
  order_status: { $nin: ['canceled', 'refund', 'pending_refund'] }
};

function asDate(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function readRange(query) {
  const start = asDate(query.start);
  const end = asDate(query.end);
  return start && end && start <= end ? { start, end } : null;
}

function dateFilter({ start, end }) { return { $gte: start, $lte: end }; }

function getBusinessDateParts(now = new Date()) {
  const timeZone = process.env.BUSINESS_TIMEZONE || 'Asia/Ho_Chi_Minh';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  } catch {
    return {
      year: String(now.getUTCFullYear()), month: String(now.getUTCMonth() + 1).padStart(2, '0'),
      day: String(now.getUTCDate()).padStart(2, '0'), hour: String(now.getUTCHours()).padStart(2, '0'),
      minute: String(now.getUTCMinutes()).padStart(2, '0'), second: String(now.getUTCSeconds()).padStart(2, '0')
    };
  }
}

function getBusinessDay(now = new Date()) {
  const parts = getBusinessDateParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getBusinessDayBounds(now = new Date()) {
  const parts = getBusinessDateParts(now);
  const localNowAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const timezoneOffset = localNowAsUtc - now.getTime();
  const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - timezoneOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function firstResponsePipeline(chatScope) {
  const pipeline = [
    { $sort: { conversation_id: 1, created_at: 1 } },
    { $group: { _id: '$conversation_id', messages: { $push: { sender_type: '$sender_type', created_at: '$created_at' } } } },
    { $project: { firstCustomer: { $arrayElemAt: [{ $filter: { input: '$messages', as: 'message', cond: { $eq: ['$$message.sender_type', 'customer'] } } }, 0] }, messages: 1 } },
    { $match: { firstCustomer: { $ne: null } } },
    {
      $project: {
        firstCustomer: 1,
        firstAgent: {
          $arrayElemAt: [{ $filter: { input: '$messages', as: 'message', cond: { $and: [{ $eq: ['$$message.sender_type', 'agent'] }, { $gt: ['$$message.created_at', '$firstCustomer.created_at'] }] } } }, 0]
        }
      }
    },
    { $match: { firstAgent: { $ne: null } } }
  ];

  if (chatScope.customer_id) {
    pipeline.push(
      { $lookup: { from: ChatConversation.collection.name, localField: '_id', foreignField: 'conversation_id', as: 'conversation' } },
      { $match: { 'conversation.customer_id': chatScope.customer_id } }
    );
  }

  pipeline.push(
    { $project: { response_ms: { $subtract: ['$firstAgent.created_at', '$firstCustomer.created_at'] } } },
    { $group: { _id: null, average_ms: { $avg: '$response_ms' } } }
  );
  return pipeline;
}

async function periodMetrics(range) {
  const created_at = dateFilter(range);
  const [[summary], orders, newCustomers] = await Promise.all([
    Order.aggregate([
      { $match: { ...REVENUE_ORDER_FILTER, created_at } },
      { $group: { _id: null, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } }
    ]),
    // Keep this in lockstep with the Orders page's "Total orders" stat: every
    // order created in the selected period, irrespective of payment status.
    Order.countDocuments({ created_at }),
    User.countDocuments({ role: 'customer', createdAt: created_at })
  ]);
  const revenue = summary?.revenue || 0;
  const revenueEligibleOrders = summary?.orders || 0;
  // AOV must use the same eligible order population as recognised revenue,
  // rather than the operational Total Orders KPI above.
  return { revenue, orders, aov: revenueEligibleOrders ? revenue / revenueEligibleOrders : 0, newCustomers };
}

function revenueSeries(range, timezone) {
  return Order.aggregate([
    { $match: { ...REVENUE_ORDER_FILTER, created_at: dateFilter(range) } },
    { $group: { _id: { $dateToString: { date: '$created_at', format: '%Y-%m-%d', timezone } }, revenue: { $sum: '$pricing.total' } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', revenue: 1 } }
  ]).then((daily) => {
    // Daily remains readable through 30 days.  Roll 90-day views into calendar
    // weeks so the chart has a useful density without changing its revenue total.
    if ((range.end.getTime() - range.start.getTime()) / 86_400_000 <= 62) return daily;
    const weeks = new Map();
    for (const row of daily) {
      const date = new Date(`${row.date}T00:00:00Z`);
      const weekday = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - weekday);
      const key = date.toISOString().slice(0, 10);
      weeks.set(key, (weeks.get(key) || 0) + row.revenue);
    }
    return [...weeks].map(([date, revenue]) => ({ date, revenue }));
  });
}

async function getTodos() {
  const { start: todayStart, end: tomorrowStart } = getBusinessDayBounds();
  const createdToday = { $gte: todayStart, $lt: tomorrowStart };
  const [waitingToShip, refunds, posts, comments, chats, lowStock, paymentFailed] = await Promise.all([
    // These two totals intentionally use the exact Orders page filters linked
    // from the To-do rows: status plus Date = Today.
    Order.countDocuments({ order_status: { $in: ['pending', 'processing'] }, created_at: createdToday }),
    Order.countDocuments({ order_status: 'pending_refund', created_at: createdToday }),
    PostReport.distinct('post_id', { status: 'pending' }),
    CommentReport.distinct('comment_id', { status: 'pending' }),
    ChatConversation.countDocuments({ status: 'waiting' }),
    // Products has no configurable low-stock threshold. Reuse the established
    // stock rule used by subscriptions and checkout: a variant at <= 0 needs action.
    Product.aggregate([{ $match: { is_active: true } }, { $unwind: '$variants' }, { $match: { 'variants.stock': { $lte: 0 } } }, { $count: 'count' }]),
    Subscription.countDocuments({ status: 'payment_failed' })
  ]);
  return {
    waiting_to_ship: waitingToShip,
    refund_requests: refunds,
    reports_to_review: posts.length + comments.length,
    chats_waiting: chats,
    low_stock_variants: lowStock[0]?.count || 0,
    ritual_box_payment_failed: paymentFailed
  };
}

async function getDashboard(req, res) {
  const range = readRange(req.query);
  if (!range) return res.status(400).json({ error: 'A valid start and end timestamp are required.' });
  const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return res.status(400).json({ error: 'Invalid timezone.' });
  }
  try {
    const includeTodos = req.query.include_todos !== 'false';
    const [current, series, todos] = await Promise.all([
      periodMetrics(range), revenueSeries(range, timezone), includeTodos ? getTodos() : Promise.resolve(null)
    ]);
    res.json({
      range: { start: range.start.toISOString(), end: range.end.toISOString(), timezone },
      kpis: {
        revenue: { value: current.revenue },
        orders: { value: current.orders },
        aov: { value: current.aov },
        new_customers: { value: current.newCustomers }
      },
      revenue_series: series,
      ...(todos ? { todos } : {})
    });
  } catch (error) {
    console.error('Failed to load admin dashboard:', error);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
}

async function getSalesDashboard(req, res) {
  const range = readRange(req.query);
  if (!range) return res.status(400).json({ error: 'A valid start and end timestamp are required.' });
  try {
    const today = getBusinessDay();
    const created_at = dateFilter(range);
    const [ordersToShip, refundRequests, reportedPosts, reportedComments, waitingChats, lowStock, activeVouchers, failedRitualBoxes] = await Promise.all([
      Order.countDocuments({ order_status: { $in: ['pending', 'processing'] }, created_at }),
      Order.countDocuments({ order_status: 'pending_refund', created_at }),
      PostReport.distinct('post_id', { status: 'pending' }),
      CommentReport.distinct('comment_id', { status: 'pending' }),
      ChatConversation.countDocuments({ status: 'waiting' }),
      Product.aggregate([
        { $match: { is_active: true } },
        { $unwind: '$variants' },
        { $match: { 'variants.stock': { $lte: 0 } } },
        { $count: 'count' }
      ]),
      // Voucher dates are stored as YYYY-MM-DD strings, so lexical bounds retain
      // their intended calendar-date semantics without timezone conversion.
      Voucher.countDocuments({
        is_active: true,
        valid_from: { $lte: today },
        valid_to: { $gte: today },
        $expr: { $or: [{ $eq: ['$usage_limit', null] }, { $lt: ['$used_count', '$usage_limit'] }] }
      }),
      Subscription.countDocuments({ status: 'payment_failed' })
    ]);
    const lowStockVariants = lowStock[0]?.count || 0;
    const reportsToReview = reportedPosts.length + reportedComments.length;
    res.json({
      kpis: {
        orders_to_ship: ordersToShip,
        refund_requests: refundRequests,
        reports_to_review: reportsToReview,
        chats_waiting: waitingChats,
        low_stock_variants: lowStockVariants,
        active_vouchers: activeVouchers
      },
      todos: {
        orders_to_ship: ordersToShip,
        refund_requests: refundRequests,
        reports_to_review: reportsToReview,
        chats_waiting: waitingChats,
        low_stock_variants: lowStockVariants,
        ritual_box_payment_failed: failedRitualBoxes
      }
    });
  } catch (error) {
    console.error('Failed to load sales dashboard:', error);
    res.status(500).json({ error: 'Failed to load sales dashboard data.' });
  }
}

async function getServicesDashboard(req, res) {
  try {
    const { start: todayStart, end: tomorrowStart } = getBusinessDayBounds();
    // Voucher.createdAt is ISO-8601; these UTC instants form the business-day
    // bounds while preserving lexical string comparison in MongoDB.
    let chatScope = {};
    if (req.user.role === 'cskh') {
      const agent = await User.findById(req.user.user_id, 'assigned_chat_customer_ids').lean();
      chatScope = { customer_id: { $in: agent?.assigned_chat_customer_ids || [] } };
    }
    const [waitingChats, reportedPosts, reportedComments, restrictedCustomers, recipesAwaitingApproval, vouchersIssuedToday, firstResponse] = await Promise.all([
      ChatConversation.countDocuments({ ...chatScope, status: 'waiting' }),
      PostReport.distinct('post_id', { status: 'pending' }),
      CommentReport.distinct('comment_id', { status: 'pending' }),
      User.countDocuments({ role: 'customer', status: 'suspended' }),
      Recipe.countDocuments({ published: false }),
      Voucher.countDocuments({ createdAt: { $gte: todayStart.toISOString(), $lt: tomorrowStart.toISOString() } }),
      ChatMessage.aggregate(firstResponsePipeline(chatScope))
    ]);
    const reportsToReview = reportedPosts.length + reportedComments.length;
    res.json({
      kpis: {
        chats_waiting: waitingChats,
        reports_to_review: reportsToReview,
        restricted_customers: restrictedCustomers,
        avg_first_response_ms: firstResponse[0]?.average_ms || 0
      },
      todos: {
        chats_waiting: waitingChats,
        reports_to_review: reportsToReview,
        recipes_awaiting_approval: recipesAwaitingApproval,
        support_vouchers_issued_today: vouchersIssuedToday
      }
    });
  } catch (error) {
    console.error('Failed to load services dashboard:', error);
    res.status(500).json({ error: 'Failed to load services dashboard data.' });
  }
}

module.exports = { getDashboard, getSalesDashboard, getServicesDashboard };
