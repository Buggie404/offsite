const Order = require('../models/Order');
const notificationService = require('./notification.service');
const { TIME_UNIT_MS, addUnits } = require('../utils/subscription-time');

// Business rules: "Project Planning & Prep 2" — failed delivery, customer confirms the redelivery.
// - Staff move a shipping order to delivery_failed with a reason code and a note; each failure
//   counts in delivery_attempts. The first delivery + MAX_REDELIVERY_ATTEMPTS redeliveries: once
//   delivery_attempts > MAX_REDELIVERY_ATTEMPTS there is no redelivery, only a cancel.
// - Reason other than carrier_issue (attempts left): the customer has REDELIVERY_CONFIRM_HOURS to
//   confirm a redelivery (phone / address / note) or cancel; a reminder goes out after
//   REDELIVERY_REMINDER_HOURS; no answer by then → the order is cancelled.
// - carrier_issue: our side; staff ship again directly, nothing is asked of the customer.
// - Stock stays held throughout (stock_reserved); a cancel puts it back once (Order hook).
// - Refund on cancel: card / bank_transfer back to the same account (completed); paid QR orders
//   wait for a manual payout to the customer's refund_destination (pending_payout); COD: nothing.
// Hours are subscription time units, so SUB_TIME_UNIT=minute turns them into minutes for demos.

const positive = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const MAX_REDELIVERY_ATTEMPTS = positive('MAX_REDELIVERY_ATTEMPTS', 2);
const REDELIVERY_CONFIRM_HOURS = positive('REDELIVERY_CONFIRM_HOURS', 24);
const REDELIVERY_REMINDER_HOURS = positive('REDELIVERY_REMINDER_HOURS', 12);
const REASON_CODES = ['customer_unreachable', 'wrong_address', 'refused', 'carrier_issue'];
const EXPIRED_CANCEL_NOTE = 'Customer did not respond after the failed delivery';
// A claimed order stays claimed this long so a racing cancel (customer / expiry / staff) can't
// cancel it — and release its stock, voucher and points — a second time. A crashed run frees it.
const CLAIM_LEASE_MS = 2 * 60 * 1000;

const hoursLabel = (hours) => (TIME_UNIT_MS === 60 * 1000 ? `${hours} minutes` : `${hours} hours`);

// ─── State ───────────────────────────────────────────────────────

const hasRedeliveryLeft = (order) => (order.delivery_attempts || 0) <= MAX_REDELIVERY_ATTEMPTS;

// Staff may send the order out again: attempts left and either the customer confirmed or the
// carrier was at fault. Orders failed before reason codes existed keep the old rule (ship again).
function canRedeliver(order) {
  if (order.order_status !== 'delivery_failed') return false;
  if (!order.delivery_failed_reason_code && !order.redelivery) return true; // legacy order
  if (!hasRedeliveryLeft(order)) return false;
  return order.delivery_failed_reason_code === 'carrier_issue' || order.redelivery?.status === 'confirmed';
}

// Called by staff moving the order to delivery_failed (before the save). Returns what to tell the
// customer: 'awaiting_customer' | 'carrier_issue' | 'exhausted'.
function recordDeliveryFailure(order, { reasonCode, note, now = new Date() }) {
  order.delivery_attempts = (order.delivery_attempts || 0) + 1;
  order.delivery_failed_reason_code = reasonCode;
  order.delivery_failed_reason = note;
  if (!hasRedeliveryLeft(order)) {
    order.redelivery = null;
    return 'exhausted';
  }
  if (reasonCode === 'carrier_issue') {
    order.redelivery = null;
    return 'carrier_issue';
  }
  order.redelivery = {
    status: 'awaiting_customer',
    requested_at: now,
    expires_at: addUnits(now, REDELIVERY_CONFIRM_HOURS),
    reminder_sent_at: null,
    confirmed_at: null,
    contact_phone: null,
    shipping_address: null,
    note: ''
  };
  return 'awaiting_customer';
}

// "Redelivery 1 of 2": which redelivery the customer is being asked about.
function redeliveryNumber(order) {
  return Math.min(order.delivery_attempts || 0, MAX_REDELIVERY_ATTEMPTS);
}

// ─── Refunds on cancel ───────────────────────────────────────────

// Sets refund_status on an order being cancelled (before the save; the Order hook already marks a
// paid order's payment_status refunded). Paid QR: pending_payout until staff transfer the money.
function applyCancelRefund(order, { refundDestination = null } = {}) {
  if (order.payment_status !== 'paid' && order.payment_status !== 'refunded') {
    order.refund_status = null;
    return null;
  }
  if (order.payment?.method === 'qr') {
    order.refund_status = 'pending_payout';
    if (refundDestination) order.refund_destination = refundDestination;
    return 'pending_payout';
  }
  if (['card', 'bank_transfer'].includes(order.payment?.method)) {
    order.refund_status = 'completed';
    return 'completed';
  }
  order.refund_status = null; // COD: nothing was taken
  return null;
}

const needsRefundDestination = (order) =>
  order.payment?.method === 'qr' && order.payment_status === 'paid';

// Bank account for a QR payout. Returns { value } or { error }.
function parseRefundDestination(input) {
  const bank = String(input?.bank_name || '').trim();
  const number = String(input?.account_number || '').replace(/\s+/g, '');
  const holder = String(input?.account_holder || '').trim().replace(/\s+/g, ' ');
  if (!bank) return { error: 'Choose the bank to refund to.' };
  if (!/^\d{6,20}$/.test(number)) return { error: 'Account number must be 6 to 20 digits.' };
  if (holder.length < 2) return { error: 'Enter the account holder name.' };
  return { value: { bank_name: bank.slice(0, 100), account_number: number, account_holder: holder.slice(0, 100).toUpperCase() } };
}

// ─── Claims (one cancel per order) ───────────────────────────────

// No cancel of this order is in progress (cancel_lock_until unset or run out).
const unlocked = (now) => ({ $or: [{ cancel_lock_until: null }, { cancel_lock_until: { $lte: now } }] });

// Atomically claims a delivery_failed order still waiting on the customer: of two racing callers
// (customer cancel, the expiry job, staff) only one gets the document back; the others get null.
// `set` lets the expiry job flip redelivery.status in the same write.
function claimAwaiting(orderId, now, { set = {}, extra = {} } = {}) {
  return Order.findOneAndUpdate(
    { _id: orderId, order_status: 'delivery_failed', 'redelivery.status': 'awaiting_customer', ...extra, ...unlocked(now) },
    { $set: { cancel_lock_until: new Date(now.getTime() + CLAIM_LEASE_MS), ...set } },
    { new: true }
  );
}

// Same for staff cancelling a delivery_failed order (whatever its redelivery state).
function claimForStaffCancel(orderId, now) {
  return Order.findOneAndUpdate(
    { _id: orderId, order_status: 'delivery_failed', ...unlocked(now) },
    { $set: { cancel_lock_until: new Date(now.getTime() + CLAIM_LEASE_MS) } },
    { new: true }
  );
}

// Cancels a claimed order through the normal save path (Order hook: stock back once, voucher back,
// points reversed, paid → refunded) and sets the refund status.
async function cancelClaimed(order, { changedBy, note, refundDestination = null, now = new Date() }) {
  order.order_status = 'canceled';
  order.canceled_at = now;
  order._changedBy = changedBy;
  order._statusChangeNote = note;
  order.cancel_lock_until = null;
  applyCancelRefund(order, { refundDestination });
  await order.save();
  return order;
}

async function notify(order, type, detail = null) {
  if (!order.user_id) return; // guests have no inbox
  try {
    await notificationService.createNotification({
      recipient_id: order.user_id, sender: null, type, post_id: order.order_id, comment_content: detail
    });
  } catch (err) {
    console.error(`Error creating ${type} notification for ${order.order_id}:`, err);
  }
}

// ─── Job: reminder + expiry ──────────────────────────────────────

async function sendReminders(now) {
  const due = await Order.find({
    order_status: 'delivery_failed',
    'redelivery.status': 'awaiting_customer',
    'redelivery.reminder_sent_at': null,
    'redelivery.requested_at': { $lte: addUnits(now, -REDELIVERY_REMINDER_HOURS) },
    'redelivery.expires_at': { $gt: now }
  }, { _id: 1 }).lean();

  let sent = 0;
  for (const { _id } of due) {
    // Conditional write: the reminder goes out once however many runs overlap.
    const order = await Order.findOneAndUpdate(
      { _id, order_status: 'delivery_failed', 'redelivery.status': 'awaiting_customer', 'redelivery.reminder_sent_at': null },
      { $set: { 'redelivery.reminder_sent_at': now } },
      { new: true, timestamps: false }
    );
    if (!order) continue;
    const left = Math.max(1, Math.ceil((new Date(order.redelivery.expires_at) - now) / TIME_UNIT_MS));
    await notify(order, 'ORDER_REDELIVERY_REMINDER', `Confirm the redelivery or cancel within ${hoursLabel(left)}, or the order will be cancelled.`);
    sent++;
  }
  return sent;
}

async function expireUnanswered(now) {
  const due = await Order.find({
    order_status: 'delivery_failed',
    'redelivery.status': 'awaiting_customer',
    'redelivery.expires_at': { $lte: now }
  }, { _id: 1 }).lean();

  let cancelled = 0;
  for (const { _id } of due) {
    try {
      const order = await claimAwaiting(_id, now, {
        set: { 'redelivery.status': 'expired' },
        extra: { 'redelivery.expires_at': { $lte: now } }
      });
      if (!order) continue;
      await cancelClaimed(order, { changedBy: 'system', note: EXPIRED_CANCEL_NOTE, now });
      await notify(order, 'ORDER_REDELIVERY_EXPIRED', order.refund_status === 'pending_payout'
        ? 'No reply after the failed delivery, so the order was cancelled. Add the bank account for your refund on the order page.'
        : order.refund_status === 'completed'
          ? 'No reply after the failed delivery, so the order was cancelled and refunded to your card.'
          : 'No reply after the failed delivery, so the order was cancelled.');
      cancelled++;
    } catch (err) {
      console.error(`Redelivery expiry failed for ${_id}:`, err); // keep going with the rest
    }
  }
  return cancelled;
}

async function runRedeliveryJob(now = new Date()) {
  const reminded = await sendReminders(now);
  const expired = await expireUnanswered(now);
  return { reminded, expired };
}

let jobTimer = null;
let running = false;

// Every 5 minutes (every minute in demo mode), started with the server.
function startRedeliveryJob(intervalMs = Math.min(5 * 60 * 1000, TIME_UNIT_MS)) {
  if (jobTimer) return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runRedeliveryJob();
      if (summary.reminded || summary.expired) console.log('Redelivery job:', summary);
    } catch (err) {
      console.error('Redelivery job failed:', err);
    } finally {
      running = false;
    }
  };
  run();
  jobTimer = setInterval(run, intervalMs);
}

module.exports = {
  MAX_REDELIVERY_ATTEMPTS,
  REDELIVERY_CONFIRM_HOURS,
  REDELIVERY_REMINDER_HOURS,
  REASON_CODES,
  EXPIRED_CANCEL_NOTE,
  hasRedeliveryLeft,
  canRedeliver,
  recordDeliveryFailure,
  redeliveryNumber,
  applyCancelRefund,
  needsRefundDestination,
  parseRefundDestination,
  unlocked,
  claimAwaiting,
  claimForStaffCancel,
  cancelClaimed,
  notify,
  runRedeliveryJob,
  startRedeliveryJob
};
