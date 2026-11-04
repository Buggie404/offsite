const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/purchase-points-posting.test.js
// Purchase points are pending from processing; they post only once the order was delivered and
// the refund window (3 days) after delivery has passed. Canceled / refunded orders reverse them.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-20T00:00:00Z');

function fixture(orders) {
  const txns = Object.keys(orders).map((orderId) => ({
    _id: orderId, user_id: 'USR1', type: 'purchase', ref_type: 'order', ref_id: orderId, amount: 10, status: 'pending',
    created_at: new Date(NOW.getTime() - 10 * DAY),
    async save() { return this; }
  }));
  const balance = { USR1: 0 };
  const PointTransaction = {
    find: async (filter) => txns.filter(t => t.status === filter.status && filter.type.$in.includes(t.type)),
    findOneAndUpdate: async (filter, update) => {
      const t = txns.find(x => x._id === filter._id && x.status === filter.status);
      if (!t) return null;
      Object.assign(t, update.$set);
      return t;
    }
  };
  const service = load('../src/services/points.service.js', {
    '../models/PointTransaction': PointTransaction,
    '../models/User': { updateOne: async (f, u) => { balance[f.user_id] += u.$inc.points; } },
    '../models/Order': { findOne: (f) => ({ lean: async () => orders[f.order_id] || null }) },
    './community-restriction.service': { activeRestriction: () => false },
    '../models/Referral': { updateOne: async () => {} },
    './loyalty.service': { finalizeReferralOrderRewards: async () => {} }
  });
  return { service, txns, balance };
}

test('only delivered orders past the refund window post; others wait or are reversed', async () => {
  const f = fixture({
    DELIVERED_OLD: { order_status: 'delivered', delivered_at: new Date(NOW.getTime() - 4 * DAY) },
    DELIVERED_NEW: { order_status: 'delivered', delivered_at: new Date(NOW.getTime() - 1 * DAY) },
    REJECTED_OLD: { order_status: 'refund_rejected', delivered_at: new Date(NOW.getTime() - 5 * DAY) },
    PROCESSING: { order_status: 'processing' },
    SHIPPING: { order_status: 'shipping' },
    PENDING_REFUND: { order_status: 'pending_refund', delivered_at: new Date(NOW.getTime() - 5 * DAY) },
    CANCELED: { order_status: 'canceled' },
    REFUNDED: { order_status: 'refund', delivered_at: new Date(NOW.getTime() - 5 * DAY) }
  });
  await f.service.postDuePoints(NOW);
  const status = Object.fromEntries(f.txns.map(t => [t.ref_id, t.status]));
  assert.deepEqual(status, {
    DELIVERED_OLD: 'posted',
    DELIVERED_NEW: 'pending',
    REJECTED_OLD: 'posted',
    PROCESSING: 'pending',
    SHIPPING: 'pending',
    PENDING_REFUND: 'pending',
    CANCELED: 'reversed',
    REFUNDED: 'reversed'
  });
  assert.equal(f.balance.USR1, 20);
});
