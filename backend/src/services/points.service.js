const PointTransaction = require('../models/PointTransaction');
const User = require('../models/User');
const Order = require('../models/Order');

// Membership point rules
//   Purchase: +1 point per USD of the order subtotal × tier multiplier.
//   Review:   +1 point per review × tier multiplier.
//   Purchase points go "pending" when the order is delivered and "posted"
//   (added to Users.points) once the refund window has passed. A refund or
//   hidden content reverses them. The balance may go negative and is made up
//   by later credits. Tiers are never downgraded.
const TIER_MULTIPLIER = { Seed: 1, Leaf: 1.1, Bloom: 1.2, Zen: 1.5 };

// Refund/return requests are locked to 3 days after the order is delivered.
// Purchase points stay pending for the same period; override only the points
// hold with POINTS_HOLD_DAYS for demos — the refund window stays fixed.
const REFUND_WINDOW_DAYS = 3;
const HOLD_DAYS = Number(process.env.POINTS_HOLD_DAYS) > 0 ? Number(process.env.POINTS_HOLD_DAYS) : REFUND_WINDOW_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

function tierMultiplier(tier) {
  return TIER_MULTIPLIER[tier] ?? TIER_MULTIPLIER.Seed;
}

// Points are whole numbers: round the tier-multiplied amount.
function calcPoints(base, tier) {
  return Math.max(0, Math.round(base * tierMultiplier(tier)));
}

async function getTier(userId) {
  const user = await User.findOne({ user_id: userId }, { membership_tier: 1 }).lean();
  return user?.membership_tier || 'Seed';
}

// Reviews store the JWT user id (Mongo _id); points are keyed by Users.user_id (USR0000X).
async function toAppUserId(id) {
  if (!id) return null;
  if (/^USR/i.test(String(id))) return String(id);
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  const user = await User.findById(String(id), { user_id: 1 }).lean();
  return user?.user_id || null;
}

async function adjustBalance(userId, delta) {
  if (!delta) return;
  await User.updateOne({ user_id: userId }, { $inc: { points: delta } });
}

// ─── Purchase ───────────────────────────────────────────────────

// Order delivered → pending purchase points. Idempotent per order.
async function awardPurchasePoints(order) {
  if (!order || order.is_guest || !order.user_id) return null;
  const existing = await PointTransaction.findOne({ type: 'purchase', ref_type: 'order', ref_id: order.order_id });
  if (existing) return existing;

  const amount = calcPoints(order.pricing?.subtotal || 0, await getTier(order.user_id));
  if (amount <= 0) return null;

  return PointTransaction.create({
    user_id: order.user_id,
    type: 'purchase',
    amount,
    status: 'pending',
    ref_type: 'order',
    ref_id: order.order_id
  });
}

// Refund approved → reverse the order's purchase points (taking them back if already posted).
async function reversePurchasePoints(order) {
  if (!order) return null;
  const txn = await PointTransaction.findOne({
    type: 'purchase', ref_type: 'order', ref_id: order.order_id, status: { $in: ['pending', 'posted'] }
  });
  if (!txn) return null;
  return reverseTransaction(txn);
}

// Points shown on an order page: the real transaction once it exists, otherwise
// an estimate (status 'pending') for a signed-in customer's live order.
async function getOrderPoints(order) {
  if (!order || order.is_guest || !order.user_id) return null;
  const txn = await PointTransaction.findOne({ type: 'purchase', ref_type: 'order', ref_id: order.order_id }).lean();
  if (txn) {
    return { amount: txn.amount, status: txn.status, posted_at: txn.posted_at, estimated: false, hold_days: HOLD_DAYS };
  }
  if (['canceled', 'refund'].includes(order.order_status)) return null;
  const amount = calcPoints(order.pricing?.subtotal || 0, await getTier(order.user_id));
  return amount > 0 ? { amount, status: 'pending', posted_at: null, estimated: true, hold_days: HOLD_DAYS } : null;
}

// ─── Review ─────────────────────────────────────────────────────

// A review is credited right away (it already requires a delivered order).
async function awardReviewPoints(review) {
  const userId = await toAppUserId(review?.user_id);
  if (!userId) return null;
  const existing = await PointTransaction.findOne({ type: 'review', ref_type: 'review', ref_id: review.review_id });
  if (existing) return existing;

  const amount = calcPoints(1, await getTier(userId));
  if (amount <= 0) return null;

  const txn = await PointTransaction.create({
    user_id: userId,
    type: 'review',
    amount,
    status: 'posted',
    ref_type: 'review',
    ref_id: review.review_id,
    posted_at: new Date()
  });
  await adjustBalance(userId, amount);
  return txn;
}

// Review hidden for violating the rules → take its points back.
async function reverseReviewPoints(reviewId) {
  const txn = await PointTransaction.findOne({
    type: 'review', ref_type: 'review', ref_id: reviewId, status: { $in: ['pending', 'posted'] }
  });
  return txn ? reverseTransaction(txn) : null;
}

// ─── Shared ─────────────────────────────────────────────────────

async function reverseTransaction(txn) {
  const wasPosted = txn.status === 'posted';
  txn.status = 'reversed';
  txn.reversed_at = new Date();
  await txn.save();
  if (wasPosted) await adjustBalance(txn.user_id, -txn.amount);
  return txn;
}

// Post pending purchase points whose refund window has ended.
// Orders with a refund under review stay pending; refunded orders are reversed.
async function postDuePoints(now = new Date()) {
  const due = await PointTransaction.find({
    status: 'pending',
    type: 'purchase',
    created_at: { $lte: new Date(now.getTime() - HOLD_DAYS * DAY_MS) }
  });

  let posted = 0;
  for (const txn of due) {
    const order = await Order.findOne({ order_id: txn.ref_id }, { order_status: 1 }).lean();
    if (order?.order_status === 'pending_refund') continue;
    if (order?.order_status === 'refund') {
      await reverseTransaction(txn);
      continue;
    }
    // Claim the row first so overlapping runs can't post it twice.
    const claimed = await PointTransaction.findOneAndUpdate(
      { _id: txn._id, status: 'pending' },
      { $set: { status: 'posted', posted_at: now } }
    );
    if (claimed) {
      await adjustBalance(txn.user_id, txn.amount);
      posted++;
    }
  }
  return posted;
}

let postingTimer = null;

// Hourly posting job, started with the server.
function startPointsPostingJob(intervalMs = 60 * 60 * 1000) {
  if (postingTimer) return;
  const run = () => postDuePoints().catch(err => console.error('Points posting job failed:', err));
  run();
  postingTimer = setInterval(run, intervalMs);
}

module.exports = {
  TIER_MULTIPLIER,
  HOLD_DAYS,
  REFUND_WINDOW_DAYS,
  tierMultiplier,
  calcPoints,
  awardPurchasePoints,
  reversePurchasePoints,
  getOrderPoints,
  awardReviewPoints,
  reverseReviewPoints,
  postDuePoints,
  startPointsPostingJob
};
