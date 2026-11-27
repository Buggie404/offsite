const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/order-points-fixture');
const DAY = 86400000, NOW = new Date('2026-11-28T00:00:00Z');
const delivered = days => ({ order_status: 'delivered', delivered_at: new Date(NOW - days * DAY) });

test('a refund committed between reading Delivered and posting causes a retry and keeps points pending', async () => {
  const f = fixture({ ORDER1: delivered(3) }, {
    beforeOrderWrite: db => db.setOrderStatus('ORDER1', 'pending_refund', 'pending')
  });
  await f.service.postDuePoints(NOW);
  assert.ok(f.attempts >= 2);
  assert.equal(f.state.orders.ORDER1.order_status, 'pending_refund');
  assert.equal(f.txns[0].status, 'pending');
  assert.equal(f.balance.USR1, 0);
});

test('pending refund waits indefinitely; approval reverses, rejection posts after the delivery hold', async () => {
  for (const decision of ['refund', 'refund_rejected']) {
    const f = fixture({ ORDER1: { ...delivered(9), order_status: 'pending_refund' } }, {
      refunds: [{ order_id: 'ORDER1', status: 'pending' }]
    });
    await f.service.postDuePoints(NOW);
    assert.equal(f.txns[0].status, 'pending');
    f.setOrderStatus('ORDER1', decision, decision === 'refund' ? 'approved' : 'rejected');
    const posted = await f.service.postDuePoints(NOW);
    assert.equal(posted, decision === 'refund' ? 0 : 1);
    assert.equal(f.txns[0].status, decision === 'refund' ? 'reversed' : 'posted');
    assert.equal(f.balance.USR1, decision === 'refund' ? 0 : 10);
  }
});

test('rejection does not bypass the original three-day delivery hold', async () => {
  const f = fixture({ ORDER1: { ...delivered(2), order_status: 'refund_rejected' } });
  await f.service.postDuePoints(NOW);
  assert.equal(f.txns[0].status, 'pending');
  await f.service.postDuePoints(new Date(NOW.getTime() + DAY));
  assert.equal(f.txns[0].status, 'posted');
});

test('a pending refund document also blocks posting if an old order status is inconsistent', async () => {
  const f = fixture({ ORDER1: delivered(5) }, { refunds: [{ order_id: 'ORDER1', status: 'pending' }] });
  await f.service.postDuePoints(NOW);
  assert.equal(f.txns[0].status, 'pending');
});

test('posting and balance increments roll back together and a retry credits only once', async () => {
  const f = fixture({ ORDER1: delivered(5) }, { failBalance: true });
  await assert.rejects(f.service.postDuePoints(NOW), /balance write failed/);
  assert.equal(f.txns[0].status, 'pending');
  assert.equal(f.balance.USR1, 0);
  await Promise.all([f.service.postDuePoints(NOW), f.service.postDuePoints(NOW)]);
  assert.equal(f.balance.USR1, 10);
  assert.equal(f.txns[0].status, 'posted');
});

test('Referral first-order points wait for the same admin decision as purchase points', async () => {
  for (const approved of [true, false]) {
    const f = fixture({ ORDER1: { ...delivered(6), order_status: 'pending_refund' } }, {
      txns: [{ _id: 'TX1', user_id: 'ANH', ref_type: 'order', ref_id: 'ORDER1', type: 'referral_order', amount: 20, status: 'pending' }],
      referrals: [{ first_order_id: 'ORDER1', order_reward_status: 'awaiting_post' }],
      refunds: [{ order_id: 'ORDER1', status: 'pending' }]
    });
    await f.service.postDuePoints(NOW);
    assert.equal(f.txns[0].status, 'pending');
    f.setOrderStatus('ORDER1', approved ? 'refund' : 'refund_rejected', approved ? 'approved' : 'rejected');
    await f.service.postDuePoints(NOW);
    assert.equal(f.txns[0].status, approved ? 'reversed' : 'posted');
    assert.equal(f.balance.ANH || 0, approved ? 0 : 20);
    assert.equal(f.state.referrals[0].order_reward_status, approved ? 'ineligible' : 'posted');
  }
});

test('refund request and Pending refund order state commit together or both roll back', async () => {
  const f = fixture({ ORDER1: delivered(2) });
  await assert.rejects(f.submission.submitRefund('ORDER1', f.requestDocument({ fail: true }), 'USR1', { clock: () => NOW }), /request save failed/);
  assert.equal(f.state.orders.ORDER1.order_status, 'delivered');
  assert.equal(f.state.refunds.length, 0);
  const updated = await f.submission.submitRefund('ORDER1', f.requestDocument(), 'USR1', { clock: () => NOW });
  assert.equal(updated.order_status, 'pending_refund');
  assert.equal(f.state.orders.ORDER1.order_status, 'pending_refund');
  assert.equal(f.state.refunds.length, 1);
  await f.service.postDuePoints(new Date(NOW.getTime() + 10 * DAY));
  assert.equal(f.txns[0].status, 'pending');
  await assert.rejects(f.submission.submitRefund('ORDER1', f.requestDocument(), 'USR1', { clock: () => NOW }), /no longer eligible/);
  assert.equal(f.state.refunds.length, 1);
});

test('the refund window is rechecked inside the transaction, including the exact deadline', async () => {
  for (const days of [3, 4]) {
    const f = fixture({ ORDER1: delivered(days) });
    await assert.rejects(f.submission.submitRefund('ORDER1', f.requestDocument(), 'USR1', { clock: () => NOW }), /within 3 days/);
    assert.equal(f.state.orders.ORDER1.order_status, 'delivered');
    assert.equal(f.state.refunds.length, 0);
  }
});

test('accepted refund holds legacy prematurely posted points instead of reversing them before admin review', async () => {
  const f = fixture({ ORDER1: delivered(2) }, {
    txns: [{ _id: 'TX1', user_id: 'USR1', ref_type: 'order', ref_id: 'ORDER1', type: 'purchase', amount: 22, status: 'posted' }],
    balance: { USR1: 22 }
  });
  await f.submission.submitRefund('ORDER1', f.requestDocument(), 'USR1', { clock: () => NOW });
  assert.equal(f.txns[0].status, 'pending');
  assert.ok(f.txns[0].posted_at instanceof Date);
  assert.equal(f.balance.USR1, 0);
});

test('a shorter demo hold cannot post before the refund window ends', async () => {
  const f = fixture({ ORDER1: delivered(2) });
  await f.settlement.postDueOrderPoints(NOW, { holdDays: 1, refundWindowDays: 3 });
  assert.equal(f.txns[0].status, 'pending');
});

test('missing orders do not post orphaned purchase transactions', async () => {
  const f = fixture({}, {
    txns: [{ _id: 'TX1', user_id: 'USR1', ref_type: 'order', ref_id: 'MISSING', type: 'purchase', amount: 10, status: 'pending' }]
  });
  await f.service.postDuePoints(NOW);
  assert.equal(f.txns[0].status, 'pending');
  assert.equal(f.balance.USR1, 0);
});

test('if posting wins the deadline race, refund retry rechecks time and cannot create Pending refund beside Posted points', async () => {
  let time = new Date(NOW.getTime() - 1);
  const f = fixture({ ORDER1: delivered(3) }, {
    beforeOrderWrite: db => {
      // Simulate another committed transaction after our snapshot was read.
      db.setOrderStatus('ORDER1', 'delivered');
      db.txns[0].status = 'posted';
      db.balance.USR1 = 10;
      time = NOW;
    }
  });
  await assert.rejects(f.submission.submitRefund(
    'ORDER1', f.requestDocument(), 'USR1', { clock: () => time }
  ), /within 3 days/);
  assert.ok(f.attempts >= 2);
  assert.equal(f.state.orders.ORDER1.order_status, 'delivered');
  assert.equal(f.state.refunds.length, 0);
  assert.equal(f.txns[0].status, 'posted');
  assert.equal(f.balance.USR1, 10);
});
