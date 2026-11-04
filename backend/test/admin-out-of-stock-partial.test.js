const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/admin-out-of-stock-partial.test.js
// Out of stock while processing, on an order with more than one line: the customer is asked to
// choose, then staff swap the line (same or lower price) or remove it; only the last line left
// cancels the order.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const line = (id, price, qty = 1) => ({
  product_id: id, variant_id: `SKU-${id}`, product_name: `Item ${id}`, variant_name: 'Default',
  quantity: qty, unit_price: price, subtotal: price * qty, image: { url: 'x', public_id: 'x' }, purchase_type: 'one_time'
});

function orderDoc(extra = {}) {
  return {
    _id: 'O1', order_id: 'OFS-2026-00088', user_id: 'USR1', order_status: 'processing', payment_status: 'paid',
    created_at: new Date('2026-11-01T03:00:00Z'), internal_notes: '', status_history: [], removed_items: [], refunded_amount: 0,
    items: [line('A', 20), line('B', 15, 2)],
    pricing: { subtotal: 50, shipping_cost: 0, discount_amount: 5, total: 45 },
    coupon: { code: 'SAVE5', discount_amount: 5 },
    payment: { method: 'card' }, delivery_info: { recipient_name: 'Mai' }, shipping: { method: 'standard' },
    saved: 0,
    async save() { this.saved++; return this; },
    ...extra
  };
}

function fixture(order, { products = {}, stockOk = true } = {}) {
  const notifications = [];
  const reserved = [];
  const released = [];
  const pointsUpdated = [];
  const notificationService = {
    notifySubscription: async () => {},
    createNotification: async (n) => notifications.push(n)
  };
  const api = load('../src/controllers/admin.controller.js', {
    '../models/Order': { findOne: async () => order },
    '../models/RefundRequest': { findOne: () => ({ sort: () => ({ lean: async () => null }) }) },
    '../services/subscription.service': {
      skipCycleForCanceledOrder: async () => null,
      getOrderRitualBoxes: async () => [],
      getOrderSubscriptions: async () => []
    },
    '../services/notification.service': notificationService,
    '../services/socket.service': { emitOrderUpdated: () => {} },
    '../services/inventory.service': {
      findProduct: async (id) => products[id] || null,
      reserveItems: async (items) => { if (!stockOk) return { ok: false, failed: items[0] }; reserved.push(...items); return { ok: true }; },
      releaseItems: async (items) => { released.push(...items); }
    },
    '../services/points.service': { updatePurchasePoints: async (o) => pointsUpdated.push(o.pricing.subtotal) }
  });
  return { api, notifications, reserved, released, pointsUpdated };
}

async function call(api, fn, order, body) {
  const logs = [];
  const req = { params: { id: order.order_id }, body, user: { user_id: 'ADM1', role: 'qlsp' }, writeActivityLog: async (e) => logs.push(e) };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await api[fn](req, res);
  return { res, logs };
}

test('one line out of stock on a 2-line order: flagged, order stays processing, customer asked to choose', async () => {
  const order = orderDoc();
  const f = fixture(order);
  const { res, logs } = await call(f.api, 'markItemsOutOfStock', order, { items: [{ product_id: 'A', variant_id: 'SKU-A' }] });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(order.order_status, 'processing');
  assert.equal(order.payment_status, 'paid');
  assert.equal(order.items[0].out_of_stock, true);
  assert.equal(order.items[1].out_of_stock, undefined);
  assert.deepEqual(f.notifications.map(n => n.type), ['ORDER_ITEM_OUT_OF_STOCK']);
  assert.match(f.notifications[0].comment_content, /Item A is out of stock\. Contact us to swap it for an item of the same or lower price, or to remove it/);
  assert.equal(logs[0].actionType, 'order.mark-out-of-stock');

  const again = await call(f.api, 'markItemsOutOfStock', order, { items: [{ product_id: 'A', variant_id: 'SKU-A' }] });
  assert.equal(again.res.statusCode, 400);
});

test('every line out of stock: the whole order is cancelled and refunded (as before)', async () => {
  const order = orderDoc();
  const f = fixture(order);
  const { res } = await call(f.api, 'markItemsOutOfStock', order, {
    items: [{ product_id: 'A', variant_id: 'SKU-A' }, { product_id: 'B', variant_id: 'SKU-B' }]
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(order.order_status, 'canceled');
  assert.equal(order.payment_status, 'refunded');
  assert.deepEqual(f.notifications.map(n => n.type), ['ORDER_CANCELED_BY_STORE']);
});

test('remove: the line leaves the order, total recalculated, difference refunded, points follow', async () => {
  const order = orderDoc();
  order.items[0].out_of_stock = true;
  const f = fixture(order);
  const { res, logs } = await call(f.api, 'resolveOutOfStockLine', order, { product_id: 'A', variant_id: 'SKU-A', action: 'remove' });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(order.order_status, 'processing');
  assert.equal(order.payment_status, 'paid');
  assert.deepEqual(order.items.map(i => i.product_id), ['B']);
  assert.deepEqual(order.pricing, { subtotal: 30, shipping_cost: 0, discount_amount: 5, total: 25 });
  assert.equal(order.refunded_amount, 20);
  assert.equal(order.removed_items.length, 1);
  assert.equal(order.removed_items[0].action, 'removed');
  assert.equal(order.removed_items[0].item.product_id, 'A');
  assert.deepEqual(f.pointsUpdated, [30]);
  assert.deepEqual(f.released, [], 'the out-of-stock line is not put back in stock');
  assert.deepEqual(f.notifications.map(n => n.type), ['ORDER_ITEMS_UPDATED']);
  assert.match(f.notifications[0].comment_content, /Item A removed\. \$20 refunded\./);
  assert.equal(logs[0].actionType, 'order.resolve-out-of-stock');
});

test('swap: replaced by a cheaper item, its stock reserved, the difference refunded', async () => {
  const order = orderDoc();
  order.items[0].out_of_stock = true;
  const f = fixture(order, {
    products: { C: { _id: 'C', name: 'Item C', is_active: true, images: [], variants: [{ sku: 'SKU-C', label: 'Default', price: 18 }] } }
  });
  const { res } = await call(f.api, 'resolveOutOfStockLine', order, {
    product_id: 'A', variant_id: 'SKU-A', action: 'swap', replacement: { product_id: 'C', variant_id: 'SKU-C' }
  });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(order.items.map(i => [i.product_id, i.unit_price, i.out_of_stock]), [['C', 18, undefined], ['B', 15, undefined]]);
  assert.equal(order.pricing.total, 43);
  assert.equal(order.refunded_amount, 2);
  assert.equal(order.removed_items[0].action, 'swapped');
  assert.equal(order.removed_items[0].replaced_by.product_id, 'C');
  assert.equal(f.reserved.length, 1);
  assert.match(f.notifications[0].comment_content, /Item A swapped for Item C\. \$2 refunded\./);
});

test('swap refused for a more expensive item, a subscription line, or no stock', async () => {
  const pricey = { _id: 'D', name: 'Item D', is_active: true, images: [], variants: [{ sku: 'SKU-D', label: 'Default', price: 25 }] };
  const cheap = { _id: 'C', name: 'Item C', is_active: true, images: [], variants: [{ sku: 'SKU-C', label: 'Default', price: 18 }] };

  let order = orderDoc(); order.items[0].out_of_stock = true;
  let f = fixture(order, { products: { D: pricey } });
  let { res } = await call(f.api, 'resolveOutOfStockLine', order, { product_id: 'A', variant_id: 'SKU-A', action: 'swap', replacement: { product_id: 'D', variant_id: 'SKU-D' } });
  assert.equal(res.statusCode, 400);
  assert.equal(order.items[0].product_id, 'A');

  order = orderDoc(); order.items[0].out_of_stock = true; order.items[0].purchase_type = 'subscription';
  f = fixture(order, { products: { C: cheap } });
  ({ res } = await call(f.api, 'resolveOutOfStockLine', order, { product_id: 'A', variant_id: 'SKU-A', action: 'swap', replacement: { product_id: 'C', variant_id: 'SKU-C' } }));
  assert.equal(res.statusCode, 400);

  order = orderDoc(); order.items[0].out_of_stock = true;
  f = fixture(order, { products: { C: cheap }, stockOk: false });
  ({ res } = await call(f.api, 'resolveOutOfStockLine', order, { product_id: 'A', variant_id: 'SKU-A', action: 'swap', replacement: { product_id: 'C', variant_id: 'SKU-C' } }));
  assert.equal(res.statusCode, 409);
  assert.equal(order.saved, 0);
});

test('COD order: removing a line lowers the amount to collect, nothing refunded', async () => {
  const order = orderDoc({ payment_status: 'pending', payment: { method: 'cod' } });
  order.items[0].out_of_stock = true;
  const f = fixture(order);
  await call(f.api, 'resolveOutOfStockLine', order, { product_id: 'A', variant_id: 'SKU-A', action: 'remove' });
  assert.equal(order.pricing.total, 25);
  assert.equal(order.refunded_amount, 0);
  assert.match(f.notifications[0].comment_content, /Item A removed\. New total \$25\./);
});

test('removing the last line left cancels the order', async () => {
  const order = orderDoc({ items: [line('A', 20)], pricing: { subtotal: 20, shipping_cost: 0, discount_amount: 0, total: 20 }, coupon: null });
  order.items[0].out_of_stock = true;
  const f = fixture(order);
  const { res } = await call(f.api, 'resolveOutOfStockLine', order, { product_id: 'A', variant_id: 'SKU-A', action: 'remove' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(order.order_status, 'canceled');
  assert.equal(order.payment_status, 'refunded');
});

test('a line not marked out of stock cannot be resolved', async () => {
  const order = orderDoc();
  const f = fixture(order);
  const { res } = await call(f.api, 'resolveOutOfStockLine', order, { product_id: 'A', variant_id: 'SKU-A', action: 'remove' });
  assert.equal(res.statusCode, 400);
});
