const Subscription = require('../models/Subscription');
const Order = require('../models/Order');
const notificationService = require('./notification.service');
const subscriptionService = require('./subscription.service');

// Business rules: "Project Planning & Prep 2" — Ritual Box charge job.
// - Every hour: charge active subscriptions with next_charge_at <= now.
// - Expired card / no card: payment_failed, no charge, ask the customer to update the card.
// - Charge error: retry after 24h → 48h → 72h; if the last retry fails too → suspended.
// - Stock is held 3 days before next_charge_at (when SUBSCRIPTION_UPCOMING goes out); the charge
//   uses that stock as is. Not enough stock: SUBSCRIPTION_OUT_OF_STOCK right away (with the
//   replacement suggestion) and every later pass tries again, so a restock is picked up on its own.
// - Still not held at charge time: no charge; the customer has until 3 days after next_charge_at
//   to take the replacement (held, then charged), otherwise the cycle is skipped and not charged.
// - Held stock goes back when the cycle is skipped, the box is paused / cancelled / payment_failed /
//   suspended, or its item / quantity changes; a charge error with retries left keeps it.
// - A system skip (out of stock) does not count toward the customer's 2-consecutive-skips limit.
// - Suspended: one SUBSCRIPTION_SUSPENDED reminder after 7 days; after SUSPENDED_AUTO_CANCEL_DAYS
//   (env, default 30) the box is cancelled (cancelled_by_admin, 'Repeated payment failure').
// Demo mode: SUB_TIME_UNIT=minute turns every "hour" above into a minute (job interval,
// retry delays, out-of-stock window, upcoming notice) and every cycle "day" into 24 minutes,
// so the flow can be watched live (see utils/subscription-time).
const {
  TIME_UNIT_MS, RESERVE_AHEAD_UNITS, SUSPENDED_REMINDER_DAYS, SUSPENDED_AUTO_CANCEL_DAYS, addUnits, addCycleDays, autoCancelAt
} = require('../utils/subscription-time');
const AUTO_CANCEL_REASON = 'Repeated payment failure';
const RETRY_DELAYS_UNITS = [24, 48, 72];
const OUT_OF_STOCK_WINDOW_UNITS = RESERVE_AHEAD_UNITS;   // 3 days after next_charge_at
const UPCOMING_NOTICE_UNITS = RESERVE_AHEAD_UNITS;       // 3 days before: hold stock + notice
const CHARGE_LEASE_MS = 10 * 60 * 1000; // a crashed run frees its claim after 10 minutes


async function notify(sub, type, message) {
  await notificationService.notifySubscription(sub, type, message);
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
  sub.next_charge_at = addCycleDays(order.created_at, sub.frequency_days);
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
    sub.next_charge_at = addCycleDays(sub.next_charge_at, sub.frequency_days);
    await subscriptionService.releaseStaleReservation(sub); // the skipped cycle keeps no stock
    // Like a staff skip, a skip the system makes (nothing in stock) doesn't use up the
    // customer's 2-consecutive-skips allowance: consecutive_skips is left as it is.
    sub.last_failure_reason = null;
    sub.last_failed_at = null;
    await notify(sub, 'SUBSCRIPTION_SKIPPED', 'The item was out of stock and no replacement was chosen, so this delivery was skipped. You were not charged.');
    return 'skipped';
  }
  if (sub.last_failure_reason !== 'out_of_stock') {
    sub.last_failure_reason = 'out_of_stock';
    sub.last_failed_at = now;
    await notify(sub, 'SUBSCRIPTION_OUT_OF_STOCK', await outOfStockMessage(sub));
  }
  return 'out_of_stock';
}

// SUBSCRIPTION_OUT_OF_STOCK text: the replacement suggested in Ritual Box (same lookup as the
// Ritual Box tab) and the date the cycle is skipped if nothing can be held by then.
async function outOfStockMessage(sub) {
  const deadline = formatChargeDate(addUnits(sub.next_charge_at, OUT_OF_STOCK_WINDOW_UNITS));
  let replacement = null;
  try {
    const product = await subscriptionService.findProduct(sub.product_id);
    const variant = (product?.variants || []).find(v => v.sku === sub.variant_id);
    replacement = await subscriptionService.findReplacement(product, variant || { price: sub.pricing_snapshot?.original_price });
  } catch (err) {
    console.error(`Subscription ${sub.subscription_id}: replacement lookup failed`, err);
  }
  return replacement
    ? `Pick a replacement for this delivery in Ritual Box (for example ${replacement.name}) by ${deadline}, or wait for the restock. Your box keeps its usual item after this delivery. Otherwise this delivery is skipped and you are not charged.`
    : `We are restocking. If it isn't back by ${deadline}, this delivery is skipped and you are not charged.`;
}

// Charge error: retry after 24h, then 48h, then 72h; when the last retry fails → suspended.
async function handleChargeError(sub, reason, now) {
  sub.failed_attempts = (sub.failed_attempts || 0) + 1;
  sub.last_failure_reason = reason;
  sub.last_failed_at = now;
  if (sub.failed_attempts > RETRY_DELAYS_UNITS.length) {
    sub.status = 'suspended';
    sub.suspended_at = now;
    sub.suspended_reminded_at = null;
    sub.next_retry_at = null;
    await subscriptionService.releaseStaleReservation(sub); // suspended boxes hold no stock
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
    await subscriptionService.releaseStaleReservation(sub); // no card to charge: the held stock goes back
    await notify(sub, 'SUBSCRIPTION_PAYMENT_FAILED', result.message);
    return 'payment_failed';
  }
  return handleChargeError(sub, result.reason || 'charge_error', now);
}

// Boxes due within 3 days: hold their stock for that cycle (idempotent). Stock still held by
// boxes that no longer need it (paused / cancelled / suspended, cycle moved) goes back first.
// Not enough stock → SUBSCRIPTION_OUT_OF_STOCK once per cycle; tried again on every pass.
async function reserveUpcoming(now) {
  const summary = { reserved: 0, reserve_failed: 0, released: 0 };

  const holding = await Subscription.find({ reserved_for: { $ne: null } });
  for (const sub of holding) {
    try {
      if (await subscriptionService.releaseStaleReservation(sub)) summary.released++;
    } catch (err) {
      console.error(`Subscription ${sub.subscription_id}: releasing held stock failed`, err);
    }
  }

  const upcoming = await Subscription.find({
    status: 'active',
    next_charge_at: { $lte: addUnits(now, UPCOMING_NOTICE_UNITS) }
  });
  for (const sub of upcoming) {
    if (subscriptionService.isReservedFor(sub)) continue;
    try {
      const held = await subscriptionService.reserveForCycle(sub);
      if (held.ok) {
        summary.reserved++;
        if (sub.last_failure_reason === 'out_of_stock') {
          await Subscription.updateOne(
            { _id: sub._id, last_failure_reason: 'out_of_stock' },
            { $set: { last_failure_reason: null, last_failed_at: null } }
          );
        }
        continue;
      }
      summary.reserve_failed++;
      // Once per cycle: the claim only matches until the reason is set (cleared on charge / skip).
      const claimed = await Subscription.findOneAndUpdate(
        { _id: sub._id, next_charge_at: sub.next_charge_at, last_failure_reason: { $ne: 'out_of_stock' } },
        { $set: { last_failure_reason: 'out_of_stock', last_failed_at: now } }
      );
      if (claimed) await notify(sub, 'SUBSCRIPTION_OUT_OF_STOCK', await outOfStockMessage(sub));
    } catch (err) {
      console.error(`Subscription ${sub.subscription_id}: holding stock failed`, err);
    }
  }
  return summary;
}

// Suspended boxes: the reminder once after 7 days, and the automatic cancel once
// SUSPENDED_AUTO_CANCEL_DAYS have passed. Both are conditional writes, so overlapping runs act once.
async function processSuspended(now) {
  const summary = { suspended_reminders: 0, auto_cancelled: 0 };
  const suspended = await Subscription.find({ status: 'suspended' });
  for (const sub of suspended) {
    try {
      // Boxes suspended before suspended_at existed start the clock at their last failure.
      let since = sub.suspended_at;
      if (!since) {
        since = sub.last_failed_at || sub.updated_at || now;
        await Subscription.updateOne({ _id: sub._id, status: 'suspended', suspended_at: null }, { $set: { suspended_at: since } });
      }

      const cancelAt = autoCancelAt(since);
      if (cancelAt <= now) {
        const cancelled = await Subscription.findOneAndUpdate(
          { _id: sub._id, status: 'suspended' },
          {
            $set: {
              status: 'cancelled_by_admin', cancel_reason: AUTO_CANCEL_REASON, cancelled_by: 'system', cancelled_at: now,
              pending_changes: {}, replacement_offer: null, admin_proposal: null, next_retry_at: null
            },
            $push: {
              admin_messages: {
                action: 'cancel', reason: AUTO_CANCEL_REASON, sent_by: 'system', sent_at: now,
                message: `Suspended for ${SUSPENDED_AUTO_CANCEL_DAYS} days without a successful payment: cancelled automatically.`
              }
            }
          },
          { new: true }
        );
        if (!cancelled) continue;
        await subscriptionService.releaseStaleReservation(cancelled);
        await notify(cancelled, 'SUBSCRIPTION_CANCELLED',
          `We couldn't charge your card for ${SUSPENDED_AUTO_CANCEL_DAYS} days, so this Ritual Box was cancelled. You were not charged.`);
        summary.auto_cancelled++;
        continue;
      }

      if (!sub.suspended_reminded_at && addCycleDays(since, SUSPENDED_REMINDER_DAYS) <= now) {
        const claimed = await Subscription.findOneAndUpdate(
          { _id: sub._id, status: 'suspended', suspended_reminded_at: null },
          { $set: { suspended_reminded_at: now } }
        );
        if (!claimed) continue;
        await notify(sub, 'SUBSCRIPTION_SUSPENDED',
          `Reminder: update your card and reactivate this Ritual Box by ${formatChargeDate(cancelAt)}, or it will be cancelled.`);
        summary.suspended_reminders++;
      }
    } catch (err) {
      console.error(`Subscription ${sub.subscription_id}: suspended check failed`, err);
    }
  }
  return summary;
}

// SUBSCRIPTION_UPCOMING once per cycle, for boxes whose stock is held (within 3 days of the
// charge). A box that couldn't be held got SUBSCRIPTION_OUT_OF_STOCK instead, and gets this
// notice once a restock lets the job hold it.
async function sendUpcomingNotices(now) {
  const subs = await Subscription.find({
    status: 'active',
    next_charge_at: { $gt: now, $lte: addUnits(now, UPCOMING_NOTICE_UNITS) },
    reserved_for: { $ne: null }
  }, {
    _id: 1, user_id: 1, subscription_id: 1, product_id: 1, variant_id: 1, next_charge_at: 1, quantity: 1,
    pricing_snapshot: 1, shipping_method: 1, upcoming_notified_for: 1, reserved_for: 1, reserved_items: 1
  }).lean();

  let sent = 0;
  for (const sub of subs) {
    if (!subscriptionService.isReservedFor(sub)) continue;
    if (sub.upcoming_notified_for && +sub.upcoming_notified_for === +sub.next_charge_at) continue;
    const claimed = await Subscription.findOneAndUpdate(
      { _id: sub._id, next_charge_at: sub.next_charge_at, upcoming_notified_for: { $ne: sub.next_charge_at } },
      { $set: { upcoming_notified_for: sub.next_charge_at } }
    );
    if (!claimed) continue;
    // A one-cycle replacement is what gets billed this time.
    const total = subscriptionService.cycleItem(sub).pricing.subscribe_price * sub.quantity + (sub.shipping_method === 'express' ? 15 : 0);
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

  // Hold stock first, so a box restocked (or switched to a replacement) since the last pass is
  // charged in this same pass.
  const held = await reserveUpcoming(now);
  for (const [key, n] of Object.entries(held)) if (n) summary[key] = n;

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
  for (const [key, n] of Object.entries(await processSuspended(now))) if (n) summary[key] = n;
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
  UPCOMING_NOTICE_UNITS,
  runSubscriptionChargeJob,
  startSubscriptionChargeJob
};
