const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');

// Business rules: "Project Planning & Prep 2" — Subscription conventions.
const FREQUENCIES = [7, 14, 30];
const SHORTER_FREQUENCY = { 30: 14, 14: 7 };      // Điều chỉnh thông minh: 30 → 14 → 7
const DEFAULT_SUBSCRIBE_DISCOUNT_PERCENT = 10;
const MAX_CONSECUTIVE_SKIPS = 2;
const LOCK_WINDOW_HOURS = 48;                     // khoá thao tác trước next_charge_at
const SUGGESTION_TTL_DAYS = 3;                    // gợi ý điều chỉnh / thay thế hết hàng chờ tối đa 3 ngày
const PAUSE_OPTIONS = { '1_month': 30, '2_months': 60, until_reactivated: null };
const CLOSED_STATUSES = ['cancelled', 'cancelled_by_admin'];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);
const round2 = n => Math.round(n * 100) / 100;

// A shorter frequency moves the next charge earlier, but never closer than the 48h notice window.
const shiftedChargeAt = (sub, days, now) => new Date(Math.max(
  now.getTime() + LOCK_WINDOW_HOURS * HOUR_MS,
  addDays(sub.next_charge_at, days - sub.frequency_days).getTime()
));

class SubscriptionActionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Subscriptions store product_id as the Product _id string (same as Carts);
// fall back to the numeric product_id for older records.
async function findProduct(productId) {
  if (mongoose.Types.ObjectId.isValid(String(productId))) {
    const byId = await Product.findById(String(productId)).lean();
    if (byId) return byId;
  }
  if (/^\d+$/.test(String(productId))) {
    return Product.findOne({ product_id: Number(productId) }).lean();
  }
  return null;
}

// Variant label worth showing: '' for products without real variants ("Default").
function variantLabel(label) {
  const text = String(label || '').trim();
  return /^default( variant)?$/i.test(text) ? '' : text;
}

function pickImage(product, variant) {
  const sorted = imgs => [...(imgs || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return sorted(variant?.images)[0]?.url || sorted(product?.images)[0]?.url || null;
}

// "MM/YY" → expired once that month is over.
function isCardExpired(expireDate, now = new Date()) {
  const m = /^(\d{1,2})\/(\d{2})$/.exec(String(expireDate || '').trim());
  if (!m) return false;
  const endOfMonth = new Date(2000 + Number(m[2]), Number(m[1]), 1);
  return endOfMonth <= now;
}

function maskCard(pm) {
  const digits = String(pm.card_number || '').replace(/\D/g, '');
  return {
    id: String(pm._id),
    card_type: pm.card_type,
    issued_bank: pm.issued_bank || null,
    last4: digits.slice(-4),
    expire_date: pm.expire_date,
    is_default: !!pm.is_default,
    is_expired: isCardExpired(pm.expire_date)
  };
}

function cardBrand(pm) {
  if (pm.card_type === 'NAPAS') return 'Napas';
  const first = String(pm.card_number || '').replace(/\D/g, '')[0];
  return first === '4' ? 'Visa' : first === '5' ? 'Mastercard' : 'Card';
}

const isLocked = (sub, now = new Date()) =>
  sub.status === 'active' && new Date(sub.next_charge_at).getTime() - now.getTime() < LOCK_WINDOW_HOURS * HOUR_MS;

// Same category, subscribable, in stock — closest price wins.
async function findReplacement(product, variant) {
  if (!product) return null;
  const candidates = await Product.find({
    _id: { $ne: product._id },
    category: product.category,
    is_subscribable: true,
    is_active: true,
    'variants.stock': { $gt: 0 }
  }).lean();

  let best = null;
  for (const p of candidates) {
    for (const v of p.variants || []) {
      if ((v.stock ?? 0) <= 0) continue;
      const diff = Math.abs(v.price - variant.price);
      if (!best || diff < best.diff) best = { product: p, variant: v, diff };
    }
  }
  if (!best) return null;

  return {
    product_id: String(best.product._id),
    variant_id: best.variant.sku,
    name: best.product.name,
    variant_label: variantLabel(best.variant.label),
    image: pickImage(best.product, best.variant),
    price: best.variant.price,
    same_price: best.diff < 0.005
  };
}

// Replacement chosen by staff when pausing an out-of-stock box (admin screen 1.6.1).
async function offeredReplacement(offer) {
  const product = await findProduct(offer.product_id);
  const variant = (product?.variants || []).find(v => v.sku === offer.variant_id);
  if (!product || !variant || (variant.stock ?? 0) <= 0) return null;
  return {
    product_id: String(product._id),
    variant_id: variant.sku,
    name: product.name,
    variant_label: variantLabel(variant.label),
    image: pickImage(product, variant),
    price: variant.price,
    same_price: false
  };
}

function orderHistoryStatus(order) {
  if (order.payment_status === 'failed') return 'failed';
  switch (order.order_status) {
    case 'delivered': return 'delivered';
    case 'shipping': return 'shipping';
    case 'canceled': return 'cancelled';
    case 'refund':
    case 'pending_refund':
    case 'refund_rejected': return 'refund';
    default: return 'processing';
  }
}

async function getUser(userIdStr) {
  return User.findOne({ user_id: userIdStr }, { payment_methods: 1 }).lean();
}

// ─── Charge ─────────────────────────────────────────────────────
// One charge = one delivery: creates a paid subscription Order and moves next_charge_at
// forward from the moment the charge succeeded. Payments are simulated (same as checkout):
// the charge succeeds when the saved card exists and has not expired.
// Exported so the hourly charge job can reuse it.
async function chargeSubscription(sub, { now = new Date() } = {}) {
  const user = await User.findOne({ user_id: sub.user_id }).lean();
  const card = (user?.payment_methods || []).find(pm => String(pm._id) === String(sub.payment_method_id));
  if (!card) return { ok: false, reason: 'no_card', message: 'Add a payment card to this subscription first.' };
  if (isCardExpired(card.expire_date, now)) {
    return { ok: false, reason: 'card_expired', message: 'Your card has expired. Choose another card.' };
  }

  const product = await findProduct(sub.product_id);
  const variant = (product?.variants || []).find(v => v.sku === sub.variant_id);
  if (!product || !variant || (variant.stock ?? 0) < sub.quantity) {
    return { ok: false, reason: 'out_of_stock', message: 'This item is out of stock. Pick the replacement or skip this cycle.' };
  }

  const unitPrice = sub.pricing_snapshot.subscribe_price;
  const subtotal = round2(unitPrice * sub.quantity);
  const shippingCost = sub.shipping_method === 'express' ? 15 : 0;
  // The checkout order that started the box is delivery #1, so job orders count on from #2.
  const firstBoxOrders = sub.source_order_id && await Order.exists({ order_id: sub.source_order_id }) ? 1 : 0;
  const cycle = firstBoxOrders + (await Order.countDocuments({ subscription_id: sub.subscription_id })) + 1;
  // Order items require a non-empty image; products normally have one.
  const image = variant.images?.[0] || product.images?.[0] || {};

  const order = new Order({
    user_id: sub.user_id,
    is_guest: false,
    items: [{
      product_id: sub.product_id,
      variant_id: sub.variant_id,
      product_name: product.name,
      // Order items require a variant name; unlabeled variants use 'Default' like checkout (hidden in the UI).
      variant_name: variant.label || 'Default',
      image: { url: image.url || 'none', public_id: image.public_id || 'none' },
      unit_price: unitPrice,
      quantity: sub.quantity,
      subtotal,
      purchase_type: 'subscription',
      subscription_frequency_days: sub.frequency_days
    }],
    delivery_info: sub.delivery_info?.toObject ? sub.delivery_info.toObject() : sub.delivery_info,
    shipping: { method: sub.shipping_method, cost: shippingCost },
    payment: {
      method: 'card',
      card_info: {
        brand: cardBrand(card),
        last4: String(card.card_number).replace(/\D/g, '').slice(-4),
        cardholder_name: card.cardholder_name
      }
    },
    pricing: {
      subtotal,
      shipping_cost: shippingCost,
      discount_amount: 0,
      total: round2(subtotal + shippingCost),
      currency: 'USD'
    },
    payment_status: 'paid',
    subscription_id: sub.subscription_id,
    subscription_cycle: cycle
  });
  order._statusChangeNote = `Subscription ${sub.subscription_id} charged (cycle ${cycle})`;
  await order.save();

  sub.last_charged_at = now;
  sub.next_charge_at = addDays(now, sub.frequency_days);
  sub.failed_attempts = 0;
  sub.last_failure_reason = null;
  sub.next_retry_at = null;
  sub.consecutive_skips = 0;
  applyPendingAfterCharge(sub, now);
  return { ok: true, order };
}

// Changes made inside the 48h lock window (or scheduled by staff for "after the next delivery")
// take effect right after the upcoming charge.
function applyPendingAfterCharge(sub, now) {
  const p = sub.pending_changes || {};
  if (p.cancel) {
    sub.status = 'cancelled_by_admin';
    sub.cancel_reason = p.cancel.reason;
    sub.cancelled_by = p.cancel.by;
    sub.pending_changes = {};
    return;
  }
  if (p.frequency_days) {
    sub.frequency_days = p.frequency_days;
    sub.next_charge_at = addDays(now, p.frequency_days);
  }
  if (p.skip) {
    sub.skipped_deliveries.push(sub.next_charge_at);
    sub.next_charge_at = addDays(sub.next_charge_at, sub.frequency_days);
    sub.consecutive_skips = 1;
  }
  if (p.pause_option) {
    sub.status = 'paused';
    sub.pause_option = p.pause_option;
    sub.resume_at = PAUSE_OPTIONS[p.pause_option] ? addDays(now, PAUSE_OPTIONS[p.pause_option]) : null;
    sub.paused_by = p.pause_by || 'customer';
  }
  sub.pending_changes = {};
}

// ─── Checkout ───────────────────────────────────────────────────

// Server-side price for a Subscribe & Save checkout line. Null when the product
// can't be subscribed to (not subscribable, inactive or unknown variant).
async function priceSubscriptionLine(productId, sku) {
  const product = await findProduct(productId);
  if (!product || !product.is_subscribable || product.is_active === false) return null;
  const variant = (product.variants || []).find(v => v.sku === sku);
  if (!variant) return null;
  const discount = product.subscribe_discount_percent ?? DEFAULT_SUBSCRIBE_DISCOUNT_PERCENT;
  return {
    original_price: variant.price,
    subscribe_price: Math.round(variant.price * (100 - discount)) / 100,
    discount_percent: discount
  };
}

// Start one subscription per 'subscription' line of a paid checkout order.
// The order itself is the first delivery, so the next charge is one cycle out.
// Idempotent: lines already turned into subscriptions for this order are skipped.
async function createSubscriptionsFromOrder(order) {
  if (!order || order.is_guest || !order.user_id) return [];
  const lines = (order.items || []).filter(it => it.purchase_type === 'subscription');
  if (!lines.length) return [];

  // The card picked at checkout is stored on the order; a Ritual Box is never created without one.
  const user = await User.findOne({ user_id: order.user_id }).lean();
  const card = (user?.payment_methods || []).find(pm =>
    String(pm._id) === String(order.subscription_payment_method_id) && pm.card_type !== 'NAPAS'
  );
  if (!card) {
    console.error(`Order ${order.order_id}: no saved card for its Ritual Box lines, subscriptions not created.`);
    return [];
  }

  const created = [];
  const now = new Date();
  for (const line of lines) {
    const exists = await Subscription.exists({
      source_order_id: order.order_id, product_id: line.product_id, variant_id: line.variant_id
    });
    if (exists) continue;

    const pricing = await priceSubscriptionLine(line.product_id, line.variant_id);
    const frequency = FREQUENCIES.includes(line.subscription_frequency_days) ? line.subscription_frequency_days : 14;
    const sub = new Subscription({
      user_id: order.user_id,
      product_id: line.product_id,
      variant_id: line.variant_id,
      quantity: line.quantity,
      frequency_days: frequency,
      next_charge_at: addDays(now, frequency),
      status: 'active',
      pricing_snapshot: pricing || {
        original_price: line.unit_price,
        subscribe_price: line.unit_price,
        discount_percent: 0
      },
      payment_method_id: String(card._id),
      delivery_info: order.delivery_info?.toObject ? order.delivery_info.toObject() : order.delivery_info,
      shipping_method: order.shipping?.method || 'standard',
      last_charged_at: now,
      source_order_id: order.order_id
    });
    await sub.save();
    created.push(sub);
  }
  return created;
}

// Ritual Boxes started by a checkout order (for the order confirmation page).
async function shapeOrderSubscription(sub) {
  const product = await findProduct(sub.product_id);
  const variant = (product?.variants || []).find(v => v.sku === sub.variant_id) || null;
  return {
    subscription_id: sub.subscription_id,
    product_name: product?.name || 'Unavailable product',
    variant_label: variantLabel(variant?.label),
    image: pickImage(product, variant),
    quantity: sub.quantity,
    frequency_days: sub.frequency_days,
    price_per_delivery: round2(sub.pricing_snapshot.subscribe_price * sub.quantity),
    discount_percent: sub.pricing_snapshot.discount_percent,
    next_charge_at: sub.next_charge_at,
    status: sub.status
  };
}

async function getOrderSubscriptions(orderId) {
  if (!orderId) return [];
  const subs = await Subscription.find({ source_order_id: orderId }).sort({ created_at: 1 }).lean();
  return Promise.all(subs.map(shapeOrderSubscription));
}

// Admin order detail: the Ritual Box that billed this order (renewal, relation 'renewal')
// or the ones this checkout started (relation 'started').
async function getOrderRitualBoxes(order) {
  if (order.subscription_id) {
    const sub = await Subscription.findOne({ subscription_id: order.subscription_id }).lean();
    return sub ? [{ ...(await shapeOrderSubscription(sub)), relation: 'renewal' }] : [];
  }
  const started = await getOrderSubscriptions(order.order_id);
  return started.map(sub => ({ ...sub, relation: 'started' }));
}

// ─── Read ───────────────────────────────────────────────────────

// Time-based transitions the charge job would also do; applied on read so the
// screen is right even between job runs.
async function applyDueTransitions(sub, now) {
  let dirty = false;
  // Tạm dừng hết hạn → tự về active, next_charge_at tính lại từ ngày tiếp tục.
  if (sub.status === 'paused' && sub.resume_at && sub.resume_at <= now) {
    const resumedOn = sub.resume_at;
    sub.status = 'active';
    sub.next_charge_at = resumedOn;
    dirty = true;
  }
  // Gợi ý điều chỉnh quá 3 ngày không xác nhận → bỏ gợi ý.
  if (sub.suggested_frequency_days && sub.suggested_at && addDays(sub.suggested_at, SUGGESTION_TTL_DAYS) <= now) {
    sub.suggested_frequency_days = null;
    sub.suggested_at = null;
    dirty = true;
  }
  // Staff proposal not answered within 3 days → it lapses and nothing changes.
  if (sub.admin_proposal && sub.admin_proposal.expires_at <= now) {
    sub.admin_messages.push({
      action: 'proposal_expired', reason: sub.admin_proposal.type, sent_by: 'system', sent_at: now,
      ticket_id: sub.admin_proposal.ticket_id || null
    });
    sub.admin_proposal = null;
    dirty = true;
  }
  if (dirty) await sub.save();
}

function shapePendingChanges(sub) {
  const p = sub.pending_changes || {};
  if (!p.frequency_days && !p.skip && !p.pause_option && !p.cancel) return null;
  return {
    frequency_days: p.frequency_days || null,
    skip: !!p.skip,
    pause_option: p.pause_option || null,
    cancel: !!p.cancel
  };
}

async function shapeSubscription(sub, paymentMethods, now) {
  const product = await findProduct(sub.product_id);
  const variant = (product?.variants || []).find(v => v.sku === sub.variant_id) || null;
  const unitPrice = sub.pricing_snapshot.subscribe_price;
  const card = paymentMethods.find(pm => pm.id === String(sub.payment_method_id)) || null;
  // Paused by staff with a replacement offer: the customer can still accept it here.
  const hasOffer = sub.status === 'paused' && !!sub.replacement_offer;
  const outOfStock = (sub.status === 'active' || hasOffer) && !!variant && (variant.stock ?? 0) <= 0;
  const suggestion = sub.suggested_frequency_days
    ? {
        frequency_days: sub.suggested_frequency_days,
        next_charge_at: shiftedChargeAt(sub, sub.suggested_frequency_days, now),
        expires_at: addDays(sub.suggested_at || now, SUGGESTION_TTL_DAYS)
      }
    : null;

  return {
    subscription_id: sub.subscription_id,
    product_id: sub.product_id,
    variant_id: sub.variant_id,
    product_name: product?.name || 'Unavailable product',
    product_slug: product?.slug || null,
    variant_label: variantLabel(variant?.label),
    image: pickImage(product, variant),
    quantity: sub.quantity,
    frequency_days: sub.frequency_days,
    next_charge_at: sub.next_charge_at,
    status: sub.status,
    is_locked: isLocked(sub, now),
    pending_changes: shapePendingChanges(sub),
    consecutive_skips: sub.consecutive_skips || 0,
    can_skip: sub.status === 'active' && (sub.consecutive_skips || 0) < MAX_CONSECUTIVE_SKIPS,
    pause_option: sub.pause_option,
    paused_at: sub.paused_at,
    resume_at: sub.resume_at,
    failed_attempts: sub.failed_attempts,
    last_failed_at: sub.last_failed_at,
    last_failure_reason: sub.last_failure_reason,
    pricing: {
      original_price: sub.pricing_snapshot.original_price,
      subscribe_price: unitPrice,
      discount_percent: sub.pricing_snapshot.discount_percent,
      total: round2(unitPrice * sub.quantity)
    },
    payment_method: card,
    out_of_stock: outOfStock,
    // Chờ khách xác nhận tối đa 3 ngày; không xác nhận thì bỏ qua chu kỳ, không charge.
    out_of_stock_deadline: outOfStock ? addDays(sub.next_charge_at, SUGGESTION_TTL_DAYS) : null,
    replacement: outOfStock
      ? (hasOffer ? await offeredReplacement(sub.replacement_offer) : await findReplacement(product, variant))
      : null,
    suggestion,
    // Change proposed by staff; nothing happens until the customer accepts.
    admin_proposal: sub.admin_proposal
      ? {
          type: sub.admin_proposal.type,
          frequency_days: sub.admin_proposal.frequency_days || null,
          message: sub.admin_proposal.message || '',
          // Next charge if accepted now — same rules as the 'frequency' / 'resume' actions.
          next_charge_at: sub.admin_proposal.type === 'frequency'
            ? (isLocked(sub, now) ? sub.next_charge_at : shiftedChargeAt(sub, sub.admin_proposal.frequency_days, now))
            : now,
          expires_at: sub.admin_proposal.expires_at
        }
      : null,
    paused_by: sub.paused_by || null,
    created_at: sub.created_at
  };
}

async function getRitualBox(userIdStr) {
  const now = new Date();
  const [docs, user] = await Promise.all([
    Subscription.find({ user_id: userIdStr }).sort({ created_at: 1 }),
    getUser(userIdStr)
  ]);
  const paymentMethods = (user?.payment_methods || []).map(maskCard);

  for (const doc of docs) await applyDueTransitions(doc, now);

  const open = docs.filter(d => !CLOSED_STATUSES.includes(d.status)).map(d => d.toObject());
  const subscriptions = await Promise.all(open.map(s => shapeSubscription(s, paymentMethods, now)));

  // History covers cancelled subscriptions too, so past boxes stay visible.
  const nameBySub = new Map();
  for (const s of docs) {
    const shaped = subscriptions.find(x => x.subscription_id === s.subscription_id);
    if (shaped) {
      nameBySub.set(s.subscription_id, [shaped.product_name, shaped.variant_label].filter(Boolean).join(' '));
    } else {
      const p = await findProduct(s.product_id);
      const v = (p?.variants || []).find(x => x.sku === s.variant_id);
      nameBySub.set(s.subscription_id, [p?.name, variantLabel(v?.label)].filter(Boolean).join(' ') || s.subscription_id);
    }
  }

  const subIds = docs.map(s => s.subscription_id);
  const orders = subIds.length
    ? await Order.find({ user_id: userIdStr, subscription_id: { $in: subIds } })
        .sort({ created_at: -1 }).limit(20).lean()
    : [];

  const history = [
    ...orders.map(o => ({
      date: o.created_at,
      box: o.items?.[0]
        ? [o.items[0].product_name, variantLabel(o.items[0].variant_name)].filter(Boolean).join(' ')
        : nameBySub.get(o.subscription_id),
      order_id: o.order_id,
      amount: o.pricing?.total ?? null,
      status: orderHistoryStatus(o)
    })),
    // Skips scheduled for after a cancellation never happened, so leave them out.
    ...docs.flatMap(s => (s.skipped_deliveries || [])
      .filter(date => !(CLOSED_STATUSES.includes(s.status) && s.cancelled_at && date > s.cancelled_at))
      .map(date => ({
        date,
        box: nameBySub.get(s.subscription_id),
        order_id: null,
        amount: null,
        status: 'skipped'
      }))),
    // Cancelled subscriptions leave the list but stay in the history as one row.
    ...docs
      .filter(s => CLOSED_STATUSES.includes(s.status))
      .map(s => ({
        date: s.cancelled_at || s.updated_at,
        box: nameBySub.get(s.subscription_id),
        order_id: null,
        amount: null,
        status: s.status === 'cancelled_by_admin' ? 'cancelled_by_admin' : 'subscription_cancelled',
        note: s.cancel_reason || null
      }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);

  return { subscriptions, history, payment_methods: paymentMethods };
}

// ─── Customer actions ───────────────────────────────────────────

async function applyAction(userIdStr, subscriptionId, action, payload = {}) {
  const sub = await Subscription.findOne({ user_id: userIdStr, subscription_id: subscriptionId });
  if (!sub) throw new SubscriptionActionError('Subscription not found.', 404);
  if (CLOSED_STATUSES.includes(sub.status)) throw new SubscriptionActionError('This subscription has been cancelled.');

  const now = new Date();
  await applyDueTransitions(sub, now);
  const locked = isLocked(sub, now);
  if (!sub.pending_changes) sub.pending_changes = {};

  // Staff proposals: accepting runs the proposed change as the customer's own action; declining drops it.
  if (action === 'accept_proposal' || action === 'decline_proposal') {
    const proposal = sub.admin_proposal;
    if (!proposal) throw new SubscriptionActionError('This proposal is no longer available.');
    sub.admin_proposal = null;
    sub.admin_messages.push({
      action: action === 'accept_proposal' ? 'proposal_accepted' : 'proposal_declined',
      reason: proposal.type, sent_by: userIdStr, sent_at: now, ticket_id: proposal.ticket_id || null
    });
    if (action === 'decline_proposal') {
      await sub.save();
      return getRitualBox(userIdStr);
    }
    action = proposal.type === 'frequency' ? 'frequency' : 'resume';
    payload = { frequency_days: proposal.frequency_days };
  }

  // A failed / suspended subscription can only get a new card (charged right away) or be cancelled.
  const FAILED_ACTIONS = ['payment_method', 'reactivate', 'cancel'];
  if (['payment_failed', 'suspended'].includes(sub.status) && !FAILED_ACTIONS.includes(action)) {
    throw new SubscriptionActionError('Update your card to continue, or cancel this subscription.');
  }

  switch (action) {
    // Bỏ qua chu kỳ: không tính phí; tối đa 2 chu kỳ liên tiếp. Trong 48h trước charge → áp dụng cho chu kỳ sau.
    case 'skip': {
      if (sub.status !== 'active') throw new SubscriptionActionError('Only active subscriptions can skip a cycle.');
      if ((sub.consecutive_skips || 0) >= MAX_CONSECUTIVE_SKIPS) {
        throw new SubscriptionActionError('You can skip up to 2 cycles in a row. Pause or cancel instead.');
      }
      if (locked) {
        if (sub.pending_changes.skip) throw new SubscriptionActionError('The following cycle is already set to be skipped.');
        sub.pending_changes.skip = true;
      } else {
        sub.skipped_deliveries.push(sub.next_charge_at);
        sub.next_charge_at = addDays(sub.next_charge_at, sub.frequency_days);
        sub.consecutive_skips = (sub.consecutive_skips || 0) + 1;
      }
      break;
    }

    // Tạm dừng: 1 tháng, 2 tháng, hoặc đến khi khách kích hoạt lại.
    case 'pause': {
      if (sub.status !== 'active') throw new SubscriptionActionError('Only active subscriptions can be paused.');
      const option = payload.pause_option;
      if (!(option in PAUSE_OPTIONS)) throw new SubscriptionActionError('Choose how long to pause.');
      if (locked) {
        sub.pending_changes.pause_option = option;
        sub.pending_changes.pause_by = 'customer';
      } else {
        sub.status = 'paused';
        sub.pause_option = option;
        sub.resume_at = PAUSE_OPTIONS[option] ? addDays(now, PAUSE_OPTIONS[option]) : null;
        sub.paused_by = 'customer';
        sub.pending_changes.skip = false;
      }
      break;
    }

    // Tiếp tục sớm: về active, next_charge_at tính lại từ ngày tiếp tục.
    case 'resume': {
      if (sub.status !== 'paused') throw new SubscriptionActionError('Only paused subscriptions can be resumed.');
      sub.status = 'active';
      sub.next_charge_at = now;
      break;
    }

    // Đổi tần suất. Trong 48h trước charge → áp dụng từ chu kỳ sau.
    case 'frequency': {
      const days = Number(payload.frequency_days);
      if (!FREQUENCIES.includes(days)) throw new SubscriptionActionError('Invalid frequency.');
      if (locked) {
        sub.pending_changes.frequency_days = days === sub.frequency_days ? null : days;
      } else {
        if (sub.status === 'active') {
          sub.next_charge_at = shiftedChargeAt(sub, days, now);
        }
        sub.frequency_days = days;
        sub.pending_changes.frequency_days = null;
      }
      sub.suggested_frequency_days = null;
      sub.suggested_at = null;
      break;
    }

    // Đổi / cập nhật thẻ. Với payment_failed / suspended, khách bấm "Kích hoạt lại" sau đó.
    case 'payment_method': {
      const user = await getUser(userIdStr);
      const card = (user?.payment_methods || []).map(maskCard).find(m => m.id === String(payload.payment_method_id));
      if (!card) throw new SubscriptionActionError('Payment card not found.');
      if (card.is_expired) throw new SubscriptionActionError('This card has expired. Choose another card.');
      sub.payment_method_id = card.id;

      // Failed payment: the new card is charged straight away to continue the subscription.
      if (['payment_failed', 'suspended'].includes(sub.status)) {
        const result = await chargeSubscription(sub, { now });
        if (!result.ok) {
          sub.last_failure_reason = result.reason;
          sub.last_failed_at = now;
          await sub.save(); // keep the new card even if this charge failed
          throw new SubscriptionActionError(result.message);
        }
        sub.status = 'active';
      }
      break;
    }

    // Kích hoạt lại: về active, charge ngay một lần, next_charge_at tính từ lúc charge thành công.
    case 'reactivate': {
      if (!['payment_failed', 'suspended'].includes(sub.status)) {
        throw new SubscriptionActionError('Only subscriptions with a failed payment can be reactivated.');
      }
      const result = await chargeSubscription(sub, { now });
      if (!result.ok) throw new SubscriptionActionError(result.message);
      sub.status = 'active';
      break;
    }

    // Hết hàng: khách xác nhận dùng sản phẩm thay thế.
    case 'use_replacement': {
      const product = await findProduct(sub.product_id);
      const variant = (product?.variants || []).find(v => v.sku === sub.variant_id);
      const replacement = sub.replacement_offer
        ? await offeredReplacement(sub.replacement_offer)
        : await findReplacement(product, variant || { price: sub.pricing_snapshot.original_price });
      if (!replacement) throw new SubscriptionActionError('No replacement is available right now.');
      const newProduct = await findProduct(replacement.product_id);
      const discount = newProduct.subscribe_discount_percent ?? DEFAULT_SUBSCRIBE_DISCOUNT_PERCENT;
      sub.product_id = replacement.product_id;
      sub.variant_id = replacement.variant_id;
      sub.pricing_snapshot = {
        original_price: replacement.price,
        subscribe_price: round2(replacement.price * (1 - discount / 100)),
        discount_percent: discount
      };
      // Accepting a staff offer on a paused box resumes it with the new item.
      if (sub.status === 'paused' && sub.replacement_offer) {
        sub.status = 'active';
        sub.next_charge_at = now;
      }
      sub.replacement_offer = null;
      break;
    }

    // Điều chỉnh thông minh: rút ngắn chu kỳ kế tiếp một mức, chỉ khi khách xác nhận.
    case 'accept_adjustment': {
      const days = sub.suggested_frequency_days;
      if (!days) throw new SubscriptionActionError('This suggestion has expired.');
      if (sub.status === 'active') {
        sub.next_charge_at = shiftedChargeAt(sub, days, now);
      }
      sub.suggested_frequency_days = null;
      sub.suggested_at = null;
      break;
    }
    case 'dismiss_adjustment': {
      sub.suggested_frequency_days = null;
      sub.suggested_at = null;
      break;
    }

    // Huỷ: hiệu lực ngay, không charge thêm; đơn đã charge vẫn giao. Lý do là tuỳ chọn.
    case 'cancel': {
      sub.status = 'cancelled';
      sub.cancel_reason = typeof payload.reason === 'string' && payload.reason.trim()
        ? payload.reason.trim().slice(0, 500)
        : null;
      sub.pending_changes = {};
      break;
    }

    default:
      throw new SubscriptionActionError('Unknown action.');
  }

  await sub.save();
  return getRitualBox(userIdStr);
}

module.exports = {
  getRitualBox,
  priceSubscriptionLine,
  createSubscriptionsFromOrder,
  getOrderSubscriptions,
  getOrderRitualBoxes,
  applyAction,
  chargeSubscription,
  applyDueTransitions,
  isCardExpired,
  SubscriptionActionError,
  FREQUENCIES,
  SHORTER_FREQUENCY,
  PAUSE_OPTIONS,
  CLOSED_STATUSES,
  // Shared with the admin subscription service.
  findProduct,
  pickImage,
  maskCard,
  cardBrand,
  findReplacement,
  applyDueTransitions,
  orderHistoryStatus,
  shapePendingChanges
};
