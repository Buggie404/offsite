// Reconcile committed reward records, including writes made inside transactions.
// The persisted activation boundary prevents deployment from announcing historical activity.
const State = require('../models/NotificationJobState');
const PointTransaction = require('../models/PointTransaction');
const Voucher = require('../models/Voucher');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Subscription = require('../models/Subscription');
const Follow = require('../models/Follow');
const { notifyEvent } = require('./notification.service');
const { dateKey, businessToday } = require('./voucher.service');
const DAY = 86400000;

function pointNotice(txn) {
  const types = { pending: 'POINTS_PENDING', posted: 'POINTS_POSTED', reversed: 'POINTS_REVERSED', used: 'POINTS_USED' };
  const type = txn.status === 'posted' && txn.amount < 0 ? 'POINTS_USED' : types[txn.status];
  if (!type || !txn.amount) return null;
  const source = { purchase: 'your order', review: 'your review', referral_register: 'a referral', referral_order: 'a referral order',
    post_approved: 'your post', recipe_approved: 'your recipe', recipe_curated: 'your featured recipe', quiz: 'your Ritual DNA quiz', redeem_voucher: 'a reward redemption', adjust: 'a points adjustment' }[txn.type] || 'your activity';
  const amount = Math.abs(txn.amount);
  const message = txn.status === 'pending' ? `${amount} points from ${source} are pending. View Rewards for availability.`
    : txn.status === 'reversed' ? `${amount} points from ${source} were reversed. View your points history for details.`
    : txn.status === 'used' || txn.amount < 0 ? `${amount} points were used for ${source}.`
    : `${amount} points from ${source} are now available.`;
  return { recipient_id: txn.user_id, type, message, target_type: 'rewards',
    event_key: `points:${txn.transaction_id}:${txn.status}:${txn.amount}` };
}

async function rewardNotices(since) {
  const loyalty = require('./loyalty.service');
  const rows = PointTransaction.find({ updated_at: { $gte: since },
    $expr: { $gt: ['$updated_at', { $ifNull: ['$notification_seen_at', new Date(0)] }] }
  }).sort({ updated_at: 1 }).cursor();
  for await (const txn of rows) {
    const event = pointNotice(txn);
    if (!event || await notifyEvent(event)) {
      await loyalty.syncMembershipTier(txn.user_id, await loyalty.computeLifetimePoints(txn.user_id));
      // Do not move updated_at or hide a newer concurrent points transition.
      await PointTransaction.updateOne({ _id: txn._id, updated_at: txn.updated_at },
        { $set: { notification_seen_at: txn.updated_at } }, { timestamps: false });
    }
  }
}

async function voucherNotices(since, now) {
  const rows = Voucher.find({ assigned_user_id: { $nin: [null, ''] } }).cursor();
  for await (const voucher of rows) {
    const expires = new Date(`${dateKey(voucher.valid_to)}T23:59:59.999+07:00`);
    const starts = dateKey(voucher.valid_from);
    if (!Number.isFinite(expires.getTime()) || starts > businessToday(now) || (voucher.usage_limit != null && voucher.used_count >= voucher.usage_limit)) continue;
    const common = { recipient_id: voucher.assigned_user_id, target_type: 'rewards' };
    if (expires < now) {
      if (voucher.is_active && expires >= since) await notifyEvent({ ...common, type: 'VOUCHER_EXPIRED',
        event_key: `voucher-expired:${voucher._id}:${voucher.valid_to}`, message: `Voucher ${voucher.code} has expired. Check Rewards for your other offers.` });
      continue;
    }
    if (!voucher.is_active) {
      if (new Date(voucher.createdAt) >= since) await notifyEvent({ ...common, type: 'VOUCHER_WITHDRAWN',
        event_key: `voucher-withdrawn:${voucher._id}`, message: `Voucher ${voucher.code} is no longer active. Check your available vouchers.` });
      continue;
    }
    if (new Date(voucher.createdAt) >= since) await notifyEvent({ ...common, type: 'VOUCHER_RECEIVED',
      event_key: `voucher-received:${voucher._id}`, message: `You received ${voucher.title || 'a voucher'} (${voucher.code}). View its terms in Rewards.` });
    if (expires - now <= 3 * DAY) await notifyEvent({ ...common, type: 'VOUCHER_EXPIRING',
      event_key: `voucher-expiring:${voucher._id}:${voucher.valid_to}`, message: `Voucher ${voucher.code} expires soon. View its expiry date and terms in Rewards.` });
  }
}

function consumptionDue(dates, now) {
  const unique = [...new Set(dates.map(date => new Date(date).getTime()).filter(Number.isFinite))].sort((a, b) => a - b);
  if (unique.length < 2) return false;
  const interval = (unique.at(-1) - unique[0]) / (unique.length - 1);
  return interval > 0 && now.getTime() >= unique.at(-1) + interval * .85;
}

// Saves inside a transaction and payment endpoints using query updates are both covered.
async function orderNotices(since) {
  const orders = Order.find({ is_guest: { $ne: true }, user_id: { $nin: [null, ''] }, updated_at: { $gte: since } }).cursor();
  for await (const order of orders) {
    const history = [...(order.status_history || [])];
    if (!history.some(row => row.status === order.order_status)) history.push({ status: order.order_status, changed_at: order.updated_at });
    for (const event of history) {
      if (!event.changed_at || new Date(event.changed_at) < since) continue;
      const isConfirmed = event.status === 'processing';
      if (!isConfirmed && event.status !== 'delivered') continue;
      await notifyEvent({ recipient_id: order.user_id, type: isConfirmed ? 'ORDER_CONFIRMED' : 'ORDER_DELIVERED',
        event_key: `${isConfirmed ? 'confirmed' : 'delivered'}:${order.order_id}`,
        target_type: 'order', target_id: order.order_id,
        message: isConfirmed ? `Order ${order.order_id} has been confirmed and is being prepared.` : `Order ${order.order_id} has been delivered. View your order for review and return options.` });
    }
  }
}

async function followNotices(since) {
  for await (const relation of Follow.find({ created_at: { $gte: since } }).cursor()) {
    const sender = await User.findOne({ user_id: relation.follower_id }, 'user_id community_name profile_name avatar_url').lean();
    if (!sender) continue;
    await notifyEvent({ recipient_id: relation.following_id, type: 'FOLLOW_RECEIVED',
      event_key: `follow:${relation.follower_id}:${new Date(relation.created_at).toISOString().slice(0, 10)}`,
      target_type: 'profile', target_id: relation.follower_id, message: 'started following you.',
      sender: { user_id: sender.user_id, username: sender.community_name || sender.profile_name || 'A member', avatar_url: sender.avatar_url } });
  }
}

async function consumptionNotices(now) {
  const groups = await Order.aggregate([
    { $match: { order_status: 'delivered', is_guest: { $ne: true }, user_id: { $nin: [null, ''] } } },
    { $unwind: '$items' },
    { $group: { _id: { user: '$user_id', product: '$items.product_id' }, dates: { $addToSet: '$created_at' } } }
  ]);
  for (const group of groups) {
    if (!consumptionDue(group.dates, now)) continue;
    const user = await User.findOne({ user_id: group._id.user, role: 'customer', status: 'active' }, 'notification_preferences').lean();
    if (!user || user.notification_preferences?.consumption_reminder === false) continue;
    const id = String(group._id.product || '');
    const product = await Product.findOne(/^[a-f0-9]{24}$/i.test(id) ? { _id: id } : { product_id: Number(id) }).lean();
    if (!product || !['coffee', 'matcha'].includes(product.category) || !product.is_active) continue;
    if (await Subscription.exists({ user_id: group._id.user, product_id: { $in: [String(product._id), String(product.product_id)] },
      status: { $in: ['active', 'paused', 'payment_failed', 'suspended'] } })) continue;
    const latest = Math.max(...group.dates.map(date => new Date(date).getTime()));
    await notifyEvent({ recipient_id: group._id.user, type: 'CONSUMPTION_REMINDER',
      event_key: `consumption:${product.product_id}:${latest}`, target_type: 'product', target_id: product.slug || String(product.product_id),
      message: `You may be running low on ${product.name}, based on your previous purchases. Check your pantry before buying again.` });
  }
}

let running = false;
let timer;
let lastConsumptionDay = '';
async function initializeNotificationJobs(now = new Date()) {
  return State.findOneAndUpdate({ _id: 'customer-events-v1' },
    { $setOnInsert: { enabled_at: now } }, { upsert: true, new: true });
}
async function runNotificationJobs(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const state = await initializeNotificationJobs(now);
    for (const task of [() => rewardNotices(state.enabled_at), () => voucherNotices(state.enabled_at, now),
      () => orderNotices(state.enabled_at), () => followNotices(state.enabled_at)]) {
      try { await task(); } catch (error) { console.error('Customer notification category failed:', error); }
    }
    const day = businessToday(now);
    if (lastConsumptionDay !== day) { await consumptionNotices(now); lastConsumptionDay = day; }
  } finally { running = false; }
}
function startNotificationJobs() {
  if (timer) return;
  const run = () => runNotificationJobs().catch(error => console.error('Customer notification job failed:', error));
  run(); timer = setInterval(run, 30_000);
}
module.exports = { pointNotice, consumptionDue, rewardNotices, voucherNotices, consumptionNotices, orderNotices, followNotices, initializeNotificationJobs, runNotificationJobs, startNotificationJobs };
