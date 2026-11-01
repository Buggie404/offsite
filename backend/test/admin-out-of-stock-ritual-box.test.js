const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/admin-out-of-stock-ritual-box.test.js
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const lean = value => Object.assign(Promise.resolve(value), { lean: async () => value, sort: () => ({ lean: async () => value }) });
const clone = value => structuredClone(value);
const CHARGED_AT = new Date('2026-10-28T03:00:00Z');
const NEXT_CHARGE = new Date('2026-11-11T03:00:00Z');

function orderDoc(extra = {}) {
  return {
    _id: 'O1', order_id: 'OFS-2026-00077', user_id: 'USR1', order_status: 'processing', payment_status: 'paid',
    created_at: CHARGED_AT, internal_notes: '', status_history: [],
    items: [{ product_id: '12', variant_id: 'SKU-12', product_name: 'Ceremonial Matcha', variant_name: 'Default', quantity: 1, unit_price: 20, subtotal: 20, image: { url: 'x' } }],
    pricing: { total: 20 }, payment: { method: 'card' }, delivery_info: { recipient_name: 'Mai' }, shipping: { method: 'standard' },
    saved: 0,
    async save() { this.saved++; return this; },
    ...extra
  };
}

function fixture(order) {
  const sub = {
    subscription_id: 'SUB0007', user_id: 'USR1', product_id: '12', variant_id: 'SKU-12', quantity: 1, status: 'active',
    frequency_days: 14, next_charge_at: NEXT_CHARGE, consecutive_skips: 1, skipped_deliveries: [], admin_messages: [],
    pricing_snapshot: { subscribe_price: 18, discount_percent: 10 }
  };
  const store = { sub };
  const notifications = [];
  const Subscription = {
    findOne: () => lean(clone(store.sub)),
    findOneAndUpdate: async (filter, update) => {
      if (filter.subscription_id !== store.sub.subscription_id) return null;
      if (store.sub.skipped_deliveries.some(d => d.getTime() === filter.skipped_deliveries.$ne.getTime())) return null;
      for (const [key, value] of Object.entries(update.$push)) store.sub[key].push(value);
      return clone(store.sub);
    },
    find: () => ({ sort: () => ({ lean: async () => [] }) })
  };
  const notificationService = {
    notifySubscription: async (target, type, message) => notifications.push({ kind: 'subscription', type, target, message }),
    createNotification: async (n) => notifications.push({ kind: 'order', type: n.type, target: n })
  };
  const subscriptionService = load('../src/services/subscription.service.js', {
    '../models/Subscription': Subscription,
    '../models/Product': { findById: () => lean(null), findOne: () => lean({ name: 'Ceremonial Matcha', variants: [{ sku: 'SKU-12', label: 'Default' }], images: [] }) },
    './notification.service': notificationService
  });
  const api = load('../src/controllers/admin.controller.js', {
    '../models/Order': { findOne: async () => order },
    '../models/RefundRequest': { findOne: () => ({ sort: () => ({ lean: async () => null }) }) },
    '../services/subscription.service': subscriptionService,
    '../services/notification.service': notificationService,
    '../services/socket.service': { emitOrderUpdated: () => {} }
  });
  return { api, store, notifications };
}

async function markOutOfStock(api, order, reason) {
  const logs = [];
  const req = {
    params: { id: order.order_id },
    body: { items: [{ product_id: '12', variant_id: 'SKU-12' }], ...(reason ? { reason } : {}) },
    user: { user_id: 'ADM1', role: 'qlsp' },
    writeActivityLog: async (entry) => logs.push(entry)
  };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await api.markItemsOutOfStock(req, res);
  return { res, logs };
}

test('Ritual Box delivery order: cancelled + refunded, box stays active, cycle recorded as skipped', async () => {
  const order = orderDoc({ subscription_id: 'SUB0007', subscription_cycle: 3 });
  const f = fixture(order);
  const { res, logs } = await markOutOfStock(f.api, order, 'Supplier delayed the matcha batch');

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(order.order_status, 'canceled');
  assert.equal(order.payment_status, 'refunded');
  assert.equal(order.items[0].out_of_stock, true);

  // Box: still active, next charge untouched, one skipped delivery for this cycle,
  // consecutive_skips untouched (system skips don't count toward the customer's limit).
  assert.equal(f.store.sub.status, 'active');
  assert.equal(f.store.sub.next_charge_at.getTime(), NEXT_CHARGE.getTime());
  assert.deepEqual(f.store.sub.skipped_deliveries.map(d => d.getTime()), [CHARGED_AT.getTime()]);
  assert.equal(f.store.sub.consecutive_skips, 1);
  assert.equal(f.store.sub.admin_messages.length, 1);
  assert.equal(f.store.sub.admin_messages[0].action, 'skip');
  assert.equal(f.store.sub.admin_messages[0].sent_by, 'ADM1');

  // Customer: the order cancellation (as before) and a Ritual Box "skipped" notice linked to the order.
  assert.deepEqual(f.notifications.map(n => n.type), ['ORDER_CANCELED_BY_STORE', 'SUBSCRIPTION_SKIPPED']);
  const skipped = f.notifications[1];
  assert.equal(skipped.target.subscription_id, 'SUB0007');
  assert.equal(skipped.target.order_id, 'OFS-2026-00077');
  assert.match(skipped.message, /refunded your payment in full/);
  assert.match(skipped.message, /next box is scheduled/);

  // Activity log: the order action (as before) + subscription.skip with the cancel reason.
  assert.deepEqual(logs.map(l => l.actionType), ['order.mark-out-of-stock', 'subscription.skip']);
  const subLog = logs[1];
  assert.equal(subLog.targetEntity, 'Subscriptions');
  assert.equal(subLog.targetId, 'SUB0007');
  assert.equal(subLog.reason, 'Supplier delayed the matcha batch');
  assert.equal(subLog.oldValue.skipped_deliveries.length, 0);
  assert.equal(subLog.newValue.skipped_deliveries.length, 1);
});

test('the same cycle is never recorded twice', async () => {
  const order = orderDoc({ subscription_id: 'SUB0007' });
  const f = fixture(order);
  const svc = load('../src/services/subscription.service.js', {
    '../models/Subscription': {
      findOne: () => lean(clone(f.store.sub)),
      findOneAndUpdate: async () => null // already recorded
    },
    './notification.service': { notifySubscription: async () => assert.fail('no second notice') }
  });
  assert.equal(await svc.skipCycleForCanceledOrder(order, { adminId: 'ADM1', reason: 'x' }), null);
});

test('regular one-time order: behaviour unchanged, no Ritual Box side effects', async () => {
  const order = orderDoc();
  const f = fixture(order);
  const { res, logs } = await markOutOfStock(f.api, order);

  assert.equal(res.statusCode, 200);
  assert.equal(order.order_status, 'canceled');
  assert.equal(order.payment_status, 'refunded');
  assert.deepEqual(logs.map(l => l.actionType), ['order.mark-out-of-stock']);
  assert.equal(logs[0].reason, 'Out of stock: Ceremonial Matcha');
  assert.deepEqual(f.notifications.map(n => n.type), ['ORDER_CANCELED_BY_STORE']);
  assert.equal(f.store.sub.skipped_deliveries.length, 0);
  assert.equal(f.store.sub.admin_messages.length, 0);
});

test('a failure recording the skip does not fail the (already saved) cancellation', async () => {
  const order = orderDoc({ subscription_id: 'SUB0007' });
  const notificationService = { notifySubscription: async () => {}, createNotification: async () => {} };
  const api = load('../src/controllers/admin.controller.js', {
    '../models/Order': { findOne: async () => order },
    '../models/RefundRequest': { findOne: () => ({ sort: () => ({ lean: async () => null }) }) },
    '../services/subscription.service': {
      skipCycleForCanceledOrder: async () => { throw new Error('db down'); },
      getOrderRitualBoxes: async () => []
    },
    '../services/notification.service': notificationService,
    '../services/socket.service': { emitOrderUpdated: () => {} }
  });
  const error = console.error; console.error = () => {};
  try {
    const { res } = await markOutOfStock(api, order);
    assert.equal(res.statusCode, 200);
    assert.equal(order.order_status, 'canceled');
  } finally { console.error = error; }
});
