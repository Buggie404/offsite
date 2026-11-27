const Order = require('../models/Order');
const RefundRequest = require('../models/RefundRequest');
const PointTransaction = require('../models/PointTransaction');
const User = require('../models/User');
const Referral = require('../models/Referral');

const DAY_MS = 24 * 60 * 60 * 1000;
function invalid(status, message) {
  return Object.assign(new Error(message), { status });
}

async function submitRefund(orderId, refundRequest, actorId, { windowDays = 3, clock = () => new Date() } = {}) {
  // connection.transaction also resets Mongoose document save state on retries.
  let result = null;
  await Order.db.transaction(async session => {
    result = null;
    const current = await Order.findOne({ order_id: orderId }).session(session).lean();
    if (!current || current.order_status !== 'delivered') {
      throw invalid(409, 'The order is no longer eligible for a refund request. Please refresh.');
    }
    const now = clock();
    const date = current.delivered_at
      || [...(current.status_history || [])].reverse().find(row => row.status === 'delivered')?.changed_at;
    if (date && now.getTime() - new Date(date).getTime() >= windowDays * DAY_MS) {
      throw invalid(400, `Refunds can only be requested within ${windowDays} days of delivery.`);
    }
    if (await RefundRequest.findOne({ order_id: orderId, status: 'pending' }).session(session).lean()) {
      throw invalid(409, 'A refund request is already pending review for this order.');
    }
    const updated = await Order.findOneAndUpdate(
      { _id: current._id, order_status: 'delivered' },
      { $set: { order_status: 'pending_refund' }, $push: { status_history: {
        status: 'pending_refund', changed_at: now, changed_by: actorId,
        note: 'Refund request submitted by customer'
      } } },
      { session, new: true, runValidators: true }
    );
    if (!updated) throw invalid(409, 'The order changed. Please refresh before requesting a refund.');
    await refundRequest.save({ session });

    // Repair early postings from older/demo configurations if a valid refund is accepted.
    // This is NOT a reversal: the admin still decides whether points post or reverse.
    const early = await PointTransaction.find({
      ref_type: 'order', ref_id: orderId, status: 'posted',
      type: { $in: ['purchase', 'referral_order'] }
    }).session(session);
    for (const txn of early) {
      const held = await PointTransaction.updateOne(
        { _id: txn._id, status: 'posted' },
        { $set: { status: 'pending', posted_at: null } }, { session }
      );
      if (!held.modifiedCount) continue;
      await User.updateOne({ user_id: txn.user_id }, { $inc: { points: -txn.amount } }, { session });
      if (txn.type === 'referral_order') {
        await Referral.updateOne({ first_order_id: orderId }, {
          $set: { order_reward_status: 'awaiting_post' }
        }, { session });
      }
    }
    result = updated;
  });
  return result;
}
module.exports = { submitRefund };
