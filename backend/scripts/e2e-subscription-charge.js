#!/usr/bin/env node
// E2E check of the Ritual Box charge job against a DEV database.
//
//   cd backend && node scripts/e2e-subscription-charge.js          # run, print PASS/FAIL, clean up
//   cd backend && node scripts/e2e-subscription-charge.js --keep   # keep the TEST_E2E_ data to inspect
//
// - Uses MONGODB_URI (backend/.env). Refuses to run when NODE_ENV=production or the database
//   name contains "prod". Runs with SUB_TIME_UNIT=minute (1 "hour" of the plan = 1 minute).
// - Creates its own data (users, products, subscriptions) prefixed TEST_E2E_ and deletes
//   everything with that prefix at the start (leftovers of a crashed run) and at the end.
// - Time travel: the job is called with an explicit `now`, so no waiting is needed.
// - Scope: the job normally picks up EVERY due subscription in the database. So that it never
//   touches real DEV boxes (it runs with a future `now`), this script narrows Subscription.find
//   to the scenario's TEST_E2E_ user while the job runs. That is a patch on the model object in
//   this process only; no application code is changed.
// - Main code is not modified. Mismatches with the plan are reported as FAIL / NOTE, not fixed.

const path = require('path');

process.env.SUB_TIME_UNIT = 'minute'; // before dotenv (which never overrides) and before the services load
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
const Subscription = require('../src/models/Subscription');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const subscriptionService = require('../src/services/subscription.service');
const chargeServicePath = require.resolve('../src/services/subscription-charge.service');
const chargeService = require(chargeServicePath);

const UNIT_MS = chargeService.TIME_UNIT_MS;            // 60 000 with SUB_TIME_UNIT=minute
const DAY_MS = 24 * 60 * 60 * 1000;
const units = (n) => n * UNIT_MS;
const at = (base, ms) => new Date(base.getTime() + ms);
const fmt = (d) => (d ? new Date(d).toISOString().replace('.000Z', 'Z') : String(d));
const deltaLabel = (from, to) => {
  const ms = new Date(to) - new Date(from);
  return `${(ms / UNIT_MS).toFixed(1)} units (${(ms / DAY_MS).toFixed(2)} real days)`;
};

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

// ─── Scope the job to one TEST_E2E_ user ────────────────────────
let scopeUser = null;
const realFind = Subscription.find.bind(Subscription);
Subscription.find = function scopedFind(filter = {}, ...rest) {
  if (filter && filter.user_id !== undefined) return realFind(filter, ...rest); // already one customer's boxes
  if (!scopeUser) throw new Error('e2e: an unscoped Subscription.find ran outside a scenario (would read real DEV boxes)');
  return realFind({ ...filter, user_id: scopeUser }, ...rest);
};
async function runJob(user, now, opts = {}, service = chargeService) {
  scopeUser = user;
  try {
    return await service.runSubscriptionChargeJob({ now, ...opts });
  } finally {
    scopeUser = null;
  }
}

// ─── Test data ────────────────────────────────────────────────
const runTag = Date.now().toString(36).toUpperCase();
let productSeq = 0;
const T0 = new Date(Math.floor(Date.now() / 60000) * 60000); // whole minute

async function createProduct({ stock }) {
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
    is_subscribable: true,
    subscribe_discount_percent: 10,
    images: [image],
    variants: [{ sku: `${PREFIX}SKU_${runTag}_${productSeq}`, label: 'Default', price: 20, stock, images: [image], is_default: true }]
  });
  return Product.findById(_id).lean();
}

async function createUser(key, { cardExpiry = '12/40' } = {}) {
  const cardId = new mongoose.Types.ObjectId();
  const userId = `${PREFIX}${runTag}_${key}`;
  await User.collection.insertOne({
    user_id: userId,
    email: `${userId.toLowerCase()}@example.invalid`,
    profile_name: `${PREFIX}${key}`,
    role: 'customer',
    status: 'active',
    payment_methods: [{
      _id: cardId, card_type: 'VISA', card_number: '4111111111111111', cardholder_name: 'TEST E2E', expire_date: cardExpiry
    }]
  });
  return { userId, cardId: String(cardId) };
}

async function createSubscription(user, product, { frequency = 14, nextChargeAt }) {
  const variant = product.variants[0];
  return Subscription.create({
    user_id: user.userId,
    product_id: String(product._id),
    variant_id: variant.sku,
    quantity: 1,
    frequency_days: frequency,
    next_charge_at: nextChargeAt,
    status: 'active',
    pricing_snapshot: { original_price: 20, subscribe_price: 18, discount_percent: 10 },
    payment_method_id: user.cardId,
    delivery_info: { recipient_name: `${PREFIX}Recipient`, mobile: '0900000000', city: 'Ho Chi Minh', address: '1 Test St' },
    shipping_method: 'standard'
  });
}

const reload = (sub) => Subscription.findById(sub._id).lean();
const ordersOf = (sub) => Order.countDocuments({ subscription_id: sub.subscription_id });
const noticesOf = (user, type) => Notification.countDocuments({ recipient_id: user.userId, type });
const stockOf = async (product) => (await Product.findById(product._id).lean()).variants[0].stock;

async function cleanup() {
  const re = new RegExp(`^${PREFIX}`);
  const [subs, orders, notifs, users, products] = await Promise.all([
    Subscription.deleteMany({ user_id: re }),
    Order.deleteMany({ user_id: re }),
    Notification.deleteMany({ recipient_id: re }),
    User.collection.deleteMany({ user_id: re }),
    Product.collection.deleteMany({ name: re })
  ]);
  return {
    subscriptions: subs.deletedCount, orders: orders.deletedCount, notifications: notifs.deletedCount,
    users: users.deletedCount, products: products.deletedCount
  };
}

// ─── Scenarios ────────────────────────────────────────────────

// a. Due active box → job creates an order, charges the card, moves next_charge_at.
async function scenarioA() {
  console.log('\n[a] Due active box is charged');
  const user = await createUser('A');
  const product = await createProduct({ stock: 10 });
  const sub = await createSubscription(user, product, { frequency: 14, nextChargeAt: at(T0, -units(1)) });
  const now = T0;

  const summary = await runJob(user.userId, now);
  const after = await reload(sub);
  const order = await Order.findOne({ subscription_id: sub.subscription_id }).lean();

  check('a1', 'job reports one charge', summary.charged === 1, JSON.stringify(summary));
  check('a2', 'one order created for the box', !!order, order ? order.order_id : 'no order');
  check('a3', 'card charged (order paid, card on order, stock reserved)',
    order && order.payment_status === 'paid' && order.payment?.card_info?.last4 === '1111' && (await stockOf(product)) === 9,
    order ? `payment_status=${order.payment_status}, last4=${order.payment?.card_info?.last4}, stock 10→${await stockOf(product)}` : '');
  check('a4', 'last_charged_at = now, failed_attempts = 0',
    after.last_charged_at && +after.last_charged_at === +now && after.failed_attempts === 0);
  const expected = at(now, units(14));
  check('a5', 'next_charge_at = now + frequency_days in units (minutes)', +after.next_charge_at === +expected,
    `expected ${fmt(expected)}, got ${fmt(after.next_charge_at)} (= now + ${deltaLabel(now, after.next_charge_at)})`);
}

// b. Charge error → retry +24 / +48 / +72 units, then suspended. Counts the real charge attempts.
async function scenarioB() {
  console.log('\n[b] Charge errors: retry 24 → 48 → 72, then suspended');
  const user = await createUser('B');
  const product = await createProduct({ stock: 10 });
  const sub = await createSubscription(user, product, { nextChargeAt: at(T0, -units(1)) });
  let attempts = 0;
  const failingCharge = async () => { attempts += 1; return { ok: false, reason: 'card_declined', message: 'E2E: declined' }; };
  const timeline = [];

  let now = T0;
  const expectedDelays = [24, 48, 72];
  for (let i = 0; i < 3; i += 1) {
    await runJob(user.userId, now, { charge: failingCharge });
    const s = await reload(sub);
    timeline.push(`attempt ${attempts} at ${fmt(now)} → failed_attempts=${s.failed_attempts}, next_retry_at=${fmt(s.next_retry_at)}, status=${s.status}`);
    check(`b${i + 1}`, `after failure ${i + 1}: failed_attempts=${i + 1}, retry +${expectedDelays[i]} units`,
      s.failed_attempts === i + 1 && s.next_retry_at && +s.next_retry_at === +at(now, units(expectedDelays[i])) && s.status === 'active',
      `failed_attempts=${s.failed_attempts}, next_retry_at = now + ${s.next_retry_at ? deltaLabel(now, s.next_retry_at) : 'null'}`);

    // One minute before the retry is due nothing is attempted.
    const before = attempts;
    await runJob(user.userId, at(now, units(expectedDelays[i]) - 60 * 1000), { charge: failingCharge });
    if (attempts !== before) check(`b${i + 1}x`, 'no attempt before next_retry_at', false, `attempted early`);
    now = at(now, units(expectedDelays[i]));
  }

  await runJob(user.userId, now, { charge: failingCharge });
  let s = await reload(sub);
  timeline.push(`attempt ${attempts} at ${fmt(now)} → failed_attempts=${s.failed_attempts}, status=${s.status}`);
  check('b4', 'next failure → status suspended', s.status === 'suspended', `status=${s.status}, failed_attempts=${s.failed_attempts}`);

  await runJob(user.userId, at(now, units(500)), { charge: failingCharge });
  s = await reload(sub);
  check('b5', 'suspended box is not charged again', attempts === 4, `attempts=${attempts}`);
  check('b6', 'SUBSCRIPTION_SUSPENDED sent once', (await noticesOf(user, 'SUBSCRIPTION_SUSPENDED')) === 1);
  check('b7', 'no order created', (await ordersOf(sub)) === 0);
  console.log('    timeline:');
  timeline.forEach((line) => console.log(`      ${line}`));
  note(`[b] Real charge attempts before suspension: ${attempts} (1 at the due date + 3 retries at +24/+48/+72 units). Compare with the plan.`);
}

// c. Expired card → payment_failed, no charge.
async function scenarioC() {
  console.log('\n[c] Expired card → payment_failed, no charge');
  const user = await createUser('C', { cardExpiry: '01/20' });
  const product = await createProduct({ stock: 10 });
  const sub = await createSubscription(user, product, { nextChargeAt: at(T0, -units(1)) });

  await runJob(user.userId, T0);
  const s = await reload(sub);
  check('c1', 'status = payment_failed', s.status === 'payment_failed', `status=${s.status}, reason=${s.last_failure_reason}`);
  check('c2', 'no order, stock untouched', (await ordersOf(sub)) === 0 && (await stockOf(product)) === 10);
  check('c3', 'SUBSCRIPTION_PAYMENT_FAILED sent', (await noticesOf(user, 'SUBSCRIPTION_PAYMENT_FAILED')) === 1);
  check('c4', 'no retry scheduled', !s.next_retry_at && (s.failed_attempts || 0) === 0);
}

// d. Out of stock → SUBSCRIPTION_OUT_OF_STOCK, then skipped after 72 units, never charged.
async function scenarioD() {
  console.log('\n[d] Out of stock → notice, skipped after 3 "days" (72 units)');
  const user = await createUser('D');
  const product = await createProduct({ stock: 0 });
  const due = at(T0, -units(1));
  const sub = await createSubscription(user, product, { nextChargeAt: due });

  await runJob(user.userId, T0);
  let s = await reload(sub);
  check('d1', 'SUBSCRIPTION_OUT_OF_STOCK sent, cycle not skipped yet',
    (await noticesOf(user, 'SUBSCRIPTION_OUT_OF_STOCK')) === 1 && s.last_failure_reason === 'out_of_stock' && s.skipped_deliveries.length === 0);

  await runJob(user.userId, at(due, units(71)));
  s = await reload(sub);
  check('d2', 'still waiting at +71 units, no duplicate notice',
    s.skipped_deliveries.length === 0 && (await noticesOf(user, 'SUBSCRIPTION_OUT_OF_STOCK')) === 1);

  const skipAt = at(due, units(72));
  await runJob(user.userId, skipAt);
  s = await reload(sub);
  check('d3', 'skipped at +72 units', s.skipped_deliveries.length === 1 && +s.skipped_deliveries[0] === +due,
    `skipped_deliveries=${s.skipped_deliveries.map(fmt).join(',') || '[]'}`);
  check('d4', 'never charged (no order), SUBSCRIPTION_SKIPPED sent',
    (await ordersOf(sub)) === 0 && (await noticesOf(user, 'SUBSCRIPTION_SKIPPED')) === 1);
  // Same frequency rule as a5 (units vs real days is checked there once).
  check('d5', 'next_charge_at moved one cycle (due + frequency_days)',
    +s.next_charge_at === +at(due, units(s.frequency_days)) || +s.next_charge_at === +at(due, s.frequency_days * DAY_MS),
    `due + ${deltaLabel(due, s.next_charge_at)}`);
  check('d6', 'system skip does not count toward the 2-skip limit (consecutive_skips unchanged)', s.consecutive_skips === 0,
    `consecutive_skips=${s.consecutive_skips}`);
}

// e. Two job runs at the same time → one order (lease).
async function scenarioE() {
  console.log('\n[e] Two concurrent job runs → one order');
  const user = await createUser('E');
  const product = await createProduct({ stock: 10 });

  // Two servers: two separate instances of the job module (each has its own in-process queue).
  const sub1 = await createSubscription(user, product, { nextChargeAt: at(T0, -units(1)) });
  delete require.cache[chargeServicePath];
  const secondInstance = require(chargeServicePath);
  require.cache[chargeServicePath].exports = chargeService;
  scopeUser = user.userId;
  try {
    await Promise.all([
      chargeService.runSubscriptionChargeJob({ now: T0 }),
      secondInstance.runSubscriptionChargeJob({ now: T0 })
    ]);
  } finally {
    scopeUser = null;
  }
  check('e1', 'two job instances in parallel → exactly 1 order', (await ordersOf(sub1)) === 1, `orders=${await ordersOf(sub1)}`);
  check('e2', 'lease released after the run', !(await reload(sub1)).charge_locked_until);

  // Same process: Promise.all of two calls.
  await Subscription.deleteOne({ _id: sub1._id });
  const sub2 = await createSubscription(user, product, { nextChargeAt: at(T0, -units(1)) });
  scopeUser = user.userId;
  try {
    await Promise.all([chargeService.runSubscriptionChargeJob({ now: T0 }), chargeService.runSubscriptionChargeJob({ now: T0 })]);
  } finally {
    scopeUser = null;
  }
  check('e3', 'same process, Promise.all of two runs → exactly 1 order', (await ordersOf(sub2)) === 1, `orders=${await ordersOf(sub2)}`);
}

// f. SUBSCRIPTION_UPCOMING sent exactly once, 72 units before the charge.
async function scenarioF() {
  console.log('\n[f] SUBSCRIPTION_UPCOMING exactly once, 3 "days" (72 units) before');
  const user = await createUser('F');
  const product = await createProduct({ stock: 10 });
  const chargeAt = at(T0, units(100));
  await createSubscription(user, product, { nextChargeAt: chargeAt });

  await runJob(user.userId, at(chargeAt, -units(73)));
  check('f1', 'not sent 73 units before', (await noticesOf(user, 'SUBSCRIPTION_UPCOMING')) === 0);
  await runJob(user.userId, at(chargeAt, -units(72)));
  check('f2', 'sent at 72 units before', (await noticesOf(user, 'SUBSCRIPTION_UPCOMING')) === 1);
  await runJob(user.userId, at(chargeAt, -units(71)));
  await runJob(user.userId, at(chargeAt, -units(10)));
  check('f3', 'not sent again for the same cycle', (await noticesOf(user, 'SUBSCRIPTION_UPCOMING')) === 1,
    `count=${await noticesOf(user, 'SUBSCRIPTION_UPCOMING')}`);
}

// g. Smart adjustment: a one-time purchase of the same product suggests 30 → 14; accepting keeps 14.
async function scenarioG() {
  console.log('\n[g] Smart adjustment 30 → 14, kept after the next charge');
  const user = await createUser('G');
  const product = await createProduct({ stock: 10 });
  const sub = await createSubscription(user, product, { frequency: 30, nextChargeAt: at(new Date(), 10 * DAY_MS) });

  await subscriptionService.suggestAdjustmentsForOrder({
    order_id: `${PREFIX}${runTag}_ORDER_G`,
    user_id: user.userId,
    is_guest: false,
    subscription_id: null,
    items: [{ product_id: String(product._id), variant_id: product.variants[0].sku, product_name: product.name, purchase_type: 'one_time' }]
  });
  let s = await reload(sub);
  check('g1', 'suggestion 30 → 14 + SUBSCRIPTION_ADJUSTED',
    s.suggested_frequency_days === 14 && (await noticesOf(user, 'SUBSCRIPTION_ADJUSTED')) === 1,
    `suggested_frequency_days=${s.suggested_frequency_days}`);

  await subscriptionService.applyAction(user.userId, sub.subscription_id, 'accept_adjustment');
  s = await reload(sub);
  check('g2', 'accepted: frequency_days = 14, suggestion cleared',
    s.frequency_days === 14 && !s.suggested_frequency_days && !s.pending_changes?.frequency_days,
    `frequency_days=${s.frequency_days}, next_charge_at=${fmt(s.next_charge_at)}`);

  const chargeNow = at(new Date(s.next_charge_at), 1000);
  await runJob(user.userId, chargeNow);
  s = await reload(sub);
  check('g3', 'after the next charge frequency_days is still 14 (permanent)',
    s.frequency_days === 14 && (await ordersOf(sub)) === 1,
    `frequency_days=${s.frequency_days}, orders=${await ordersOf(sub)}, next charge + ${deltaLabel(chargeNow, s.next_charge_at)}`);
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const dbName = mongoose.connection.name;
  if (/prod/i.test(dbName)) {
    await mongoose.disconnect();
    refuse(`connected database "${dbName}" contains "prod".`);
  }
  console.log(`E2E Ritual Box charge job — database "${dbName}", SUB_TIME_UNIT=minute (1 unit = ${UNIT_MS / 1000}s), T0=${fmt(T0)}, run ${runTag}`);

  const leftovers = await cleanup();
  if (Object.values(leftovers).some(Boolean)) console.log('Removed leftovers of an earlier run:', leftovers);

  const scenarios = [scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF, scenarioG];
  try {
    for (const scenario of scenarios) {
      try {
        await scenario();
      } catch (error) {
        check(scenario.name.replace('scenario', '').toLowerCase(), `${scenario.name} crashed`, false, error.stack || error.message);
      }
    }
  } finally {
    if (KEEP) {
      console.log(`\n--keep: TEST_E2E_ data left in "${dbName}" (prefix ${PREFIX}${runTag}_).`);
    } else {
      console.log('\nCleanup:', await cleanup());
    }
    await mongoose.disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n──────────────── RESULT ────────────────');
  console.table(results.map((r) => ({ id: r.id, result: r.ok ? 'PASS' : 'FAIL', check: r.label })));
  if (notes.length) {
    console.log('Notes:');
    notes.forEach((n) => console.log(`  - ${n}`));
  }
  console.log(`${results.length - failed.length} PASS, ${failed.length} FAIL`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  console.error('E2E run failed:', error);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
