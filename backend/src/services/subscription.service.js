const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const notificationService = require('./notification.service');
const inventoryService = require('./inventory.service');
const { appendInternalNote } = require('../utils/internal-notes');
const { addCycleDays, addUnits, RESERVE_AHEAD_UNITS } = require('../utils/subscription-time');

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
  addCycleDays(sub.next_charge_at, days - sub.frequency_days).getTime()
));

class SubscriptionActionError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    this.code = code;
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
const MAX_REPLACEMENT_OPTIONS = 6;

// Price of a product in a box: its own Subscribe & Save discount, like a new box would get.
function boxPricing(product, variant) {
  const discount = product?.subscribe_discount_percent ?? DEFAULT_SUBSCRIBE_DISCOUNT_PERCENT;
  return {
    original_price: variant.price,
    subscribe_price: round2(variant.price * (1 - discount / 100)),
    discount_percent: discount
  };
}

function shapeReplacement(product, variant, basePrice, quantity = 1, current = null) {
  const pricing = boxPricing(product, variant);
  const total = round2(pricing.subscribe_price * quantity);
  return {
    product_id: String(product._id),
    variant_id: variant.sku,
    name: product.name,
    variant_label: variantLabel(variant.label),
    image: pickImage(product, variant),
    price: variant.price,
    same_price: Math.abs(variant.price - basePrice) < 0.005,
    pricing,
    total,
    // What this delivery costs compared with the box's usual charge (+ more, − less).
    difference: current == null ? null : round2(total - current)
  };
}

// Out of stock: in-stock items from the same category, closest in price first (cheaper, same
// price or dearer: the box is billed to a card, so a higher price is simply charged).
async function findReplacements(product, variant, { quantity = 1, currentTotal = null, limit = MAX_REPLACEMENT_OPTIONS } = {}) {
  if (!product) return [];
  const candidates = await Product.find({
    _id: { $ne: product._id },
    category: product.category,
    is_subscribable: true,
    is_active: true,
    'variants.stock': { $gt: 0 }
  }).lean();

  const basePrice = variant?.price ?? 0;
  const options = [];
  for (const p of candidates) {
    for (const v of p.variants || []) {
      if ((v.stock ?? 0) < quantity) continue;
      options.push({ product: p, variant: v, diff: Math.abs(v.price - basePrice) });
    }
  }
  options.sort((a, b) => a.diff - b.diff || a.variant.price - b.variant.price);
  return options.slice(0, limit).map(o => shapeReplacement(o.product, o.variant, basePrice, quantity, currentTotal));
}

// The closest single pick (staff offers, the out-of-stock notification).
async function findReplacement(product, variant) {
  const [best] = await findReplacements(product, variant, { limit: 1 });
  return best || null;
}

// Replacement chosen by staff when pausing an out-of-stock box (admin screen 1.6.1).
async function offeredReplacement(offer, { quantity = 1, basePrice = null, currentTotal = null } = {}) {
  const product = await findProduct(offer.product_id);
  const variant = (product?.variants || []).find(v => v.sku === offer.variant_id);
  if (!product || !variant || (variant.stock ?? 0) < quantity) return null;
  return { ...shapeReplacement(product, variant, basePrice ?? variant.price, quantity, currentTotal), offered_by_staff: true };
}

// Every replacement the customer may pick for an out-of-stock box: the staff offer (if any)
// first, then the closest in-stock items.
async function replacementOptions(sub) {
  const product = await findProduct(sub.product_id);
  const variant = (product?.variants || []).find(v => v.sku === sub.variant_id)
    || { price: sub.pricing_snapshot.original_price };
  const quantity = sub.quantity || 1;
  const currentTotal = round2(sub.pricing_snapshot.subscribe_price * quantity);
  const options = await findReplacements(product, variant, { quantity, currentTotal });
  if (sub.replacement_offer) {
    const offered = await offeredReplacement(sub.replacement_offer, { quantity, basePrice: variant.price, currentTotal });
    if (offered) {
      return [offered, ...options.filter(o => !(o.product_id === offered.product_id && o.variant_id === offered.variant_id))]
        .slice(0, MAX_REPLACEMENT_OPTIONS);
    }
  }
  return options;
}

function orderHistoryStatus(order) {
  if (order.payment_status === 'failed') return 'failed';
  switch (order.order_status) {
    case 'delivered': return 'delivered';
    case 'shipping': return 'shipping';
    case 'delivery_failed': return 'delivery_failed';
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

// ─── Stock held for the next cycle ──────────────────────────────
// 3 days (RESERVE_AHEAD_UNITS) before next_charge_at the charge job holds the box's stock for that
// cycle (subtracted from variants.stock); the charge then uses exactly that stock. A hold belongs
// to one cycle date and one item / quantity: once either changes, or the box stops being billed
// (paused, cancelled, payment_failed, suspended), the hold is stale and goes back on the shelf.
// A payment_failed box gets its stock held again when the customer reactivates it (charge time).
const HOLDING_STATUSES = ['active'];

// Replacement picked for the upcoming cycle only; ignored once that cycle is charged, skipped or moved.
function activeCycleReplacement(sub) {
  const r = sub?.cycle_replacement;
  return r && r.product_id && sameTime(r.for_cycle, sub.next_charge_at) ? r : null;
}

// What the upcoming cycle ships and costs: the one-cycle replacement, else the box's own item.
function cycleItem(sub) {
  const r = activeCycleReplacement(sub);
  return r
    ? { product_id: String(r.product_id), variant_id: r.variant_id, pricing: r.pricing, replacement: true }
    : { product_id: String(sub.product_id), variant_id: sub.variant_id, pricing: sub.pricing_snapshot, replacement: false };
}

const boxLines = sub => {
  const item = cycleItem(sub);
  return [{ product_id: item.product_id, variant_id: item.variant_id, quantity: sub.quantity }];
};
const plainLines = items => (items || []).map(i => ({ product_id: String(i.product_id), variant_id: i.variant_id, quantity: i.quantity }));
const sameTime = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

// True when the box holds stock for its upcoming cycle, for its current item and quantity.
function isReservedFor(sub) {
  if (!sub?.reserved_for || !sameTime(sub.reserved_for, sub.next_charge_at)) return false;
  const [held, ...rest] = plainLines(sub.reserved_items);
  const [line] = boxLines(sub);
  return !!held && !rest.length && held.product_id === line.product_id
    && held.variant_id === line.variant_id && held.quantity === sub.quantity;
}

// Puts the box's held stock back. The hold is cleared in the database first, so the stock goes
// back once even when two paths (customer action, charge job, admin) release it together.
async function releaseReservation(sub) {
  const previous = await Subscription.findOneAndUpdate(
    { _id: sub._id, reserved_for: { $ne: null } },
    { $set: { reserved_for: null, reserved_items: [] } },
    { new: false }
  );
  sub.reserved_for = null;
  sub.reserved_items = [];
  const lines = plainLines(previous?.reserved_items);
  if (lines.length) await inventoryService.releaseItems(lines);
  return lines.length > 0;
}

// Releases a hold that no longer matches the box (cycle skipped or moved, item / quantity
// changed, box paused / cancelled / suspended). Call before saving a changed box.
async function releaseStaleReservation(sub) {
  if (!sub?.reserved_for) return false;
  if (HOLDING_STATUSES.includes(sub.status) && isReservedFor(sub)) return false;
  return releaseReservation(sub);
}

// Holds stock for the box's upcoming cycle (next_charge_at, current item and quantity).
// Idempotent: a box already holding stock for that cycle is left as it is; a stale hold goes
// back first. Returns { ok: true, already } or { ok: false, failed } when stock is short.
async function reserveForCycle(sub) {
  if (isReservedFor(sub)) return { ok: true, already: true };
  if (sub.reserved_for) await releaseReservation(sub);

  const lines = boxLines(sub);
  const reservation = await inventoryService.reserveItems(lines);
  if (!reservation.ok) return { ok: false, failed: reservation.failed };

  const cycle = new Date(sub.next_charge_at);
  const saved = await Subscription.updateOne(
    { _id: sub._id, reserved_for: null },
    { $set: { reserved_for: cycle, reserved_items: lines } }
  );
  if (saved.modifiedCount !== 1) {
    // Another run held stock for this box meanwhile: keep theirs, give this stock back.
    await inventoryService.releaseItems(lines);
    const fresh = await Subscription.findById(sub._id, { reserved_for: 1, reserved_items: 1 }).lean();
    sub.reserved_for = fresh?.reserved_for || null;
    sub.reserved_items = plainLines(fresh?.reserved_items);
    return isReservedFor(sub) ? { ok: true, already: true } : { ok: false, failed: lines[0] };
  }
  sub.reserved_for = cycle;
  sub.reserved_items = lines;
  return { ok: true, already: false };
}

// Takes the box's hold for this charge (cleared atomically so nobody can release it meanwhile).
// Without one the stock is held now — a box reactivated by the customer, or restocked since the
// last job pass; nothing to hold means no charge. Returns the lines taken, or null.
async function takeStockForCharge(sub) {
  if (isReservedFor(sub)) {
    const claimed = await Subscription.findOneAndUpdate(
      { _id: sub._id, reserved_for: sub.reserved_for },
      { $set: { reserved_for: null, reserved_items: [] } },
      { new: false }
    );
    if (claimed && plainLines(claimed.reserved_items).length) return plainLines(claimed.reserved_items);
  }
  if (sub.reserved_for) await releaseReservation(sub);
  const lines = boxLines(sub);
  const reservation = await inventoryService.reserveItems(lines);
  return reservation.ok ? lines : null;
}

// A charge that failed after taking the stock keeps it held for this cycle (retries charge it).
async function keepStockForRetry(sub, lines) {
  const cycle = new Date(sub.next_charge_at);
  const kept = await Subscription.updateOne(
    { _id: sub._id, reserved_for: null },
    { $set: { reserved_for: cycle, reserved_items: lines } }
  );
  if (kept.modifiedCount === 1) {
    sub.reserved_for = cycle;
    sub.reserved_items = lines;
  } else {
    await inventoryService.releaseItems(lines);
  }
}

// ─── Charge ─────────────────────────────────────────────────────
// One charge = one delivery: creates a paid subscription Order and moves next_charge_at
// forward from the moment the charge succeeded. Payments are simulated (same as checkout):
// the charge succeeds when the saved card exists and has not expired.
// The order is built from the stock held for this cycle: no second stock check, no second
// subtraction (the order is stock_reserved, so cancelling it puts the stock back).
// Exported so the hourly charge job can reuse it.
async function chargeSubscription(sub, { now = new Date() } = {}) {
  const user = await User.findOne({ user_id: sub.user_id }).lean();
  const card = (user?.payment_methods || []).find(pm => String(pm._id) === String(sub.payment_method_id));
  if (!card) return { ok: false, reason: 'no_card', message: 'Add a payment card to this subscription first.' };
  if (isCardExpired(card.expire_date, now)) {
    return { ok: false, reason: 'card_expired', message: 'Your card has expired. Choose another card.' };
  }

  // A replacement picked for this cycle ships and is billed instead of the box's item (this cycle only).
  const item = cycleItem(sub);
  const product = await findProduct(item.product_id);
  const variant = (product?.variants || []).find(v => v.sku === item.variant_id);
  if (!product || !variant) {
    return { ok: false, reason: 'out_of_stock', message: 'This item is out of stock. Pick the replacement or skip this cycle.' };
  }

  const unitPrice = item.pricing.subscribe_price;
  const subtotal = round2(unitPrice * sub.quantity);
  const shippingCost = sub.shipping_method === 'express' ? 15 : 0;
  // The checkout order that started the box is delivery #1, so job orders count on from #2.
  const firstBoxOrders = sub.source_order_id && await Order.exists({ order_id: sub.source_order_id }) ? 1 : 0;
  const cycle = firstBoxOrders + (await Order.countDocuments({ subscription_id: sub.subscription_id })) + 1;
  // Order items require a non-empty image; products normally have one.
  const image = variant.images?.[0] || product.images?.[0] || {};

  const lines = await takeStockForCharge(sub);
  if (!lines) {
    return { ok: false, reason: 'out_of_stock', message: 'This item is out of stock. Pick the replacement or skip this cycle.' };
  }
  const [held] = lines;

  const order = new Order({
    user_id: sub.user_id,
    is_guest: false,
    items: [{
      product_id: held.product_id,
      variant_id: held.variant_id,
      product_name: product.name,
      // Order items require a variant name; unlabeled variants use 'Default' like checkout (hidden in the UI).
      variant_name: variant.label || 'Default',
      image: { url: image.url || 'none', public_id: image.public_id || 'none' },
      unit_price: unitPrice,
      quantity: held.quantity,
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
    stock_reserved: true,
    subscription_id: sub.subscription_id,
    subscription_cycle: cycle
  });
  order._statusChangeNote = item.replacement
    ? `Subscription ${sub.subscription_id} charged (cycle ${cycle}) with a one-time replacement for ${sub.product_id}/${sub.variant_id}`
    : `Subscription ${sub.subscription_id} charged (cycle ${cycle})`;

  try {
    await order.save();
  } catch (saveErr) {
    await keepStockForRetry(sub, lines);
    throw saveErr;
  }

  sub.reserved_for = null;
  sub.reserved_items = [];
  // The replacement was for this cycle only; remember it so the customer can keep it for good.
  sub.cycle_replacement = null;
  sub.last_replacement = item.replacement
    ? { product_id: item.product_id, variant_id: item.variant_id, order_id: order.order_id || null, charged_at: now }
    : null;
  sub.last_charged_at = now;
  sub.next_charge_at = addCycleDays(now, sub.frequency_days);
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
    sub.next_charge_at = addCycleDays(now, p.frequency_days);
  }
  if (p.skip) {
    sub.skipped_deliveries.push(sub.next_charge_at);
    sub.next_charge_at = addCycleDays(sub.next_charge_at, sub.frequency_days);
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

// The order was paid for its Subscribe & Save lines but no Ritual Box could start (card removed
// or not a credit / debit card): flag the order for CSKH (Admin Orders › Needs attention), leave
// a note on it and tell the customer, pointing at the order.
async function reportSubscriptionNotStarted(order) {
  console.error(`Order ${order.order_id}: no saved card for its Ritual Box lines, subscriptions not created.`);
  const note = 'Ritual Box not started: the card chosen at checkout is no longer saved (or is not a Visa / Mastercard). '
    + 'Contact the customer to add a card and start the box from the order, or refund the order.';
  try {
    const fresh = await Order.findOne({ order_id: order.order_id }, 'internal_notes').lean();
    await Order.updateOne(
      { order_id: order.order_id },
      {
        $set: {
          subscription_start_failed: true,
          subscription_start_failed_at: new Date(),
          internal_notes: appendInternalNote(fresh?.internal_notes, note, 'System')
        }
      }
    );
  } catch (err) {
    console.error(`Order ${order.order_id}: could not flag the order for its Ritual Box.`, err);
  }
  await notificationService.notifySubscription(
    { user_id: order.user_id, subscription_id: null, order_id: order.order_id },
    'SUBSCRIPTION_NOT_STARTED',
    "Your Ritual Box couldn't start because the card you chose is no longer saved. "
      + 'Add a Visa / Mastercard and start it from the order, or our team will contact you.'
  );
}

// A card a Ritual Box can be billed to: saved, Visa / Mastercard (not NAPAS) and not expired.
const isSubscriptionCard = pm => pm.card_type !== 'NAPAS' && !isCardExpired(pm.expire_date);

// Start one subscription per 'subscription' line of a paid checkout order.
// The order itself is the first delivery, so the next charge is one cycle out.
// Idempotent: lines already turned into subscriptions for this order are skipped.
// `paymentMethodId` (customer starting the box later from the order) replaces the checkout
// card; a bad card then throws instead of flagging the order again.
async function createSubscriptionsFromOrder(order, { paymentMethodId = null } = {}) {
  if (!order || order.is_guest || !order.user_id) return [];
  const lines = (order.items || []).filter(it => it.purchase_type === 'subscription');
  if (!lines.length) return [];

  // The card picked at checkout is stored on the order; a Ritual Box is never created without one.
  const user = await User.findOne({ user_id: order.user_id }).lean();
  const cardId = paymentMethodId || order.subscription_payment_method_id;
  const card = (user?.payment_methods || []).find(pm =>
    String(pm._id) === String(cardId) && (paymentMethodId ? isSubscriptionCard(pm) : pm.card_type !== 'NAPAS')
  );
  if (!card) {
    if (paymentMethodId) throw new SubscriptionActionError('Choose a saved Visa / Mastercard that has not expired.');
    await reportSubscriptionNotStarted(order);
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
      next_charge_at: addCycleDays(now, frequency),
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
    try {
      await sub.save();
    } catch (err) {
      // Second line of defence (unique source_order_id + product_id + variant_id index): another
      // request created this line's box first — hand that one back instead of making another.
      if (!isDuplicateSourceLine(err)) throw err;
      const existing = await Subscription.findOne({
        source_order_id: order.order_id, product_id: line.product_id, variant_id: line.variant_id
      });
      if (!existing) throw err;
      created.push(existing);
      continue;
    }
    created.push(sub);
  }
  return created;
}

// E11000 on the source-line index (not e.g. a subscription_id collision, which must surface).
function isDuplicateSourceLine(err) {
  return err?.code === 11000 && (Boolean(err.keyPattern?.source_order_id) || /source_order_id/.test(err.message || ''));
}

// POST /api/subscriptions/start-from-order/:orderId — the customer starts the Ritual Box of a
// flagged order (subscription_start_failed) with a card saved since. Clears the flag on success.
async function startFromOrder(userIdStr, orderId, paymentMethodId) {
  if (!paymentMethodId) throw new SubscriptionActionError('Choose a card for your Ritual Box.');
  // Claim the order atomically: of two concurrent requests (two tabs) only one clears the flag
  // and goes on to create the box; the other gets the same 409 as a box already started.
  const claimed = await Order.findOneAndUpdate(
    {
      order_id: orderId,
      user_id: userIdStr,
      subscription_start_failed: true,
      payment_status: 'paid',
      order_status: { $nin: ['canceled', 'refund', 'pending_refund'] }
    },
    { $set: { subscription_start_failed: false, subscription_start_failed_at: null } },
    { new: false }
  );
  if (!claimed) {
    const order = await Order.findOne({ order_id: orderId, user_id: userIdStr }, 'subscription_start_failed').lean();
    if (!order) throw new SubscriptionActionError('Order not found.', 404);
    if (!order.subscription_start_failed) {
      throw new SubscriptionActionError('The Ritual Box of this order has already started.', 409);
    }
    throw new SubscriptionActionError('This order can no longer start a Ritual Box.', 409);
  }

  // Put the flag back if no box came out of it, so the customer / CSKH can try again.
  const restoreFlag = () => Order.updateOne(
    { order_id: orderId, subscription_start_failed: false },
    { $set: { subscription_start_failed: true, subscription_start_failed_at: claimed.subscription_start_failed_at } }
  ).catch(err => console.error(`Order ${orderId}: could not restore subscription_start_failed.`, err));
  try {
    const created = await createSubscriptionsFromOrder(claimed, { paymentMethodId });
    if (!created.length && !(await Subscription.exists({ source_order_id: orderId }))) {
      throw new SubscriptionActionError('This order can no longer start a Ritual Box.', 409);
    }
  } catch (err) {
    await restoreFlag();
    throw err;
  }
  const fresh = await Order.findOne({ order_id: orderId }, 'internal_notes').lean();
  await Order.updateOne(
    { order_id: orderId },
    {
      $set: {
        subscription_start_failed: false,
        subscription_start_failed_at: null,
        subscription_payment_method_id: String(paymentMethodId),
        internal_notes: appendInternalNote(fresh?.internal_notes, 'Ritual Box started by the customer from the order.', 'System')
      }
    }
  );
  return { order_id: orderId, subscriptions: await getOrderSubscriptions(orderId) };
}

// Điều chỉnh thông minh: a paid order buying, one-time, the product of an active Ritual Box
// suggests bringing that box forward one step (30 → 14 → 7). Only a suggestion: applied when
// the customer accepts, dropped after SUGGESTION_TTL_DAYS. Not for boxes charging within the
// 48h window (that box is already on its way) or ones started by this same order.
async function suggestAdjustmentsForOrder(order) {
  if (!order || order.is_guest || !order.user_id || order.subscription_id) return [];
  const lines = (order.items || []).filter(it => (it.purchase_type || 'one_time') === 'one_time');
  if (!lines.length) return [];

  const now = new Date();
  const suggested = [];
  for (const line of lines) {
    const filter = {
      user_id: order.user_id,
      product_id: String(line.product_id),
      status: 'active',
      frequency_days: { $in: Object.keys(SHORTER_FREQUENCY).map(Number) },
      next_charge_at: { $gte: new Date(now.getTime() + LOCK_WINDOW_HOURS * HOUR_MS) },
      source_order_id: { $ne: order.order_id },
      // No suggestion still waiting on the customer.
      $or: [
        { suggested_frequency_days: null },
        { suggested_at: null },
        { suggested_at: { $lte: addDays(now, -SUGGESTION_TTL_DAYS) } }
      ]
    };
    if (line.variant_id) filter.variant_id = line.variant_id;

    const candidates = await Subscription.find(filter);
    for (const candidate of candidates) {
      const days = SHORTER_FREQUENCY[candidate.frequency_days];
      // Conditional write so a concurrent order can't suggest (and notify) twice.
      const sub = await Subscription.findOneAndUpdate(
        { _id: candidate._id, frequency_days: candidate.frequency_days, $or: filter.$or },
        { $set: { suggested_frequency_days: days, suggested_at: now, suggested_by_order_id: order.order_id } },
        { new: true }
      );
      if (!sub) continue;
      suggested.push(sub);
      await notificationService.notifySubscription(
        sub,
        'SUBSCRIPTION_ADJUSTED',
        `You bought ${line.product_name} separately. Switch your Ritual Box to every ${days} days to get your next box sooner?`
      );
    }
  }
  return suggested;
}

// Ritual Boxes started by a checkout order (for the order confirmation page).
// The one-time order behind a suggestion was canceled, refunded or is being refunded: the
// customer didn't end up buying it, so the "get your next box sooner" suggestion is withdrawn.
// An adjustment the customer already accepted is NOT reverted — accepting is a decision the
// customer made and was applied (frequency / next charge already changed); only a suggestion
// still waiting on them is removed. The SUBSCRIPTION_ADJUSTED notification stays in the list
// (Notifications have no "expired" state); the Ritual Box page no longer shows Accept for it.
async function withdrawSuggestionsForOrder(orderId) {
  if (!orderId) return 0;
  const result = await Subscription.updateMany(
    { suggested_by_order_id: orderId },
    { $set: { suggested_frequency_days: null, suggested_at: null, suggested_by_order_id: null } }
  );
  return result.modifiedCount || 0;
}

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
// Subscriptions that applyDueTransitions would change at `now` — lets list pages update
// only those instead of loading every subscription.
function dueTransitionsQuery(now) {
  return {
    $or: [
      { status: 'paused', resume_at: { $ne: null, $lte: now } },
      { suggested_frequency_days: { $ne: null }, suggested_at: { $ne: null, $lte: addDays(now, -SUGGESTION_TTL_DAYS) } },
      { 'admin_proposal.expires_at': { $lte: now } }
    ]
  };
}

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
    sub.suggested_by_order_id = null;
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

async function shapeCycleReplacement(sub) {
  const r = activeCycleReplacement(sub);
  if (!r) return null;
  const product = await findProduct(r.product_id);
  const variant = (product?.variants || []).find(v => v.sku === r.variant_id) || null;
  const total = round2(r.pricing.subscribe_price * (sub.quantity || 1));
  return {
    product_id: String(r.product_id),
    variant_id: r.variant_id,
    name: product?.name || 'Unavailable product',
    variant_label: variantLabel(variant?.label),
    image: pickImage(product, variant),
    for_cycle: r.for_cycle,
    pricing: r.pricing,
    total,
    difference: round2(total - sub.pricing_snapshot.subscribe_price * (sub.quantity || 1))
  };
}

async function shapeSwitchOffer(sub) {
  const r = sub.last_replacement;
  if (!r || CLOSED_STATUSES.includes(sub.status)) return null;
  if (String(r.product_id) === String(sub.product_id) && r.variant_id === sub.variant_id) return null;
  const product = await findProduct(r.product_id);
  const variant = (product?.variants || []).find(v => v.sku === r.variant_id);
  if (!product || !variant || product.is_active === false) return null;
  const quantity = sub.quantity || 1;
  const pricing = boxPricing(product, variant);
  const total = round2(pricing.subscribe_price * quantity);
  return {
    product_id: String(product._id),
    variant_id: variant.sku,
    name: product.name,
    variant_label: variantLabel(variant.label),
    image: pickImage(product, variant),
    order_id: r.order_id || null,
    pricing,
    total,
    difference: round2(total - sub.pricing_snapshot.subscribe_price * quantity)
  };
}

// Switches the box's own item for good (price = that product's Subscribe & Save price). A hold
// for the coming cycle follows the new item; nothing in stock → the usual out-of-stock flow.
async function switchBoxItem(sub, product, variant, now) {
  sub.product_id = String(product._id);
  sub.variant_id = variant.sku;
  sub.pricing_snapshot = boxPricing(product, variant);
  sub.cycle_replacement = null;
  sub.last_replacement = null;
  if (sub.status === 'active' && sub.next_charge_at <= addUnits(now, RESERVE_AHEAD_UNITS)) {
    const held = await reserveForCycle(sub);
    if (held.ok && sub.last_failure_reason === 'out_of_stock') {
      sub.last_failure_reason = null;
      sub.last_failed_at = null;
    }
  }
}

async function shapeSubscription(sub, paymentMethods, now) {
  const product = await findProduct(sub.product_id);
  const variant = (product?.variants || []).find(v => v.sku === sub.variant_id) || null;
  const unitPrice = sub.pricing_snapshot.subscribe_price;
  const card = paymentMethods.find(pm => pm.id === String(sub.payment_method_id)) || null;
  // Paused by staff with a replacement offer: the customer can still accept it here.
  const hasOffer = sub.status === 'paused' && !!sub.replacement_offer;
  // Stock held for the coming cycle is already off variants.stock: that box is covered.
  const outOfStock = (sub.status === 'active' || hasOffer) && !!variant && !isReservedFor(sub)
    && (variant.stock ?? 0) < (sub.quantity || 1);
  const suggestion = sub.suggested_frequency_days
    ? {
        frequency_days: sub.suggested_frequency_days,
        next_charge_at: shiftedChargeAt(sub, sub.suggested_frequency_days, now),
        expires_at: addDays(sub.suggested_at || now, SUGGESTION_TTL_DAYS)
      }
    : null;
  const replacementChoices = outOfStock ? await replacementOptions(sub) : [];

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
    // Same time base as the charge job (minutes in demo mode).
    out_of_stock_deadline: outOfStock ? addUnits(sub.next_charge_at, RESERVE_AHEAD_UNITS) : null,
    replacement: replacementChoices[0] || null,
    // Every item the customer may pick for this one delivery (staff offer first, then closest price).
    replacement_options: replacementChoices,
    // Picked for the upcoming delivery only; the box goes back to its own item afterwards.
    cycle_replacement: await shapeCycleReplacement(sub),
    // The last delivery was a replacement: offer to switch the box to it for good.
    switch_offer: await shapeSwitchOffer(sub),
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

const FAILED_STATUSES = ['payment_failed', 'suspended'];

// Why a charge of a payment_failed / suspended box didn't go through, for the customer.
const REACTIVATE_FAILURES = {
  out_of_stock: 'Not charged: this item is out of stock right now. Try again once it is back in stock.',
  card_expired: 'Not charged: this card has expired. Choose another card.',
  no_card: 'Not charged: add a payment card to this subscription first.',
  declined: 'Not charged: the card was declined. Try again or use another card.'
};

// A saved, unexpired card of this customer, or a SubscriptionActionError.
async function savedCard(userIdStr, paymentMethodId) {
  const user = await getUser(userIdStr);
  const card = (user?.payment_methods || []).map(maskCard).find(m => m.id === String(paymentMethodId));
  if (!card) throw new SubscriptionActionError('Payment card not found.');
  if (card.is_expired) throw new SubscriptionActionError(REACTIVATE_FAILURES.card_expired, 400, 'card_expired');
  return card;
}

// Customer charges a payment_failed / suspended box (new card or "Reactivate", also when
// accepting a staff "resume" proposal). Success: active, retries reset, next charge counted from
// this charge (chargeSubscription). Failure: the box stays as it was — status, failed_attempts and
// next_retry_at untouched (no new 24h/48h/72h cycle); only the new card (if any) and the reason are
// kept, written directly so nothing else changed in memory (e.g. an accepted proposal) is saved.
async function reactivateFailedBox(sub, now, { newCardId = null } = {}) {
  let result;
  try {
    result = await chargeSubscription(sub, { now });
  } catch (err) {
    console.error(`Subscription ${sub.subscription_id} reactivation charge error:`, err);
    result = { ok: false, reason: 'declined' };
  }
  if (result.ok) {
    // A change waiting for "after the next charge" (pause / cancel) may have just applied.
    if (FAILED_STATUSES.includes(sub.status)) sub.status = 'active';
    return result;
  }

  const reason = REACTIVATE_FAILURES[result.reason] ? result.reason : 'declined';
  await releaseStaleReservation(sub); // a failed box never keeps stock
  await Subscription.updateOne(
    { _id: sub._id },
    { $set: { ...(newCardId ? { payment_method_id: newCardId } : {}), last_failure_reason: reason, last_failed_at: now } }
  );
  throw new SubscriptionActionError(REACTIVATE_FAILURES[reason], 402, reason);
}

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
    // Resuming a payment_failed / suspended box means charging it: the reactivate flow.
    action = proposal.type === 'frequency' ? 'frequency' : (FAILED_STATUSES.includes(sub.status) ? 'reactivate' : 'resume');
    payload = { frequency_days: proposal.frequency_days };
  }

  // A failed / suspended subscription can only get a new card (charged right away) or be cancelled.
  const FAILED_ACTIONS = ['payment_method', 'reactivate', 'cancel'];
  if (FAILED_STATUSES.includes(sub.status) && !FAILED_ACTIONS.includes(action)) {
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
        sub.next_charge_at = addCycleDays(sub.next_charge_at, sub.frequency_days);
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
      sub.suggested_by_order_id = null;
      break;
    }

    // Đổi / cập nhật thẻ. Với payment_failed / suspended: thẻ mới được charge ngay để tiếp tục.
    case 'payment_method': {
      const card = await savedCard(userIdStr, payload.payment_method_id);
      sub.payment_method_id = card.id;
      if (FAILED_STATUSES.includes(sub.status)) await reactivateFailedBox(sub, now, { newCardId: card.id });
      break;
    }

    // Kích hoạt lại: charge ngay một lần (thẻ đang lưu, hoặc thẻ mới gửi kèm), về active,
    // next_charge_at tính từ lúc charge thành công. Thất bại: giữ nguyên trạng thái, báo lý do.
    case 'reactivate': {
      if (!FAILED_STATUSES.includes(sub.status)) {
        throw new SubscriptionActionError('Only subscriptions with a failed payment can be reactivated.');
      }
      let newCardId = null;
      if (payload.payment_method_id) {
        newCardId = (await savedCard(userIdStr, payload.payment_method_id)).id;
        sub.payment_method_id = newCardId;
      }
      await reactivateFailedBox(sub, now, { newCardId });
      break;
    }

    // Hết hàng: khách xác nhận dùng sản phẩm thay thế.
    case 'use_replacement': {
      // The customer picks one of the offered items (payload.product_id + variant_id; none =
      // the first option). By default it replaces the item for the upcoming delivery only and
      // the box keeps its own item; payload.permanent switches the box to it for good.
      const options = await replacementOptions(sub);
      const picked = payload.product_id
        ? options.find(o => o.product_id === String(payload.product_id) && o.variant_id === payload.variant_id)
        : options[0];
      if (!picked) throw new SubscriptionActionError('This replacement is not available right now. Pick another one.');
      const newProduct = await findProduct(picked.product_id);
      const newVariant = (newProduct?.variants || []).find(v => v.sku === picked.variant_id);
      if (!newProduct || !newVariant) throw new SubscriptionActionError('This replacement is not available right now. Pick another one.');

      // Accepting on a box staff paused for the stock problem resumes it.
      if (sub.status === 'paused' && sub.replacement_offer) {
        sub.status = 'active';
        sub.next_charge_at = now;
        sub.paused_by = null;
        sub.pause_option = null;
        sub.resume_at = null;
      }

      if (payload.permanent === true) {
        await switchBoxItem(sub, newProduct, newVariant, now);
      } else {
        sub.cycle_replacement = {
          product_id: picked.product_id,
          variant_id: picked.variant_id,
          for_cycle: sub.next_charge_at,
          pricing: picked.pricing,
          chosen_at: now
        };
        // Charge coming up: the replacement is held now, so the next job pass charges it.
        if (sub.status === 'active' && sub.next_charge_at <= addUnits(now, RESERVE_AHEAD_UNITS)) {
          const held = await reserveForCycle(sub);
          if (!held.ok) {
            sub.cycle_replacement = null;
            throw new SubscriptionActionError('This replacement just ran out. Pick another one.');
          }
        }
      }
      if (sub.last_failure_reason === 'out_of_stock' && isReservedFor(sub)) {
        sub.last_failure_reason = null;
        sub.last_failed_at = null;
      }
      sub.replacement_offer = null;
      break;
    }

    // After a delivery with a replacement: keep that item in the box from now on.
    case 'switch_item': {
      const offer = await shapeSwitchOffer(sub);
      const current = activeCycleReplacement(sub);
      // Also allowed for the replacement already picked for the coming delivery.
      const target = offer || (current ? { product_id: String(current.product_id), variant_id: current.variant_id } : null);
      if (!target) throw new SubscriptionActionError('There is no replacement to switch to.');
      if (payload.product_id && (String(payload.product_id) !== target.product_id || payload.variant_id !== target.variant_id)) {
        throw new SubscriptionActionError('There is no replacement to switch to.');
      }
      const newProduct = await findProduct(target.product_id);
      const newVariant = (newProduct?.variants || []).find(v => v.sku === target.variant_id);
      if (!newProduct || !newVariant) throw new SubscriptionActionError('This item is no longer available.');
      await switchBoxItem(sub, newProduct, newVariant, now);
      break;
    }

    // Keep the box's own item: hide the switch suggestion.
    case 'dismiss_switch': {
      sub.last_replacement = null;
      break;
    }

    // Điều chỉnh thông minh: rút ngắn chu kỳ kế tiếp một mức, chỉ khi khách xác nhận.
    case 'accept_adjustment': {
      const days = sub.suggested_frequency_days;
      if (!days) throw new SubscriptionActionError('This suggestion has expired.');
      // Same as choosing the shorter frequency: inside the 48h window it starts from the next cycle.
      if (locked) {
        sub.pending_changes.frequency_days = days;
      } else {
        if (sub.status === 'active') {
          sub.next_charge_at = shiftedChargeAt(sub, days, now);
        }
        sub.frequency_days = days;
        sub.pending_changes.frequency_days = null;
      }
      sub.suggested_frequency_days = null;
      sub.suggested_at = null;
      sub.suggested_by_order_id = null;
      break;
    }
    case 'dismiss_adjustment': {
      sub.suggested_frequency_days = null;
      sub.suggested_at = null;
      sub.suggested_by_order_id = null;
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

  // Skip / pause / cancel / new date / new item: stock held for the old cycle goes back.
  await releaseStaleReservation(sub);
  await sub.save();
  return getRitualBox(userIdStr);
}

module.exports = {
  getRitualBox,
  priceSubscriptionLine,
  createSubscriptionsFromOrder,
  startFromOrder,
  suggestAdjustmentsForOrder,
  withdrawSuggestionsForOrder,
  getOrderSubscriptions,
  getOrderRitualBoxes,
  applyAction,
  chargeSubscription,
  reserveForCycle,
  releaseReservation,
  releaseStaleReservation,
  isReservedFor,
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
  findReplacements,
  replacementOptions,
  cycleItem,
  dueTransitionsQuery,
  orderHistoryStatus,
  shapePendingChanges
};
