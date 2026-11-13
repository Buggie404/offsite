const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/order-stock-release-once.test.js
// One-time and mixed orders hold their stock from checkout (stock_reserved). It goes back exactly
// once when: the pending order is abandoned (24h expiry is covered in pending-order-expiry.test.js,
// discarding is covered here), the order is cancelled by anyone, or a return is approved (only the
// returned quantities). Calling any of these again never puts the stock back a second time.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

// ─── Cancel: the real Order pre-save hook, run without a database ─────────────
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const inventory = require('../src/services/inventory.service');

const line = (sku, quantity) => ({
  product_id: '507f1f77bcf86cd799439011', variant_id: sku, product_name: 'Matcha', variant_name: 'Default',
  image: { url: 'x', public_id: 'x' }, unit_price: 20, quantity, subtotal: 20 * quantity, purchase_type: 'one_time'
});

// The stored order: the hook re-reads its status, and the stock_released claim updates it.
function store(status) {
  return { order_status: status, stock_released: false };
}

function hydrate(status, extra = {}) {
  return Order.hydrate({
    _id: '507f1f77bcf86cd799439099', order_id: 'OFS-2026-00500', user_id: 'USR1', is_guest: false,
    order_status: status, payment_status: 'paid', payment: { method: 'card' }, stock_reserved: true,
    items: [line('SKU-A', 2), { ...line('SKU-B', 1), purchase_type: 'subscription', subscription_frequency_days: 14 }],
    status_history: [], ...extra
  });
}

// Runs order.save()'s pre-save hooks against `stored` (what the database holds right now).
async function preSave(order, stored) {
  await new Promise((resolve, reject) =>
    Order.schema.s.hooks.execPre('save', order, [{ validateBeforeSave: false }], e => e ? reject(e) : resolve()));
  stored.order_status = order.order_status;
}

let released;
test.beforeEach(() => {
  released = [];
  inventory.releaseItems = async (items) => { released.push(...items.map(i => [i.variant_id, i.quantity])); };
  Product.updateOne = async () => ({});
});

function useStore(stored) {
  Order.findById = () => ({ select: async () => ({ order_status: stored.order_status }) });
  Order.updateOne = async (filter, update) => {
    await tick(); // let racing saves interleave
    if (filter.stock_released?.$ne === true && stored.stock_released !== true) {
      Object.assign(stored, update.$set);
      return { modifiedCount: 1 };
    }
    return { modifiedCount: 0 };
  };
}

for (const [who, from] of [
  ['customer cancels a pending order', 'pending'],
  ['customer cancels a processing order', 'processing'],
  ['admin cancels after delivery_failed', 'delivery_failed']
]) {
  test(`cancel (${who}): every line of a mixed order goes back once`, async () => {
    const stored = store(from);
    useStore(stored);
    const order = hydrate(from);
    order.order_status = 'canceled';
    await preSave(order, stored);
    assert.deepEqual(released, [['SKU-A', 2], ['SKU-B', 1]]);
    assert.equal(order.stock_released, true);
    assert.equal(order.payment_status, 'refunded');
  });
}

test('two cancels racing on the same order (both read the old status): stock goes back once', async () => {
  const stored = store('processing');
  useStore(stored);
  const first = hydrate('processing');
  const second = hydrate('processing');
  first.order_status = 'canceled';
  second.order_status = 'canceled';
  // Both hooks read 'processing' before either save lands.
  Order.findById = () => ({ select: async () => ({ order_status: 'processing' }) });
  await Promise.all([preSave(first, stored), preSave(second, stored)]);
  assert.deepEqual(released, [['SKU-A', 2], ['SKU-B', 1]]);
});

test('cancelling an order that is already canceled puts nothing back', async () => {
  const stored = { order_status: 'canceled', stock_released: true };
  useStore(stored);
  const order = hydrate('canceled', { stock_released: true });
  order.order_status = 'canceled';
  order.markModified('order_status');
  await preSave(order, stored);
  assert.deepEqual(released, []);
});

// ─── Return approved: only the returned quantities, once ─────────────────────
function refundFixture() {
  const order = {
    _id: 'O1', order_id: 'OFS-2026-00501', user_id: 'USR1', order_status: 'pending_refund', payment_status: 'paid',
    items: [line('SKU-A', 3), line('SKU-B', 1)], pricing: { total: 80 }, status_history: [], $locals: {},
    payment: { method: 'card' }, delivery_info: {}, shipping: {},
    async save() { await tick(); return this; }
  };
  const request = { _id: 'R1', refund_request_id: 'RF1', order_id: order.order_id, status: 'pending', refund_item: [{ ...line('SKU-A', 2) }], status_history: [] };
  // Both approvals read the request while it is still pending; only the atomic update decides.
  const RefundRequest = {
    findOne: () => {
      const snapshot = { ...request, status: 'pending' };
      return { sort: () => Object.assign(Promise.resolve(snapshot), { lean: async () => ({ ...request }) }) };
    },
    findOneAndUpdate: async (filter, update) => {
      await tick();
      if (request.status !== filter.status) return null;
      Object.assign(request, update.$set);
      return { ...request };
    }
  };
  const releasedItems = [];
  const api = load('../src/controllers/admin.controller.js', {
    '../models/Order': { findOne: async () => order },
    '../models/RefundRequest': RefundRequest,
    '../services/subscription.service': { getOrderRitualBoxes: async () => [] },
    '../services/socket.service': { emitOrderUpdated: () => {} },
    '../services/notification.service': { createNotification: async () => {} },
    '../services/points.service': { reversePurchasePoints: async () => {} },
    '../services/inventory.service': { releaseItems: async (items) => { released.push(...items.map(i => [i.variant_id, i.quantity])); } }
  });
  return { api, order, request, releasedItems };
}

test('return approved: the returned quantity (2 of 3) goes back, once even when approved twice at the same time', async () => {
  const f = refundFixture();
  const call = async () => {
    const r = res();
    await f.api.approveRefundRequest({ params: { id: f.order.order_id }, user: { user_id: 'ADM1', role: 'qlsp' }, writeActivityLog: async () => {} }, r);
    return r;
  };
  const [a, b] = await Promise.all([call(), call()]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  assert.deepEqual(released, [['SKU-A', 2]]);
  assert.equal(f.request.status, 'approved');
});

// ─── Discard (customer abandons the pending order) ──────────────────────────
test('discarding a pending order twice puts its stock back once', async () => {
  let row = {
    _id: 'O2', order_id: 'OFS-2026-00502', user_id: 'USR1', session_id: null, order_status: 'pending',
    stock_reserved: true, items: [line('SKU-A', 2)], coupon: null
  };
  const api = load('../src/controllers/orders.controller.js', {
    '../models/Order': {
      findOne: async () => row && { ...row },
      findOneAndDelete: async (filter) => {
        await tick();
        if (!row || row.order_status !== filter.order_status) return null;
        const deleted = row;
        row = null;
        return deleted;
      }
    },
    '../models/User': { findById: async () => ({ user_id: 'USR1' }) },
    '../services/inventory.service': { releaseItems: async (items) => { released.push(...items.map(i => [i.variant_id, i.quantity])); } },
    '../services/socket.service': { emitOrderUpdated: () => {} }
  });
  const call = async () => {
    const r = res();
    await api.deleteOrder({ params: { id: 'OFS-2026-00502' }, user: { user_id: 'U1' }, body: {}, query: {} }, r);
    return r;
  };
  const results = await Promise.all([call(), call()]);
  assert.ok(results.every(r => r.statusCode === 200 || r.statusCode === 404));
  assert.deepEqual(released, [['SKU-A', 2]]);
});
