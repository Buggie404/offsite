const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/subscription-suggestion-withdraw.test.js
// The Order model and its real save hooks run (no database: hooks are executed directly and
// the few DB reads are stubbed); subscription.service runs against an in-memory Subscriptions.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const DAY = 24 * 60 * 60 * 1000;

// Just enough of MongoDB's filter language for the queries these services send.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some(f => matches(doc, f));
    const value = doc[key];
    if (cond === null) return value == null;
    if (cond instanceof Date || typeof cond !== 'object') return String(value) === String(cond);
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$in') return arg.includes(value);
      if (op === '$ne') return arg === null ? value != null : value !== arg;
      if (op === '$gte') return value >= arg;
      if (op === '$lte') return value != null && value <= arg;
      throw new Error(`unsupported operator ${op}`);
    });
  });
}

function fixture() {
  const rows = [];
  const notifications = [];
  const asDoc = row => Object.assign(row, {
    save: async () => row,
    toObject: () => ({ ...row })
  });
  const Subscription = {
    find: filter => {
      const result = rows.filter(r => matches(r, filter));
      // getRitualBox (after an action) lists the box; shaping it isn't what's tested here.
      return Object.assign(Promise.resolve(result), { sort: async () => [] });
    },
    findOne: async filter => rows.find(r => matches(r, filter)) || null,
    findOneAndUpdate: async (filter, update) => {
      const row = rows.find(r => matches(r, filter));
      if (!row) return null;
      Object.assign(row, update.$set);
      return row;
    },
    updateMany: async (filter, update) => {
      const hit = rows.filter(r => matches(r, filter));
      hit.forEach(r => Object.assign(r, update.$set));
      return { modifiedCount: hit.length };
    }
  };
  const service = load('../src/services/subscription.service.js', {
    '../models/Subscription': Subscription,
    '../models/User': { findOne: () => ({ lean: async () => ({ payment_methods: [] }) }) },
    './notification.service': { notifySubscription: async (sub, type, message) => notifications.push({ type, sub: sub.subscription_id, message }) }
  });

  const now = Date.now();
  const sub = asDoc({
    subscription_id: 'SUB0001', user_id: 'USR1', product_id: 'P1', variant_id: 'SKU1', status: 'active',
    frequency_days: 30, next_charge_at: new Date(now + 20 * DAY), source_order_id: 'OFS-2026-00001',
    pending_changes: {}, suggested_frequency_days: null, suggested_at: null, suggested_by_order_id: null,
    admin_proposal: null, admin_messages: []
  });
  rows.push(sub);
  return { service, sub, notifications };
}

// Real Order model; its hooks call require('../services/subscription.service') at run time,
// which is pointed at the in-memory service for the test.
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const servicePath = require.resolve('../src/services/subscription.service');
const inventoryPath = require.resolve('../src/services/inventory.service');

function oneTimeOrder(status = 'processing') {
  return Order.hydrate({
    _id: '507f1f77bcf86cd799439011', order_id: 'OFS-2026-00042', user_id: 'USR1', order_status: status,
    payment_status: 'paid', payment: { method: 'card' }, stock_reserved: true,
    items: [{ product_id: 'P1', variant_id: 'SKU1', product_name: 'Ceremonial Matcha', quantity: 1, purchase_type: 'one_time' }],
    status_history: []
  });
}

// What order.save() runs, minus the write: pre-save hooks, then post-save hooks.
async function saveHooks(order, storedStatus) {
  const findById = Order.findById;
  Order.findById = () => ({ select: async () => ({ order_status: storedStatus }) });
  try {
    await new Promise((resolve, reject) => Order.schema.s.hooks.execPre('save', order, [{ validateBeforeSave: false }], e => e ? reject(e) : resolve()));
    await new Promise((resolve, reject) => Order.schema.s.hooks.execPost('save', order, [order], e => e ? reject(e) : resolve()));
  } finally {
    Order.findById = findById;
  }
}

test.before(() => {
  require(servicePath);
  require(inventoryPath).releaseItems = async () => {}; // stock is covered by its own tests
  Product.updateOne = async () => ({});
});

function useService(service) {
  require.cache[servicePath].exports = service;
}

test('one-time purchase suggests a shorter cycle; canceling that order withdraws it', async () => {
  const f = fixture();
  useService(f.service);
  const order = oneTimeOrder();

  await f.service.suggestAdjustmentsForOrder(order);
  assert.equal(f.sub.suggested_frequency_days, 14);
  assert.ok(f.sub.suggested_at instanceof Date);
  assert.equal(f.sub.suggested_by_order_id, 'OFS-2026-00042');
  assert.equal(f.notifications[0].type, 'SUBSCRIPTION_ADJUSTED');

  order.order_status = 'canceled';
  await saveHooks(order, 'processing');
  assert.equal(f.sub.suggested_frequency_days, null);
  assert.equal(f.sub.suggested_at, null);
  assert.equal(f.sub.suggested_by_order_id, null);
  assert.equal(f.sub.frequency_days, 30);
});

for (const status of ['pending_refund', 'refund']) {
  test(`order moving to ${status} withdraws its suggestion`, async () => {
    const f = fixture();
    useService(f.service);
    const order = oneTimeOrder(status === 'refund' ? 'pending_refund' : 'delivered');
    await f.service.suggestAdjustmentsForOrder(order);
    order.order_status = status;
    await saveHooks(order, status === 'refund' ? 'pending_refund' : 'delivered');
    assert.equal(f.sub.suggested_frequency_days, null);
  });
}

test('order still valid (e.g. shipped) keeps the suggestion', async () => {
  const f = fixture();
  useService(f.service);
  const order = oneTimeOrder();
  await f.service.suggestAdjustmentsForOrder(order);
  order.order_status = 'shipping';
  await saveHooks(order, 'processing');
  assert.equal(f.sub.suggested_frequency_days, 14);
  assert.equal(f.sub.suggested_by_order_id, 'OFS-2026-00042');
});

test('canceling another order leaves the suggestion alone', async () => {
  const f = fixture();
  useService(f.service);
  await f.service.suggestAdjustmentsForOrder(oneTimeOrder());
  assert.equal(await f.service.withdrawSuggestionsForOrder('OFS-2026-00099'), 0);
  assert.equal(f.sub.suggested_frequency_days, 14);
});

test('accepted adjustment is kept when the order is canceled afterwards', async () => {
  // Accepting is the customer's own decision and has already been applied (shorter frequency,
  // earlier next charge), so a later cancel of the one-time order does not undo it.
  const f = fixture();
  useService(f.service);
  const order = oneTimeOrder();
  await f.service.suggestAdjustmentsForOrder(order);

  await f.service.applyAction('USR1', 'SUB0001', 'accept_adjustment');
  assert.equal(f.sub.frequency_days, 14);
  assert.equal(f.sub.suggested_frequency_days, null);
  assert.equal(f.sub.suggested_at, null);
  assert.equal(f.sub.suggested_by_order_id, null);
  const nextCharge = f.sub.next_charge_at;

  order.order_status = 'canceled';
  await saveHooks(order, 'processing');
  assert.equal(f.sub.frequency_days, 14);
  assert.equal(f.sub.next_charge_at, nextCharge);
});

test('dismissing clears all suggestion fields', async () => {
  const f = fixture();
  useService(f.service);
  await f.service.suggestAdjustmentsForOrder(oneTimeOrder());
  await f.service.applyAction('USR1', 'SUB0001', 'dismiss_adjustment');
  assert.deepEqual(
    [f.sub.suggested_frequency_days, f.sub.suggested_at, f.sub.suggested_by_order_id],
    [null, null, null]
  );
});

test('a failing withdrawal does not fail saving the order', async () => {
  useService({ withdrawSuggestionsForOrder: async () => { throw new Error('db down'); } });
  const order = oneTimeOrder();
  order.order_status = 'canceled';
  const error = console.error; console.error = () => {};
  try {
    await saveHooks(order, 'processing'); // resolves
  } finally { console.error = error; }
  assert.equal(order.order_status, 'canceled');
});
