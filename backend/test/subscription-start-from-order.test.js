const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/subscription-start-from-order.test.js
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const PRODUCT_ID = '507f1f77bcf86cd799439011';
const CARD_ID = '65a000000000000000000001';
const FAILED_AT = new Date('2026-10-30T08:00:00Z');

const lean = value => ({ lean: async () => value, then: (ok, ko) => Promise.resolve(value).then(ok, ko) });
const sameLine = (a, b) => a.source_order_id === b.source_order_id && a.product_id === b.product_id && a.variant_id === b.variant_id;

function fixture({ uniqueIndex = true, saveError = null } = {}) {
  const order = {
    _id: 'O1', order_id: 'OFS-2026-00042', user_id: 'USR1', is_guest: false,
    order_status: 'processing', payment_status: 'paid',
    subscription_start_failed: true, subscription_start_failed_at: FAILED_AT,
    subscription_payment_method_id: 'old-card', internal_notes: 'Ritual Box not started: …',
    delivery_info: { name: 'A' }, shipping: { method: 'standard' },
    items: [{ product_id: PRODUCT_ID, variant_id: 'SKU1', quantity: 1, unit_price: 20, purchase_type: 'subscription', subscription_frequency_days: 14 }]
  };
  const subs = [];
  let nextId = 1;

  const Order = {
    findOneAndUpdate: async (filter, update) => {
      await tick();
      // Atomic match-and-write, like MongoDB.
      const hit = order.order_id === filter.order_id && order.user_id === filter.user_id &&
        order.subscription_start_failed === filter.subscription_start_failed &&
        order.payment_status === filter.payment_status && !filter.order_status.$nin.includes(order.order_status);
      if (!hit) return null;
      const before = structuredClone(order);
      Object.assign(order, update.$set);
      return before;
    },
    findOne: (filter) => lean(filter.order_id === order.order_id && (!filter.user_id || filter.user_id === order.user_id) ? { ...order } : null),
    updateOne: async (filter, update) => {
      await tick();
      const hit = filter.order_id === order.order_id &&
        (filter.subscription_start_failed === undefined || filter.subscription_start_failed === order.subscription_start_failed);
      if (hit) Object.assign(order, update.$set);
      return { modifiedCount: hit ? 1 : 0 };
    }
  };

  function Subscription(data) { Object.assign(this, data); }
  Subscription.prototype.save = async function () {
    await tick(); // both requests have passed the exists() check by now
    if (saveError) throw saveError;
    if (uniqueIndex && subs.some(s => sameLine(s, this))) {
      throw Object.assign(new Error('E11000 duplicate key error index: source_order_id_1_product_id_1_variant_id_1'),
        { code: 11000, keyPattern: { source_order_id: 1, product_id: 1, variant_id: 1 } });
    }
    this.subscription_id = `SUB${String(nextId++).padStart(4, '0')}`;
    subs.push(this);
    return this;
  };
  Subscription.exists = async filter => subs.some(s => Object.entries(filter).every(([k, v]) => s[k] === v));
  Subscription.findOne = async filter => subs.find(s => sameLine(s, filter)) || null;
  Subscription.find = filter => ({ sort: () => ({ lean: async () => subs.filter(s => s.source_order_id === filter.source_order_id) }) });

  const cards = [{ _id: CARD_ID, card_type: 'VISA', expire_date: '12/30' }];
  const service = load('../src/services/subscription.service.js', {
    '../models/Order': Order,
    '../models/Subscription': Subscription,
    '../models/User': { findOne: () => lean({ user_id: 'USR1', payment_methods: cards }) },
    '../models/Product': {
      findById: () => lean({ _id: PRODUCT_ID, name: 'Ceremonial Matcha', is_subscribable: true, subscribe_discount_percent: 10, variants: [{ sku: 'SKU1', price: 20, label: 'Default' }], images: [] }),
      findOne: () => lean(null)
    },
    './notification.service': { notifySubscription: async () => {} }
  });
  return { service, order, subs, cards };
}

test('two concurrent starts create exactly one Ritual Box; the other gets 409', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.service.startFromOrder('USR1', f.order.order_id, CARD_ID),
    f.service.startFromOrder('USR1', f.order.order_id, CARD_ID)
  ]);
  const ok = results.filter(r => r.status === 'fulfilled');
  const failed = results.filter(r => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.status, 409);
  assert.equal(failed[0].reason.message, 'The Ritual Box of this order has already started.');

  assert.equal(f.subs.length, 1);
  assert.equal(ok[0].value.order_id, f.order.order_id);
  assert.equal(ok[0].value.subscriptions.length, 1);
  assert.equal(f.order.subscription_start_failed, false);
  assert.equal(f.order.subscription_start_failed_at, null);
  assert.equal(f.order.subscription_payment_method_id, CARD_ID);
  assert.match(f.order.internal_notes, /Ritual Box started by the customer from the order\./);
});

test('a bad card puts the flag (and its original time) back so the customer can retry', async () => {
  const f = fixture();
  await assert.rejects(f.service.startFromOrder('USR1', f.order.order_id, 'not-a-saved-card'), { status: 400 });
  assert.equal(f.subs.length, 0);
  assert.equal(f.order.subscription_start_failed, true);
  assert.deepEqual(f.order.subscription_start_failed_at, FAILED_AT);
  assert.equal(f.order.subscription_payment_method_id, 'old-card');

  await f.service.startFromOrder('USR1', f.order.order_id, CARD_ID); // retry works
  assert.equal(f.subs.length, 1);
});

test('no box created at all is treated as a failure and the flag is restored', async () => {
  const f = fixture();
  f.order.items = [{ ...f.order.items[0], purchase_type: 'one_time' }]; // no subscription lines left
  await assert.rejects(f.service.startFromOrder('USR1', f.order.order_id, CARD_ID), { status: 409 });
  assert.equal(f.order.subscription_start_failed, true);
  assert.deepEqual(f.order.subscription_start_failed_at, FAILED_AT);
});

test('existing error responses are unchanged', async () => {
  const f = fixture();
  await assert.rejects(f.service.startFromOrder('USR1', 'OFS-NOPE', CARD_ID), { status: 404, message: 'Order not found.' });
  await assert.rejects(f.service.startFromOrder('USR2', f.order.order_id, CARD_ID), { status: 404 });
  await assert.rejects(f.service.startFromOrder('USR1', f.order.order_id, null), { message: 'Choose a card for your Ritual Box.' });
  f.order.order_status = 'pending_refund';
  await assert.rejects(f.service.startFromOrder('USR1', f.order.order_id, CARD_ID),
    { status: 409, message: 'This order can no longer start a Ritual Box.' });
  assert.equal(f.order.subscription_start_failed, true); // a refused request never touches the flag
});

test('unique index: concurrent creates for the same line return the existing box', async () => {
  const f = fixture();
  const order = { ...f.order };
  const [a, b] = await Promise.all([
    f.service.createSubscriptionsFromOrder(order, { paymentMethodId: CARD_ID }),
    f.service.createSubscriptionsFromOrder(order, { paymentMethodId: CARD_ID })
  ]);
  assert.equal(f.subs.length, 1);
  assert.equal(a[0], f.subs[0]);
  assert.equal(b[0], f.subs[0]);
});

test('other duplicate-key errors (e.g. subscription_id) are not swallowed', async () => {
  const f = fixture({ saveError: Object.assign(new Error('E11000 duplicate key error index: subscription_id_1'), { code: 11000, keyPattern: { subscription_id: 1 } }) });
  await assert.rejects(f.service.createSubscriptionsFromOrder({ ...f.order }, { paymentMethodId: CARD_ID }), { code: 11000 });
  assert.equal(f.subs.length, 0);
});
