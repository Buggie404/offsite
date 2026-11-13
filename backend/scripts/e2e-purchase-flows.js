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
// (card + renewal order), from cart to delivered, plus pending fallbacks, cancels and refunds;
// Ritual Box stock held 3 days before each charge (charge from the hold, out of stock → restock /
// replacement / skipped cycle, release on skip / pause / cancel). The charge job is scoped to this
// run's customer while it runs (see runJob).

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
async function createProduct({ stock = 20, price = 20, subscribable = true, category = 'matcha' } = {}) {
  productSeq += 1;
  const _id = new mongoose.Types.ObjectId();
  const image = { url: 'https://example.invalid/test.jpg', public_id: `${PREFIX}img` };
  await Product.collection.insertOne({
    _id,
    product_id: 900000000 + Math.floor(Math.random() * 90000000),
    slug: `${PREFIX.toLowerCase()}${runTag.toLowerCase()}-${productSeq}`,
    name: `${PREFIX}Matcha ${runTag}-${productSeq}`,
    category,
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
const adminStatus = (admin, orderId, status, reason, reasonCode) =>
  call('PUT', `/api/admin/orders/${orderId}/status`, { token: admin.token, body: { status, reason, ...(reasonCode ? { reason_code: reasonCode } : {}) } });
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
  const [orders, subs, refunds, notifs, points, pantry, carts, users, prods, vouchers, chats] = await Promise.all([
    Order.deleteMany(orderFilter),
    Subscription.deleteMany({ user_id: re }),
    RefundRequest.deleteMany({ order_id: { $in: orderIds } }),
    Notification.deleteMany({ recipient_id: re }),
    PointTransaction.deleteMany({ user_id: re }),
    PantryItem.deleteMany({ user_id: re }),
    Cart.deleteMany({ user_id: re }),
    User.collection.deleteMany({ user_id: re }),
    Product.collection.deleteMany({ name: re }),
    Voucher.collection.deleteMany({ title: `${PREFIX}voucher` }),
    // Support chats opened in scenario 8 (customer ids and AI session ids carry the prefix).
    require('../src/models/ChatConversation').deleteMany({ customer_id: re }),
    require('../src/models/ChatMessage').deleteMany({ $or: [{ source_session_id: re }, { sender_id: re }] }),
    require('../src/models/AiChatSession').deleteMany({ session_id: re })
  ]);
  return {
    orders: orders.deletedCount, subscriptions: subs.deletedCount, refund_requests: refunds.deletedCount,
    notifications: notifs.deletedCount, point_transactions: points.deletedCount, pantry_items: pantry.deletedCount,
    carts: carts.deletedCount, users: users.deletedCount, products: prods.deletedCount, vouchers: vouchers.deletedCount,
    chats: chats.deletedCount
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
  await tick();
  const early = await PointTransaction.findOne({ ref_id: order.order_id, type: 'purchase' }).lean();
  check('1.6b', 'purchase points created pending when the order reaches processing', early && early.status === 'pending' && early.amount === 40,
    early ? `${early.amount} pts ${early.status}` : 'no transaction');

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
  check('1.11', 'purchase points still pending after delivery (posted after the refund window)', txn && txn.status === 'pending', txn ? `${txn.amount} pts ${txn.status}` : 'no transaction');

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
  console.log('\n[2] One-time QR: fail → retry → paid → shipping → delivery_failed → shipping → delivered → refund rejected (final)');
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
  const failed = await adminStatus(admin, order.order_id, 'delivery_failed', 'Customer not at home', 'customer_unreachable');
  check('2.7', 'delivery_failed with reason (customer notified)', failed.status === 200 && (await noticeCount(customer.userId, 'ORDER_DELIVERY_FAILED', order.order_id)) === 1, errorOf(failed));
  // Shipped again once the customer confirmed the redelivery (see scenario 8).
  await confirmRedelivery(customer, order.order_id);
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
  after = await reloadOrder(order.order_id);
  check('2.11', 'a rejected refund is final: asking again is refused', second.status === 400 && after.order_status === 'refund_rejected', errorOf(second));
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
  await tick();
  const pointsB = await PointTransaction.findOne({ ref_id: b.order.order_id, type: 'purchase' }).lean();
  check('4b.1', 'customer cancels a paid processing order → canceled / refunded, stock back, points reversed',
    cancelB.status === 200 && afterB.order_status === 'canceled' && afterB.payment_status === 'refunded' && (await stockOf(p)) === 20 && pointsB?.status === 'reversed',
    `${errorOf(cancelB)}, ${afterB.order_status}/${afterB.payment_status}, stock ${await stockOf(p)}, points ${pointsB?.status}`);
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

  // 4c2. Payment failed, then left pending past the hold → canceled (a failed payment never undoes the cancel).
  const c2 = await placeOrder([{ product: p, qty: 1 }], { method: 'qr', customer });
  await call('PUT', `/api/orders/${c2.order.order_id}/fail-payment`, { token: customer.token, body: {} });
  const stockC2 = await stockOf(p);
  await expiry.expireOrder(c2.order._id, new Date(Date.now() + expiry.PENDING_ORDER_HOLD_MS + HOUR));
  const afterC2 = await reloadOrder(c2.order.order_id);
  check('4c.3', 'failed-payment order expires → stays canceled (not back to pending), stock back',
    afterC2.order_status === 'canceled' && (await stockOf(p)) === stockC2 + 1, `status ${afterC2.order_status}/${afterC2.payment_status}`);
  const c3 = await placeOrder([{ product: p, qty: 1 }], { method: 'qr', customer });
  await call('PUT', `/api/orders/${c3.order.order_id}/fail-payment`, { token: customer.token, body: {} });
  const cancelC3 = await call('PUT', `/api/orders/${c3.order.order_id}/cancel`, { token: customer.token, body: {} });
  const afterC3 = await reloadOrder(c3.order.order_id);
  check('4c.4', 'customer cancels a failed-payment order → stays canceled', cancelC3.status === 200 && afterC3.order_status === 'canceled',
    `${errorOf(cancelC3)}, status ${afterC3.order_status}`);

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
  await adminStatus(admin, f.order.order_id, 'delivery_failed', 'Wrong address', 'wrong_address');
  const stockF = await stockOf(p);
  const cancelF = await adminStatus(admin, f.order.order_id, 'canceled', 'Customer unreachable');
  const afterF = await reloadOrder(f.order.order_id);
  check('4f.1', 'admin cancels after delivery_failed → canceled / refunded, stock back',
    cancelF.status === 200 && afterF.order_status === 'canceled' && afterF.payment_status === 'refunded' && (await stockOf(p)) === stockF + 1,
    `${errorOf(cancelF)}, ${afterF.order_status}/${afterF.payment_status}, stock ${stockF} → ${await stockOf(p)}`);

  // 4g. Out of stock after ordering no longer exists for one-time / mixed orders: the stock was held
  // at checkout, so the admin routes for it are gone and a processing order ships as it is.
  const g = await placeOrder([{ product: p, qty: 1 }], { method: 'qr', customer });
  await call('PUT', `/api/orders/${g.order.order_id}/confirm-payment`, { token: customer.token, body: {} });
  const gLine = { product_id: String(p._id), variant_id: skuOf(p) };
  const oos = await call('POST', `/api/admin/orders/${g.order.order_id}/out-of-stock`, { token: admin.token, body: { items: [gLine] } });
  const resolve = await call('POST', `/api/admin/orders/${g.order.order_id}/out-of-stock/resolve`, { token: admin.token, body: { ...gLine, action: 'remove' } });
  const shipG = await adminStatus(admin, g.order.order_id, 'shipping');
  check('4g.1', 'no "mark out of stock" / resolve routes any more; a processing order ships as it is',
    oos.status === 404 && resolve.status === 404 && shipG.status === 200, `${errorOf(oos)} / ${errorOf(resolve)} / ${errorOf(shipG)}`);
}

// ─── Ritual Box charge job, scoped to this run's customer ────────
// The job normally reads every box in the database; while it runs here Subscription.find is
// narrowed to the TEST_E2E_ customer (a patch on the model in this process only), so it never
// touches real DEV boxes even though it is called with a future `now`.
const chargeJob = require('../src/services/subscription-charge.service');
let scopeUser = null;
const realSubscriptionFind = Subscription.find.bind(Subscription);
Subscription.find = function scopedFind(filter = {}, ...rest) {
  if (!scopeUser || (filter && filter.user_id !== undefined)) return realSubscriptionFind(filter, ...rest);
  return realSubscriptionFind({ ...filter, user_id: scopeUser }, ...rest);
};
async function runJob(customer, now, opts = {}) {
  scopeUser = customer.userId;
  try {
    return await chargeJob.runSubscriptionChargeJob({ now, ...opts });
  } finally {
    scopeUser = null;
  }
}
const UNIT = chargeJob.TIME_UNIT_MS;
const units = (n) => n * UNIT;
const shift = (date, ms) => new Date(new Date(date).getTime() + ms);
const boxNotices = (customer, type, subId) => Notification.countDocuments({ recipient_id: customer.userId, type, ...(subId ? { subscription_id: subId } : {}) });

// A box charging at `chargeAt` (no checkout order: only the renewal job is under test here).
async function createBox(customer, product, { qty = 1, chargeAt }) {
  return Subscription.create({
    user_id: customer.userId, product_id: String(product._id), variant_id: skuOf(product), quantity: qty,
    frequency_days: 14, next_charge_at: chargeAt, status: 'active',
    pricing_snapshot: { original_price: product.variants[0].price, subscribe_price: product.variants[0].price * 0.9, discount_percent: 10 },
    payment_method_id: customer.cardId, delivery_info: DELIVERY, shipping_method: 'standard'
  });
}
const reloadBox = (box) => Subscription.findById(box._id).lean();
const boxOrders = (box) => Order.find({ subscription_id: box.subscription_id }).lean();

// 7. Ritual Box: stock held 3 days before each charge.
async function ritualBoxStockHold({ admin }) {
  console.log('\n[7] Ritual Box: stock held 3 days ahead, charge from the hold, out of stock → restock / replacement / skip, release on skip / pause / cancel');
  const customer = await createCustomer('C7');
  // A category of its own, so the replacement lookup only sees this run's products.
  const category = `${PREFIX.toLowerCase()}${runTag.toLowerCase()}`;
  const box = await createProduct({ stock: 10, price: 30, category });
  const T = new Date();

  // 7a. Held 72 units before next_charge_at, once; SUBSCRIPTION_UPCOMING with it.
  const a = await createBox(customer, box, { qty: 2, chargeAt: shift(T, units(100)) });
  await runJob(customer, shift(a.next_charge_at, -units(73)));
  check('7a.1', 'nothing held 73 units before the charge', (await stockOf(box)) === 10 && !(await reloadBox(a)).reserved_for);
  await runJob(customer, shift(a.next_charge_at, -units(72)));
  let s = await reloadBox(a);
  check('7a.2', 'held 72 units (3 days) before: stock 10 → 8, reserved_for = next_charge_at, SUBSCRIPTION_UPCOMING sent',
    (await stockOf(box)) === 8 && +s.reserved_for === +s.next_charge_at && s.reserved_items?.[0]?.quantity === 2
      && (await boxNotices(customer, 'SUBSCRIPTION_UPCOMING', a.subscription_id)) === 1,
    `stock ${await stockOf(box)}, reserved_for ${s.reserved_for}`);
  await runJob(customer, shift(a.next_charge_at, -units(50)));
  check('7a.3', 'next passes hold nothing more, no second notice', (await stockOf(box)) === 8
    && (await boxNotices(customer, 'SUBSCRIPTION_UPCOMING', a.subscription_id)) === 1, `stock ${await stockOf(box)}`);

  // 7b. The charge uses the hold: no second subtraction, no stock check (stock sold out meanwhile).
  await Product.updateOne({ _id: box._id }, { $set: { 'variants.0.stock': 0 } });
  const summary = await runJob(customer, a.next_charge_at);
  s = await reloadBox(a);
  const [orderA] = await boxOrders(a);
  if (orderA) created.orderIds.add(orderA.order_id);
  check('7b.1', 'charged from the hold although the shelf is empty: paid order × 2, stock still 0, hold cleared',
    summary.charged === 1 && orderA?.payment_status === 'paid' && orderA.items[0].quantity === 2 && orderA.stock_reserved === true
      && (await stockOf(box)) === 0 && !s.reserved_for && !s.reserved_items?.length,
    `${JSON.stringify(summary)}, stock ${await stockOf(box)}`);
  await Subscription.updateOne({ _id: a._id }, { $set: { status: 'cancelled' } }); // out of the way

  // 7c. Not enough stock 3 days ahead: OUT_OF_STOCK right away, on the admin to-do; QLSP restocks → held and charged.
  const c = await createBox(customer, box, { qty: 1, chargeAt: shift(T, units(60)) });
  await runJob(customer, T);
  s = await reloadBox(c);
  check('7c.1', 'cannot hold: SUBSCRIPTION_OUT_OF_STOCK sent at once, box flagged out_of_stock, not held',
    (await boxNotices(customer, 'SUBSCRIPTION_OUT_OF_STOCK', c.subscription_id)) === 1 && s.last_failure_reason === 'out_of_stock' && !s.reserved_for,
    `reason ${s.last_failure_reason}`);
  const todo = await call('GET', '/api/admin/sales-dashboard', { token: admin.token });
  const boxTask = JSON.stringify(todo.data || {}).includes(`box-stock:${skuOf(box)}`);
  check('7c.2', 'admin to-do lists "Ritual Box charging soon · item out of stock" for this item', todo.status === 200 && boxTask, errorOf(todo));
  await runJob(customer, shift(T, units(5)));
  check('7c.3', 'retried each pass, no duplicate notice', (await boxNotices(customer, 'SUBSCRIPTION_OUT_OF_STOCK', c.subscription_id)) === 1);
  await Product.updateOne({ _id: box._id }, { $set: { 'variants.0.stock': 4 } }); // QLSP restocks
  await runJob(customer, shift(T, units(6)));
  s = await reloadBox(c);
  check('7c.4', 'after the restock the next pass holds it (4 → 3), flag cleared, SUBSCRIPTION_UPCOMING sent',
    (await stockOf(box)) === 3 && +s.reserved_for === +s.next_charge_at && !s.last_failure_reason
      && (await boxNotices(customer, 'SUBSCRIPTION_UPCOMING', c.subscription_id)) === 1, `stock ${await stockOf(box)}`);
  await runJob(customer, c.next_charge_at);
  const ordersC = await boxOrders(c);
  ordersC.forEach(o => created.orderIds.add(o.order_id));
  check('7c.5', 'charged at the due date from the hold (stock stays 3)', ordersC.length === 1 && (await stockOf(box)) === 3, `orders ${ordersC.length}`);
  await Subscription.updateOne({ _id: c._id }, { $set: { status: 'cancelled' } });

  // 7d. Due and still not held → not charged; the customer picks the replacement → held, then charged.
  const alt = await createProduct({ stock: 5, price: 28, category });
  await Product.updateOne({ _id: box._id }, { $set: { 'variants.0.stock': 0 } });
  const d = await createBox(customer, box, { qty: 1, chargeAt: shift(T, -units(1)) });
  await runJob(customer, T);
  check('7d.1', 'due but not held: not charged', (await boxOrders(d)).length === 0);
  const replace = await call('PATCH', `/api/subscriptions/${d.subscription_id}`, {
    token: customer.token,
    body: { action: 'use_replacement', product_id: String(alt._id), variant_id: skuOf(alt) }
  });
  s = await reloadBox(d);
  check('7d.2', 'use_replacement: replacement held at once for this delivery only (5 → 4), box keeps its item',
    s.variant_id === skuOf(box) && s.cycle_replacement?.variant_id === skuOf(alt)
      && (await stockOf(alt)) === 4 && +s.reserved_for === +s.next_charge_at,
    `${errorOf(replace)}, variant ${s.variant_id}, replacement ${s.cycle_replacement?.variant_id}, stock ${await stockOf(alt)}`);
  await runJob(customer, shift(T, units(1)));
  const ordersD = await boxOrders(d);
  ordersD.forEach(o => created.orderIds.add(o.order_id));
  s = await reloadBox(d);
  check('7d.3', 'next pass charges the replacement from the hold (stock stays 4); the box goes back to its item',
    ordersD.length === 1 && ordersD[0].items[0].variant_id === skuOf(alt) && (await stockOf(alt)) === 4
      && s.variant_id === skuOf(box) && !s.cycle_replacement && s.last_replacement?.variant_id === skuOf(alt),
    `orders ${ordersD.length}, variant ${s.variant_id}`);
  await Subscription.updateOne({ _id: d._id }, { $set: { status: 'cancelled' } });

  // 7e. Still not held 3 days after next_charge_at → cycle skipped, not charged, nothing held.
  await Product.updateOne({ _id: alt._id }, { $set: { 'variants.0.stock': 0 } });
  const e = await createBox(customer, box, { qty: 1, chargeAt: shift(T, -units(10)) });
  await runJob(customer, T);
  await runJob(customer, shift(e.next_charge_at, units(71)));
  check('7e.1', 'still waiting at +71 units', (await reloadBox(e)).skipped_deliveries.length === 0);
  await runJob(customer, shift(e.next_charge_at, units(72)));
  s = await reloadBox(e);
  check('7e.2', 'skipped at +72 units: not charged, SUBSCRIPTION_SKIPPED, no stock held, skip limit untouched',
    s.skipped_deliveries.length === 1 && (await boxOrders(e)).length === 0 && !s.reserved_for && s.consecutive_skips === 0
      && (await boxNotices(customer, 'SUBSCRIPTION_SKIPPED', e.subscription_id)) === 1,
    `skipped ${s.skipped_deliveries.length}, next ${s.next_charge_at}`);
  await Subscription.updateOne({ _id: e._id }, { $set: { status: 'cancelled' } });

  // 7f. Skip / pause / cancel by the customer put the held stock back (once).
  await Product.updateOne({ _id: box._id }, { $set: { 'variants.0.stock': 9 } });
  for (const [action, body] of [['skip', {}], ['pause', { pause_option: '1_month' }], ['cancel', {}]]) {
    // Outside the 48h lock, inside the 3-day hold window: the action takes effect now.
    const f = await createBox(customer, box, { qty: 3, chargeAt: shift(new Date(), 60 * HOUR) });
    await runJob(customer, new Date());
    const held = (await stockOf(box)) === 6 && !!(await reloadBox(f)).reserved_for;
    const r = await call('PATCH', `/api/subscriptions/${f.subscription_id}`, { token: customer.token, body: { action, ...body } });
    await runJob(customer, new Date()); // the job's cleanup must not put it back a second time
    s = await reloadBox(f);
    check(`7f.${action}`, `${action}: the 3 held go back once (9 → 6 → 9), hold cleared`,
      held && r.status === 200 && (await stockOf(box)) === 9 && !s.reserved_for, `${errorOf(r)}, stock ${await stockOf(box)}, held ${held}`);
    await Subscription.updateOne({ _id: f._id }, { $set: { status: 'cancelled' } });
  }
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
  check('5.10b', 'the Ritual Box stays active after its first order is refunded (the customer pauses or cancels it)', boxAfter?.status === 'active', boxAfter?.status);

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

  // Next renewal canceled while processing: refunded, its stock back once (order held it), box stays active.
  const subDoc2 = await Subscription.findById(sub._id);
  const charge2 = await subscriptionService.chargeSubscription(subDoc2, { now: new Date(subDoc2.next_charge_at) });
  if (charge2.ok) {
    await subDoc2.save();
    created.orderIds.add(charge2.order.order_id);
    const stockHeld = await stockOf(box);
    const cancel = await call('PUT', `/api/orders/${charge2.order.order_id}/cancel`, { token: customer.token, body: {} });
    const again = await call('PUT', `/api/orders/${charge2.order.order_id}/cancel`, { token: customer.token, body: {} });
    const after = await reloadOrder(charge2.order.order_id);
    const subAfter = await Subscription.findById(sub._id).lean();
    check('6.9', 'renewal canceled → canceled / refunded, stock back once (+1, not +2), box still active',
      cancel.status === 200 && again.status === 400 && after.order_status === 'canceled' && after.payment_status === 'refunded'
        && (await stockOf(box)) === stockHeld + 1 && subAfter.status === 'active',
      `${errorOf(cancel)}, ${after.order_status}/${after.payment_status}, stock ${stockHeld} → ${await stockOf(box)}, box ${subAfter.status}`);
  } else {
    check('6.9', 'second renewal charged', false, JSON.stringify(charge2));
  }
}

// ─── Failed delivery → redelivery confirmation ──────────────────
const redeliveryJob = require('../src/services/redelivery.service');
const ChatConversation = require('../src/models/ChatConversation');
const ChatMessage = require('../src/models/ChatMessage');
const AiChatSession = require('../src/models/AiChatSession');

const REDELIVERY_ADDRESS = { recipient_name: `${PREFIX}Recipient`, city: 'Ho Chi Minh', address: '12 Le Loi, Ben Nghe' };
const CONFIRM_BODY = { contact_phone: '0901 234 567', shipping_address: REDELIVERY_ADDRESS, note: 'Call before arriving' };
const REFUND_TO = { bank_name: 'Vietcombank', account_number: '0123456789', account_holder: 'Test E2E' };
const failDelivery = (admin, orderId, reasonCode, note = 'E2E: courier note') =>
  call('PUT', `/api/admin/orders/${orderId}/status`, { token: admin.token, body: { status: 'delivery_failed', reason: note, ...(reasonCode ? { reason_code: reasonCode } : {}) } });
const confirmRedelivery = (customer, orderId, body = CONFIRM_BODY) =>
  call('POST', `/api/orders/${orderId}/redelivery/confirm`, { token: customer.token, body });
const cancelRedelivery = (customer, orderId, body = {}) =>
  call('POST', `/api/orders/${orderId}/redelivery/cancel`, { token: customer.token, body });

// A paid / confirmed order already handed to the carrier.
async function shippedOrder(customer, admin, product, method = 'cod') {
  const { order } = await placeOrder([{ product, qty: 1 }], { method, customer });
  const id = order.order_id;
  if (method === 'cod') await call('PUT', `/api/orders/${id}/confirm`, { token: customer.token, body: {} });
  else await call('PUT', `/api/orders/${id}/confirm-payment`, { token: customer.token, body: {} });
  await adminStatus(admin, id, 'shipping');
  return id;
}

// The redelivery job reads every failed delivery in the database; while it runs here, Order.find
// is narrowed to this run's customer (a patch on the model in this process only).
async function runRedeliveryJob(customer, now) {
  const realFind = Order.find;
  Order.find = function scopedFind(filter = {}, ...rest) { return realFind.call(this, { ...filter, user_id: customer.userId }, ...rest); };
  try {
    return await redeliveryJob.runRedeliveryJob(now);
  } finally {
    Order.find = realFind;
  }
}
const historyNotes = (order, text) => (order.status_history || []).filter(h => (h.note || '').includes(text)).length;

// 8. Delivery failed → the customer confirms a redelivery or cancels; staff ship again; refunds.
async function redeliveryFlows({ admin }) {
  console.log('\n[8] Failed delivery: customer confirms / cancels, staff ship again, reminder, expiry, QR payout, chat context');
  const customer = await createCustomer('C8');
  const p = await createProduct({ stock: 50, price: 20 });
  const HOURS = 60 * 60 * 1000; // default time unit (SUB_TIME_UNIT not set)

  // (a) wrong_address → awaiting_customer → customer confirms → staff ship again → shipping.
  const a = await shippedOrder(customer, admin, p);
  const stockA = await stockOf(p);
  const noCode = await failDelivery(admin, a, null);
  const failA = await failDelivery(admin, a, 'wrong_address', 'House number not found');
  let oa = await reloadOrder(a);
  check('8a.1', 'delivery_failed needs a reason code (400 without), then: attempts 1, waiting on the customer for 24h, stock still held',
    noCode.status === 400 && failA.status === 200 && oa.order_status === 'delivery_failed' && oa.delivery_attempts === 1
      && oa.delivery_failed_reason_code === 'wrong_address' && oa.delivery_failed_reason === 'House number not found'
      && oa.redelivery?.status === 'awaiting_customer'
      && Math.round((new Date(oa.redelivery.expires_at) - new Date(oa.redelivery.requested_at)) / HOURS) === 24
      && (await stockOf(p)) === stockA && (await noticeCount(customer.userId, 'ORDER_DELIVERY_FAILED', a)) === 1,
    `${errorOf(noCode)} / ${errorOf(failA)}, ${oa.redelivery?.status}, stock ${stockA} → ${await stockOf(p)}`);
  const badPhone = await confirmRedelivery(customer, a, { ...CONFIRM_BODY, contact_phone: '12ab' });
  const badAddress = await confirmRedelivery(customer, a, { ...CONFIRM_BODY, shipping_address: { ...REDELIVERY_ADDRESS, address: 'Le Loi' } });
  const confirmA = await confirmRedelivery(customer, a);
  oa = await reloadOrder(a);
  check('8a.2', 'confirm validates like checkout (bad phone / address → 400), then saves phone, address, note; order address unchanged',
    badPhone.status === 400 && badAddress.status === 400 && confirmA.status === 200 && oa.redelivery.status === 'confirmed'
      && oa.redelivery.contact_phone === '0901234567' && oa.redelivery.shipping_address.address === REDELIVERY_ADDRESS.address
      && oa.redelivery.note === 'Call before arriving' && oa.delivery_info.address === DELIVERY.address
      && historyNotes(oa, 'Customer confirmed the redelivery') === 1,
    `${errorOf(badPhone)} / ${errorOf(badAddress)} / ${errorOf(confirmA)}`);
  const shipA = await adminStatus(admin, a, 'shipping');
  oa = await reloadOrder(a);
  check('8a.3', 'staff ship again → shipping, customer told, redelivery kept for reference',
    shipA.status === 200 && oa.order_status === 'shipping' && oa.redelivery?.status === 'confirmed'
      && (await noticeCount(customer.userId, 'ORDER_SHIPPING', a)) === 2, errorOf(shipA));

  // (b) Ship again before the customer confirmed → 409.
  const b = await shippedOrder(customer, admin, p);
  await failDelivery(admin, b, 'customer_unreachable');
  const shipB = await adminStatus(admin, b, 'shipping');
  check('8b.1', 'ship again while waiting on the customer → 409, still delivery_failed',
    shipB.status === 409 && (await reloadOrder(b)).order_status === 'delivery_failed', errorOf(shipB));
  await cancelRedelivery(customer, b); // out of the way: it would otherwise expire in (e)'s job run

  // (c) carrier_issue → no redelivery asked, staff ship again directly.
  const c = await shippedOrder(customer, admin, p);
  await failDelivery(admin, c, 'carrier_issue', 'Truck broke down');
  const oc = await reloadOrder(c);
  const confirmC = await confirmRedelivery(customer, c);
  const shipC = await adminStatus(admin, c, 'shipping');
  check('8c.1', 'carrier_issue: nothing asked of the customer (confirm → 409), staff ship again → shipping',
    !oc.redelivery && confirmC.status === 409 && shipC.status === 200 && (await reloadOrder(c)).order_status === 'shipping',
    `${errorOf(confirmC)} / ${errorOf(shipC)}`);

  // (d) Customer cancels: COD nothing to refund; card back to the card; QR pending_payout → staff mark paid.
  const dCod = await shippedOrder(customer, admin, p, 'cod');
  await failDelivery(admin, dCod, 'refused');
  const stockD = await stockOf(p);
  const cancelCod = await cancelRedelivery(customer, dCod);
  const oCod = await reloadOrder(dCod);
  check('8d.1', 'COD cancel → canceled, nothing refunded (refund_status null), stock back +1',
    cancelCod.status === 200 && oCod.order_status === 'canceled' && oCod.payment_status !== 'refunded' && !oCod.refund_status
      && (await stockOf(p)) === stockD + 1, `${errorOf(cancelCod)}, ${oCod.payment_status}/${oCod.refund_status}`);

  const dCard = await shippedOrder(customer, admin, p, 'card');
  await failDelivery(admin, dCard, 'customer_unreachable');
  const cancelCard = await cancelRedelivery(customer, dCard);
  const oCard = await reloadOrder(dCard);
  await tick();
  const pointsCard = await PointTransaction.findOne({ ref_id: dCard, type: 'purchase' }).lean();
  check('8d.2', 'card cancel → refunded to the card (refund_status completed), points reversed',
    cancelCard.status === 200 && oCard.payment_status === 'refunded' && oCard.refund_status === 'completed' && pointsCard?.status === 'reversed',
    `${errorOf(cancelCard)}, ${oCard.payment_status}/${oCard.refund_status}, points ${pointsCard?.status}`);

  const dQr = await shippedOrder(customer, admin, p, 'qr');
  await failDelivery(admin, dQr, 'customer_unreachable');
  const qrNoDest = await cancelRedelivery(customer, dQr);
  const qrCancel = await cancelRedelivery(customer, dQr, { refund_destination: REFUND_TO });
  let oQr = await reloadOrder(dQr);
  check('8d.3', 'paid QR cancel needs the refund account (400 without), then pending_payout with that account',
    qrNoDest.status === 400 && qrCancel.status === 200 && oQr.order_status === 'canceled' && oQr.refund_status === 'pending_payout'
      && oQr.refund_destination?.account_number === REFUND_TO.account_number,
    `${errorOf(qrNoDest)} / ${errorOf(qrCancel)}, ${oQr.refund_status}`);
  const todo = await call('GET', '/api/admin/sales-dashboard', { token: admin.token });
  const payoutTask = (todo.data?.data?.tasks || todo.data?.tasks || []).find?.(t => t.key === `refund-payout:${dQr}`)
    || JSON.stringify(todo.data || {}).includes(`refund-payout:${dQr}`);
  const paid = await call('POST', `/api/admin/orders/${dQr}/refunds/mark-paid`, { token: admin.token, body: {} });
  const paidAgain = await call('POST', `/api/admin/orders/${dQr}/refunds/mark-paid`, { token: admin.token, body: {} });
  oQr = await reloadOrder(dQr);
  check('8d.4', 'to-do lists the QR payout; staff mark it paid → completed, customer notified; again → 409',
    !!payoutTask && paid.status === 200 && paidAgain.status === 409 && oQr.refund_status === 'completed'
      && (await noticeCount(customer.userId, 'ORDER_REFUND_PAID', dQr)) === 1,
    `${errorOf(paid)} / ${errorOf(paidAgain)}`);

  // (e) No answer within 24h → cancelled automatically, stock back exactly once.
  const e = await shippedOrder(customer, admin, p, 'cod');
  await failDelivery(admin, e, 'customer_unreachable');
  const requested = new Date((await reloadOrder(e)).redelivery.requested_at);
  const stockE = await stockOf(p);
  await runRedeliveryJob(customer, new Date(requested.getTime() + 23 * HOURS));
  const early = await reloadOrder(e);
  await runRedeliveryJob(customer, new Date(requested.getTime() + 24 * HOURS));
  await runRedeliveryJob(customer, new Date(requested.getTime() + 25 * HOURS));
  const oe = await reloadOrder(e);
  check('8e.1', 'still waiting at 23h; at 24h canceled (redelivery expired), ORDER_REDELIVERY_EXPIRED, stock +1 once',
    early.order_status === 'delivery_failed' && oe.order_status === 'canceled' && oe.redelivery?.status === 'expired'
      && (await stockOf(p)) === stockE + 1 && (await noticeCount(customer.userId, 'ORDER_REDELIVERY_EXPIRED', e)) === 1
      && historyNotes(oe, redeliveryJob.EXPIRED_CANCEL_NOTE) === 1,
    `status ${oe.order_status}, stock ${stockE} → ${await stockOf(p)}`);
  const eQr = await shippedOrder(customer, admin, p, 'qr');
  await failDelivery(admin, eQr, 'refused');
  const requestedQr = new Date((await reloadOrder(eQr)).redelivery.requested_at);
  await runRedeliveryJob(customer, new Date(requestedQr.getTime() + 24 * HOURS));
  const destLater = await call('POST', `/api/orders/${eQr}/refund-destination`, { token: customer.token, body: { refund_destination: REFUND_TO } });
  const oeQr = await reloadOrder(eQr);
  check('8e.2', 'paid QR auto-cancel → pending_payout; the customer adds the refund account after the cancel',
    oeQr.order_status === 'canceled' && oeQr.refund_status === 'pending_payout' && destLater.status === 200
      && oeQr.refund_destination?.bank_name === REFUND_TO.bank_name, `${errorOf(destLater)}, ${oeQr.refund_status}`);

  // (f) Confirm or cancel twice: one write, no duplicate history, stock back once.
  const f1 = await shippedOrder(customer, admin, p);
  await failDelivery(admin, f1, 'wrong_address');
  const [c1, c2] = await Promise.all([confirmRedelivery(customer, f1), confirmRedelivery(customer, f1)]);
  const of1 = await reloadOrder(f1);
  check('8f.1', 'confirm twice (at once) → one 200 + one 409, one history entry',
    [c1.status, c2.status].sort().join() === '200,409' && historyNotes(of1, 'Customer confirmed the redelivery') === 1,
    `${c1.status}/${c2.status}`);
  const f2 = await shippedOrder(customer, admin, p);
  await failDelivery(admin, f2, 'customer_unreachable');
  const stockF = await stockOf(p);
  const [k1, k2] = await Promise.all([cancelRedelivery(customer, f2), cancelRedelivery(customer, f2)]);
  const of2 = await reloadOrder(f2);
  check('8f.2', 'cancel twice (at once) → one cancel, stock back once, one canceled history entry',
    [k1.status, k2.status].sort().join() === '200,409' && of2.order_status === 'canceled' && (await stockOf(p)) === stockF + 1
      && of2.status_history.filter(h => h.status === 'canceled').length === 1,
    `${k1.status}/${k2.status}, stock ${stockF} → ${await stockOf(p)}`);

  // (g) Third failed delivery: no redelivery left — ship again 409, the customer can't confirm, staff can only cancel.
  const g = await shippedOrder(customer, admin, p, 'card');
  for (let i = 0; i < 2; i++) {
    await failDelivery(admin, g, 'customer_unreachable');
    await confirmRedelivery(customer, g);
    await adminStatus(admin, g, 'shipping');
  }
  const fail3 = await failDelivery(admin, g, 'customer_unreachable');
  const og = await reloadOrder(g);
  const ship3 = await adminStatus(admin, g, 'shipping');
  const confirm3 = await confirmRedelivery(customer, g);
  const cancel3 = await adminStatus(admin, g, 'canceled', 'No redeliveries left');
  const og2 = await reloadOrder(g);
  const lastNotice = await Notification.findOne({ recipient_id: customer.userId, type: 'ORDER_DELIVERY_FAILED', post_id: g }).sort({ created_at: -1 }).lean();
  check('8g.1', '3rd failure: attempts 3, no redelivery, customer told it will be cancelled & refunded',
    fail3.status === 200 && og.delivery_attempts === 3 && !og.redelivery && /cancelled and refunded/.test(lastNotice?.comment_content || ''),
    `attempts ${og.delivery_attempts}, notice "${lastNotice?.comment_content}"`);
  check('8g.2', 'ship again → 409, customer confirm → 409, staff cancel → canceled / refunded to the card',
    ship3.status === 409 && confirm3.status === 409 && cancel3.status === 200 && og2.order_status === 'canceled'
      && og2.payment_status === 'refunded' && og2.refund_status === 'completed',
    `${errorOf(ship3)} / ${errorOf(confirm3)} / ${errorOf(cancel3)}`);

  // (h) The 12h reminder goes out once however often the job runs.
  const h = await shippedOrder(customer, admin, p);
  await failDelivery(admin, h, 'customer_unreachable');
  const requestedH = new Date((await reloadOrder(h)).redelivery.requested_at);
  await runRedeliveryJob(customer, new Date(requestedH.getTime() + 11 * HOURS));
  const before12 = await noticeCount(customer.userId, 'ORDER_REDELIVERY_REMINDER', h);
  for (const hour of [12, 12.5, 13, 20]) await runRedeliveryJob(customer, new Date(requestedH.getTime() + hour * HOURS));
  const oh = await reloadOrder(h);
  check('8h.1', 'no reminder at 11h; exactly one from 12h on (reminder_sent_at set), still waiting',
    before12 === 0 && (await noticeCount(customer.userId, 'ORDER_REDELIVERY_REMINDER', h)) === 1 && !!oh.redelivery.reminder_sent_at
      && oh.order_status === 'delivery_failed', `before ${before12}, after ${await noticeCount(customer.userId, 'ORDER_REDELIVERY_REMINDER', h)}`);

  // (i) "Chat with a human" from the order: the support conversation carries the order code.
  // Support hours (08:00–22:00 VN) are opened in-process for this call only.
  const policy = require('../src/services/chat-policy');
  const realSupportOpen = policy.supportOpen;
  policy.supportOpen = () => true;
  let chat;
  try {
    chat = await call('POST', '/api/ai-chat/handover', {
      token: customer.token,
      body: { session_id: `${PREFIX}${runTag}_CHAT`, reason: 'order_change', message: `Order ${h}: please call me before delivering`, order_id: h }
    });
  } finally {
    policy.supportOpen = realSupportOpen;
  }
  const conversation = await ChatConversation.findOne({ customer_id: customer.userId }).sort({ created_at: -1 }).lean();
  check('8i.1', 'handover from the order → ChatConversation.context_order_id is the order code',
    chat.status === 200 && chat.data?.handover === true && conversation?.context_order_id === h,
    `${errorOf(chat)}, context ${conversation?.context_order_id}`);
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

    for (const scenario of [oneTimeCod, oneTimeQr, guestCod, cancels, mixedCard, ritualBoxOnly, ritualBoxStockHold, redeliveryFlows]) {
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
