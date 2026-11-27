const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const order = {
  order_id: 'OFS-2026-00175', user_id: 'USR_LEAH', is_guest: false,
  order_status: 'delivered', pricing: { subtotal: 22 },
  created_at: new Date('2026-11-27T15:58:41Z'),
  delivered_at: new Date('2026-11-27T16:00:16Z')
};
function fixture(initial = []) {
  const rows = [...initial];
  let queried;
  const P = {
    findOne: async f => rows.find(t => t.type === f.type && t.ref_id === f.ref_id) || null,
    distinct: async () => rows.map(t => t.ref_id),
    create: async data => {
      await new Promise(resolve => setImmediate(resolve));
      if (rows.some(t => t.transaction_id === data.transaction_id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      rows.push(data);
      return data;
    }
  };
  const mocks = {
    '../models/PointTransaction': P,
    '../models/User': { findOne: () => ({ lean: async () => ({ membership_tier: 'Seed' }) }) },
    '../models/Order': { find: filter => {
      queried = filter;
      return { select() { return this; }, limit() { return this; },
        lean: async () => filter.order_id.$nin.includes(order.order_id) ? [] : [order] };
    }},
    './community-restriction.service': { activeRestriction: () => null }
  };
  const filename = path.resolve(__dirname, '../src/services/points.service.js');
  const mod = { exports: {} };
  const realRequire = createRequire(filename);
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports);
  return { service: mod.exports, rows, query: () => queried };
}
test('Rewards recovers the missing $22 member order as 22 pending points', async () => {
  const f = fixture();
  assert.equal(await f.service.reconcilePurchasePoints(order.user_id), 1);
  assert.equal(f.rows[0].amount, 22);
  assert.equal(f.rows[0].user_id, order.user_id);
  assert.equal(f.rows[0].status, 'pending');
  assert.equal(f.rows[0].created_at, order.created_at);
  assert.equal(f.query().user_id, order.user_id);
  assert.equal(f.query().order_status.$in.includes('refund'), false);
  assert.equal(f.query().order_status.$in.includes('canceled'), false);
});
test('repeated Rewards loads do not add duplicate purchase points', async () => {
  const f = fixture();
  await f.service.reconcilePurchasePoints(order.user_id);
  assert.equal(await f.service.reconcilePurchasePoints(order.user_id), 0);
  assert.equal(f.rows.length, 1);
});
test('concurrent order hooks and Rewards recovery create only one transaction', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.awardPurchasePoints(order), f.service.awardPurchasePoints(order)]);
  assert.equal(f.rows.length, 1);
  assert.equal(results[0].transaction_id, results[1].transaction_id);
});
test('reversed purchase points are never recreated by recovery', async () => {
  const f = fixture([{ type: 'purchase', ref_id: order.order_id, status: 'reversed', amount: 22 }]);
  assert.equal(await f.service.reconcilePurchasePoints(order.user_id), 0);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].status, 'reversed');
});
test('guest orders cannot receive purchase points', async () => {
  const f = fixture();
  assert.equal(await f.service.awardPurchasePoints({ ...order, is_guest: true }), null);
  assert.equal(f.rows.length, 0);
});
