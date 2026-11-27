const Order = require('../models/Order');
const PointTransaction = require('../models/PointTransaction');
const RefundRequest = require('../models/RefundRequest');
const Referral = require('../models/Referral');
const User = require('../models/User');

const DAY_MS = 24 * 60 * 60 * 1000;
function deliveredAt(order) {
  return order.delivered_at
    || [...(order.status_history || [])].reverse().find(row => row.status === 'delivered')?.changed_at;
}

async function settleOrderPoint(id, now, holdDays, refundWindowDays) {
  const session = await Order.db.startSession();
  let posted = 0;
  try {
    await session.withTransaction(async () => {
      posted = 0;
      const txn = await PointTransaction.findOne({ _id: id, status: 'pending' }).session(session).lean();
      if (!txn) return 0;
      const order = await Order.findOne({ order_id: txn.ref_id }).session(session).lean();
      // Missing orders must not silently earn points.
      if (!order) return 0;
      const reverse = ['refund', 'canceled'].includes(order.order_status);
      if (!reverse) {
        if (!['delivered', 'refund_rejected'].includes(order.order_status)) return 0;
        if (await RefundRequest.findOne({ order_id: txn.ref_id, status: 'pending' }).session(session).lean()) return 0;
        const date = deliveredAt(order);
        // Demo overrides cannot settle points while customers may still request refunds.
        const wait = Math.max(holdDays, refundWindowDays) * DAY_MS;
        if (!date || now.getTime() - new Date(date).getTime() < wait) return 0;
      }

      // Refund submission writes this same Orders document. A competing write causes
      // a transaction retry, which re-reads the order instead of using stale Delivered.
      const locked = await Order.updateOne(
        { _id: order._id, order_status: order.order_status },
        { $inc: { points_settlement_revision: 1 } }, { session, timestamps: false }
      );
      if (!locked.modifiedCount) return 0;

      const claimed = await PointTransaction.findOneAndUpdate(
        { _id: id, status: 'pending' },
        { $set: reverse ? { status: 'reversed', reversed_at: now } : { status: 'posted', posted_at: now } },
        { session, new: true }
      );
      if (!claimed) return 0;
      if (!reverse) {
        await User.updateOne({ user_id: txn.user_id }, { $inc: { points: txn.amount } }, { session });
      }
      if (txn.type === 'referral_order') {
        await Referral.updateOne(
          { first_order_id: txn.ref_id, order_reward_status: 'awaiting_post' },
          { $set: reverse
            ? { order_reward_status: 'ineligible', ineligible_reason: 'order_refunded_or_canceled' }
            : { order_reward_status: 'posted' } },
          { session }
        );
      }
      posted = reverse ? 0 : 1;
    });
    return posted;
  } finally {
    await session.endSession();
  }
}

async function postDueOrderPoints(now, { holdDays, refundWindowDays }) {
  const pending = await PointTransaction.find({
    status: 'pending', type: { $in: ['purchase', 'referral_order'] }
  });
  let posted = 0;
  for (const txn of pending) {
    posted += await settleOrderPoint(txn._id, now, holdDays, refundWindowDays);
  }
  return posted;
}
module.exports = { postDueOrderPoints, settleOrderPoint };
