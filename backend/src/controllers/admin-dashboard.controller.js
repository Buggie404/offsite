const Order = require('../models/Order');
const RefundRequest = require('../models/RefundRequest');
const PostReport = require('../models/PostReport');
const CommentReport = require('../models/CommentReport');
const Report = require('../models/Report');
const ContactMessage = require('../models/ContactMessage');
const ChatConversation = require('../models/ChatConversation');
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

// "Ritual Box payment failed" to-do: renewals that could not be charged plus orders whose
// first Ritual Box charge failed at checkout (subscription_start_failed, never started).
async function countRitualBoxPaymentFailed() {
  const [renewals, notStarted] = await Promise.all([
    Subscription.countDocuments({ status: 'payment_failed' }),
    Order.countDocuments({ subscription_start_failed: true })
  ]);
  return { total: renewals + notStarted, notStarted };
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
    countRitualBoxPaymentFailed()
  ]);
  return {
    waiting_to_ship: waitingToShip,
    refund_requests: refunds,
    reports_to_review: posts.length + comments.length,
    chats_waiting: chats,
    low_stock_variants: lowStock[0]?.count || 0,
    ritual_box_payment_failed: paymentFailed.total,
    ritual_box_start_failed: paymentFailed.notStarted
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
      countRitualBoxPaymentFailed()
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
        ritual_box_payment_failed: failedRitualBoxes.total,
        ritual_box_start_failed: failedRitualBoxes.notStarted
      }
    });
  } catch (error) {
    console.error('Failed to load sales dashboard:', error);
    res.status(500).json({ error: 'Failed to load sales dashboard data.' });
  }
}

const QUEUE_LIMIT = 50;
const CONTACT_LIMIT = 20;
const WAITING_ALERT_MS = 5 * 60 * 1000; // past this a waiting chat stands out in the queue
const REPORT_LABELS = { spam: 'spam', inappropriate: 'inappropriate', off_topic: 'off topic', misleading: 'misleading', other: 'other' };

// Customers waiting for a person, longest wait first. The AI's summary saves asking again.
async function loadChatQueue(agentId, now) {
  const [waiting, myOpen, rows] = await Promise.all([
    ChatConversation.countDocuments({ status: 'waiting' }),
    ChatConversation.countDocuments({ status: 'open', agent_id: agentId }),
    ChatConversation.find({ status: 'waiting' }, 'conversation_id customer_id summary handoff_summary handover_reason last_message_preview created_at')
      .sort({ created_at: 1 }).limit(QUEUE_LIMIT).lean()
  ]);
  const customers = await User.find({ user_id: { $in: rows.map((row) => row.customer_id) } }, 'user_id profile_name avatar_url membership_tier').lean();
  const customerById = new Map(customers.map((customer) => [customer.user_id, customer]));
  return {
    waiting,
    my_open: myOpen,
    queue: rows.map((row) => {
      const customer = customerById.get(row.customer_id);
      return {
        conversation_id: row.conversation_id,
        customer_name: customer?.profile_name || 'Guest',
        avatar_url: customer?.avatar_url || null,
        tier: customer?.membership_tier || null,
        summary: row.summary || row.handoff_summary || row.last_message_preview || '',
        reason: row.handover_reason || null,
        waiting_since: row.created_at,
        overdue: now - new Date(row.created_at) >= WAITING_ALERT_MS
      };
    })
  };
}

// One card per reported target, like the Community reports queue.
async function loadReportTask() {
  const [groups, latest] = await Promise.all([
    Report.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: { type: '$target_type', post: '$post_id', comment: '$comment_id', account: '$reported_user_id' }, since: { $min: '$created_at' } } }
    ]),
    Report.findOne({ status: 'pending' }, 'target_type reason').sort({ created_at: -1 }).lean()
  ]);
  if (!groups.length) return [];
  return [{
    key: 'reports', type: 'reports', count: groups.length,
    title: `${groups.length} report${groups.length === 1 ? '' : 's'} waiting for review`,
    detail: `Latest: ${latest?.target_type} · ${REPORT_LABELS[latest?.reason] || latest?.reason}`,
    since: groups.reduce((oldest, group) => (group.since < oldest ? group.since : oldest), groups[0].since),
    link: '/admin/community-reports', action: 'Review'
  }];
}

async function loadRecipeTask() {
  const [count, oldest] = await Promise.all([
    Recipe.countDocuments({ published: false }),
    Recipe.find({ published: false }, 'title createdAt').sort({ createdAt: 1 }).limit(3).lean()
  ]);
  if (!count) return [];
  return [{
    key: 'recipes', type: 'recipes', count,
    title: `${count} recipe${count === 1 ? '' : 's'} waiting for approval`,
    detail: oldest.map((recipe) => `"${recipe.title}"`).join(' · '),
    since: oldest[0].createdAt,
    link: '/admin/recipes', action: 'Review'
  }];
}

// Contact messages have no admin page yet, so Reply answers by email.
async function loadContactTasks() {
  const [count, rows] = await Promise.all([
    ContactMessage.countDocuments({ status: 'new' }),
    ContactMessage.find({ status: 'new' }, 'contact_id email subject message source created_at').sort({ created_at: 1 }).limit(CONTACT_LIMIT).lean()
  ]);
  return rows.map((row) => ({
    key: `contact:${row.contact_id}`, type: 'messages', count: 1, total: count,
    title: `Contact message · ${row.subject}`,
    detail: `From the ${row.source === 'chatbot' ? 'chatbot' : 'contact form'} · ${row.message.slice(0, 80)}`,
    since: row.created_at,
    mailto: `mailto:${row.email}?subject=${encodeURIComponent(`Re: ${row.subject}`)}`, action: 'Reply'
  }));
}

async function getServicesDashboard(req, res) {
  try {
    const now = new Date();
    const { start: todayStart, end: tomorrowStart } = getBusinessDayBounds();
    // Voucher.createdAt is ISO-8601; these UTC instants form the business-day
    // bounds while preserving lexical string comparison in MongoDB.
    const [chat, reports, recipes, contacts, vouchersIssuedToday] = await Promise.all([
      loadChatQueue(String(req.user.user_id), now),
      loadReportTask(),
      loadRecipeTask(),
      loadContactTasks(),
      Voucher.countDocuments({ createdAt: { $gte: todayStart.toISOString(), $lt: tomorrowStart.toISOString() } })
    ]);
    const tasks = [...reports, ...recipes, ...contacts]
      .sort((a, b) => new Date(a.since) - new Date(b.since));
    res.json({
      chat,
      tasks,
      counts: {
        reports: reports[0]?.count || 0,
        recipes: recipes[0]?.count || 0,
        messages: contacts[0]?.total || 0
      },
      support_vouchers_issued_today: vouchersIssuedToday
    });
  } catch (error) {
    console.error('Failed to load services dashboard:', error);
    res.status(500).json({ error: 'Failed to load services dashboard data.' });
  }
}

module.exports = { getDashboard, getSalesDashboard, getServicesDashboard };
