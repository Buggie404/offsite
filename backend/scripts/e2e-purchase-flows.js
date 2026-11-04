#!/usr/bin/env node
// E2E check of the purchase flows against a DEV database, through the real HTTP API.
//
//   cd backend && node scripts/e2e-purchase-flows.js          # run, print PASS/FAIL, clean up
//   cd backend && node scripts/e2e-purchase-flows.js --keep   # keep the TEST_E2E_ data to inspect
//
// - Uses MONGODB_URI (backend/.env). Refuses to run when NODE_ENV=production or the database
//   name contains "prod". Starts the Express app in this process on a free port (no socket.io,
//   no background jobs) and calls it with customer / guest / admin tokens.
// - Creates its own data prefixed TEST_E2E_ (users, products, voucher) and deletes it at the
//   start (leftovers of a crashed run) and at the end. Orders it creates use real order ids
//   (OFS-YYYY-NNNNN) and are deleted by owner. Admin actions write ActivityLogs, which are
//   append-only by design: those rows (actor TEST_E2E_…) are left in place.
// - Time travel: the pending-order expiry and the Ritual Box renewal are called with an explicit
//   `now`, and only on this run's orders / boxes, so no real DEV order or box is touched.
// - Main code is not modified. Mismatches are reported as FAIL / NOTE, not fixed.
//
// Flows: one-time (COD, QR, guest), mixed (one-time + Ritual Box line, card), Ritual Box only
// (card + renewal order), from cart to delivered, plus pending fallbacks, cancels and refunds.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const PREFIX = 'TEST_E2E_';
const KEEP = process.argv.includes('--keep');

function dbNameFromUri(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri || '');
  return match ? decodeURIComponent(match[1]) : '';
}
function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}
const uri = process.env.MONGODB_URI;
if (process.env.NODE_ENV === 'production') refuse('NODE_ENV=production. This script only runs against a DEV database.');
if (!uri) refuse('MONGODB_URI is not set (backend/.env).');
if (/prod/i.test(dbNameFromUri(uri))) refuse(`database name "${dbNameFromUri(uri)}" contains "prod".`);

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../src/config/auth');
const { connectDB } = require('../src/config/db');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const Voucher = require('../src/models/Voucher');
const Subscription = require('../src/models/Subscription');
const Notification = require('../src/models/Notification');
const RefundRequest = require('../src/models/RefundRequest');
const PointTransaction = require('../src/models/PointTransaction');
const PantryItem = require('../src/models/PantryItem');
const Cart = require('../src/models/Cart');
const subscriptionService = require('../src/services/subscription.service');
const expiry = require('../src/services/pending-order-expiry.service');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const runTag = Date.now().toString(36).toUpperCase();
const tick = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms)); // post-save hooks use setImmediate

// ─── Result table ─────────────────────────────────────────────
const results = [];
const notes = [];
function check(id, label, ok, detail = '') {
  results.push({ id, label, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? ` — ${detail}` : ''}`);
}
function note(text) {
  notes.push(text);
  console.log(`  NOTE  ${text}`);
}

// ─── HTTP ─────────────────────────────────────────────────────
let baseUrl = null;
async function call(method, url, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}
const orderOf = (res) => res.data?.data || res.data;
const errorOf = (res) => `HTTP ${res.status}${res.data?.error ? `: ${res.data.error}` : ''}`;

// ─── Test data ────────────────────────────────────────────────
let productSeq = 0;
const products = [];
async function createProduct({ stock = 20, price = 20, subscribable = true } = {}) {
  productSeq += 1;
  const _id = new mongoose.Types.ObjectId();
  const image = { url: 'https://example.invalid/test.jpg', public_id: `${PREFIX}img` };
  await Product.collection.insertOne({
    _id,
    product_id: 900000000 + Math.floor(Math.random() * 90000000),
    slug: `${PREFIX.toLowerCase()}${runTag.toLowerCase()}-${productSeq}`,
    name: `${PREFIX}Matcha ${runTag}-${productSeq}`,
    category: 'matcha',
    is_active: true,
    is_subscribable: subscribable,
    subscribe_discount_percent: 10,
    images: [image],
    variants: [{ sku: `${PREFIX}SKU_${runTag}_${productSeq}`, label: 'Default', price, stock, images: [image], is_default: true }]
  });
  const product = await Product.findById(_id).lean();
  products.push(product);
  return product;
}
const stockOf = async (product) => (await Product.findById(product._id).lean()).variants[0].stock;
const skuOf = (product) => product.variants[0].sku;

const DELIVERY = { recipient_name: `${PREFIX}Recipient`, mobile: '0900000000', city: 'Ho Chi Minh', address: '1 Test St' };

async function createCustomer(key) {
  const _id = new mongoose.Types.ObjectId();
  const cardId = new mongoose.Types.ObjectId();
  const userId = `${PREFIX}${runTag}_${key}`;
  await User.collection.insertOne({
    _id,
    user_id: userId,
    email: `${userId.toLowerCase()}@example.invalid`,
    profile_name: `${PREFIX}${key}`,
    role: 'customer',
    status: 'active',
    membership_tier: 'seed',
    points: 0,
    addresses: [{
      _id: new mongoose.Types.ObjectId(), recipient_name: DELIVERY.recipient_name, phone: DELIVERY.mobile,
      city: DELIVERY.city, detail_address: DELIVERY.address, label: null, is_default: true
    }],
    payment_methods: [{
      _id: cardId, card_type: 'credit', card_number: '4111111111111111', cardholder_name: 'TEST E2E', expire_date: '12/40', is_default: true
    }]
  });
  const token = jwt.sign({ user_id: String(_id), email: `${userId.toLowerCase()}@example.invalid`, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });
  return { _id, userId, cardId: String(cardId), token };
}

async function createAdmin() {
  const _id = new mongoose.Types.ObjectId();
  const userId = `${PREFIX}${runTag}_ADMIN`;
  await User.collection.insertOne({
    _id, user_id: userId, email: `${userId.toLowerCase()}@example.invalid`, profile_name: `${PREFIX}Admin`,
    role: 'admin_cc', status: 'active'
  });
  const token = jwt.sign({ user_id: userId, email: `${userId.toLowerCase()}@example.invalid`, role: 'admin_cc' }, JWT_SECRET, { expiresIn: '1h' });
  return { userId, token };
}

async function createVoucher({ usageLimit = 1, suffix = '' } = {}) {
  const code = `E2E${runTag}${suffix}`.slice(0, 30).toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  await Voucher.collection.insertOne({
    code, voucher_type: 'discount', discount_type: 'fixed', discount_value: 5, is_active: true,
    usage_limit: usageLimit, used_count: 0, min_order_amount: 0, max_discount_value: null,
    valid_from: '2020-01-01', valid_to: '2099-12-31', createdAt: today, title: `${PREFIX}voucher`,
    created_by: null, purpose: 'campaign', assigned_user_id: null, related_ref: null,
    usage_limit_per_user: 1, target_tier: null
  });
  return code;
}
const voucherUsed = async (code) => (await Voucher.findOne({ code }).lean())?.used_count;

// Order body as the checkout page sends it. Lines: [{ product, qty, sub: 14 }]
function orderBody(lines, { method = 'cod', customer = null, coupon = null, sessionId = null } = {}) {
  const items = lines.map(({ product, qty = 1, sub = null }) => ({
    product_id: String(product._id),
    variant_id: skuOf(product),
    product_name: product.name,
    quantity: qty,
    purchase_type: sub ? 'subscription' : 'one_time',
    subscription_frequency_days: sub
  }));
  const subtotal = lines.reduce((sum, { product, qty = 1 }) => sum + product.variants[0].price * qty, 0);
  const payment = { method };
  if (method === 'card') {
    payment.card_info = { brand: 'Visa', last4: '1111', cardholder_name: 'TEST E2E' };
    if (customer) payment.payment_method_id = customer.cardId;
  }
  return {
    items,
    delivery_info: DELIVERY,
    shipping: { method: 'standard', cost: 0 },
    payment,
    pricing: { subtotal, shipping_cost: 0, discount_amount: 0, total: subtotal, currency: 'USD' },
    coupon: coupon ? { code: coupon } : null,
    session_id: sessionId || undefined
  };
}

const created = { orderIds: new Set(), sessions: new Set() };
async function placeOrder(lines, opts = {}) {
  const res = await call('POST', '/api/orders', { token: opts.customer?.token, body: orderBody(lines, opts) });
  const order = orderOf(res);
  if (order?.order_id) created.orderIds.add(order.order_id);
  return { res, order };
}
const reloadOrder = (orderId) => Order.findOne({ order_id: orderId }).lean();
const boxesOf = (orderId) => Subscription.find({ source_order_id: orderId }).lean();
const noticeCount = (userId, type, orderId) => Notification.countDocuments({ recipient_id: userId, type, post_id: orderId });

// Admin moves an order through its own transitions.
const adminStatus = (admin, orderId, status, reason) =>
  call('PUT', `/api/admin/orders/${orderId}/status`, { token: admin.token, body: { status, reason } });
const REFUND_BODY = (order, extra = {}) => ({
  reason: 'Damaged item',
  description: 'E2E test refund',
  evidence: ['https://example.invalid/evidence.jpg'],
  items: order.items.map(it => ({ product_id: it.product_id, variant_id: it.variant_id, quantity: it.quantity })),
  refund_payment: { method: 'card', card_info: { brand: 'Visa', last4: '1111', cardholder_name: 'TEST E2E' } },
  ...extra
});

// Ships and delivers an order (admin → shipping, customer → receive).
async function shipAndReceive(admin, orderId, { customer, sessionId } = {}) {
  const ship = await adminStatus(admin, orderId, 'shipping');
  const receive = await call('PUT', `/api/orders/${orderId}/receive`, {
    token: customer?.token, body: sessionId ? { session_id: sessionId } : {}
  });
  return { ship, receive };
}

// ─── Cleanup ──────────────────────────────────────────────────
async function cleanup() {
  const re = new RegExp(`^${PREFIX}`);
  const orderFilter = { $or: [{ user_id: re }, { session_id: re }, { 'delivery_info.recipient_name': re }] };
  const orderIds = (await Order.find(orderFilter, { order_id: 1 }).lean()).map(o => o.order_id);
  const [orders, subs, refunds, notifs, points, pantry, carts, users, prods, vouchers] = await Promise.all([
    Order.deleteMany(orderFilter),
    Subscription.deleteMany({ user_id: re }),
    RefundRequest.deleteMany({ order_id: { $in: orderIds } }),
    Notification.deleteMany({ recipient_id: re }),
    PointTransaction.deleteMany({ user_id: re }),
    PantryItem.deleteMany({ user_id: re }),
    Cart.deleteMany({ user_id: re }),
    User.collection.deleteMany({ user_id: re }),
    Product.collection.deleteMany({ name: re }),
    Voucher.collection.deleteMany({ title: `${PREFIX}voucher` })
  ]);
  return {
    orders: orders.deletedCount, subscriptions: subs.deletedCount, refund_requests: refunds.deletedCount,
    notifications: notifs.deletedCount, point_transactions: points.deletedCount, pantry_items: pantry.deletedCount,
    carts: carts.deletedCount, users: users.deletedCount, products: prods.deletedCount, vouchers: vouchers.deletedCount
  };
}

// ─── Scenarios ────────────────────────────────────────────────

// 1. One-time, COD, from the cart: voucher, confirm, ship, deliver, refund approved.
async function oneTimeCod({ customer, admin, voucher }) {
  console.log('\n[1] One-time COD: cart → order (voucher) → confirm → shipping → delivered → refund approved');
  const p = await createProduct({ stock: 10 });

  const put = await call('PUT', '/api/cart', {
    token: customer.token,
    body: { items: [{ product_id: String(p._id), variantSku: skuOf(p), quantity: 2, selected: true }] }
  });
  const cart = (await call('GET', '/api/cart', { token: customer.token })).data?.cart;
  const line = cart?.items?.find(i => i.variantSku === skuOf(p));
  check('1.1', 'add to cart: line saved with qty 2, one_time, price from product',
    put.status === 200 && line && line.quantity === 2 && line.purchaseType === 'one_time' && line.priceAtAdd === 20,
    line ? JSON.stringify({ q: line.quantity, t: line.purchaseType, price: line.priceAtAdd }) : errorOf(put));

  const { res, order } = await placeOrder([{ product: p, qty: line?.quantity || 2 }], { method: 'cod', customer, coupon: voucher });
  check('1.2', 'order created pending / payment pending', res.status === 201 && order.order_status === 'pending' && order.payment_status === 'pending', errorOf(res));
  check('1.3', 'stock reserved at checkout (10 → 8)', (await stockOf(p)) === 8, `stock ${await stockOf(p)}`);
  check('1.4', 'voucher applied on the server (5 off) and used_count 0 → 1',
    order.pricing?.discount_amount === 5 && order.pricing?.total === 35 && (await voucherUsed(voucher)) === 1,
    `discount ${order.pricing?.discount_amount}, total ${order.pricing?.total}, used ${await voucherUsed(voucher)}`);
  check('1.5', 'ORDER_PLACED notification', (await noticeCount(customer.userId, 'ORDER_PLACED', order.order_id)) === 1);

  const confirm = await call('PUT', `/api/orders/${order.order_id}/confirm`, { token: customer.token, body: {} });
  check('1.6', 'COD confirm → processing, stock not taken twice', confirm.status === 200 && orderOf(confirm).order_status === 'processing' && (await stockOf(p)) === 8,
    `${errorOf(confirm)}, stock ${await stockOf(p)}`);

  const pend = await adminStatus(admin, order.order_id, 'delivered');
  check('1.7', 'admin cannot jump processing → delivered', pend.status === 400, errorOf(pend));

  const { ship, receive } = await shipAndReceive(admin, order.order_id, { customer });
  check('1.8', 'admin ships → shipping (ORDER_SHIPPING notification)',
    ship.status === 200 && (await noticeCount(customer.userId, 'ORDER_SHIPPING', order.order_id)) === 1, errorOf(ship));
  let after = await reloadOrder(order.order_id);
  check('1.9', 'customer receives → delivered, delivered_at set, COD marked paid',
    receive.status === 200 && after.order_status === 'delivered' && after.delivered_at && after.payment_status === 'paid',
    `${errorOf(receive)}, status ${after.order_status}, payment ${after.payment_status}`);
  check('1.10', 'total_sold_quantity +2', (await Product.findById(p._id).lean()).total_sold_quantity === 2);
  await tick();
  const txn = await PointTransaction.findOne({ ref_id: order.order_id, type: 'purchase' }).lean();
  check('1.11', 'purchase points pending', txn && txn.status === 'pending', txn ? `${txn.amount} pts ${txn.status}` : 'no transaction');

  const refund = await call('POST', `/api/orders/${order.order_id}/refund`, { token: customer.token, body: REFUND_BODY(after) });
  after = await reloadOrder(order.order_id);
  check('1.12', 'refund request → pending_refund', refund.status === 200 && after.order_status === 'pending_refund', errorOf(refund));
  const dup = await call('POST', `/api/orders/${order.order_id}/refund`, { token: customer.token, body: REFUND_BODY(after) });
  check('1.13', 'second refund request while one is pending is refused', dup.status === 400, errorOf(dup));

  const approve = await call('POST', `/api/admin/orders/${order.order_id}/refund/approve`, { token: admin.token, body: {} });
  after = await reloadOrder(order.order_id);
  await tick();
  const reversed = await PointTransaction.findOne({ ref_id: order.order_id, type: 'purchase' }).lean();
  check('1.14', 'refund approved → refund / refunded, stock back (8 → 10)',
    approve.status === 200 && after.order_status === 'refund' && after.payment_status === 'refunded' && (await stockOf(p)) === 10,
    `${errorOf(approve)}, status ${after.order_status}/${after.payment_status}, stock ${await stockOf(p)}`);
  check('1.15', 'purchase points reversed', reversed && reversed.status !== 'pending' && reversed.status !== 'posted', reversed?.status);
  check('1.16', 'refunded order keeps its voucher use (only canceled orders give it back)', (await voucherUsed(voucher)) === 1, `used ${await voucherUsed(voucher)}`);
}

// 2. One-time QR: payment fails, retried, paid; delivery fails and is re-sent; refund rejected then approved.
async function oneTimeQr({ customer, admin }) {
  console.log('\n[2] One-time QR: fail → retry → paid → shipping → delivery_failed → shipping → delivered → refund rejected → approved');
  const p = await createProduct({ stock: 10 });
  const { res, order } = await placeOrder([{ product: p, qty: 1 }], { method: 'qr', customer });
  check('2.1', 'QR order created pending, stock reserved', res.status === 201 && order.order_status === 'pending' && (await stockOf(p)) === 9, errorOf(res));

  const fail = await call('PUT', `/api/orders/${order.order_id}/fail-payment`, { token: customer.token, body: {} });
  check('2.2', 'payment fails → stays pending, payment failed', fail.status === 200 && orderOf(fail).order_status === 'pending' && orderOf(fail).payment_status === 'failed', errorOf(fail));
  const retry = await call('PUT', `/api/orders/${order.order_id}/retry-payment`, { token: customer.token, body: {} });
  check('2.3', 'retry → payment pending again', retry.status === 200 && orderOf(retry).payment_status === 'pending', errorOf(retry));
  const pay = await call('PUT', `/api/orders/${order.order_id}/confirm-payment`, { token: customer.token, body: {} });
  check('2.4', 'paid → processing, stock not taken twice', pay.status === 200 && orderOf(pay).order_status === 'processing' && orderOf(pay).payment_status === 'paid' && (await stockOf(p)) === 9,
    `${errorOf(pay)}, stock ${await stockOf(p)}`);
  const again = await call('PUT', `/api/orders/${order.order_id}/confirm-payment`, { token: customer.token, body: {} });
  check('2.5', 'confirming twice is harmless', again.status === 200 && (await stockOf(p)) === 9, errorOf(again));

  await adminStatus(admin, order.order_id, 'shipping');
  const noReason = await adminStatus(admin, order.order_id, 'delivery_failed');
  check('2.6', 'delivery_failed without a reason is refused', noReason.status === 400, errorOf(noReason));
  const failed = await adminStatus(admin, order.order_id, 'delivery_failed', 'Customer not at home');
  check('2.7', 'delivery_failed with reason (customer notified)', failed.status === 200 && (await noticeCount(customer.userId, 'ORDER_DELIVERY_FAILED', order.order_id)) === 1, errorOf(failed));
  const { ship, receive } = await shipAndReceive(admin, order.order_id, { customer });
  check('2.8', 're-shipped and delivered', ship.status === 200 && receive.status === 200 && (await reloadOrder(order.order_id)).order_status === 'delivered', `${errorOf(ship)} / ${errorOf(receive)}`);

  let after = await reloadOrder(order.order_id);
  await call('POST', `/api/orders/${order.order_id}/refund`, { token: customer.token, body: REFUND_BODY(after) });
  const noReasonReject = await call('POST', `/api/admin/orders/${order.order_id}/refund/reject`, { token: admin.token, body: {} });
  check('2.9', 'reject without a reason is refused', noReasonReject.status === 400, errorOf(noReasonReject));
  const reject = await call('POST', `/api/admin/orders/${order.order_id}/refund/reject`, { token: admin.token, body: { reason: 'Photo does not show damage' } });
  after = await reloadOrder(order.order_id);
  check('2.10', 'refund rejected → refund_rejected, stock unchanged', reject.status === 200 && after.order_status === 'refund_rejected' && (await stockOf(p)) === 9,
    `${errorOf(reject)}, stock ${await stockOf(p)}`);
  const second = await call('POST', `/api/orders/${order.order_id}/refund`, { token: customer.token, body: REFUND_BODY(after) });
  const approve = await call('POST', `/api/admin/orders/${order.order_id}/refund/approve`, { token: admin.token, body: {} });
  after = await reloadOrder(order.order_id);
  check('2.11', 'customer asks again after a rejection → approved, stock back (9 → 10)',
    second.status === 200 && approve.status === 200 && after.order_status === 'refund' && (await stockOf(p)) === 10,
    `${errorOf(second)} / ${errorOf(approve)}, stock ${await stockOf(p)}`);
}

// 3. Guest one-time COD order delivered.
async function guestCod({ admin }) {
  console.log('\n[3] Guest one-time COD: order → confirm → shipping → delivered');
  const p = await createProduct({ stock: 5 });
  const sessionId = `${PREFIX}${runTag}_SS1`;
  created.sessions.add(sessionId);
  const { res, order } = await placeOrder([{ product: p, qty: 1 }], { method: 'cod', sessionId });
  check('3.1', 'guest order created', res.status === 201 && order.is_guest === true && order.order_status === 'pending', errorOf(res));
  const other = await call('PUT', `/api/orders/${order.order_id}/confirm`, { body: { session_id: 'SOMEONE_ELSE' } });
  check('3.2', 'another session cannot confirm it', other.status === 403, errorOf(other));
  const confirm = await call('PUT', `/api/orders/${order.order_id}/confirm`, { body: { session_id: sessionId } });
  const { ship, receive } = await shipAndReceive(admin, order.order_id, { sessionId });
  const after = await reloadOrder(order.order_id);
  check('3.3', 'confirmed, shipped and received by the guest session', confirm.status === 200 && ship.status === 200 && receive.status === 200 && after.order_status === 'delivered',
    `${errorOf(confirm)} / ${errorOf(ship)} / ${errorOf(receive)}`);
  check('3.4', 'stock 5 → 4', (await stockOf(p)) === 4);
}

// 4. Cancels and fallbacks to pending / canceled.
async function cancels({ customer, admin }) {
  console.log('\n[4] Cancels: customer, expiry (QR + COD), discard, admin after failed delivery, out of stock');
  const p = await createProduct({ stock: 20 });

  // 4a. Customer cancels a pending COD order with a one-use voucher → stock and voucher use back,
  // and the same customer can use the voucher again.
  const voucher = await createVoucher({ usageLimit: 1, suffix: 'C' });
  const a = await placeOrder([{ product: p, qty: 2 }], { method: 'cod', customer, coupon: voucher });
  const usedAfterOrder = await voucherUsed(voucher);
  const cancelA = await call('PUT', `/api/orders/${a.order?.order_id}/cancel`, { token: customer.token, body: {} });
  const afterA = await reloadOrder(a.order?.order_id);
  check('4a.1', 'customer cancels pending COD → canceled, stock back (20)', a.res.status === 201 && cancelA.status === 200 && afterA?.order_status === 'canceled' && (await stockOf(p)) === 20,
    `${errorOf(a.res)} / ${errorOf(cancelA)}, stock ${await stockOf(p)}`);
  check('4a.2', 'one-use voucher: used_count 1 after order, 0 after cancel', usedAfterOrder === 1 && (await voucherUsed(voucher)) === 0,
    `used ${usedAfterOrder} → ${await voucherUsed(voucher)}`);
  const reuse = await placeOrder([{ product: p, qty: 1 }], { method: 'cod', customer, coupon: voucher });
  check('4a.3', 'the voucher can be used again after the cancel', reuse.res.status === 201 && (await voucherUsed(voucher)) === 1, errorOf(reuse.res));
  if (reuse.order?.order_id) await call('DELETE', `/api/orders/${reuse.order.order_id}`, { token: customer.token });
  check('4a.4', 'discarding that order gives the use back too', (await voucherUsed(voucher)) === 0 && (await stockOf(p)) === 20,
    `used ${await voucherUsed(voucher)}, stock ${await stockOf(p)}`);
  const cancelTwice = await call('PUT', `/api/orders/${a.order.order_id}/cancel`, { token: customer.token, body: {} });
  check('4a.5', 'canceling again is refused, stock unchanged', cancelTwice.status === 400 && (await stockOf(p)) === 20, errorOf(cancelTwice));

  // 4b. Customer cancels a paid (processing) QR order.
  const b = await placeOrder([{ product: p, qty: 1 }], { method: 'qr', customer });
  await call('PUT', `/api/orders/${b.order.order_id}/confirm-payment`, { token: customer.token, body: {} });
  const cancelB = await call('PUT', `/api/orders/${b.order.order_id}/cancel`, { token: customer.token, body: {} });
  const afterB = await reloadOrder(b.order.order_id);
  check('4b.1', 'customer cancels a processing order → canceled, stock back', cancelB.status === 200 && afterB.order_status === 'canceled' && (await stockOf(p)) === 20,
    `${errorOf(cancelB)}, stock ${await stockOf(p)}`);
  if (afterB.payment_status === 'paid') {
    note(`4b: a paid QR order canceled by the customer keeps payment_status "paid" (admin cancel sets "refunded"). Check how the refund is handled.`);
  }
  const shipped = await placeOrder([{ product: p, qty: 1 }], { method: 'cod', customer });
  await call('PUT', `/api/orders/${shipped.order.order_id}/confirm`, { token: customer.token, body: {} });
  await adminStatus(admin, shipped.order.order_id, 'shipping');
  const cancelShipped = await call('PUT', `/api/orders/${shipped.order.order_id}/cancel`, { token: customer.token, body: {} });
  check('4b.2', 'customer cannot cancel a shipping order', cancelShipped.status === 400, errorOf(cancelShipped));

  // 4c. QR order left pending past the hold → auto-canceled (stock back, ORDER_CANCELED).
  const c = await placeOrder([{ product: p, qty: 3 }], { method: 'qr', customer });
  const stockC = await stockOf(p);
  const early = await expiry.expireOrder(c.order._id, new Date(Date.now() + HOUR));
  const late = await expiry.expireOrder(c.order._id, new Date(Date.now() + expiry.PENDING_ORDER_HOLD_MS + HOUR));
  const afterC = await reloadOrder(c.order.order_id);
  check('4c.1', 'not expired before the hold, expired after it', !early && late && afterC.order_status === 'canceled', `status ${afterC.order_status}`);
  check('4c.2', 'stock back (+3), ORDER_CANCELED sent', (await stockOf(p)) === stockC + 3 && (await noticeCount(customer.userId, 'ORDER_CANCELED', c.order.order_id)) === 1,
    `stock ${stockC} → ${await stockOf(p)}`);

  // 4d. COD order not confirmed within the hold → auto-canceled with the store-cancel notice.
  const d = await placeOrder([{ product: p, qty: 1 }], { method: 'cod', customer });
  const stockD = await stockOf(p);
  const expiredD = await expiry.expireOrder(d.order._id, new Date(Date.now() + expiry.PENDING_ORDER_HOLD_MS + HOUR));
  const afterD = await reloadOrder(d.order.order_id);
  check('4d.1', 'pending COD expires after the hold, stock back, ORDER_CANCELED_BY_STORE sent',
    expiredD && afterD.order_status === 'canceled' && (await stockOf(p)) === stockD + 1
      && (await noticeCount(customer.userId, 'ORDER_CANCELED_BY_STORE', d.order.order_id)) === 1,
    `status ${afterD.order_status}, stock ${stockD} → ${await stockOf(p)}`);

  // 4e. Discarding (deleting) a pending order puts the stock back.
  const e = await placeOrder([{ product: p, qty: 2 }], { method: 'qr', customer });
  const stockE = await stockOf(p);
  const del = await call('DELETE', `/api/orders/${e.order.order_id}`, { token: customer.token });
  check('4e.1', 'discarded pending order is deleted, stock back (+2)', del.status === 200 && !(await reloadOrder(e.order.order_id)) && (await stockOf(p)) === stockE + 2,
    `${errorOf(del)}, stock ${stockE} → ${await stockOf(p)}`);

  // 4f. Admin cancels after a failed delivery of a paid order → canceled + refunded, stock back.
  const f = await placeOrder([{ product: p, qty: 1 }], { method: 'qr', customer });
  await call('PUT', `/api/orders/${f.order.order_id}/confirm-payment`, { token: customer.token, body: {} });
  await adminStatus(admin, f.order.order_id, 'shipping');
  await adminStatus(admin, f.order.order_id, 'delivery_failed', 'Wrong address');
  const stockF = await stockOf(p);
  const cancelF = await adminStatus(admin, f.order.order_id, 'canceled', 'Customer unreachable');
  const afterF = await reloadOrder(f.order.order_id);
  check('4f.1', 'admin cancels after delivery_failed → canceled / refunded, stock back',
    cancelF.status === 200 && afterF.order_status === 'canceled' && afterF.payment_status === 'refunded' && (await stockOf(p)) === stockF + 1,
    `${errorOf(cancelF)}, ${afterF.order_status}/${afterF.payment_status}, stock ${stockF} → ${await stockOf(p)}`);

  // 4g. Admin marks a line out of stock on a processing order → whole order canceled, that line not restocked.
  const q = await createProduct({ stock: 5 });
  const g = await placeOrder([{ product: p, qty: 1 }, { product: q, qty: 1 }], { method: 'cod', customer });
  await call('PUT', `/api/orders/${g.order.order_id}/confirm`, { token: customer.token, body: {} });
  const stockGp = await stockOf(p);
  const oos = await call('POST', `/api/admin/orders/${g.order.order_id}/out-of-stock`, {
    token: admin.token, body: { items: [{ product_id: String(q._id), variant_id: skuOf(q) }] }
  });
  const afterG = await reloadOrder(g.order.order_id);
  check('4g.1', 'out of stock → order canceled; other line restocked, missing line not',
    oos.status === 200 && afterG.order_status === 'canceled' && (await stockOf(p)) === stockGp + 1 && (await stockOf(q)) === 4,
    `${errorOf(oos)}, p ${stockGp} → ${await stockOf(p)}, q stays ${await stockOf(q)}`);
}

// 5. Mixed cart (one-time + Ritual Box line) paid by card.
async function mixedCard({ customer, admin }) {
  console.log('\n[5] Mixed (one-time + Ritual Box line), card: cart → order → paid → box created → delivered → refund');
  const one = await createProduct({ stock: 10, price: 20 });
  const box = await createProduct({ stock: 10, price: 30 });

  const put = await call('PUT', '/api/cart', {
    token: customer.token,
    body: { items: [
      { product_id: String(one._id), variantSku: skuOf(one), quantity: 1, selected: true },
      { product_id: String(box._id), variantSku: skuOf(box), quantity: 1, selected: true, purchaseType: 'subscription', subscriptionFrequencyDays: 14 }
    ] }
  });
  const subLine = put.data?.cart?.items?.find(i => i.variantSku === skuOf(box));
  check('5.1', 'cart keeps the Ritual Box line (subscription, 14 days, 10% off shown)',
    subLine && subLine.purchaseType === 'subscription' && subLine.subscriptionFrequencyDays === 14 && subLine.priceAtAdd === 27,
    subLine ? JSON.stringify({ t: subLine.purchaseType, f: subLine.subscriptionFrequencyDays, price: subLine.priceAtAdd }) : errorOf(put));

  const cod = await placeOrder([{ product: one }, { product: box, sub: 14 }], { method: 'cod', customer });
  check('5.2', 'Ritual Box line refused with COD', cod.res.status === 400 && (await stockOf(box)) === 10, errorOf(cod.res));

  const { res, order } = await placeOrder([{ product: one }, { product: box, sub: 14 }], { method: 'card', customer });
  check('5.3', 'card order created pending, both lines reserved', res.status === 201 && order.order_status === 'pending' && (await stockOf(one)) === 9 && (await stockOf(box)) === 9,
    `${errorOf(res)}, stock ${await stockOf(one)}/${await stockOf(box)}`);
  const boxLine = order.items?.find(i => i.purchase_type === 'subscription');
  check('5.4', 'first box charged at full price (30), not the Subscribe & Save price', boxLine?.unit_price === 30 && order.pricing?.total === 50,
    `unit ${boxLine?.unit_price}, total ${order.pricing?.total}`);
  check('5.5', 'no Ritual Box before payment', (await boxesOf(order.order_id)).length === 0);

  const pay = await call('PUT', `/api/orders/${order.order_id}/confirm-payment`, { token: customer.token, body: {} });
  const boxes = await boxesOf(order.order_id);
  const sub = boxes[0];
  check('5.6', 'paid → processing, one active Ritual Box for the subscription line only',
    pay.status === 200 && orderOf(pay).order_status === 'processing' && boxes.length === 1 && sub.status === 'active' && sub.product_id === String(box._id),
    `${errorOf(pay)}, boxes ${boxes.length}`);
  if (sub) {
    const days = (new Date(sub.next_charge_at) - new Date(sub.last_charged_at)) / DAY;
    check('5.7', 'box: 14 days, Subscribe & Save price 27, card from checkout',
      sub.frequency_days === 14 && sub.pricing_snapshot?.subscribe_price === 27 && sub.payment_method_id === customer.cardId,
      `next charge in ${days.toFixed(2)} days (SUB_TIME_UNIT=${process.env.SUB_TIME_UNIT || 'day'}), price ${sub.pricing_snapshot?.subscribe_price}`);
  }
  await call('PUT', `/api/orders/${order.order_id}/confirm-payment`, { token: customer.token, body: {} });
  check('5.8', 'confirming payment again creates no second box', (await boxesOf(order.order_id)).length === 1);

  const { ship, receive } = await shipAndReceive(admin, order.order_id, { customer });
  check('5.9', 'shipped and delivered', ship.status === 200 && receive.status === 200 && (await reloadOrder(order.order_id)).order_status === 'delivered',
    `${errorOf(ship)} / ${errorOf(receive)}`);

  const after = await reloadOrder(order.order_id);
  await call('POST', `/api/orders/${order.order_id}/refund`, { token: customer.token, body: REFUND_BODY(after) });
  const approve = await call('POST', `/api/admin/orders/${order.order_id}/refund/approve`, { token: admin.token, body: {} });
  check('5.10', 'whole order refunded, both lines restocked', approve.status === 200 && (await stockOf(one)) === 10 && (await stockOf(box)) === 10,
    `${errorOf(approve)}, stock ${await stockOf(one)}/${await stockOf(box)}`);
  const boxAfter = await Subscription.findById(sub?._id).lean();
  note(`5: after the order that started it was refunded, the Ritual Box is "${boxAfter?.status}". Nothing cancels or pauses it — confirm with the plan that this is intended.`);

  // Mixed order canceled before payment: no box, stock back.
  const unpaid = await placeOrder([{ product: one }, { product: box, sub: 14 }], { method: 'card', customer });
  const cancel = await call('PUT', `/api/orders/${unpaid.order.order_id}/cancel`, { token: customer.token, body: {} });
  check('5.11', 'mixed card order canceled before payment: no box, stock back',
    cancel.status === 200 && (await boxesOf(unpaid.order.order_id)).length === 0 && (await stockOf(one)) === 10 && (await stockOf(box)) === 10,
    `${errorOf(cancel)}, stock ${await stockOf(one)}/${await stockOf(box)}`);
}

// 6. Ritual Box only: checkout, renewal order delivered, renewal out of stock, suggestion withdrawn.
async function ritualBoxOnly({ customer, admin }) {
  console.log('\n[6] Ritual Box only, card: order → paid → box → renewal order delivered → renewal out of stock; suggestion withdrawn on cancel');
  const box = await createProduct({ stock: 10, price: 30 });

  const guest = await placeOrder([{ product: box, sub: 30 }], { method: 'card', sessionId: `${PREFIX}${runTag}_SS2` });
  check('6.1', 'guests cannot buy a Ritual Box', guest.res.status === 400, errorOf(guest.res));
  const qr = await placeOrder([{ product: box, sub: 30 }], { method: 'qr', customer });
  check('6.2', 'Ritual Box refused with QR', qr.res.status === 400 && (await stockOf(box)) === 10, errorOf(qr.res));

  const { res, order } = await placeOrder([{ product: box, qty: 1, sub: 30 }], { method: 'card', customer });
  const pay = await call('PUT', `/api/orders/${order?.order_id}/confirm-payment`, { token: customer.token, body: {} });
  let [sub] = await boxesOf(order?.order_id);
  check('6.3', 'box-only order paid → one active 30-day box', res.status === 201 && pay.status === 200 && sub && sub.status === 'active' && sub.frequency_days === 30,
    `${errorOf(res)} / ${errorOf(pay)}`);
  if (!sub) return;
  const first = await shipAndReceive(admin, order.order_id, { customer });
  check('6.4', 'first box delivered', first.receive.status === 200, errorOf(first.receive));

  // A one-time purchase of the same item suggests a shorter cycle; canceling it withdraws the suggestion.
  const oneTime = await placeOrder([{ product: box, qty: 1 }], { method: 'cod', customer });
  await call('PUT', `/api/orders/${oneTime.order.order_id}/confirm`, { token: customer.token, body: {} });
  sub = await Subscription.findById(sub._id).lean();
  check('6.5', 'one-time order of the same item suggests 30 → 14 days', sub.suggested_by_order_id === oneTime.order.order_id && sub.suggested_frequency_days === 14,
    `suggested_by ${sub.suggested_by_order_id}, days ${sub.suggested_frequency_days}`);
  await call('PUT', `/api/orders/${oneTime.order.order_id}/cancel`, { token: customer.token, body: {} });
  await tick();
  sub = await Subscription.findById(sub._id).lean();
  check('6.6', 'canceling that order withdraws the suggestion', !sub.suggested_by_order_id && sub.suggested_frequency_days == null,
    `suggested_by ${sub.suggested_by_order_id}`);

  // Renewal: charge the box at its next charge date (this box only).
  const subDoc = await Subscription.findById(sub._id);
  const stockBefore = await stockOf(box);
  const charge = await subscriptionService.chargeSubscription(subDoc, { now: new Date(subDoc.next_charge_at) });
  if (charge.ok) {
    await subDoc.save();
    created.orderIds.add(charge.order.order_id);
  }
  const renewal = charge.ok ? await reloadOrder(charge.order.order_id) : null;
  check('6.7', 'renewal charged: paid processing order at the Subscribe & Save price, stock reserved',
    renewal && renewal.payment_status === 'paid' && renewal.order_status === 'processing' && renewal.items[0].unit_price === 27 && (await stockOf(box)) === stockBefore - 1,
    renewal ? `${renewal.order_id} ${renewal.order_status}/${renewal.payment_status}, cycle ${renewal.subscription_cycle}` : JSON.stringify(charge));
  if (renewal) {
    const r = await shipAndReceive(admin, renewal.order_id, { customer });
    check('6.8', 'renewal order shipped and delivered', r.ship.status === 200 && r.receive.status === 200 && (await reloadOrder(renewal.order_id)).order_status === 'delivered',
      `${errorOf(r.ship)} / ${errorOf(r.receive)}`);
  }

  // Next renewal is canceled by the store (out of stock): order refunded, the cycle recorded as skipped, box stays active.
  const subDoc2 = await Subscription.findById(sub._id);
  const charge2 = await subscriptionService.chargeSubscription(subDoc2, { now: new Date(subDoc2.next_charge_at) });
  if (charge2.ok) {
    await subDoc2.save();
    created.orderIds.add(charge2.order.order_id);
    const oos = await call('POST', `/api/admin/orders/${charge2.order.order_id}/out-of-stock`, {
      token: admin.token, body: { items: [{ product_id: String(box._id), variant_id: skuOf(box) }] }
    });
    const after = await reloadOrder(charge2.order.order_id);
    const subAfter = await Subscription.findById(sub._id).lean();
    check('6.9', 'renewal out of stock → canceled / refunded, cycle skipped, box still active',
      oos.status === 200 && after.order_status === 'canceled' && after.payment_status === 'refunded'
        && subAfter.status === 'active' && (subAfter.skipped_deliveries || []).length === 1,
      `${errorOf(oos)}, ${after.order_status}/${after.payment_status}, box ${subAfter.status}, skipped ${(subAfter.skipped_deliveries || []).length}`);
  } else {
    check('6.9', 'second renewal charged', false, JSON.stringify(charge2));
  }
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  const dbName = dbNameFromUri(uri);
  console.log(`E2E purchase flows on database "${dbName}" (run ${runTag})`);
  await connectDB(); // before loading the app, which connects on require otherwise
  const app = require('../src/app');
  const leftovers = await cleanup();
  if (Object.values(leftovers).some(Boolean)) console.log('Removed leftovers of an earlier run:', leftovers);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const customer = await createCustomer('C1');
    const admin = await createAdmin();
    const voucher = await createVoucher({ usageLimit: 1 });

    for (const scenario of [oneTimeCod, oneTimeQr, guestCod, cancels, mixedCard, ritualBoxOnly]) {
      try {
        await scenario({ customer, admin, voucher });
      } catch (err) {
        check(scenario.name, 'scenario crashed', false, err.stack || String(err));
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await tick(500);
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED:` : '.'}`);
    for (const r of failed) console.log(`  FAIL ${r.id} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    if (notes.length) {
      console.log('\nNotes:');
      for (const n of notes) console.log(`  - ${n}`);
    }
    if (KEEP) {
      console.log(`\n--keep: TEST_E2E_ data left in "${dbName}" (prefix ${PREFIX}${runTag}_).`);
    } else {
      console.log('\nCleanup:', await cleanup());
    }
    await mongoose.disconnect();
    process.exitCode = failed.length ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 1000).unref();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
