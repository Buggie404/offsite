const Subscription = require('../models/Subscription');
const Order = require('../models/Order');
const User = require('../models/User');
const notificationService = require('./notification.service');
const {
  SubscriptionActionError,
  FREQUENCIES,
  PAUSE_OPTIONS,
  CLOSED_STATUSES,
  findProduct,
  pickImage,
  cardBrand,
  findReplacement,
  applyDueTransitions,
  orderHistoryStatus,
  chargeSubscription,
  shapePendingChanges
} = require('./subscription.service');

// Admin side of Ritual Box (screen 1.6.1 Subscriptions). Rules: "Project Planning & Prep 2" —
// QLSP và Admin CC xem danh sách, đổi tần suất, huỷ (cancelled_by_admin, bắt buộc lý do),
// kích hoạt lại; mọi hành động ghi ActivityLogs (controller).

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);
const round2 = n => Math.round(n * 100) / 100;

const NEEDS_ACTION_STATUSES = ['payment_failed', 'suspended'];
const PAUSE_REASONS = ['Item out of stock', 'Payment problem', 'Customer asked us', 'Other'];
const CANCEL_REASONS = ['Product discontinued', 'Repeated payment failure', 'Customer asked us', 'Other'];

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function productLabel(product, variant) {
  return [product?.name || 'Unavailable product', variant?.label].filter(Boolean).join(' ');
}

// Out of stock only matters while deliveries are still coming.
function isOutOfStock(sub, variant) {
  return ['active', 'paused'].includes(sub.status) && (!variant || (variant.stock ?? 0) <= 0);
}

function needsAction(row) {
  return row.out_of_stock && row.status === 'active' || NEEDS_ACTION_STATUSES.includes(row.status);
}

async function loadCustomers(userIds) {
  const users = await User.find({ user_id: { $in: [...new Set(userIds)] } })
    .select('user_id profile_name email payment_methods').lean();
  return new Map(users.map(u => [u.user_id, u]));
}

async function shapeRow(sub, user) {
  const product = await findProduct(sub.product_id);
  const variant = (product?.variants || []).find(v => v.sku === sub.variant_id) || null;
  const name = user?.profile_name || sub.delivery_info?.recipient_name || sub.user_id;
  return {
    subscription_id: sub.subscription_id,
    customer: { user_id: sub.user_id, name, initials: initialsOf(name), email: user?.email || null },
    product_name: product?.name || 'Unavailable product',
    variant_label: variant?.label || '',
    box: productLabel(product, variant),
    image: pickImage(product, variant),
    quantity: sub.quantity,
    frequency_days: sub.frequency_days,
    // Paused / cancelled boxes have no upcoming delivery.
    next_charge_at: ['active', 'payment_failed'].includes(sub.status) ? sub.next_charge_at : null,
    status: sub.status,
    out_of_stock: isOutOfStock(sub, variant),
    price: round2(sub.pricing_snapshot.subscribe_price * sub.quantity),
    created_at: sub.created_at
  };
}

function matchesSearch(row, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const compactId = q.replace(/-/g, '');
  return row.subscription_id.toLowerCase().includes(compactId)
    || row.customer.name.toLowerCase().includes(q)
    || (row.customer.email || '').toLowerCase().includes(q)
    || row.box.toLowerCase().includes(q);
}

function matchesFilter(row, filter) {
  switch (filter) {
    case 'active': return row.status === 'active';
    case 'needs_action': return needsAction(row);
    case 'paused': return row.status === 'paused';
    case 'cancelled': return CLOSED_STATUSES.includes(row.status);
    default: return true;
  }
}

async function listSubscriptions({ filter = 'all', search = '' } = {}) {
  const now = new Date();
  const docs = await Subscription.find({}).sort({ created_at: -1 });
  for (const doc of docs) await applyDueTransitions(doc, now);

  const customers = await loadCustomers(docs.map(d => d.user_id));
  const rows = await Promise.all(docs.map(d => shapeRow(d.toObject(), customers.get(d.user_id))));

  const stats = {
    active: rows.filter(r => r.status === 'active').length,
    affected_by_stock: rows.filter(r => r.out_of_stock && r.status === 'active').length,
    paused: rows.filter(r => r.status === 'paused').length,
    needs_action: rows.filter(needsAction).length
  };

  const query = String(search || '').trim();
  return {
    data: rows.filter(r => matchesFilter(r, filter) && matchesSearch(r, query)),
    stats
  };
}

async function getSubscriptionDetail(subscriptionId) {
  const sub = await Subscription.findOne({ subscription_id: subscriptionId });
  if (!sub) throw new SubscriptionActionError('Subscription not found.', 404);
  await applyDueTransitions(sub, new Date());

  const plain = sub.toObject();
  const user = (await loadCustomers([plain.user_id])).get(plain.user_id);
  const row = await shapeRow(plain, user);

  const product = await findProduct(plain.product_id);
  const variant = (product?.variants || []).find(v => v.sku === plain.variant_id) || null;
  const cardDoc = (user?.payment_methods || []).find(pm => String(pm._id) === String(plain.payment_method_id));
  const digits = String(cardDoc?.card_number || '').replace(/\D/g, '');

  const orders = await Order.find({ subscription_id: plain.subscription_id })
    .sort({ created_at: -1 }).limit(20).lean();
  // The checkout order that started the box is the first delivery.
  const sourceOrder = plain.source_order_id
    ? await Order.findOne({ order_id: plain.source_order_id }).lean()
    : null;
  const allOrders = [...orders, ...(sourceOrder ? [sourceOrder] : [])];
  const deliveries = allOrders.map(o => ({
    date: o.created_at,
    order_id: o.order_id,
    result: orderHistoryStatus(o)
  }));

  let replacement = null;
  if (plain.replacement_offer) {
    const rp = await findProduct(plain.replacement_offer.product_id);
    const rv = (rp?.variants || []).find(v => v.sku === plain.replacement_offer.variant_id);
    if (rp && rv) {
      replacement = {
        product_id: plain.replacement_offer.product_id,
        variant_id: rv.sku,
        name: rp.name,
        variant_label: rv.label || '',
        image: pickImage(rp, rv),
        price: rv.price,
        offered: true
      };
    }
  }
  if (!replacement && row.out_of_stock) {
    replacement = await findReplacement(product, variant || { price: plain.pricing_snapshot.original_price });
  }

  return {
    ...row,
    pricing: {
      original_price: plain.pricing_snapshot.original_price,
      subscribe_price: plain.pricing_snapshot.subscribe_price,
      discount_percent: plain.pricing_snapshot.discount_percent
    },
    card: cardDoc ? { brand: cardBrand(cardDoc), last4: digits.slice(-4) } : null,
    pause_option: plain.pause_option,
    resume_at: plain.resume_at,
    upcoming_delivery_at: plain.next_charge_at,
    // The delivery after the upcoming one — for "from the following delivery" / "after the next delivery".
    following_delivery_at: addDays(plain.next_charge_at, plain.frequency_days),
    pending_changes: shapePendingChanges(plain),
    failed_attempts: plain.failed_attempts || 0,
    last_failure_reason: plain.last_failure_reason,
    cancelled_at: plain.cancelled_at,
    cancel_reason: plain.cancel_reason,
    replacement,
    deliveries,
    // Orders already charged keep shipping after a cancel.
    open_order_ids: allOrders
      .filter(o => ['pending', 'processing', 'shipping'].includes(o.order_status))
      .map(o => o.order_id),
    messages: [...(plain.admin_messages || [])].reverse(),
    internal_note: plain.internal_note?.text || '',
    internal_note_updated_at: plain.internal_note?.updated_at || null
  };
}

async function notifyCustomer(sub, type, message) {
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

function cleanText(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Runs one admin action; returns { before, after } plain snapshots for the activity log.
async function applyAdminAction(subscriptionId, action, payload, adminId) {
  const sub = await Subscription.findOne({ subscription_id: subscriptionId });
  if (!sub) throw new SubscriptionActionError('Subscription not found.', 404);
  const now = new Date();
  await applyDueTransitions(sub, now);
  const before = sub.toObject();
  if (!sub.pending_changes) sub.pending_changes = {};

  if (CLOSED_STATUSES.includes(sub.status) && action !== 'note') {
    throw new SubscriptionActionError('This subscription has been cancelled.');
  }

  const message = cleanText(payload.message);
  const logMessage = (reason) => sub.admin_messages.push({ action, reason, message, sent_by: adminId, sent_at: now });

  switch (action) {
    // Staff pause applies right away (e.g. stock problem) — no 48h lock, nothing is charged while paused.
    case 'pause': {
      if (sub.status !== 'active') throw new SubscriptionActionError('Only active subscriptions can be paused.');
      const reason = cleanText(payload.reason, 200);
      if (!PAUSE_REASONS.includes(reason)) throw new SubscriptionActionError('Choose a reason for pausing.');
      const option = payload.pause_option || 'until_reactivated';
      if (!(option in PAUSE_OPTIONS)) throw new SubscriptionActionError('Choose how long to pause.');
      const affects = payload.affects || 'next';
      if (!['next', 'following'].includes(affects)) throw new SubscriptionActionError('Choose which delivery to pause from.');

      if (affects === 'following') {
        // The upcoming delivery is charged and ships; the pause starts right after it.
        if (payload.offer_replacement) {
          throw new SubscriptionActionError('A replacement can only be offered when pausing the next delivery.');
        }
        sub.pending_changes.pause_option = option;
        sub.pending_changes.cancel = null;
        logMessage(reason);
        await sub.save();
        await notifyCustomer(sub, 'SUBSCRIPTION_PAUSED', message);
        break;
      }

      sub.status = 'paused';
      sub.pause_option = option;
      sub.resume_at = PAUSE_OPTIONS[option] ? addDays(now, PAUSE_OPTIONS[option]) : null;
      sub.pending_changes = {};

      sub.replacement_offer = null;
      if (payload.offer_replacement) {
        const product = await findProduct(sub.product_id);
        const variant = (product?.variants || []).find(v => v.sku === sub.variant_id);
        const replacement = await findReplacement(product, variant || { price: sub.pricing_snapshot.original_price });
        if (!replacement) throw new SubscriptionActionError('No replacement is available right now.');
        sub.replacement_offer = {
          product_id: replacement.product_id,
          variant_id: replacement.variant_id,
          offered_at: now,
          offered_by: adminId
        };
      }
      logMessage(reason);
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_PAUSED', message);
      break;
    }

    // Resume a paused box (by staff), or reactivate a failed one: charge now, next_charge_at from that charge.
    case 'reactivate': {
      if (sub.status === 'paused') {
        // Keep the scheduled delivery if it is still ahead; otherwise bill from today.
        sub.status = 'active';
        if (!sub.next_charge_at || sub.next_charge_at < now) sub.next_charge_at = now;
        sub.replacement_offer = null;
      } else if (NEEDS_ACTION_STATUSES.includes(sub.status)) {
        const result = await chargeSubscription(sub, { now });
        if (!result.ok) throw new SubscriptionActionError(result.message);
        sub.status = 'active';
      } else {
        throw new SubscriptionActionError('Only paused or failed subscriptions can be reactivated.');
      }
      logMessage(null);
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_RESUMED', message);
      break;
    }

    case 'frequency': {
      const days = Number(payload.frequency_days);
      if (!FREQUENCIES.includes(days)) throw new SubscriptionActionError('Invalid frequency.');
      if (days === sub.frequency_days) break;
      if (sub.status === 'active') {
        const shifted = addDays(sub.next_charge_at, days - sub.frequency_days);
        sub.next_charge_at = shifted < now ? now : shifted;
      }
      sub.frequency_days = days;
      sub.pending_changes.frequency_days = null;
      sub.suggested_frequency_days = null;
      sub.suggested_at = null;
      await sub.save();
      break;
    }

    // Huỷ bởi admin: hiệu lực ngay, bắt buộc lý do; đơn đã charge vẫn giao.
    case 'cancel': {
      const reason = cleanText(payload.reason, 200);
      if (!CANCEL_REASONS.includes(reason)) throw new SubscriptionActionError('A reason is required to cancel.');
      const cancelReason = reason === 'Other' && message ? message.slice(0, 500) : reason;
      const effective = payload.effective || 'now';
      if (!['now', 'after_next'].includes(effective)) throw new SubscriptionActionError('Choose when the cancellation takes effect.');

      if (effective === 'after_next') {
        // One more charge + delivery, then cancelled_by_admin (applied by the charge).
        if (sub.status !== 'active') {
          throw new SubscriptionActionError('Only active subscriptions have a next delivery to wait for.');
        }
        sub.pending_changes.cancel = { reason: cancelReason, by: adminId };
        sub.pending_changes.pause_option = null;
        logMessage(reason);
        await sub.save();
        await notifyCustomer(sub, 'SUBSCRIPTION_CANCELLED', message || reason);
        break;
      }

      sub.status = 'cancelled_by_admin';
      sub.cancel_reason = cancelReason;
      sub.cancelled_by = adminId;
      sub.pending_changes = {};
      sub.replacement_offer = null;
      logMessage(reason);
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_CANCELLED', message || reason);
      break;
    }

    case 'note': {
      sub.internal_note = { text: cleanText(payload.note, 2000), updated_by: adminId, updated_at: now };
      await sub.save();
      break;
    }

    default:
      throw new SubscriptionActionError('Unknown action.');
  }

  return { before, after: sub.toObject() };
}

module.exports = {
  listSubscriptions,
  getSubscriptionDetail,
  applyAdminAction,
  PAUSE_REASONS,
  CANCEL_REASONS
};
