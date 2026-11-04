const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/admin-orders-attention.test.js
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

const row = (order_id, order_status, extra = {}) => ({
  _id: order_id, order_id, order_status, user_id: 'USR1', created_at: new Date('2026-10-30T00:00:00Z'),
  pricing: { total: 10, currency: 'USD' }, delivery_info: { recipient_name: 'Mai' }, items: [{ purchase_type: 'one_time' }],
  subscription_start_failed: false, ...extra
});

function fixture(rows) {
  const seen = { aggregate: null, find: null, sort: null, counts: [] };
  const Order = {
    aggregate: async (pipeline) => { seen.aggregate = pipeline; return rows; },
    find: (filter) => {
      seen.find = filter;
      const chain = {
        sort: (s) => { seen.sort = s; return chain; },
        skip: () => chain, limit: () => chain, select: () => chain,
        lean: async () => rows
      };
      return chain;
    },
    countDocuments: async (filter) => { seen.counts.push(filter); return 0; }
  };
  const api = load('../src/controllers/admin.controller.js', { '../models/Order': Order });
  return { api, seen };
}

const call = async (api, query, user = { role: 'admin_cc' }) => {
  const res = response();
  await api.getAllOrders({ query, user }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
};

test('default listing pages urgent orders first in the database', async () => {
  const { api, seen } = fixture([]);
  await call(api, { page: '2', limit: '20' });
  assert.equal(seen.find, null);
  const [match, addFields, sort, skip, limit, project] = seen.aggregate;
  assert.deepEqual(match.$match.order_status, { $ne: 'canceled' }); // cancelled orders stay hidden
  assert.ok(addFields.$addFields._urgent);
  assert.deepEqual(sort, { $sort: { _urgent: -1, created_at: -1, _id: -1 } });
  assert.deepEqual(skip, { $skip: 20 });
  assert.deepEqual(limit, { $limit: 20 });
  assert.equal(project.$project.order_status, 1);
  assert.equal(project.$project._urgent, undefined);
});

test('a status filter keeps the plain newest-first order', async () => {
  const { api, seen } = fixture([]);
  await call(api, { order_status: 'shipping' });
  assert.equal(seen.aggregate, null);
  assert.equal(seen.find.order_status, 'shipping');
  assert.deepEqual(seen.sort, { created_at: -1, _id: -1 });
});

test('each order carries needs_attention and its reasons', async () => {
  const { api } = fixture([
    row('A', 'pending_refund'),
    row('B', 'delivery_failed'),
    row('C', 'processing', { subscription_start_failed: true }),
    row('D', 'refund'),
    row('E', 'refund_rejected'),
    row('F', 'shipping')
  ]);
  const body = await call(api, {});
  const flags = Object.fromEntries(body.data.map(o => [o.order_id, [o.needs_attention, o.attention_reasons]]));
  assert.deepEqual(flags, {
    A: [true, ['pending_refund']],
    B: [true, ['delivery_failed']],
    C: [true, ['ritual_box_not_started']],
    D: [false, []],
    E: [false, []],
    F: [false, []]
  });
});

test('Needs attention filter, stat card and sort share one definition', async () => {
  const { api, seen } = fixture([]);
  await call(api, { attention: 'needs_attention' });
  const expected = [{ order_status: { $in: ['pending_refund', 'delivery_failed'] } }, { subscription_start_failed: true }];
  assert.deepEqual(seen.aggregate[0].$match.$or, expected);
  assert.deepEqual(seen.aggregate[0].$match.order_status, { $ne: 'canceled' });
  const statCount = seen.counts.find(f => f.$or);
  assert.deepEqual(statCount.$or, expected);
});

test('the Ritual Box-only filter used by dashboard links still works', async () => {
  const { api, seen } = fixture([]);
  await call(api, { attention: 'ritual_box_not_started' });
  assert.equal(seen.aggregate[0].$match.subscription_start_failed, true);
  assert.equal(seen.aggregate[0].$match.$or, undefined);
});

test('CSKH (view only) sees only assigned customers, urgent first too', async () => {
  const { api, seen } = fixture([]);
  await call(api, {}, { role: 'cskh', assigned_chat_customer_ids: ['USR7'] });
  assert.deepEqual(seen.aggregate[0].$match.user_id, { $in: ['USR7'] });
  assert.ok(seen.counts.every(f => JSON.stringify(f.user_id) === JSON.stringify({ $in: ['USR7'] })));
});
