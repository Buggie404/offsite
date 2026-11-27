const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('a missing first-order transaction is recreated pending, not falsely marked posted or delayed again', async () => {
  const deliveredAt = new Date('2026-11-20T00:00:00Z');
  const dueAt = new Date('2026-11-23T00:00:00Z');
  const referral = {
    referral_id: 'REF1', referrer_id: 'ANH', referee_id: 'LEAH', first_order_id: 'ORDER1',
    order_reward_status: 'awaiting_post', order_reward_due_at: dueAt, order_points: 20,
    async save() {}
  };
  const order = { order_id: 'ORDER1', user_id: 'LEAH', is_guest: false,
    order_status: 'delivered', delivered_at: deliveredAt };
  let txn = null;
  const mocks = {
    mongoose: {},
    '../models/User': { findOne: () => ({ lean: async () => ({ user_id: 'USER', phone: '' }) }) },
    '../models/Referral': { find: async () => [referral], findOne: async () => referral },
    '../models/PointTransaction': {
      findOne: () => ({ then(resolve) { return Promise.resolve(txn).then(resolve); }, lean: async () => txn }),
      create: async data => { txn = data; return data; }
    },
    '../models/Order': { countDocuments: async () => 2, findOne: () => ({ lean: async () => order }) },
    '../models/Voucher': {},
    './points.service': { HOLD_DAYS: 3 },
    './voucher.service': {},
    './referral-registration.service': { ensureWelcomeVoucher: async () => 'WELCOME5_LEAH' }
  };
  const file = path.resolve(__dirname, '../src/services/loyalty.service.js');
  const realRequire = createRequire(file), mod = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports);
  await mod.exports.finalizeReferralOrderRewards(new Date('2026-11-24T00:00:00Z'));
  assert.equal(referral.order_reward_status, 'awaiting_post');
  assert.equal(referral.order_reward_due_at, dueAt);
  assert.equal(txn.status, 'pending');
  assert.equal(txn.amount, 20);
  assert.equal(txn.user_id, 'ANH');
  assert.equal(txn.created_at, deliveredAt);
  await mod.exports.finalizeReferralOrderRewards(new Date('2026-11-24T00:00:00Z'));
  assert.equal(referral.order_reward_status, 'awaiting_post');
});
