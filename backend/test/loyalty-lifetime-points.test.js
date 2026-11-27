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
          && (typeof match.status === 'string' ? t.status === match.status : match.status.$in.includes(t.status))
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
test('Lifetime counts only positive posted earnings for the current customer', async () => {
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
test('reversed earnings and accounts without posted earnings do not count', async () => {
  const txn = earned(22, 'posted');
  const service = loyaltyWith([txn]);
  assert.equal(await service.computeLifetimePoints('USR1'), 22);
  txn.status = 'reversed';
  assert.equal(await service.computeLifetimePoints('USR1'), 0);
  assert.equal(await service.computeLifetimePoints('USR2'), 0);
});
