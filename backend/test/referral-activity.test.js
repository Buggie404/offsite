const test = require('node:test');
const assert = require('node:assert/strict');
const { referralActivityRows } = require('../src/services/referral-activity');
const signup = {
  referral_id: 'REF1', referee_display: 'leahlee@gmail.com',
  register_reward_status: 'posted', order_reward_status: 'pending',
  register_points: 20, order_points: 20
};
test('signup has its own stable posted reward row before any order', () => {
  assert.deepEqual(referralActivityRows([signup]), [{
    id: 'REF1:signup', friend: signup.referee_display,
    status: 'Signed up · points posted', points: 20
  }]);
});
test('first order pending adds a second row without replacing signup or its 20 points', () => {
  const before = referralActivityRows([signup])[0];
  const rows = referralActivityRows([{ ...signup, first_order_id: 'ORDER1', order_reward_status: 'awaiting_post' }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], before);
  assert.equal(rows[1].status, 'First order · points pending');
  assert.equal(rows[1].points, 20);
  assert.notEqual(rows[0].id, rows[1].id);
});
test('posting first order preserves both milestone rows at 20 each, never a combined 40 row', () => {
  const rows = referralActivityRows([{ ...signup, first_order_id: 'ORDER1', order_reward_status: 'posted' }]);
  assert.deepEqual(rows.map(r => r.points), [20, 20]);
  assert.equal(rows[0].status, 'Signed up · points posted');
  assert.equal(rows[1].status, 'First order · points posted');
});
test('an ineligible order cannot hide or reverse the signup reward', () => {
  const rows = referralActivityRows([{ ...signup, first_order_id: 'ORDER1', order_reward_status: 'ineligible' }]);
  assert.equal(rows[0].points, 20);
  assert.equal(rows[1].points, 0);
  assert.equal(rows[1].status, 'First order · ineligible');
});
test('yearly-limit signup does not fabricate a rewarded or first-order milestone', () => {
  const rows = referralActivityRows([{ ...signup, register_reward_status: 'skipped', order_reward_status: 'ineligible', register_points: 0 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].points, 0);
  assert.equal(rows[0].status, 'Signed up · ineligible');
});
test('multiple friends retain unique IDs for Angular tracking', () => {
  const rows = referralActivityRows([signup, { ...signup, referral_id: 'REF2', order_reward_status: 'posted' }]);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
});

test('referral badges prioritize pending/ineligible over the words first order', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const ts = require('../../frontend/node_modules/typescript');
  const filename = path.resolve(__dirname, '../../frontend/src/app/features/account/components/rewards-referral/rewards-referral.component.ts');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const component = source.statements.find(node => ts.isClassDeclaration(node));
  const method = component.members.find(node => node.name?.getText(source) === 'referralStatusChipClass');
  const js = ts.transpileModule('class Badges {' + method.getText(source) + '} module.exports = Badges;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module });
  const badges = new module.exports();
  assert.equal(badges.referralStatusChipClass('First order · points pending'), 'status-chip--pending');
  assert.equal(badges.referralStatusChipClass('First order · ineligible'), 'status-chip--reversed');
  assert.equal(badges.referralStatusChipClass('Signed up · points posted'), 'status-chip--posted');
});
