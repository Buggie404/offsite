const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/pending-order-expiry.test.js
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const HOUR = 60 * 60 * 1000;
const tick = () => new Promise(resolve => setImmediate(resolve));

// In-memory stand-in for the Orders collection. save() mirrors the stock part of the real
// Order pre-save hook: reserved stock goes back when the stored status moves to 'canceled'
// from anything but canceled/refund (the hook re-reads the stored status the same way).
function fixture() {
  const rows = new Map();
  const released = [];   // one entry per releaseItems call: [order_id, items]
  const notifications = [];

  const matches = (row, filter) => {
    if (filter._id !== undefined && row._id !== filter._id) return false;
    if (filter.order_status && row.order_status !== filter.order_status) return false;
    if (filter['payment.method']?.$ne && row.payment?.method === filter['payment.method'].$ne) return false;
    if (filter.created_at?.$lte && !(row.created_at <= filter.created_at.$lte)) return false;
    if (filter.$or && !filter.$or.some(({ updated_at: c }) =>
      c === null ? row.updated_at == null
        : c.$exists === false ? row.updated_at === undefined
          : row.updated_at instanceof Date && row.updated_at < c.$lt)) return false;
    return true;
  };

  const toDoc = row => {
    const doc = structuredClone(row);
    doc.save = async () => {
      await tick(); // let concurrent callers interleave, like a real round trip
      const original = rows.get(doc._id);
      if (doc.order_status === 'canceled' && doc.stock_reserved &&
          !['canceled', 'refund'].includes(original.order_status)) {
        released.push([doc.order_id, doc.items.map(i => i.sku)]);
      }
      await tick();
      const { save, _changedBy, _statusChangeNote, ...data } = doc;
      if (data.order_status !== original.order_status) {
        data.status_history = [...(data.status_history || []), { status: data.order_status, changed_by: _changedBy, note: _statusChangeNote }];
      }
      rows.set(doc._id, data);
      return doc;
    };
    return doc;
  };

  const Order = {
    find: (filter) => ({ lean: async () => [...rows.values()].filter(r => matches(r, filter)).map(r => ({ _id: r._id })) }),
    findOneAndUpdate: async (filter, update) => {
      await tick();
      const row = [...rows.values()].find(r => matches(r, filter)); // atomic: no await between match and write
      if (!row) return null;
      Object.assign(row, update.$set);
      return toDoc(row);
    },
    findById: async id => rows.get(id) ? toDoc(rows.get(id)) : null
  };
  const notificationService = { createNotification: async n => notifications.push(n) };

  const service = load('../src/services/pending-order-expiry.service.js', {
    '../models/Order': Order,
    './notification.service': notificationService
  });

  const now = new Date('2026-11-01T12:00:00Z');
  const add = (order_id, { ageHours, method = 'qr', user_id = 'USR1', status = 'pending' }) => {
    const created = new Date(now.getTime() - ageHours * HOUR);
    rows.set(order_id, {
      _id: order_id, order_id, user_id, order_status: status, payment: { method },
      stock_reserved: true, items: [{ sku: `${order_id}-SKU` }], created_at: created, updated_at: created
    });
  };
  return { service, rows, released, notifications, now, add, Order };
}

test('QR / card order pending for 25h is canceled and its stock released exactly once', async () => {
  const f = fixture();
  f.add('QR25', { ageHours: 25, method: 'qr' });
  f.add('CARD25', { ageHours: 25, method: 'card', user_id: null }); // guest

  assert.equal(await f.service.expirePendingOrders(f.now), 2);
  for (const id of ['QR25', 'CARD25']) {
    const row = f.rows.get(id);
    assert.equal(row.order_status, 'canceled');
    assert.equal(row.status_history.at(-1).changed_by, 'system');
    assert.equal(row.status_history.at(-1).note, 'Order automatically canceled: Payment pending for more than 24 hours');
  }
  assert.deepEqual(f.released, [['QR25', ['QR25-SKU']], ['CARD25', ['CARD25-SKU']]]);
  // Only the registered customer is notified; the guest is skipped.
  assert.deepEqual(f.notifications, [{ recipient_id: 'USR1', sender: null, type: 'ORDER_CANCELED', post_id: 'QR25' }]);
});

test('order pending for 1h is left unchanged', async () => {
  const f = fixture();
  f.add('QR1', { ageHours: 1 });
  assert.equal(await f.service.expirePendingOrders(f.now), 0);
  assert.equal(f.rows.get('QR1').order_status, 'pending');
  assert.equal(f.released.length, 0);
  assert.equal(f.notifications.length, 0);
});

test('pending COD order is left unchanged, however old', async () => {
  const f = fixture();
  f.add('COD48', { ageHours: 48, method: 'cod' });
  assert.equal(await f.service.expirePendingOrders(f.now), 0);
  assert.equal(f.rows.get('COD48').order_status, 'pending');
  assert.equal(f.released.length, 0);
});

test('running twice (in a row or overlapping) releases stock only once', async () => {
  const f = fixture();
  f.add('QR25', { ageHours: 25 });
  const counts = await Promise.all([f.service.expirePendingOrders(f.now), f.service.expirePendingOrders(f.now)]);
  assert.equal(counts[0] + counts[1], 1);
  assert.equal(await f.service.expirePendingOrders(f.now), 0);
  assert.equal(await f.service.expirePendingOrders(new Date(f.now.getTime() + HOUR)), 0); // after the lease too
  assert.equal(f.released.length, 1);
  assert.equal(f.notifications.length, 1);
});

test('job and a request reading the order at the same time release stock only once', async () => {
  const f = fixture();
  f.add('QR25', { ageHours: 25 });
  const loaded = await f.Order.findById('QR25'); // what the GET handler loaded
  const [, fromRequest] = await Promise.all([
    f.service.expirePendingOrders(f.now),
    f.service.expireIfStale(loaded, f.now)
  ]);
  assert.equal(fromRequest.order_status, 'canceled'); // the endpoint still answers with the canceled order
  assert.equal(f.released.length, 1);
});

test('expireIfStale returns fresh orders untouched', async () => {
  const f = fixture();
  f.add('QR1', { ageHours: 1 });
  const loaded = await f.Order.findById('QR1');
  assert.equal(await f.service.expireIfStale(loaded, f.now), loaded);
});

test('one failing order does not stop the rest', async () => {
  const f = fixture();
  f.add('BAD', { ageHours: 30 });
  f.add('GOOD', { ageHours: 30 });
  const realFind = f.Order.findOneAndUpdate;
  f.Order.findOneAndUpdate = async (filter, update) => {
    if (filter._id === 'BAD') throw new Error('boom');
    return realFind(filter, update);
  };
  const error = console.error; console.error = () => {};
  try {
    assert.equal(await f.service.expirePendingOrders(f.now), 1);
  } finally { console.error = error; }
  assert.equal(f.rows.get('GOOD').order_status, 'canceled');
  assert.equal(f.rows.get('BAD').order_status, 'pending');
});
