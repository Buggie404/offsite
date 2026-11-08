const mongoose = require('mongoose');
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
const Referral = require('../models/Referral');
const BrewSession = require('../models/BrewSession');
const RitualArchetype = require('../models/RitualArchetype');
const pointsService = require('../services/points.service');

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

function getBusinessDayBounds(now = new Date()) {
  const parts = getBusinessDateParts(now);
  const localNowAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const timezoneOffset = localNowAsUtc - now.getTime();
  const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - timezoneOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

const DAY_MS = 86_400_000;
const REPEAT_WINDOW_MS = 90 * DAY_MS; // "repeat customer" = 2+ orders in the last 90 days
const SPARK_POINTS = 8;
const TIERS = ['Seed', 'Leaf', 'Bloom', 'Zen'];

// Revenue after money given back for removed / swapped lines.
const NET_EXPR = { $subtract: ['$pricing.total', { $ifNull: ['$refunded_amount', 0] }] };
// After $unwind items: this line's share of the order's net revenue.
const ITEM_NET_EXPR = {
  $multiply: [NET_EXPR, { $cond: [{ $gt: ['$pricing.subtotal', 0] }, { $divide: ['$items.subtotal', '$pricing.subtotal'] }, 0] }]
};
// Ritual Box revenue: Subscribe & Save lines at checkout plus every scheduled renewal order.
const BOX_LINE_EXPR = { $or: [{ $eq: ['$items.purchase_type', 'subscription'] }, { $ne: [{ $ifNull: ['$subscription_id', null] }, null] }] };

/** The same length of time right before the selected range. */
function previousRange({ start, end }) {
  const prevEnd = new Date(start.getTime() - 1);
  return { start: new Date(prevEnd.getTime() - (end.getTime() - start.getTime())), end: prevEnd };
}

/** Calendar days (YYYY-MM-DD in the viewer's timezone) covered by the range. */
function dayKeys(range, timezone) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const keys = [];
  const push = (date) => { const key = format.format(date); if (keys[keys.length - 1] !== key) keys.push(key); };
  for (let t = range.start.getTime(); t < range.end.getTime(); t += 6 * 3_600_000) push(new Date(t));
  push(range.end);
  return keys;
}

function dayExpr(field, timezone) {
  return { $dateToString: { date: field, format: '%Y-%m-%d', timezone } };
}

function pctChange(current, previous) {
  if (!previous) return current ? null : 0; // nothing to compare against
  return ((current - previous) / previous) * 100;
}

async function revenueSummary(range) {
  const [row] = await Order.aggregate([
    { $match: { ...REVENUE_ORDER_FILTER, created_at: dateFilter(range) } },
    { $group: { _id: null, revenue: { $sum: NET_EXPR }, orders: { $sum: 1 } } }
  ]);
  return { revenue: row?.revenue || 0, eligibleOrders: row?.orders || 0 };
}

/** Net revenue per day, split into one-time and Ritual Box lines. */
function dailyRevenueSplit(range, timezone) {
  return Order.aggregate([
    { $match: { ...REVENUE_ORDER_FILTER, created_at: dateFilter(range) } },
    { $unwind: '$items' },
    { $group: { _id: { day: dayExpr('$created_at', timezone), box: BOX_LINE_EXPR }, amount: { $sum: ITEM_NET_EXPR } } }
  ]).then((rows) => {
    const byDay = new Map();
    for (const row of rows) {
      const day = byDay.get(row._id.day) || { one_time: 0, ritual_box: 0 };
      day[row._id.box ? 'ritual_box' : 'one_time'] += row.amount;
      byDay.set(row._id.day, day);
    }
    return byDay;
  });
}

function dailyCount(model, field, filter, range, timezone) {
  return model.aggregate([
    { $match: { ...filter, [field]: dateFilter(range) } },
    { $group: { _id: dayExpr(`$${field}`, timezone), count: { $sum: 1 } } }
  ]).then((rows) => new Map(rows.map((row) => [row._id, row.count])));
}

/**
 * Daily through 62 days; longer ranges roll into 7-day buckets counted from the
 * first day, so the current and previous periods stay aligned bucket by bucket.
 */
function bucketSeries(keys, prevKeys, current, previous) {
  const size = keys.length > 62 ? 7 : 1;
  const series = [];
  for (let i = 0; i < keys.length; i += size) {
    const bucket = { date: keys[i], one_time: 0, ritual_box: 0, previous: 0 };
    for (let j = i; j < Math.min(i + size, keys.length); j++) {
      const day = current.get(keys[j]);
      if (day) { bucket.one_time += day.one_time; bucket.ritual_box += day.ritual_box; }
      const prevDay = previous.get(prevKeys[j]);
      if (prevDay) bucket.previous += prevDay.one_time + prevDay.ritual_box;
    }
    series.push(bucket);
  }
  return series;
}

/** Evenly spaced points for a sparkline (keeps the payload small on 90-day ranges). */
function sparkline(values) {
  if (values.length <= SPARK_POINTS * 2) return values;
  const size = Math.ceil(values.length / (SPARK_POINTS * 2));
  const points = [];
  for (let i = 0; i < values.length; i += size) points.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
  return points;
}

/** Orders per registered customer in the 90 days ending at `end` (revenue-eligible orders only). */
async function customerOrderCounts(end) {
  const rows = await Order.aggregate([
    { $match: { ...REVENUE_ORDER_FILTER, user_id: { $ne: null }, created_at: { $gt: new Date(end.getTime() - REPEAT_WINDOW_MS), $lte: end } } },
    { $group: { _id: '$user_id', orders: { $sum: 1 } } }
  ]);
  return new Map(rows.map((row) => [row._id, row.orders]));
}

function repeatRate(counts, userIds = null) {
  let buyers = 0;
  let repeat = 0;
  for (const [userId, orders] of counts) {
    if (userIds && !userIds.has(userId)) continue;
    buyers += 1;
    if (orders >= 2) repeat += 1;
  }
  return buyers ? (repeat / buyers) * 100 : null;
}

async function repeatRateAt(end) {
  return repeatRate(await customerOrderCounts(end));
}

async function topProducts(range) {
  const created_at = dateFilter(range);
  const top = await Order.aggregate([
    { $match: { ...REVENUE_ORDER_FILTER, created_at } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product_id', name: { $first: '$items.product_name' }, revenue: { $sum: ITEM_NET_EXPR } } },
    { $sort: { revenue: -1 } },
    { $limit: 5 }
  ]);
  if (!top.length) return [];
  const ids = top.map((row) => row._id);
  const [refunds, products] = await Promise.all([
    // Units sold in the period (paid at some point) and how many of them ended up refunded.
    Order.aggregate([
      { $match: { created_at, payment_status: { $in: ['paid', 'refunded'] }, 'items.product_id': { $in: ids } } },
      { $unwind: '$items' },
      { $match: { 'items.product_id': { $in: ids } } },
      { $group: {
        _id: '$items.product_id',
        units: { $sum: '$items.quantity' },
        refunded: { $sum: { $cond: [{ $or: [{ $eq: ['$order_status', 'refund'] }, { $eq: ['$payment_status', 'refunded'] }] }, '$items.quantity', 0] } }
      } }
    ]),
    // Order lines keep the product's Mongo _id as product_id.
    Product.find({ _id: { $in: ids.filter((id) => mongoose.isValidObjectId(id)) } }, 'name rating_avg').lean()
  ]);
  const refundById = new Map(refunds.map((row) => [row._id, row]));
  const productById = new Map(products.map((product) => [String(product._id), product]));
  return top.map((row) => {
    const refund = refundById.get(row._id);
    const product = productById.get(String(row._id));
    return {
      product_id: row._id,
      name: product?.name || row.name,
      revenue: row.revenue,
      refund_rate: refund?.units ? (refund.refunded / refund.units) * 100 : 0,
      rating: product?.rating_avg ?? null
    };
  });
}

async function archetypeValue(range, orderCounts) {
  const [archetypes, groups, allCustomers] = await Promise.all([
    RitualArchetype.find({ is_active: true }, 'archetype_id name tagline').sort({ archetype_id: 1 }).lean(),
    User.aggregate([
      { $match: { role: 'customer', 'ritual_dna.archetype_id': { $ne: null } } },
      { $group: { _id: '$ritual_dna.archetype_id', user_ids: { $push: '$user_id' } } }
    ]),
    User.countDocuments({ role: 'customer' })
  ]);
  const archetypeByUser = new Map();
  for (const group of groups) for (const userId of group.user_ids) archetypeByUser.set(userId, group._id);
  const dnaUserIds = [...archetypeByUser.keys()];
  const [revenueRows, itemRows] = dnaUserIds.length ? await Promise.all([
    Order.aggregate([
      { $match: { ...REVENUE_ORDER_FILTER, created_at: dateFilter(range), user_id: { $in: dnaUserIds } } },
      { $group: { _id: '$user_id', revenue: { $sum: NET_EXPR } } }
    ]),
    Order.aggregate([
      { $match: { ...REVENUE_ORDER_FILTER, created_at: dateFilter(range), user_id: { $in: dnaUserIds } } },
      { $unwind: '$items' },
      { $group: { _id: { user: '$user_id', product: '$items.product_name' }, quantity: { $sum: '$items.quantity' } } }
    ])
  ]) : [[], []];

  const stats = new Map(groups.map((group) => [group._id, { customers: group.user_ids.length, userIds: new Set(group.user_ids), revenue: 0, picks: new Map() }]));
  for (const row of revenueRows) {
    const entry = stats.get(archetypeByUser.get(row._id));
    if (entry) entry.revenue += row.revenue;
  }
  for (const row of itemRows) {
    const entry = stats.get(archetypeByUser.get(row._id.user));
    if (entry) entry.picks.set(row._id.product, (entry.picks.get(row._id.product) || 0) + row.quantity);
  }
  const groupsOut = archetypes.map((archetype) => {
    const entry = stats.get(archetype.archetype_id) || { customers: 0, userIds: new Set(), revenue: 0, picks: new Map() };
    const topPick = [...entry.picks].sort((a, b) => b[1] - a[1])[0];
    return {
      archetype_id: archetype.archetype_id,
      name: archetype.name,
      tagline: archetype.tagline,
      customers: entry.customers,
      // Share of ALL customers, so the groups plus "no quiz yet" add up to 100%.
      share: allCustomers ? (entry.customers / allCustomers) * 100 : 0,
      revenue_per_customer: entry.customers ? entry.revenue / entry.customers : 0,
      repeat_rate: repeatRate(orderCounts, entry.userIds),
      top_pick: topPick ? topPick[0] : null
    };
  });
  const quizCustomers = groupsOut.reduce((sum, group) => sum + group.customers, 0);
  return { groups: groupsOut, coverage: { customers: allCustomers, quiz_customers: quizCustomers } };
}

async function retention(range, orderCounts) {
  const created = dateFilter(range);
  const [newBoxes, cancelled, activeAtStart, paymentFailed, suspended, tierCounts, tierRevenue, referred, referredOrdered, buyers] = await Promise.all([
    Subscription.countDocuments({ created_at: created }),
    Subscription.countDocuments({ cancelled_at: created }),
    Subscription.countDocuments({ created_at: { $lt: range.start }, $or: [{ cancelled_at: null }, { cancelled_at: { $gte: range.start } }] }),
    Subscription.countDocuments({ status: 'payment_failed' }),
    Subscription.countDocuments({ status: 'suspended' }),
    User.aggregate([{ $match: { role: 'customer' } }, { $group: { _id: '$membership_tier', count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { ...REVENUE_ORDER_FILTER, created_at: created, user_id: { $ne: null } } },
      { $group: { _id: '$user_id', revenue: { $sum: NET_EXPR } } },
      { $lookup: { from: 'Users', localField: '_id', foreignField: 'user_id', as: 'user' } },
      { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$user.membership_tier', 0] }, 'Seed'] }, revenue: { $sum: '$revenue' } } }
    ]),
    Referral.countDocuments({ created_at: created }),
    Referral.countDocuments({ created_at: created, first_order_id: { $ne: null } }),
    Promise.resolve([...orderCounts.keys()])
  ]);
  const brewers = new Set(buyers.length ? await BrewSession.distinct('user_id', { user_id: { $in: buyers } }) : []);
  const nonBrewers = new Set(buyers.filter((userId) => !brewers.has(userId)));
  const countByTier = new Map(tierCounts.map((row) => [row._id || 'Seed', row.count]));
  const revenueByTier = new Map(tierRevenue.map((row) => [row._id, row.revenue]));
  return {
    ritual_box: {
      new: newBoxes,
      cancelled,
      churn_rate: activeAtStart ? (cancelled / activeAtStart) * 100 : null,
      payment_failed: paymentFailed,
      suspended
    },
    tiers: TIERS.map((tier) => ({ tier, customers: countByTier.get(tier) || 0, revenue: revenueByTier.get(tier) || 0 })),
    referrals: { referred, first_order: referredOrdered },
    brew_coach: {
      with_rate: brewers.size ? repeatRate(orderCounts, brewers) : null,
      without_rate: nonBrewers.size ? repeatRate(orderCounts, nonBrewers) : null
    }
  };
}

// Backlog across the whole team, independent of the selected period.
async function getOpenWork() {
  const recentRefunds = new Date(Date.now() - REPEAT_WINDOW_MS); // matches the Orders page "90 days" link
  const [refunds, posts, comments, chats, paymentFailed, suspended, notStarted, outOfStock] = await Promise.all([
    Order.countDocuments({ order_status: 'pending_refund', created_at: { $gte: recentRefunds } }),
    PostReport.distinct('post_id', { status: 'pending' }),
    CommentReport.distinct('comment_id', { status: 'pending' }),
    ChatConversation.countDocuments({ status: 'waiting' }),
    Subscription.countDocuments({ status: 'payment_failed' }),
    Subscription.countDocuments({ status: 'suspended' }),
    Order.countDocuments({ subscription_start_failed: true }),
    // Products has no low-stock threshold; a variant at <= 0 is out of stock.
    Product.aggregate([{ $match: { is_active: true } }, { $unwind: '$variants' }, { $match: { 'variants.stock': { $lte: 0 } } }, { $count: 'count' }])
  ]);
  return {
    refunds_waiting: refunds,
    reports_to_review: posts.length + comments.length,
    chats_waiting: chats,
    boxes_payment_failed: paymentFailed,
    boxes_suspended: suspended,
    boxes_not_started: notStarted,
    out_of_stock_variants: outOfStock[0]?.count || 0
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
    const previous = previousRange(range);
    const keys = dayKeys(range, timezone);
    const prevKeys = dayKeys(previous, timezone);
    const sparkEnds = Array.from({ length: SPARK_POINTS }, (_, i) =>
      new Date(range.start.getTime() + ((range.end.getTime() - range.start.getTime()) * (i + 1)) / SPARK_POINTS));
    const includeTodos = req.query.include_todos !== 'false';

    const [
      current, prior, orders, priorOrders, split, priorSplit, ordersByDay,
      activeBoxes, boxesCreated, boxesCancelled, orderCounts, priorRepeat, repeatSpark,
      products, openWork
    ] = await Promise.all([
      revenueSummary(range),
      revenueSummary(previous),
      // Same population as the Orders page "Total orders" stat.
      Order.countDocuments({ created_at: dateFilter(range) }),
      Order.countDocuments({ created_at: dateFilter(previous) }),
      dailyRevenueSplit(range, timezone),
      dailyRevenueSplit(previous, timezone),
      dailyCount(Order, 'created_at', {}, range, timezone),
      Subscription.countDocuments({ status: 'active' }),
      dailyCount(Subscription, 'created_at', {}, range, timezone),
      dailyCount(Subscription, 'cancelled_at', {}, range, timezone),
      customerOrderCounts(range.end),
      repeatRateAt(range.start),
      Promise.all(sparkEnds.map(repeatRateAt)),
      topProducts(range),
      includeTodos ? getOpenWork() : Promise.resolve(null)
    ]);
    const [archetypes, retentionStats] = await Promise.all([archetypeValue(range, orderCounts), retention(range, orderCounts)]);

    const series = bucketSeries(keys, prevKeys, split, priorSplit);
    const ritualRevenue = series.reduce((sum, row) => sum + row.ritual_box, 0);
    const aov = current.eligibleOrders ? current.revenue / current.eligibleOrders : 0;
    const priorAov = prior.eligibleOrders ? prior.revenue / prior.eligibleOrders : 0;
    const newBoxes = [...boxesCreated.values()].reduce((a, b) => a + b, 0);
    const cancelledBoxes = [...boxesCancelled.values()].reduce((a, b) => a + b, 0);
    let boxRunning = 0;
    const repeat = repeatRate(orderCounts);

    res.json({
      range: { start: range.start.toISOString(), end: range.end.toISOString(), timezone },
      previous_range: { start: previous.start.toISOString(), end: previous.end.toISOString() },
      kpis: {
        net_revenue: {
          value: current.revenue,
          previous: prior.revenue,
          change_pct: pctChange(current.revenue, prior.revenue),
          ritual_box_share: current.revenue ? (ritualRevenue / current.revenue) * 100 : 0,
          spark: sparkline(keys.map((key) => { const day = split.get(key); return day ? day.one_time + day.ritual_box : 0; }))
        },
        orders: {
          value: orders,
          previous: priorOrders,
          change_pct: pctChange(orders, priorOrders),
          aov,
          aov_change_pct: pctChange(aov, priorAov),
          spark: sparkline(keys.map((key) => ordersByDay.get(key) || 0))
        },
        active_boxes: {
          value: activeBoxes,
          change: newBoxes - cancelledBoxes,
          new: newBoxes,
          cancelled: cancelledBoxes,
          spark: sparkline(keys.map((key) => (boxesCreated.get(key) || 0) - (boxesCancelled.get(key) || 0)))
            .map((delta) => (boxRunning += delta))
        },
        repeat_customers: {
          value: repeat,
          previous: priorRepeat,
          change_pt: repeat !== null && priorRepeat !== null ? repeat - priorRepeat : null,
          spark: repeatSpark.map((value) => value ?? 0)
        }
      },
      revenue_series: series,
      top_products: products,
      archetypes: archetypes.groups,
      ritual_dna_coverage: archetypes.coverage,
      retention: retentionStats,
      ...(openWork ? { open_work: openWork } : {})
    });
  } catch (error) {
    console.error('Failed to load admin dashboard:', error);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
}

const HOUR_MS = 3_600_000;
const PROCESSING_SLA_MS = 24 * HOUR_MS;  // processing -> shipping within a day
const REFUND_SLA_MS = 24 * HOUR_MS;      // a refund request waiting longer than this is overdue
const BOX_CHARGE_WINDOW_MS = 48 * HOUR_MS;
const QUEUE_WINDOW_MS = 90 * DAY_MS;     // matches the Orders page "90 days" links
const FORECAST_DAYS = 7;
const SALES_AVG_DAYS = 30;
const COVER_ALERT_DAYS = 14;             // stock check lists variants that run out within this
const STOCK_ROW_LIMIT = 10;
const ORDER_STRIP_STATUSES = ['pending', 'processing', 'shipping', 'delivery_failed', 'pending_refund'];
// My Pantry falls back to these shelf lives when a product has no batch expiry (pantry.logic.js).
const PANTRY_DEFAULT_DAYS = { matcha: 180, coffee: 90 };

/** When the order entered `status` (latest entry), falling back to when it was created. */
function statusSince(order, status) {
  const entry = [...(order.status_history || [])].reverse().find((row) => row.status === status);
  return entry?.changed_at || order.created_at;
}

function readableReason(reason) {
  if (!reason) return 'No reason given';
  const text = String(reason).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function orderList(orders) {
  const ids = orders.slice(0, 3).map((order) => `#${order.order_id}`).join(', ');
  return orders.length > 3 ? `${ids} +${orders.length - 3} more` : ids;
}

/** Products referenced by Subscriptions/Orders: the Product _id string, or the numeric product_id on old records. */
async function productsByRef(refs) {
  const unique = [...new Set(refs.map(String))];
  const products = await Product.find({
    $or: [
      { _id: { $in: unique.filter((ref) => mongoose.isValidObjectId(ref)) } },
      { product_id: { $in: unique.map(Number).filter(Number.isFinite) } }
    ]
  }, 'product_id name category variants batch_expiry_date').lean();
  const byRef = new Map();
  for (const product of products) {
    byRef.set(String(product._id), product);
    byRef.set(String(product.product_id), product);
  }
  return byRef;
}

function variantLabel(product, variant) {
  return variant?.label ? `${product.name} · ${variant.label}` : product.name;
}

// One "To do today" row per kind of work; `count` feeds the filter pills and the header total.
async function salesTasks(now) {
  const recent = { $gte: new Date(now - QUEUE_WINDOW_MS) };
  const [processing, failedDeliveries, refunds, dueSoon, paymentFailed, missingExpiry] = await Promise.all([
    Order.find({ order_status: 'processing', created_at: recent }, 'order_id created_at status_history').lean(),
    Order.find({ order_status: 'delivery_failed', created_at: recent }, 'order_id created_at status_history').lean(),
    Order.find({ order_status: 'pending_refund', created_at: recent }, 'order_id pricing.total refund_request delivered_at created_at').lean(),
    Subscription.aggregate([
      { $match: { status: 'active', next_charge_at: { $lte: new Date(now + BOX_CHARGE_WINDOW_MS) } } },
      { $group: { _id: { product: '$product_id', variant: '$variant_id' }, boxes: { $sum: 1 }, quantity: { $sum: '$quantity' }, first_charge: { $min: '$next_charge_at' } } }
    ]),
    Subscription.find({ status: 'payment_failed' }, 'last_failed_at next_retry_at').sort({ last_failed_at: 1 }).lean(),
    Product.find({ is_active: true, category: { $in: Object.keys(PANTRY_DEFAULT_DAYS) }, batch_expiry_date: null }, 'name category').sort({ name: 1 }).lean()
  ]);
  const tasks = [];

  const late = processing
    .map((order) => ({ order, since: statusSince(order, 'processing') }))
    .filter((row) => now - new Date(row.since) >= PROCESSING_SLA_MS)
    .sort((a, b) => new Date(a.since) - new Date(b.since));
  if (late.length) {
    tasks.push({
      key: 'processing-late', type: 'orders', icon: 'package', tone: 'danger', count: late.length, overdue: true,
      title: `${late.length} order${late.length === 1 ? '' : 's'} processing for over 24h`,
      detail: orderList(late.map((row) => row.order)),
      chip: 'overdue', due_at: new Date(new Date(late[0].since).getTime() + PROCESSING_SLA_MS),
      link: late.length === 1 ? `/admin/orders/${late[0].order.order_id}` : '/admin/orders',
      query: late.length === 1 ? null : { status: 'processing', date: '90' }
    });
  }

  for (const order of refunds) {
    const request = order.refund_request || {};
    const since = request.requested_at || order.created_at;
    const photos = request.evidence?.length || 0;
    const delivered = order.delivered_at ? Math.floor((now - new Date(order.delivered_at)) / DAY_MS) : null;
    tasks.push({
      key: `refund:${order.order_id}`, type: 'refunds', icon: 'refund', tone: 'warning', count: 1, urgent: true,
      overdue: now - new Date(since) >= REFUND_SLA_MS,
      title: `Refund #${order.order_id} · ${readableReason(request.reason)} · $${(order.pricing?.total || 0).toFixed(2)}`,
      detail: [
        photos ? `${photos} photo${photos === 1 ? '' : 's'} attached` : 'No photos',
        delivered === null ? 'not delivered yet' : delivered === 0 ? 'delivered today' : `delivered ${delivered} day${delivered === 1 ? '' : 's'} ago`
      ].join(' · '),
      chip: 'waiting', since, due_at: new Date(new Date(since).getTime() + REFUND_SLA_MS),
      link: `/admin/orders/${order.order_id}`
    });
  }

  if (dueSoon.length) {
    const products = await productsByRef(dueSoon.map((row) => row._id.product));
    for (const row of dueSoon) {
      const product = products.get(String(row._id.product));
      const variant = product?.variants?.find((item) => item.sku === row._id.variant);
      if (!product || (variant?.stock ?? 0) >= row.quantity) continue;
      const label = variantLabel(product, variant);
      tasks.push({
        key: `box-stock:${row._id.variant}`, type: 'ritual_box', icon: 'box', tone: 'warning', count: 1,
        title: `${row.boxes} Ritual Box${row.boxes === 1 ? '' : 'es'} charge in 48h · ${(variant?.stock ?? 0) > 0 ? 'not enough stock' : 'item out of stock'}`,
        detail: `${label} · customers get a replacement offer or the cycle is skipped`,
        chip: 'due', due_at: row.first_charge,
        link: '/admin/subscriptions', query: { search: product.name }
      });
    }
  }

  if (paymentFailed.length) {
    tasks.push({
      key: 'box-payment', type: 'ritual_box', icon: 'card', tone: 'danger', count: paymentFailed.length,
      title: `${paymentFailed.length} Ritual Box payment${paymentFailed.length === 1 ? '' : 's'} failed`,
      detail: 'Card charge declined · retried every 24h, then the box is suspended',
      chip: 'since', since: paymentFailed[0].last_failed_at, due_at: paymentFailed[0].next_retry_at || paymentFailed[0].last_failed_at,
      link: '/admin/subscriptions', query: { status: 'needs_action' }
    });
  }

  if (failedDeliveries.length) {
    const since = failedDeliveries.map((order) => statusSince(order, 'delivery_failed')).sort((a, b) => new Date(a) - new Date(b))[0];
    tasks.push({
      key: 'delivery-failed', type: 'orders', icon: 'truck', tone: 'info', count: failedDeliveries.length,
      title: `${failedDeliveries.length} deliver${failedDeliveries.length === 1 ? 'y' : 'ies'} failed`,
      detail: `${orderList(failedDeliveries)} · ship again or cancel`,
      chip: 'today', since, due_at: new Date(new Date(since).getTime() + DAY_MS),
      link: failedDeliveries.length === 1 ? `/admin/orders/${failedDeliveries[0].order_id}` : '/admin/orders',
      query: failedDeliveries.length === 1 ? null : { status: 'delivery_failed', date: '90' }
    });
  }

  if (missingExpiry.length) {
    const [first] = missingExpiry;
    const names = missingExpiry.slice(0, 3).map((product) => product.name).join(', ');
    tasks.push({
      key: 'expiry-missing', type: 'stock', icon: 'calendar', tone: 'neutral', count: missingExpiry.length,
      title: missingExpiry.length === 1 ? 'Batch expiry date missing' : `${missingExpiry.length} products missing a batch expiry date`,
      detail: missingExpiry.length === 1
        ? `${first.name} · My Pantry will use the ${PANTRY_DEFAULT_DAYS[first.category]}-day default`
        : `${names}${missingExpiry.length > 3 ? ` +${missingExpiry.length - 3} more` : ''} · My Pantry falls back to 180 days (matcha) / 90 days (coffee)`,
      chip: 'today', due_at: getBusinessDayBounds(new Date(now)).end,
      link: '/admin/products', query: missingExpiry.length === 1 ? { search: first.name } : null
    });
  }

  // Overdue first (longest overdue on top), then by deadline.
  return tasks.sort((a, b) => (b.overdue === true) - (a.overdue === true) || new Date(a.due_at) - new Date(b.due_at));
}

/** Variants that may run short: days of cover = stock / (avg daily sales + Ritual Box charges due / 7). */
async function stockCheck(now) {
  const [products, due, sold] = await Promise.all([
    Product.find({ is_active: true }, 'product_id name category variants batch_expiry_date').lean(),
    Subscription.aggregate([
      { $match: { status: 'active', next_charge_at: { $lte: new Date(now + FORECAST_DAYS * DAY_MS) } } },
      { $group: { _id: '$variant_id', quantity: { $sum: '$quantity' } } }
    ]),
    Order.aggregate([
      { $match: { order_status: 'delivered', delivered_at: { $gte: new Date(now - SALES_AVG_DAYS * DAY_MS) } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.variant_id', quantity: { $sum: '$items.quantity' } } }
    ])
  ]);
  const dueBySku = new Map(due.map((row) => [row._id, row.quantity]));
  const soldBySku = new Map(sold.map((row) => [row._id, row.quantity]));
  const rows = [];
  for (const product of products) {
    for (const variant of product.variants || []) {
      const boxDue = dueBySku.get(variant.sku) || 0;
      const avgSold = (soldBySku.get(variant.sku) || 0) / SALES_AVG_DAYS;
      const demand = avgSold + boxDue / FORECAST_DAYS;
      const cover = variant.stock <= 0 ? 0 : demand > 0 ? variant.stock / demand : null;
      if (variant.stock > 0 && (cover === null || cover >= COVER_ALERT_DAYS)) continue;
      rows.push({
        product_id: product.product_id,
        sku: variant.sku,
        name: variantLabel(product, variant),
        product_name: product.name,
        in_stock: variant.stock,
        ritual_box_due: boxDue,
        avg_sold_per_day: avgSold,
        days_of_cover: cover,
        // Only matcha and coffee need a batch expiry (My Pantry); other categories show none.
        needs_expiry: product.category in PANTRY_DEFAULT_DAYS,
        batch_expiry_date: product.batch_expiry_date
      });
    }
  }
  return rows
    .sort((a, b) => a.days_of_cover - b.days_of_cover || b.ritual_box_due - a.ritual_box_due)
    .slice(0, STOCK_ROW_LIMIT);
}

// Sales-Ops: today's order queues, what needs a decision and what may run short. No revenue.
async function getSalesDashboard(req, res) {
  try {
    const now = Date.now();
    const recent = { $gte: new Date(now - QUEUE_WINDOW_MS) };
    const today = getBusinessDayBounds(new Date(now));
    const [statusRows, deliveredToday, tasks, stock] = await Promise.all([
      Order.aggregate([
        { $match: { order_status: { $in: ORDER_STRIP_STATUSES }, created_at: recent } },
        { $group: { _id: '$order_status', count: { $sum: 1 } } }
      ]),
      Order.countDocuments({ order_status: 'delivered', delivered_at: { $gte: today.start, $lt: today.end } }),
      salesTasks(now),
      stockCheck(now)
    ]);
    const statusCount = Object.fromEntries(statusRows.map((row) => [row._id, row.count]));
    res.json({
      updated_at: new Date(now).toISOString(),
      order_status: {
        pending: statusCount.pending || 0,
        processing: statusCount.processing || 0,
        processing_over_24h: tasks.find((task) => task.key === 'processing-late')?.count || 0,
        shipping: statusCount.shipping || 0,
        delivery_failed: statusCount.delivery_failed || 0,
        pending_refund: statusCount.pending_refund || 0,
        delivered_today: deliveredToday,
        refund_window_days: pointsService.REFUND_WINDOW_DAYS
      },
      tasks,
      stock
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
