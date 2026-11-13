const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/subscription-stock-hold.test.js
// Ritual Box: stock is held 3 days (72 units) before next_charge_at and the charge uses exactly
// that stock. Out of stock → SUBSCRIPTION_OUT_OF_STOCK and retried each pass (restock picks up on
// its own); replacement held then charged; 3 units-days after the due date the cycle is skipped.
// Held stock goes back on skip / pause / cancel / suspended / skipped cycle, exactly once.
// subscription.service and subscription-charge.service run for real against in-memory
// Subscriptions, Products (stock), Orders and Users.
const timePath = require.resolve('../src/utils/subscription-time');
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// applyAction checks the 48h lock against the real clock, so the tests run from now.
const NOW = new Date();
const at = ms => new Date(NOW.getTime() + ms);
const P1 = '64b000000000000000000001';
const P2 = '64b000000000000000000002';
const P3 = '64b000000000000000000003';
const clone = v => structuredClone(v);

// Just enough of MongoDB's filter language for these services.
function get(doc, key) { return key.split('.').reduce((v, k) => (v == null ? v : v[k]), doc); }
function eq(a, b) {
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  return a === b || String(a) === String(b);
}
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some(f => matches(doc, f));
    if (key === '$and') return cond.every(f => matches(doc, f));
    const value = get(doc, key);
    if (cond === null) return value == null;
    if (cond instanceof Date || typeof cond !== 'object') return eq(value, cond);
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$ne') return arg === null ? value != null : !eq(value, arg);
      if (op === '$in') return arg.some(a => eq(value, a));
      if (op === '$lte') return value != null && value <= arg;
      if (op === '$gt') return value != null && value > arg;
      if (op === '$gte') return value != null && value >= arg;
      throw new Error(`unsupported ${op}`);
    });
  });
}

function query(rows) {
  const q = {
    then: (ok, ko) => Promise.resolve(rows()).then(ok, ko),
    sort: () => q, limit: () => q, skip: () => q,
    lean: async () => clone(rows().map(r => r.$row || r))
  };
  return q;
}

function world({ stock = { 'SKU-1': 10, 'SKU-2': 10 }, unit } = {}) {
  const subs = [];
  const orders = [];
  const notices = [];
  const calls = { reserve: 0, release: 0 };

  const products = {
    [P1]: { _id: P1, name: 'Ceremonial Matcha', category: 'matcha', is_subscribable: true, is_active: true, images: [], variants: [{ sku: 'SKU-1', label: 'Default', price: 30, images: [] }] },
    [P2]: { _id: P2, name: 'Daily Matcha', category: 'matcha', is_subscribable: true, is_active: true, subscribe_discount_percent: 10, images: [], variants: [{ sku: 'SKU-2', label: 'Default', price: 28, images: [] }] },
    // Only in stock when a test gives SKU-3 stock.
    [P3]: { _id: P3, name: 'Reserve Matcha', category: 'matcha', is_subscribable: true, is_active: true, subscribe_discount_percent: 10, images: [], variants: [{ sku: 'SKU-3', label: 'Default', price: 40, images: [] }] }
  };
  const withStock = p => p && { ...clone(p), variants: p.variants.map(v => ({ ...clone(v), stock: stock[v.sku] })) };

  const toDoc = row => {
    const doc = clone(row);
    Object.defineProperty(doc, 'save', { value: async () => { Object.assign(row, clone({ ...doc })); return doc; } });
    Object.defineProperty(doc, 'toObject', { value: () => clone({ ...doc }) });
    return doc;
  };
  const apply = (row, update) => {
    Object.assign(row, clone(update.$set || {}));
    for (const [k, v] of Object.entries(update.$push || {})) row[k] = [...(row[k] || []), clone(v)];
  };
  const Subscription = {
    find: (filter = {}) => query(() => subs.filter(r => matches(r, filter)).map(toDoc)),
    findOne: (filter) => { const r = subs.find(s => matches(s, filter)); return Object.assign(Promise.resolve(r ? toDoc(r) : null), { lean: async () => r ? clone(r) : null }); },
    findById: (id) => { const r = subs.find(s => s._id === id); return Object.assign(Promise.resolve(r ? toDoc(r) : null), { lean: async () => r ? clone(r) : null }); },
    findOneAndUpdate: async (filter, update, opts = {}) => {
      const row = subs.find(s => matches(s, filter));
      if (!row) return null;
      const before = clone(row);
      apply(row, update);
      return opts.new ? toDoc(row) : before;
    },
    updateOne: async (filter, update) => {
      const row = subs.find(s => matches(s, filter));
      if (!row) return { modifiedCount: 0 };
      apply(row, update);
      return { modifiedCount: 1 };
    },
    updateMany: async () => ({ modifiedCount: 0 }),
    aggregate: async () => []
  };

  function Order(data) { Object.assign(this, clone(data)); }
  Order.prototype.save = async function () { this.order_id = `OFS-2026-${String(orders.length + 1).padStart(5, '0')}`; this.created_at = new Date(); orders.push(this); return this; };
  Order.exists = async () => null;
  Order.countDocuments = async (f) => orders.filter(o => o.subscription_id === f.subscription_id).length;
  Order.findOne = () => ({ lean: async () => null });
  Order.find = () => query(() => []);

  const Product = {
    findById: (id) => ({ lean: async () => withStock(products[id]) }),
    findOne: () => ({ lean: async () => null }),
    find: (filter) => ({ lean: async () => Object.values(products).map(withStock).filter(p => p._id !== filter._id?.$ne && p.category === filter.category && p.variants.some(v => v.stock > 0)) })
  };

  const inventory = {
    reserveItems: async (items) => {
      calls.reserve++;
      for (const l of items) if ((stock[l.variant_id] ?? 0) < l.quantity) return { ok: false, failed: l };
      for (const l of items) stock[l.variant_id] -= l.quantity;
      return { ok: true };
    },
    releaseItems: async (items) => { calls.release++; for (const l of items) stock[l.variant_id] += l.quantity; }
  };
  const notificationService = { notifySubscription: async (sub, type, message) => notices.push({ type, sub: sub.subscription_id, message }) };
  const cards = [{ _id: 'CARD1', card_type: 'VISA', card_number: '4111111111111111', expire_date: '12/40', cardholder_name: 'A' }];
  const User = { findOne: () => ({ lean: async () => ({ payment_methods: clone(cards) }) }) };

  const previous = process.env.SUB_TIME_UNIT;
  if (unit) process.env.SUB_TIME_UNIT = unit; else delete process.env.SUB_TIME_UNIT;
  delete require.cache[timePath];
  let service, job;
  try {
    service = load('../src/services/subscription.service.js', {
      '../models/Subscription': Subscription, '../models/Product': Product, '../models/Order': Order, '../models/User': User,
      './notification.service': notificationService, './inventory.service': inventory
    });
    job = load('../src/services/subscription-charge.service.js', {
      '../models/Subscription': Subscription, '../models/Order': Order,
      './notification.service': notificationService, './subscription.service': service
    });
  } finally {
    if (previous === undefined) delete process.env.SUB_TIME_UNIT; else process.env.SUB_TIME_UNIT = previous;
    delete require.cache[timePath];
  }

  const addBox = (extra = {}) => {
    const row = {
      _id: `S${subs.length + 1}`, subscription_id: `SUB${subs.length + 1}`, user_id: 'USR1', product_id: P1, variant_id: 'SKU-1',
      quantity: 2, frequency_days: 14, next_charge_at: at(2 * DAY), status: 'active',
      pricing_snapshot: { original_price: 30, subscribe_price: 27, discount_percent: 10 }, payment_method_id: 'CARD1',
      delivery_info: { recipient_name: 'Mai', mobile: '0900', city: 'HCM', address: '1 St' }, shipping_method: 'standard',
      consecutive_skips: 0, skipped_deliveries: [], pending_changes: {}, admin_messages: [], failed_attempts: 0,
      last_failure_reason: null, last_failed_at: null, next_retry_at: null, charge_locked_until: null,
      upcoming_notified_for: null, reserved_for: null, reserved_items: [], replacement_offer: null, admin_proposal: null,
      suggested_frequency_days: null, suggested_at: null, ...extra
    };
    subs.push(row);
    return row;
  };
  const run = (now) => job.runSubscriptionChargeJob({ now });
  const types = () => notices.map(n => n.type);
  return { service, job, subs, orders, notices, calls, stock, cards, addBox, run, types };
}

test('held 3 days ahead: stock taken once for the next cycle, SUBSCRIPTION_UPCOMING once; idempotent', async () => {
  const w = world();
  const box = w.addBox();                                  // charges in 2 days
  const later = w.addBox({ next_charge_at: at(4 * DAY) }); // outside the 3-day window
  await w.run(NOW);
  assert.equal(w.stock['SKU-1'], 8);
  assert.equal(+box.reserved_for, +box.next_charge_at);
  assert.deepEqual(box.reserved_items, [{ product_id: P1, variant_id: 'SKU-1', quantity: 2 }]);
  assert.equal(later.reserved_for, null);
  assert.deepEqual(w.types(), ['SUBSCRIPTION_UPCOMING']);

  await w.run(at(HOUR));
  await w.run(at(2 * HOUR));
  assert.equal(w.stock['SKU-1'], 8);                       // not held again
  assert.equal(w.calls.reserve, 1);
  assert.deepEqual(w.types(), ['SUBSCRIPTION_UPCOMING']);
});

test('charge uses the held stock: no second subtraction, no stock re-check', async () => {
  const w = world();
  const box = w.addBox();
  await w.run(NOW);
  w.stock['SKU-1'] = 0;                                     // everything else sold since
  await w.run(box.next_charge_at);
  assert.equal(w.orders.length, 1);
  const [order] = w.orders;
  assert.equal(order.stock_reserved, true);
  assert.equal(order.items[0].quantity, 2);
  assert.equal(order.items[0].variant_id, 'SKU-1');
  assert.equal(w.stock['SKU-1'], 0);
  assert.equal(w.calls.reserve, 1);                        // only the hold 3 days ahead
  assert.equal(box.reserved_for, null);
  assert.deepEqual(box.reserved_items, []);
  assert.equal(+box.next_charge_at, +at(2 * DAY + 14 * DAY));
});

test('not enough stock: OUT_OF_STOCK once with the replacement, on the admin to-do; QLSP restocks → held and charged', async () => {
  const w = world({ stock: { 'SKU-1': 1, 'SKU-2': 10 } });
  const box = w.addBox();
  await w.run(NOW);
  assert.equal(box.reserved_for, null);
  assert.equal(box.last_failure_reason, 'out_of_stock');   // drives "Ritual Box charging soon · out of stock"
  assert.deepEqual(w.types(), ['SUBSCRIPTION_OUT_OF_STOCK']);
  assert.match(w.notices[0].message, /Daily Matcha/);
  assert.equal(w.stock['SKU-1'], 1);

  await w.run(at(HOUR));
  assert.deepEqual(w.types(), ['SUBSCRIPTION_OUT_OF_STOCK']); // retried, not re-notified

  w.stock['SKU-1'] = 5;                                    // QLSP restocks
  await w.run(at(2 * HOUR));
  assert.equal(+box.reserved_for, +box.next_charge_at);
  assert.equal(box.last_failure_reason, null);
  assert.equal(w.stock['SKU-1'], 3);
  assert.deepEqual(w.types(), ['SUBSCRIPTION_OUT_OF_STOCK', 'SUBSCRIPTION_UPCOMING']);

  await w.run(box.next_charge_at);
  assert.equal(w.orders.length, 1);
  assert.equal(w.stock['SKU-1'], 3);
});

test('restocked after the due date (within 3 days): held and charged in the same pass', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 0 } });
  const box = w.addBox({ next_charge_at: at(-DAY) });
  await w.run(NOW);
  assert.equal(w.orders.length, 0);
  w.stock['SKU-1'] = 2;
  await w.run(at(HOUR));
  assert.equal(w.orders.length, 1);
  assert.equal(w.stock['SKU-1'], 0);
  assert.equal(box.reserved_for, null);
});

test('still not held 3 days after the due date: cycle skipped, not charged, stock untouched, skip limit untouched', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 0 } });
  const due = at(-3 * DAY);
  const box = w.addBox({ next_charge_at: due, consecutive_skips: 1, last_failure_reason: 'out_of_stock' });
  await w.run(NOW);
  assert.equal(w.orders.length, 0);
  assert.equal(box.skipped_deliveries.length, 1);
  assert.equal(+box.next_charge_at, +at(-3 * DAY + 14 * DAY));
  assert.equal(box.consecutive_skips, 1);
  assert.equal(box.last_failure_reason, null);
  assert.ok(w.types().includes('SUBSCRIPTION_SKIPPED'));
  assert.equal(w.calls.release, 0);
});

test('a hold left on a skipped cycle goes back when the cycle is skipped', async () => {
  const w = world();
  const box = w.addBox({ next_charge_at: at(-3 * DAY) });
  await w.service.reserveForCycle(box);                    // held for the old cycle…
  assert.equal(w.stock['SKU-1'], 8);
  // …but the charge itself keeps failing on stock (product gone from the shelf meanwhile).
  const charge = async () => ({ ok: false, reason: 'out_of_stock' });
  await w.job.runSubscriptionChargeJob({ now: NOW, charge });
  assert.equal(box.skipped_deliveries.length, 1);
  assert.equal(w.stock['SKU-1'], 10);
  assert.equal(box.reserved_for, null);
});

test('replacement is for that delivery only: held, charged at its own price, then the box goes back to its item', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 5 } });
  const box = w.addBox({ next_charge_at: at(-DAY) });
  await w.run(NOW);
  assert.equal(box.last_failure_reason, 'out_of_stock');

  await w.service.applyAction('USR1', box.subscription_id, 'use_replacement', { product_id: P2, variant_id: 'SKU-2' });
  assert.equal(box.product_id, P1);                        // the box keeps its own item
  assert.equal(box.variant_id, 'SKU-1');
  assert.equal(box.cycle_replacement.product_id, P2);
  assert.equal(w.stock['SKU-2'], 3);
  assert.deepEqual(box.reserved_items, [{ product_id: P2, variant_id: 'SKU-2', quantity: 2 }]);
  assert.equal(box.last_failure_reason, null);

  await w.run(at(HOUR));
  assert.equal(w.orders.length, 1);
  assert.equal(w.orders[0].items[0].variant_id, 'SKU-2');
  assert.equal(w.orders[0].items[0].unit_price, 25.2);     // 28 with Daily Matcha's 10% off
  assert.equal(w.stock['SKU-2'], 3);                       // not taken twice
  assert.equal(box.cycle_replacement, null);
  assert.equal(box.last_replacement.product_id, P2);       // offered as "switch for good"
  assert.equal(box.product_id, P1);
  assert.deepEqual(box.pricing_snapshot, { original_price: 30, subscribe_price: 27, discount_percent: 10 });

  // Next cycle: the box's own item again (restocked → held and charged as usual).
  w.stock['SKU-1'] = 10;
  await w.run(box.next_charge_at);
  assert.equal(w.orders.length, 2);
  assert.equal(w.orders[1].items[0].variant_id, 'SKU-1');
  assert.equal(box.last_replacement, null);
});

test('several replacements offered, closest price first; a dearer one is charged at its price', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 5, 'SKU-3': 5 } });
  const box = w.addBox({ next_charge_at: at(-DAY) });
  const data = await w.service.getRitualBox('USR1');
  const [shaped] = data.subscriptions;
  assert.equal(shaped.out_of_stock, true);
  assert.deepEqual(shaped.replacement_options.map(o => o.variant_id), ['SKU-2', 'SKU-3']);
  assert.equal(shaped.replacement_options[0].difference, -3.6); // 2 × 25.20 vs 2 × 27
  assert.equal(shaped.replacement_options[1].difference, 18);   // 2 × 36 vs 2 × 27

  await w.service.applyAction('USR1', box.subscription_id, 'use_replacement', { product_id: P3, variant_id: 'SKU-3' });
  await w.run(at(HOUR));
  assert.equal(w.orders[0].items[0].variant_id, 'SKU-3');
  assert.equal(w.orders[0].pricing.total, 72);
  assert.equal(box.product_id, P1);
});

test('an item that is not among the options is refused', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 1 } });  // 1 left, the box needs 2
  const box = w.addBox({ next_charge_at: at(-DAY) });
  await assert.rejects(
    w.service.applyAction('USR1', box.subscription_id, 'use_replacement', { product_id: P2, variant_id: 'SKU-2' }),
    /not available/
  );
  assert.equal(box.product_id, P1);
  assert.equal(box.cycle_replacement ?? null, null);
  assert.equal(w.stock['SKU-2'], 1);
});

test('permanent: true switches the box for good at the new item\'s price', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 5 } });
  const box = w.addBox({ next_charge_at: at(-DAY) });
  await w.service.applyAction('USR1', box.subscription_id, 'use_replacement', { product_id: P2, variant_id: 'SKU-2', permanent: true });
  assert.equal(box.product_id, P2);
  assert.equal(box.variant_id, 'SKU-2');
  assert.deepEqual(box.pricing_snapshot, { original_price: 28, subscribe_price: 25.2, discount_percent: 10 });
  assert.equal(box.cycle_replacement, null);
  assert.deepEqual(box.reserved_items, [{ product_id: P2, variant_id: 'SKU-2', quantity: 2 }]);
});

test('after a replacement delivery the customer can switch the box to it, or keep the original', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 10 } });
  const box = w.addBox({ next_charge_at: at(-DAY) });
  await w.service.applyAction('USR1', box.subscription_id, 'use_replacement', { product_id: P2, variant_id: 'SKU-2' });
  await w.run(at(HOUR));

  let [shaped] = (await w.service.getRitualBox('USR1')).subscriptions;
  assert.equal(shaped.switch_offer.product_id, P2);
  assert.equal(shaped.switch_offer.total, 50.4);

  await w.service.applyAction('USR1', box.subscription_id, 'switch_item');
  assert.equal(box.product_id, P2);
  assert.equal(box.pricing_snapshot.subscribe_price, 25.2);
  assert.equal(box.last_replacement, null);
  [shaped] = (await w.service.getRitualBox('USR1')).subscriptions;
  assert.equal(shaped.switch_offer, null);

  // Second box: the customer keeps the original instead.
  const other = w.addBox({ next_charge_at: at(-DAY) });
  await w.service.applyAction('USR1', other.subscription_id, 'use_replacement', { product_id: P2, variant_id: 'SKU-2' });
  await w.run(at(2 * HOUR));
  assert.equal(other.last_replacement.product_id, P2);
  await w.service.applyAction('USR1', other.subscription_id, 'dismiss_switch');
  assert.equal(other.last_replacement, null);
  assert.equal(other.product_id, P1);
});

test('skipping the cycle drops the one-time replacement and gives its stock back', async () => {
  const w = world({ stock: { 'SKU-1': 0, 'SKU-2': 5 } });
  const box = w.addBox({ next_charge_at: at(60 * HOUR) });  // outside the 48h lock
  await w.service.applyAction('USR1', box.subscription_id, 'use_replacement', { product_id: P2, variant_id: 'SKU-2' });
  assert.equal(w.stock['SKU-2'], 3);
  await w.service.applyAction('USR1', box.subscription_id, 'skip');
  assert.equal(w.stock['SKU-2'], 5);
  assert.equal(box.reserved_for, null);
  assert.equal(w.service.cycleItem(box).replacement, false);  // next cycle: the box's own item
});

for (const [action, payload, check] of [
  ['skip', {}, box => assert.equal(box.skipped_deliveries.length, 1)],
  ['pause', { pause_option: '1_month' }, box => assert.equal(box.status, 'paused')],
  ['cancel', {}, box => assert.equal(box.status, 'cancelled')]
]) {
  test(`customer ${action}s the held cycle: the stock goes back (once)`, async () => {
    const w = world();
    const box = w.addBox({ next_charge_at: at(60 * HOUR) }); // held, but outside the 48h lock
    await w.run(NOW);
    assert.equal(w.stock['SKU-1'], 8);
    await w.service.applyAction('USR1', box.subscription_id, action, payload);
    check(box);
    assert.equal(w.stock['SKU-1'], 10);
    assert.equal(box.reserved_for, null);
    // Released again (job cleanup, second request): nothing more goes back.
    await w.service.releaseReservation(box);
    await w.run(at(HOUR));
    assert.equal(w.stock['SKU-1'], 10);
    assert.equal(w.calls.release, 1);
  });
}

test('inside the 48h lock a skip waits for after the charge, so the hold stays and is charged', async () => {
  const w = world();
  const box = w.addBox({ next_charge_at: at(24 * HOUR) });
  await w.run(NOW);
  await w.service.applyAction('USR1', box.subscription_id, 'skip');
  assert.equal(box.pending_changes.skip, true);
  assert.equal(w.stock['SKU-1'], 8);
  await w.run(box.next_charge_at);
  assert.equal(w.orders.length, 1);
  assert.equal(w.stock['SKU-1'], 8);
});

test('charge error with retries left keeps the hold; suspended after the last retry puts it back', async () => {
  const w = world();
  const box = w.addBox({ next_charge_at: at(-HOUR) });
  await w.service.reserveForCycle(box);
  const charge = async () => { throw new Error('gateway timeout'); };
  await w.job.runSubscriptionChargeJob({ now: NOW, charge });
  assert.equal(box.failed_attempts, 1);
  assert.equal(box.status, 'active');
  assert.equal(w.stock['SKU-1'], 8);
  assert.equal(+box.reserved_for, +box.next_charge_at);

  box.failed_attempts = 3;
  box.next_retry_at = null;
  await w.job.runSubscriptionChargeJob({ now: at(HOUR), charge });
  assert.equal(box.status, 'suspended');
  assert.equal(w.stock['SKU-1'], 10);
  assert.equal(box.reserved_for, null);
});

test('order save failing during the charge keeps the hold for the retry', async () => {
  const w = world();
  const box = w.addBox({ next_charge_at: at(-HOUR) });
  await w.service.reserveForCycle(box);
  const sub = { ...structuredClone(box), save: async () => {} };
  const realSave = w.orders.push;
  w.orders.push = () => { throw new Error('write conflict'); };
  await assert.rejects(w.service.chargeSubscription(sub, { now: NOW }), /write conflict/);
  w.orders.push = realSave;
  assert.equal(+box.reserved_for, +box.next_charge_at);
  assert.equal(w.stock['SKU-1'], 8);
});

test('card expired at charge time → payment_failed puts the held stock back; reactivating holds and charges again', async () => {
  const w = world();
  const box = w.addBox();
  await w.run(NOW);
  assert.equal(w.stock['SKU-1'], 8);
  w.cards[0].expire_date = '01/20';
  await w.run(box.next_charge_at);
  assert.equal(box.status, 'payment_failed');
  assert.equal(w.orders.length, 0);
  assert.equal(w.stock['SKU-1'], 10);
  assert.equal(box.reserved_for, null);
  await w.run(new Date(box.next_charge_at.getTime() + HOUR)); // job cleanup: nothing more goes back
  assert.equal(w.stock['SKU-1'], 10);
  assert.equal(w.calls.release, 1);

  w.cards.push({ _id: 'CARD2', card_type: 'VISA', card_number: '4111111111112222', expire_date: '12/40', cardholder_name: 'A' });
  await w.service.applyAction('USR1', box.subscription_id, 'payment_method', { payment_method_id: 'CARD2' });
  assert.equal(box.status, 'active');
  assert.equal(w.orders.length, 1);
  assert.equal(w.stock['SKU-1'], 8);
});

test('demo mode (SUB_TIME_UNIT=minute): the 3-day hold window is 72 minutes', async () => {
  const w = world({ unit: 'minute' });
  const inside = w.addBox({ next_charge_at: at(71 * 60 * 1000) });
  const outside = w.addBox({ next_charge_at: at(73 * 60 * 1000) });
  await w.run(NOW);
  assert.ok(inside.reserved_for);
  assert.equal(outside.reserved_for, null);
});
