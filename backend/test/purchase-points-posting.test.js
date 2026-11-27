const test = require('node:test');
const assert = require('node:assert/strict');
// Purchase points wait for the delivery hold and for any refund review to finish.
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-20T00:00:00Z');

function fixture(orders) {
  return require('./helpers/order-points-fixture').fixture(orders);
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
