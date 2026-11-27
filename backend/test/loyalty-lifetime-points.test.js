const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loyaltyWith(transactions) {
  const file = path.resolve(__dirname, '../src/services/loyalty.service.js');
  const realRequire = createRequire(file), mod = { exports: {} };
  const mocks = {
    mongoose: {}, '../models/User': {}, '../models/Referral': {},
    '../models/Voucher': {}, '../models/Order': {},
    './points.service': {}, './voucher.service': {},
    '../models/PointTransaction': {
      aggregate: async pipeline => {
        const match = pipeline[0].$match;
        const rows = transactions.filter(t =>
          t.user_id === match.user_id && t.amount > match.amount.$gt
          && match.$or.some(branch => (!branch.status || t.status === branch.status)
            && (!branch.posted_at || t.posted_at instanceof Date))
          && t.type !== match.type.$ne);
        return rows.length ? [{ total: rows.reduce((sum, t) => sum + t.amount, 0) }] : [];
      }
    }
  };
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports);
  return mod.exports;
}
const earned = (amount, status, extras = {}) => ({
  user_id: 'USR1', type: 'purchase', amount, status, ...extras
});
test('Lifetime counts posted earnings and excludes amounts that never posted', async () => {
  const service = loyaltyWith([
    earned(100, 'posted'), earned(20, 'posted', { type: 'referral_register' }),
    earned(50, 'pending'), earned(30, 'reversed'), earned(10, 'used'),
    earned(800, 'posted', { user_id: 'USR2' }),
    earned(90, 'posted', { type: 'redeem_voucher' }), earned(-20, 'posted')
  ]);
  assert.equal(await service.computeLifetimePoints('USR1'), 120);
});
test('149 posted plus pending cannot reach Leaf; posting makes earnings count', async () => {
  const pending = earned(22, 'pending');
  const service = loyaltyWith([earned(149, 'posted'), pending]);
  assert.equal(await service.computeLifetimePoints('USR1'), 149);
  pending.status = 'posted';
  assert.equal(await service.computeLifetimePoints('USR1'), 171);
});
test('redeeming a voucher does not reduce Lifetime points', async () => {
  const transactions = [earned(150, 'posted')];
  const service = loyaltyWith(transactions);
  transactions.push(earned(-100, 'used', { type: 'redeem_voucher' }));
  assert.equal(await service.computeLifetimePoints('USR1'), 150);
});
test('reversed pending earnings and accounts with no earned points do not count', async () => {
  const txn = earned(22, 'pending');
  const service = loyaltyWith([txn]);
  assert.equal(await service.computeLifetimePoints('USR1'), 0);
  txn.status = 'reversed';
  assert.equal(await service.computeLifetimePoints('USR1'), 0);
  assert.equal(await service.computeLifetimePoints('USR2'), 0);
});

test('posted then reversed keeps Lifetime, restoring and reversing again never double-counts it', async () => {
  const txn = earned(20, 'posted', { type: 'post_approved', posted_at: new Date('2026-11-20T00:00:00Z') });
  const service = loyaltyWith([txn]);
  assert.equal(await service.computeLifetimePoints('USR1'), 20);
  txn.status = 'reversed';
  assert.equal(await service.computeLifetimePoints('USR1'), 20);
  txn.status = 'posted';
  assert.equal(await service.computeLifetimePoints('USR1'), 20);
  txn.status = 'reversed';
  assert.equal(await service.computeLifetimePoints('USR1'), 20);
});

function pointsWith(txn, balance) {
  const file = path.resolve(__dirname, '../src/services/points.service.js');
  const realRequire = createRequire(file), mod = { exports: {} };
  const session = { withTransaction: async fn => fn(), endSession: async () => {} };
  const mocks = {
    '../models/PointTransaction': {
      db: { startSession: async () => session },
      findOne: async () => ['pending', 'posted'].includes(txn.status) ? txn : null,
      find: filter => ({ session: async () =>
        (typeof filter.status === 'string' ? txn.status === filter.status : filter.status.$in.includes(txn.status)) ? [txn] : [] }),
      updateOne: async (filter, update) => {
        if (txn.status !== filter.status) return { modifiedCount: 0 };
        Object.assign(txn, update.$set);
        return { modifiedCount: 1 };
      }
    },
    '../models/User': { updateOne: async (filter, update) => { balance.value += update.$inc.points; } },
    '../models/Order': {}, './community-restriction.service': {}
  };
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports);
  return mod.exports;
}

test('actual community reversal removes available points but preserves Lifetime, including legacy posted rows', async () => {
  const txn = earned(20, 'posted', { _id: 'TX1', type: 'post_approved', ref_type: 'post', ref_id: 'POST1',
    created_at: new Date('2026-11-20T00:00:00Z'), posted_at: null });
  const balance = { value: 5 }; // Some earned points were already redeemed.
  const points = pointsWith(txn, balance), loyalty = loyaltyWith([txn]);
  await points.reverseCommunityPoints('POST1');
  assert.equal(txn.status, 'reversed');
  assert.ok(txn.posted_at instanceof Date);
  assert.equal(balance.value, -15);
  assert.equal(await loyalty.computeLifetimePoints('USR1'), 20);
  await points.reverseCommunityPoints('POST1');
  assert.equal(balance.value, -15);
  await points.restoreCommunityPoints('POST1');
  assert.equal(balance.value, 5);
  assert.equal(await loyalty.computeLifetimePoints('USR1'), 20);
  await points.reverseCommunityPoints('POST1');
  assert.equal(balance.value, -15);
  assert.equal(await loyalty.computeLifetimePoints('USR1'), 20);
});

test('actual purchase reversal preserves posted Lifetime but never counts reversed pending earnings', async () => {
  for (const status of ['posted', 'pending']) {
    const txn = earned(22, status, { _id: 'TX1', posted_at: null, created_at: new Date('2026-11-20T00:00:00Z'), async save() {} });
    const balance = { value: status === 'posted' ? 22 : 0 };
    const points = pointsWith(txn, balance), loyalty = loyaltyWith([txn]);
    await points.reversePurchasePoints({ order_id: 'ORDER1' });
    assert.equal(txn.status, 'reversed');
    assert.equal(balance.value, 0);
    assert.equal(await loyalty.computeLifetimePoints('USR1'), status === 'posted' ? 22 : 0);
  }
});

test('temporarily held earnings that already posted retain Lifetime; never-posted pending does not', async () => {
  const service = loyaltyWith([
    earned(22, 'pending', { posted_at: new Date('2026-11-20T00:00:00Z') }),
    earned(90, 'pending')
  ]);
  assert.equal(await service.computeLifetimePoints('USR1'), 22);
});
