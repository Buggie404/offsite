const PointTransaction = require('../models/PointTransaction');
const User = require('../models/User');
const Order = require('../models/Order');
const { activeRestriction } = require('./community-restriction.service');

// Membership point rules
//   Purchase: +1 point per USD of the order subtotal × tier multiplier.
//   Review:   +1 point per review × tier multiplier.
//   Purchase points go "pending" when the order is paid / confirmed (processing)
//   and "posted" (added to Users.points) once the refund window after delivery
//   has passed. A canceled order reverses them. A refund or
//   hidden content reverses them. The balance may go negative and is made up
//   by later credits. Tiers are never downgraded.
const TIER_MULTIPLIER = { Seed: 1, Leaf: 1.1, Bloom: 1.25, Zen: 1.5 };

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

// Points earned during a Community suspension are cut by 50%.
async function earnedAmount(base, userId) {
  const user = await User.findOne({ user_id: userId }, { membership_tier: 1, community_restriction: 1 }).lean();
  const amount = calcPoints(base, user?.membership_tier || 'Seed');
  return activeRestriction(user) ? Math.round(amount / 2) : amount;
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

// Users are stored in the MongoDB `Users` collection; Mongoose and the native
// driver must not both $inc the same document or balances double-count.
async function adjustBalance(userId, delta) {
  if (!delta) return;
  await User.updateOne({ user_id: userId }, { $inc: { points: delta } });
}

// ─── Purchase ───────────────────────────────────────────────────

// Order paid / confirmed (processing) → pending purchase points. Idempotent per order.
// Called again on delivery as a fallback for orders that reached processing before this rule.
async function awardPurchasePoints(order) {
  if (!order || order.is_guest || !order.user_id) return null;
  const existing = await PointTransaction.findOne({ type: 'purchase', ref_type: 'order', ref_id: order.order_id });
  if (existing) return existing;

  const amount = await earnedAmount(order.pricing?.subtotal || 0, order.user_id);
  if (amount <= 0) return null;

  // Stable unique ID makes concurrent confirmation/delivery/recovery safe.
  const confirmedAt = (order.status_history || []).find(item => item.status === 'processing')?.changed_at
    || order.created_at || order.delivered_at || new Date();
  try {
    return await PointTransaction.create({
      transaction_id: `PTXPUR_${order.order_id}`,
      user_id: order.user_id,
      type: 'purchase',
      amount,
      status: 'pending',
      ref_type: 'order',
      ref_id: order.order_id,
      created_at: confirmedAt
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await PointTransaction.findOne({ type: 'purchase', ref_type: 'order', ref_id: order.order_id });
    if (!winner) throw error;
    return winner;
  }
}

// A failed order callback must not permanently erase the customer's purchase history.
// Include reversed entries in the known set so canceled/refunded points cannot be re-awarded.
async function reconcilePurchasePoints(userId) {
  const recorded = await PointTransaction.distinct('ref_id', {
    user_id: userId, type: 'purchase', ref_type: 'order'
  });
  const orders = await Order.find({
    user_id: userId, is_guest: { $ne: true },
    order_status: { $in: ['processing', 'shipping', 'delivered', 'refund_rejected', 'pending_refund'] },
    order_id: { $nin: recorded }, 'pricing.subtotal': { $gt: 0 }
  }).select('order_id user_id is_guest pricing created_at delivered_at status_history').limit(100).lean();
  for (const order of orders) {
    await awardPurchasePoints(order);
  }
  return orders.length;
}

// A line was removed or swapped for a cheaper one while processing: the pending points follow
// the new subtotal. Posted points are left as they are.
async function updatePurchasePoints(order) {
  if (!order || order.is_guest || !order.user_id) return null;
  const txn = await PointTransaction.findOne({ type: 'purchase', ref_type: 'order', ref_id: order.order_id, status: 'pending' });
  if (!txn) return null;
  const amount = await earnedAmount(order.pricing?.subtotal || 0, order.user_id);
  if (amount === txn.amount) return txn;
  if (amount <= 0) return reverseTransaction(txn);
  txn.amount = amount;
  await txn.save();
  return txn;
}

// Refund approved / order canceled → reverse the order's purchase points (taking them back if already posted).
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
    return { amount: txn.amount, status: txn.status, posted_at: txn.posted_at, estimated: false, hold_days: Math.max(HOLD_DAYS, REFUND_WINDOW_DAYS) };
  }
  if (['canceled', 'refund'].includes(order.order_status)) return null;
  const amount = calcPoints(order.pricing?.subtotal || 0, await getTier(order.user_id));
  return amount > 0 ? { amount, status: 'pending', posted_at: null, estimated: true, hold_days: Math.max(HOLD_DAYS, REFUND_WINDOW_DAYS) } : null;
}

// ─── Review ─────────────────────────────────────────────────────

// A review is credited right away (it already requires a delivered order).
async function awardReviewPoints(review) {
  const userId = await toAppUserId(review?.user_id);
  if (!userId) return null;
  const existing = await PointTransaction.findOne({ type: 'review', ref_type: 'review', ref_id: review.review_id });
  if (existing) return existing;

  const amount = await earnedAmount(1, userId);
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

// Claim each transition inside a transaction so retries cannot change the balance twice.
async function changeCommunityPoints(postId, restore = false, existingSession = null) {
  const session = existingSession || await PointTransaction.db.startSession();
  const change = async () => {
    const rows = await PointTransaction.find({
      ref_type: 'post', ref_id: postId,
      type: { $in: ['post_approved', 'recipe_approved'] },
      status: restore ? 'reversed' : { $in: ['pending', 'posted'] }
    }).session(session);
    for (const txn of rows) {
      const wasPosted = restore ? Boolean(txn.posted_at) : txn.status === 'posted';
      const status = restore ? (wasPosted ? 'posted' : 'pending') : 'reversed';
      const claimed = await PointTransaction.updateOne({ _id: txn._id, status: txn.status }, {
        $set: { status, reversed_at: restore ? null : new Date() }
      }, { session });
      if (claimed.modifiedCount && wasPosted) {
        await User.updateOne({ user_id: txn.user_id }, { $inc: { points: restore ? txn.amount : -txn.amount } }, { session });
      }
    }
  };
  if (existingSession) return change();
  try { await session.withTransaction(change); }
  finally { await session.endSession(); }
}

const reverseCommunityPoints = (postId, session) => changeCommunityPoints(postId, false, session);
const restoreCommunityPoints = (postId, session) => changeCommunityPoints(postId, true, session);

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
async function postPendingByType(types, holdMs, now, validateTxn, onPosted) {
  const due = await PointTransaction.find({
    status: 'pending',
    type: { $in: types },
    created_at: { $lte: new Date(now.getTime() - holdMs) }
  });

  let posted = 0;
  for (const txn of due) {
    if (validateTxn) {
      const verdict = await validateTxn(txn);
      if (verdict === 'skip') continue;
      if (verdict === 'reverse') {
        await reverseTransaction(txn);
        continue;
      }
    }

    const claimed = await PointTransaction.findOneAndUpdate(
      { _id: txn._id, status: 'pending' },
      { $set: { status: 'posted', posted_at: now } }
    );
    if (claimed) {
      await adjustBalance(txn.user_id, txn.amount);
      if (onPosted) {
        await onPosted(claimed);
      }
      posted++;
    }
  }
  return posted;
}

async function postDuePoints(now = new Date()) {
  let posted = 0;

  // Order state, point status and balance are settled together, against the same
  // Orders write boundary used by refund submission.
  posted += await require('./order-point-settlement.service').postDueOrderPoints(now, {
    holdDays: HOLD_DAYS, refundWindowDays: REFUND_WINDOW_DAYS
  });

  posted += await postPendingByType(
    ['post_approved', 'recipe_approved', 'recipe_curated'],
    DAY_MS,
    now,
    async txn => {
      if (txn.ref_type !== 'post') return 'post';
      const post = await require('../models/Post').findOne({ post_id: txn.ref_id }, 'status').lean();
      return !post || post.status === 'hidden' ? 'reverse' : 'post';
    }
  );

  try {
    const loyaltyService = require('./loyalty.service');
    await loyaltyService.finalizeReferralOrderRewards(now);
  } catch (loyaltyErr) {
    console.error('Referral finalize job failed:', loyaltyErr);
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
  reconcilePurchasePoints,
  reversePurchasePoints,
  updatePurchasePoints,
  getOrderPoints,
  awardReviewPoints,
  reverseReviewPoints,
  reverseCommunityPoints,
  restoreCommunityPoints,
  postDuePoints,
  startPointsPostingJob,
  adjustBalance
};
