const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/subscription-cycle-time.test.js
// Services are loaded with a given SUB_TIME_UNIT (the time base is read when the module loads).
const timePath = require.resolve('../src/utils/subscription-time');

function load(relative, mocks = {}, unit = undefined) {
  const previous = process.env.SUB_TIME_UNIT;
  if (unit === undefined) delete process.env.SUB_TIME_UNIT; else process.env.SUB_TIME_UNIT = unit;
  delete require.cache[timePath];
  try {
    const filename = path.resolve(__dirname, relative);
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
    run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
    return module.exports;
  } finally {
    if (previous === undefined) delete process.env.SUB_TIME_UNIT; else process.env.SUB_TIME_UNIT = previous;
    delete require.cache[timePath];
  }
}

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const NOW = new Date('2026-11-01T09:00:00Z');
const lean = value => ({ lean: async () => value });

// chargeSubscription with a saved card and stock, no database.
function chargeFixture(unit) {
  function Order(data) { Object.assign(this, data); }
  Order.prototype.save = async function () { return this; };
  Order.exists = async () => null;
  Order.countDocuments = async () => 0;
  const service = load('../src/services/subscription.service.js', {
    '../models/User': { findOne: () => lean({ payment_methods: [{ _id: 'CARD1', card_type: 'VISA', card_number: '4111111111111111', expire_date: '12/40' }] }) },
    '../models/Product': { findById: () => lean({ name: 'Matcha', variants: [{ sku: 'SKU1', label: 'Default', stock: 5, images: [] }], images: [] }), findOne: () => lean(null) },
    '../models/Order': Order,
    './inventory.service': { reserveItems: async () => ({ ok: true }), releaseItems: async () => {} },
    './notification.service': { notifySubscription: async () => {} }
  }, unit);
  const sub = {
    subscription_id: 'SUB1', user_id: 'USR1', product_id: '507f1f77bcf86cd799439011', variant_id: 'SKU1', quantity: 1,
    frequency_days: 14, next_charge_at: NOW, payment_method_id: 'CARD1', shipping_method: 'standard',
    pricing_snapshot: { subscribe_price: 18 }, delivery_info: { recipient_name: 'A' }, pending_changes: {}, skipped_deliveries: []
  };
  return { service, sub };
}

test('a5: demo mode (SUB_TIME_UNIT=minute) — the next charge is frequency_days × 24 minutes later', async () => {
  const { service, sub } = chargeFixture('minute');
  const result = await service.chargeSubscription(sub, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(sub.next_charge_at.getTime() - NOW.getTime(), 14 * 24 * MIN); // 14 "days" of 24 one-minute units
});

test('a5: production (default unit) — the next charge is still frequency_days real days later', async () => {
  const { service, sub } = chargeFixture(undefined);
  await service.chargeSubscription(sub, { now: NOW });
  assert.equal(sub.next_charge_at.getTime() - NOW.getTime(), 14 * DAY);
});

// The charge job with one due, out-of-stock box whose 72-unit window has run out.
function outOfStockJob(unit, consecutiveSkips) {
  const due = new Date(NOW.getTime() - 72 * (unit === 'minute' ? MIN : 60 * MIN));
  const sub = {
    _id: 'S1', subscription_id: 'SUB1', user_id: 'USR1', status: 'active', frequency_days: 14,
    next_charge_at: due, consecutive_skips: consecutiveSkips, skipped_deliveries: [],
    last_failure_reason: 'out_of_stock', save: async () => {}
  };
  const notices = [];
  const service = load('../src/services/subscription-charge.service.js', {
    '../models/Subscription': {
      find: (filter) => {
        const rows = filter.status === 'active' && filter.next_charge_at?.$lte ? [{ _id: 'S1' }] : [];
        // awaited directly (paused boxes: none), or .sort().lean() (due boxes), or .lean() (upcoming: none)
        return Object.assign(Promise.resolve([]), { sort: () => ({ lean: async () => rows }), lean: async () => [] });
      },
      findOneAndUpdate: async () => sub
    },
    '../models/Order': { findOne: () => lean(null) },
    './notification.service': { notifySubscription: async (s, type) => notices.push(type) },
    './subscription.service': {
      chargeSubscription: async () => ({ ok: false, reason: 'out_of_stock' }),
      applyDueTransitions: async () => {},
      isReservedFor: () => false,
      releaseStaleReservation: async () => false
    }
  }, unit);
  return { service, sub, due, notices };
}

test('d6: an out-of-stock skip by the system leaves consecutive_skips unchanged', async () => {
  for (const before of [0, 1]) {
    const { service, sub, notices } = outOfStockJob('minute', before);
    await service.runSubscriptionChargeJob({ now: NOW });
    assert.equal(sub.skipped_deliveries.length, 1);
    assert.equal(sub.consecutive_skips, before);
    assert.ok(notices.includes('SUBSCRIPTION_SKIPPED'));
  }
});

test('a5 + d6: the skipped cycle moves next_charge_at by one cycle in the active time base', async () => {
  const demo = outOfStockJob('minute', 0);
  await demo.service.runSubscriptionChargeJob({ now: NOW });
  assert.equal(demo.sub.next_charge_at.getTime() - demo.due.getTime(), 14 * 24 * MIN);

  const prod = outOfStockJob(undefined, 0);
  await prod.service.runSubscriptionChargeJob({ now: NOW });
  assert.equal(prod.sub.next_charge_at.getTime() - prod.due.getTime(), 14 * DAY);
});
