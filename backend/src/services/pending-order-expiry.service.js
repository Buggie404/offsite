const Order = require('../models/Order');
const notificationService = require('./notification.service');

// Business rule: an online-payment order (QR / card) that is still 'pending' after the hold
// window is canceled automatically, which puts its reserved stock back on the shelf.
// This file is the ONLY place that defines the rule: the background job below and the
// order-detail / order-status endpoints (orders.controller.js → expireIfStale) both use it.
//
// PENDING_ORDER_HOLD_MINUTES shortens the hold for demos (e.g. 2); default 24h, as before.
//
// TODO(COD): pending COD orders (not yet confirmed by the shop) are left alone on purpose —
// the plan has no deadline for COD confirmation yet. Add one here when the plan defines it.
const DEFAULT_HOLD_MINUTES = 24 * 60;
const HOLD_MINUTES = (() => {
  const value = Number(process.env.PENDING_ORDER_HOLD_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HOLD_MINUTES;
})();
const PENDING_ORDER_HOLD_MS = HOLD_MINUTES * 60 * 1000;
// A claimed order stays claimed this long, so a second runner (job / request / another
// server) can't cancel it — and release its stock — a second time. A crashed run frees it.
const CLAIM_LEASE_MS = 2 * 60 * 1000;

const holdLabel = HOLD_MINUTES % 60 === 0 ? `${HOLD_MINUTES / 60} hours` : `${HOLD_MINUTES} minutes`;
const CANCEL_NOTE = `Order automatically canceled: Payment pending for more than ${holdLabel}`;

function isStale(order, now = new Date()) {
  if (!order || order.order_status !== 'pending' || order.payment?.method === 'cod') return false;
  const created = new Date(order.created_at || order.createdAt).getTime();
  return Number.isFinite(created) && now.getTime() - created >= PENDING_ORDER_HOLD_MS;
}

// Cancel one order if it is still a stale pending online-payment order.
// Returns the canceled document, or null when it wasn't (or no longer is) eligible.
async function expireOrder(id, now = new Date()) {
  // Atomic claim: only one caller can match, because the claim moves updated_at to `now`
  // and the filter only accepts an order that hasn't been touched within the lease.
  // order_status stays 'pending' in the DB until save(), so the Order pre-save hook still
  // sees pending → canceled and releases the reserved stock (once).
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  const order = await Order.findOneAndUpdate(
    {
      _id: id,
      order_status: 'pending',
      'payment.method': { $ne: 'cod' },
      created_at: { $lte: new Date(now.getTime() - PENDING_ORDER_HOLD_MS) },
      $or: [{ updated_at: { $lt: leaseCutoff } }, { updated_at: { $exists: false } }, { updated_at: null }]
    },
    { $set: { updated_at: now } },
    { new: true, timestamps: false }
  );
  if (!order) return null;

  order.order_status = 'canceled';
  order.canceled_at = now;
  order._changedBy = 'system';
  order._statusChangeNote = CANCEL_NOTE;
  await order.save(); // pre-save hook releases the stock when stock_reserved is true

  if (order.user_id) { // guests have no account to notify
    try {
      await notificationService.createNotification({
        recipient_id: order.user_id,
        sender: null,
        type: 'ORDER_CANCELED',
        post_id: order.order_id
      });
    } catch (err) {
      console.error(`Error creating auto-cancel notification for order ${order.order_id}:`, err);
    }
  }
  return order;
}

// For request handlers that already loaded an order: returns the order to respond with —
// the canceled one if it just expired (or was expired concurrently), otherwise the same one.
async function expireIfStale(order, now = new Date()) {
  if (!isStale(order, now)) return order;
  const canceled = await expireOrder(order._id, now);
  if (canceled) return canceled;
  // Someone else holds the claim or already canceled it: answer with the current state.
  return (await Order.findById(order._id)) || order;
}

// Cancel every stale pending online-payment order. Returns how many were canceled.
async function expirePendingOrders(now = new Date()) {
  const due = await Order.find({
    order_status: 'pending',
    'payment.method': { $ne: 'cod' },
    created_at: { $lte: new Date(now.getTime() - PENDING_ORDER_HOLD_MS) }
  }, { _id: 1 }).lean();

  let canceled = 0;
  for (const { _id } of due) {
    try {
      if (await expireOrder(_id, now)) canceled++;
    } catch (err) {
      console.error(`Pending order expiry failed for ${_id}:`, err); // keep going with the rest
    }
  }
  return canceled;
}

let expiryTimer = null;
let running = false;

// Every 5 minutes by default, started with the server.
function startPendingOrderExpiryJob(intervalMs = 5 * 60 * 1000) {
  if (expiryTimer) return;
  const run = async () => {
    if (running) return; // previous run still going
    running = true;
    try {
      const canceled = await expirePendingOrders();
      if (canceled) console.log(`Pending order expiry job: canceled ${canceled} order(s)`);
    } catch (err) {
      console.error('Pending order expiry job failed:', err);
    } finally {
      running = false;
    }
  };
  run();
  expiryTimer = setInterval(run, intervalMs);
}

module.exports = {
  PENDING_ORDER_HOLD_MS,
  CLAIM_LEASE_MS,
  isStale,
  expireOrder,
  expireIfStale,
  expirePendingOrders,
  startPendingOrderExpiryJob
};
