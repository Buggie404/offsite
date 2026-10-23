const Subscription = require('../models/Subscription');
const Order = require('../models/Order');
const notificationService = require('./notification.service');
const subscriptionService = require('./subscription.service');

// Business rules: "Project Planning & Prep 2" — Ritual Box charge job.
// - Every hour: charge active subscriptions with next_charge_at <= now.
// - Expired card / no card: payment_failed, no charge, ask the customer to update the card.
// - Charge error: retry after 24h → 48h → 72h; if the last retry fails too → suspended.
// - Out of stock: the customer has 3 days to accept the replacement; otherwise the cycle is skipped.
// - SUBSCRIPTION_UPCOMING is sent 3 days before next_charge_at.
// Demo mode: SUB_TIME_UNIT=minute turns every "hour" above into a minute (job interval,
// retry delays, out-of-stock window, upcoming notice) so the flow can be watched live.
const TIME_UNIT_MS = process.env.SUB_TIME_UNIT === 'minute' ? 60 * 1000 : 60 * 60 * 1000;
const RETRY_DELAYS_UNITS = [24, 48, 72];
const OUT_OF_STOCK_WINDOW_UNITS = 72;   // 3 days
const UPCOMING_NOTICE_UNITS = 72;       // 3 days
const CHARGE_LEASE_MS = 10 * 60 * 1000; // a crashed run frees its claim after 10 minutes

const DAY_MS = 24 * 60 * 60 * 1000;
const addUnits = (date, units) => new Date(new Date(date).getTime() + units * TIME_UNIT_MS);
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);

async function notify(sub, type, message) {
  try {
    await notificationService.createNotification({
      recipient_id: sub.user_id,
      sender: null,
      type,
      post_id: sub.subscription_id,
      comment_content: message ? String(message).slice(0, 500) : null
    });
  } catch (err) {
    console.error(`Error creating ${type} notification:`, err);
  }
}

function formatChargeDate(date) {
  return new Date(date).toLocaleString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Claim a due subscription so overlapping runs (or a second server) can't charge it twice.
// Returns the claimed document, or null when someone else holds it or it is no longer due.
function claimDue(id, now) {
  return Subscription.findOneAndUpdate(
    {
      _id: id,
      status: 'active',
      next_charge_at: { $lte: now },
      $and: [
        { $or: [{ next_retry_at: null }, { next_retry_at: { $lte: now } }] },
        { $or: [{ charge_locked_until: null }, { charge_locked_until: { $lte: now } }] }
      ]
    },
    { $set: { charge_locked_until: new Date(now.getTime() + CHARGE_LEASE_MS) } },
    { new: true }
  );
}

// A charge whose Order was saved but whose subscription save never happened (crash
// between the two) must not be billed again: roll the cycle forward from that order.
async function recoverOrphanCharge(sub) {
  const order = await Order.findOne(
    { subscription_id: sub.subscription_id, created_at: { $gte: sub.next_charge_at } },
    { created_at: 1 }
  ).lean();
  if (!order) return false;
  sub.last_charged_at = order.created_at;
  sub.next_charge_at = addDays(order.created_at, sub.frequency_days);
  sub.failed_attempts = 0;
  sub.last_failure_reason = null;
  sub.next_retry_at = null;
  return true;
}

// Out of stock at charge time: wait up to 3 days (from the due date) for the customer to
// take the replacement in Ritual Box; after that, skip this cycle without charging.
async function handleOutOfStock(sub, result, now) {
  const deadline = addUnits(sub.next_charge_at, OUT_OF_STOCK_WINDOW_UNITS);
  if (now >= deadline) {
    sub.skipped_deliveries.push(sub.next_charge_at);
    sub.next_charge_at = addDays(sub.next_charge_at, sub.frequency_days);
    sub.consecutive_skips = Math.min((sub.consecutive_skips || 0) + 1, 2);
    sub.last_failure_reason = null;
    sub.last_failed_at = null;
    await notify(sub, 'SUBSCRIPTION_SKIPPED', 'The item was out of stock and no replacement was chosen, so this delivery was skipped. You were not charged.');
    return 'skipped';
  }
  if (sub.last_failure_reason !== 'out_of_stock') {
    sub.last_failure_reason = 'out_of_stock';
    sub.last_failed_at = now;
    await notify(sub, 'SUBSCRIPTION_OUT_OF_STOCK', `Accept the replacement by ${formatChargeDate(deadline)} or this delivery will be skipped.`);
  }
  return 'out_of_stock';
}

// Charge error: retry after 24h, then 48h, then 72h; when the last retry fails → suspended.
async function handleChargeError(sub, reason, now) {
  sub.failed_attempts = (sub.failed_attempts || 0) + 1;
  sub.last_failure_reason = reason;
  sub.last_failed_at = now;
  if (sub.failed_attempts > RETRY_DELAYS_UNITS.length) {
    sub.status = 'suspended';
    sub.next_retry_at = null;
    await notify(sub, 'SUBSCRIPTION_SUSPENDED', 'We could not charge your card after several attempts. Update your card to reactivate.');
    return 'suspended';
  }
  sub.next_retry_at = addUnits(now, RETRY_DELAYS_UNITS[sub.failed_attempts - 1]);
  return 'retry_scheduled';
}

async function chargeOne(sub, now, charge) {
  if (await recoverOrphanCharge(sub)) return 'recovered';

  let result;
  try {
    result = await charge(sub, { now });
  } catch (err) {
    console.error(`Subscription ${sub.subscription_id} charge error:`, err);
    return handleChargeError(sub, err.message || 'charge_error', now);
  }

  if (result.ok) {
    sub.upcoming_notified_for = null;
    return 'charged';
  }
  if (result.reason === 'out_of_stock') return handleOutOfStock(sub, result, now);
  if (result.reason === 'card_expired' || result.reason === 'no_card') {
    sub.status = 'payment_failed';
    sub.last_failure_reason = result.reason;
    sub.last_failed_at = now;
    sub.next_retry_at = null;
    await notify(sub, 'SUBSCRIPTION_PAYMENT_FAILED', result.message);
    return 'payment_failed';
  }
  return handleChargeError(sub, result.reason || 'charge_error', now);
}

// 3 days before next_charge_at, once per cycle.
async function sendUpcomingNotices(now) {
  const subs = await Subscription.find({
    status: 'active',
    next_charge_at: { $gt: now, $lte: addUnits(now, UPCOMING_NOTICE_UNITS) }
  }, { _id: 1, user_id: 1, subscription_id: 1, next_charge_at: 1, quantity: 1, pricing_snapshot: 1, shipping_method: 1, upcoming_notified_for: 1 }).lean();

  let sent = 0;
  for (const sub of subs) {
    if (sub.upcoming_notified_for && +sub.upcoming_notified_for === +sub.next_charge_at) continue;
    const claimed = await Subscription.findOneAndUpdate(
      { _id: sub._id, next_charge_at: sub.next_charge_at, upcoming_notified_for: { $ne: sub.next_charge_at } },
      { $set: { upcoming_notified_for: sub.next_charge_at } }
    );
    if (!claimed) continue;
    const total = sub.pricing_snapshot.subscribe_price * sub.quantity + (sub.shipping_method === 'express' ? 15 : 0);
    await notify(sub, 'SUBSCRIPTION_UPCOMING', `${formatChargeDate(sub.next_charge_at)} · $${total.toFixed(2)}`);
    sent++;
  }
  return sent;
}

// One pass of the job. Passes in this process run one after another (Order / Notification ids
// are generated from the latest row, so parallel inserts would collide); across processes the
// per-subscription claim lease keeps a sub from being charged twice.
// `charge` is injectable so the retry path can be exercised in tests.
let queue = Promise.resolve();
function runSubscriptionChargeJob(opts) {
  const pass = queue.then(() => runPass(opts));
  queue = pass.catch(() => {});
  return pass;
}

async function runPass({ now = new Date(), charge = subscriptionService.chargeSubscription } = {}) {
  const summary = { resumed: 0, upcoming: 0 };

  // Paused boxes whose pause ran out go back to active (and become due right away).
  const resumable = await Subscription.find({ status: 'paused', resume_at: { $ne: null, $lte: now } });
  for (const sub of resumable) {
    await subscriptionService.applyDueTransitions(sub, now);
    if (sub.status === 'active') summary.resumed++;
  }

  const due = await Subscription.find({
    status: 'active',
    next_charge_at: { $lte: now },
    $or: [{ next_retry_at: null }, { next_retry_at: { $lte: now } }]
  }, { _id: 1 }).sort({ next_charge_at: 1 }).lean();

  for (const { _id } of due) {
    const sub = await claimDue(_id, now);
    if (!sub) continue;
    let outcome;
    try {
      outcome = await chargeOne(sub, now, charge);
    } catch (err) {
      console.error(`Subscription ${sub.subscription_id} charge job failed:`, err);
      outcome = 'error';
    }
    sub.charge_locked_until = null;
    try {
      await sub.save();
    } catch (err) {
      console.error(`Subscription ${sub.subscription_id} save failed:`, err);
      outcome = 'error';
    }
    summary[outcome] = (summary[outcome] || 0) + 1;
  }

  summary.upcoming = await sendUpcomingNotices(now);
  return summary;
}

let chargeTimer = null;
let running = false;

// Hourly (or per minute with SUB_TIME_UNIT=minute) charge job, started with the server.
function startSubscriptionChargeJob(intervalMs = TIME_UNIT_MS) {
  if (chargeTimer) return;
  const run = async () => {
    if (running) return; // previous run still going
    running = true;
    try {
      const summary = await runSubscriptionChargeJob();
      const did = Object.entries(summary).filter(([, n]) => n > 0);
      if (did.length) console.log('Subscription charge job:', Object.fromEntries(did));
    } catch (err) {
      console.error('Subscription charge job failed:', err);
    } finally {
      running = false;
    }
  };
  run();
  chargeTimer = setInterval(run, intervalMs);
}

module.exports = {
  TIME_UNIT_MS,
  RETRY_DELAYS_UNITS,
  runSubscriptionChargeJob,
  startSubscriptionChargeJob
};
