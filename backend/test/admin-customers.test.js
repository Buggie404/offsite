const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

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

function customerDoc(fields = {}) {
  return {
    user_id: 'USR00042', profile_name: 'Mai Anh', role: 'customer', status: 'active', saved: false,
    async save() { this.saved = true; },
    toObject() { return { ...this }; },
    ...fields
  };
}

function loadApi({ customer = customerDoc(), users = [], assigned = [], chatted = [] } = {}) {
  const seen = { notes: [] };
  const api = load('../src/controllers/admin-customers.controller.js', {
    '../models/User': {
      findOne: (query) => {
        seen.findOne = query;
        const result = query.role === 'customer' ? customer : { profile_name: 'Khoa Nguyen', user_id: 'STAFF1', assigned_chat_customer_ids: assigned };
        return Object.assign(Promise.resolve(result), { lean: async () => result });
      },
      countDocuments: async (query) => { seen.listQuery ??= query; return users.length; },
      find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => users }) }) }) })
    },
    '../models/Order': { aggregate: async () => [] },
    '../models/ChatConversation': { aggregate: async () => [], distinct: async (field, filter) => { seen.chatScope = filter; return chatted; } },
    '../models/AccountReport': { aggregate: async () => [] },
    '../models/Subscription': {},
    '../models/CustomerNote': {
      create: async (doc) => { seen.notes.push(doc); return { note_id: 'N1', created_at: new Date(), ...doc }; }
    }
  });
  const logs = [];
  const req = (body = {}, query = {}) => ({
    body, query, params: { userId: 'USR00042' }, user: { user_id: '64b7f0c2a1b2c3d4e5f60718', role: 'qlsp' },
    writeActivityLog: async (entry) => { logs.push(entry); }
  });
  return { api, req, seen, logs, customer };
}

// A customer with `count` orders, newest first: ORD00{count} ... ORD001.
function loadOrdersApi({ count, customer = customerDoc() }) {
  const all = Array.from({ length: count }, (_, i) => ({
    order_id: `ORD${String(count - i).padStart(3, '0')}`, created_at: new Date(2026, 6, count - i),
    items: [{ quantity: 2 }, { quantity: 1 }], pricing: { total: 10 }, order_status: 'delivered'
  }));
  const seen = {};
  const api = load('../src/controllers/admin-customers.controller.js', {
    '../models/User': { findOne: () => ({ lean: async () => customer }) },
    '../models/Order': {
      countDocuments: async (query) => { seen.countQuery = query; return all.length; },
      find: (query) => {
        seen.findQuery = query;
        return { sort: (order) => { seen.sort = order; return { skip: (n) => ({ limit: (size) => ({ lean: async () => all.slice(n, n + size) }) }) }; } };
      }
    },
    '../models/Subscription': {}, '../models/CustomerNote': {}
  });
  const run = async (page) => {
    const res = response();
    await api.listCustomerOrders({
      params: { userId: 'USR00042' }, query: page ? { page: String(page) } : {}, user: { user_id: '64b7f0c2a1b2c3d4e5f60718', role: 'qlsp' }
    }, res);
    return res;
  };
  return { run, seen };
}

test('a customer\'s purchase history lists every order, 20 a page, newest first', async () => {
  const { run, seen } = loadOrdersApi({ count: 34 });
  const first = await run();
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.total, 34);
  assert.equal(first.body.limit, 20);
  assert.equal(first.body.data.length, 20);
  assert.equal(first.body.data[0].order_id, 'ORD034');
  assert.equal(first.body.data[0].item_count, 3);
  assert.deepEqual(seen.findQuery, { user_id: 'USR00042' });
  assert.equal(seen.sort.created_at, -1);

  const second = await run(2);
  assert.equal(second.body.page, 2);
  assert.equal(second.body.data.length, 14);
  assert.equal(second.body.data.at(-1).order_id, 'ORD001');
});

test('purchase history of an unknown customer is 404', async () => {
  const { run } = loadOrdersApi({ count: 0, customer: null });
  assert.equal((await run()).statusCode, 404);
});

test('list filters by tier and status and searches name, @handle, email or phone', async () => {
  const { api, req, seen } = loadApi();
  const res = response();
  await api.listCustomers(req({}, { tier: 'Bloom', status: 'suspended', q: '@mai.matcha' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.listQuery.role, 'customer');
  assert.equal(seen.listQuery.membership_tier, 'Bloom');
  assert.equal(seen.listQuery.status, 'suspended');
  assert.equal(seen.listQuery.$or[1].community_name.source, 'mai\\.matcha');
});

test('active filter excludes current community restrictions and expired restrictions are cleared in rows', async () => {
  const users = [
    customerDoc({ user_id: 'U1', community_restriction: { until: new Date(Date.now() + 86400000), reason: 'Spam' } }),
    customerDoc({ user_id: 'U2', community_restriction: { until: new Date(Date.now() - 1000), reason: 'Old' } })
  ];
  const { api, req, seen } = loadApi({ users });
  const res = response();
  await api.listCustomers(req({}, { status: 'active' }), res);
  assert.equal(seen.listQuery.status.$ne, 'suspended');
  assert.ok(seen.listQuery['community_restriction.until'].$not.$gt instanceof Date);
  assert.equal(res.body.data[0].restricted_reason, 'Spam');
  assert.ok(res.body.data[0].restricted_until);
  assert.equal(res.body.data[1].restricted_until, null);
});

test('an unknown tier is ignored instead of matching nothing', async () => {
  const { api, req, seen } = loadApi();
  await api.listCustomers(req({}, { tier: 'Gold' }), response());
  assert.equal('membership_tier' in seen.listQuery, false);
});

test('CSKH can list all registered customers without assignment or conversation filters', async () => {
  const { api, req, seen } = loadApi({ users: [customerDoc({ user_id: 'UNASSIGNED' })] });
  const request = req({}, { tier: 'Seed', q: 'Mai', page: '2' });
  request.user.role = 'cskh';
  const res = response();
  await api.listCustomers(request, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].user_id, 'UNASSIGNED');
  assert.equal(res.body.total, 1);
  assert.equal(res.body.page, 2);
  assert.equal(seen.listQuery.role, 'customer');
  assert.deepEqual(seen.listQuery.$and, [{ $or: [{ membership_tier: 'Seed' }, { membership_tier: null }, { membership_tier: '' }] }]);
  assert.equal(seen.listQuery.user_id, undefined);
  assert.equal(res.body.data[0].can_view_detail, false);
  assert.ok(seen.listQuery.$or);
});

test('CSKH Seed filtering includes default tiers without overwriting the name search or status filter', async () => {
  const { api, req, seen } = loadApi();
  const request = req({}, { tier: 'Seed', q: '@mai', status: 'active' });
  request.user.role = 'cskh';
  const res = response();
  await api.listCustomers(request, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen.listQuery.$and[0].$or, [{ membership_tier: 'Seed' }, { membership_tier: null }, { membership_tier: '' }]);
  assert.equal(seen.listQuery.$or[1].community_name.source, 'mai');
  assert.deepEqual(seen.listQuery.status, { $ne: 'suspended' });
  const otherRole = loadApi();
  await otherRole.api.listCustomers(otherRole.req({}, { tier: 'Seed' }), response());
  assert.equal(otherRole.seen.listQuery.membership_tier, 'Seed');
  assert.equal(otherRole.seen.listQuery.$and, undefined);
});

test('restricted filter selects active community penalties separately from suspended accounts', async () => {
  const { api, req, seen } = loadApi();
  const res = response();
  await api.listCustomers(req({}, { status: 'restricted' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen.listQuery.status, { $ne: 'suspended' });
  assert.ok(seen.listQuery['community_restriction.until'].$gt instanceof Date);
});

test('CSKH cannot read any detail resource for an unassigned customer', async () => {
  const { api, req } = profileApi();
  for (const handler of [api.getCustomer, api.listCustomerOrders, api.listCustomerConversations, api.listCustomerConversationMessages]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.data, undefined);
  }
});

test('conversation messages are scoped to both customer and conversation and returned chronologically', async () => {
  const seen = {};
  const query = result => ({ lean: async () => result });
  const api = load('../src/controllers/admin-customers.controller.js', {
    '../models/ChatConversation': { findOne: filter => { seen.conversation = filter; return query({ conversation_id: 'CHAT1', agent_id: 'STAFF1', status: 'closed' }); } },
    '../models/ChatMessage': { find: filter => { seen.messages = filter; return { sort: order => { seen.sort = order; return { limit: limit => { seen.limit = limit; return query([{ _id: 'NEW' }, { _id: 'OLD' }]); } }; } }; } }
  });
  const res = response();
  await api.listCustomerConversationMessages({ user: { role: 'admin_cc', user_id: 'STAFF1' }, params: { userId: 'USR1', conversationId: 'CHAT1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen.conversation, { customer_id: 'USR1', conversation_id: 'CHAT1' });
  assert.deepEqual(seen.messages, { conversation_id: 'CHAT1' });
  assert.equal(seen.sort.created_at, -1);
  assert.equal(seen.limit, 500);
  assert.deepEqual(res.body.data.map(row => row._id), ['OLD', 'NEW']);
});

test('no admin can lock a customer account', async () => {
  const { api, req, logs, customer } = loadApi();
  const res = response();
  await api.setCustomerStatus(req({ status: 'suspended', reason: 'Chargeback fraud' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'CUSTOMER_LOCK_DISABLED');
  assert.equal(customer.status, 'active');
  assert.equal(customer.saved, false);
  assert.equal(logs.length, 0);
});

test('unlocking clears the suspension and is logged as user.unsuspend', async () => {
  const customer = customerDoc({ status: 'suspended', suspended_reason: 'Spam', suspended_at: new Date() });
  const { api, req, logs } = loadApi({ customer });
  const res = response();
  await api.setCustomerStatus(req({ status: 'active' }), res);
  assert.equal(customer.status, 'active');
  assert.equal(customer.suspended_reason, null);
  assert.equal(logs[0].actionType, 'user.unsuspend');
});

test('internal notes store the author role and are logged; empty notes are rejected', async () => {
  const { api, req, seen, logs } = loadApi();

  const empty = response();
  await api.addCustomerNote(req({ content: '   ' }), empty);
  assert.equal(empty.statusCode, 400);

  const res = response();
  await api.addCustomerNote(req({ content: 'Asked to change delivery address.' }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(seen.notes[0].customer_id, 'USR00042');
  assert.equal(seen.notes[0].author_role, 'qlsp');
  assert.equal(seen.notes[0].author_name, 'Khoa Nguyen');
  assert.equal(logs[0].actionType, 'customer.add_note');
});

function profileApi({ claimed = false, assigned = [], pastChats = 4 } = {}) {
  const seen = {};
  const query = value => ({ lean: async () => value, sort() { return this; }, skip() { return this; }, limit() { return this; } });
  const api = load('../src/controllers/admin-customers.controller.js', {
    '../models/User': { find: () => query([]), findOne: filter => query(filter.role === 'customer'
      ? customerDoc({ email: 'mai@example.com', createdAt: new Date('2025-03-01') })
      : { _id: '64b7f0c2a1b2c3d4e5f60718', user_id: 'STAFF1', assigned_chat_customer_ids: assigned }) },
    '../models/ChatConversation': {
      find: filter => { seen.historyFilter = filter; return query([]); },
      exists: async filter => { seen.claimFilter = filter; return claimed ? { _id: 'chat' } : null; },
      countDocuments: async filter => { seen.countFilter = filter; return pastChats; }
    },
    '../models/Order': { countDocuments: async () => 1, aggregate: async () => [], find: () => query([{ order_id: 'OF1029', order_status: 'processing', items: [], pricing: { total: 74.8 } }]) },
    '../models/Subscription': { countDocuments: async () => 2 },
    '../models/CustomerNote': { find: () => query([]) },
    '../models/Voucher': { find: () => query([]) }
  });
  const req = { user: { user_id: '64b7f0c2a1b2c3d4e5f60718', role: 'cskh' }, params: { userId: 'USR00042' }, query: {}, body: { content: 'Private note' } };
  return { api, req, seen };
}

test('CSKH customer profile includes real orders, subscriptions and all past chats', async () => {
  const { api, req, seen } = profileApi({ claimed: true });
  const res = response();
  await api.getCustomer(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.email, 'mai@example.com');
  assert.equal(res.body.data.recent_orders, undefined);
  const orders = response(); await api.listCustomerOrders(req, orders);
  assert.equal(orders.statusCode, 200);
  assert.equal(orders.body.data[0].order_id, 'OF1029');
  assert.equal(res.body.data.ritual_boxes, 2);
  assert.equal(res.body.data.past_chats, 4);
  assert.deepEqual(seen.claimFilter.agent_id.$in.sort(), ['64b7f0c2a1b2c3d4e5f60718', 'STAFF1']);
  assert.deepEqual(seen.countFilter, { customer_id: 'USR00042', status: 'closed' });
});

test('explicitly assigned customer profile remains readable without claiming', async () => {
  const { api, req, seen } = profileApi({ assigned: ['USR00042'] });
  const res = response();
  await api.getCustomer(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.claimFilter, undefined);
});

test('claiming grants profile read access without expanding note-writing permissions', async () => {
  const { api, req } = profileApi({ claimed: true });
  const res = response();
  await api.addCustomerNote(req, res);
  assert.equal(res.statusCode, 403);
});

test('Assigned to me combines explicit assignments and owned chats before pagination', async () => {
  const { api, req, seen } = loadApi({ assigned: ['DIRECT'], chatted: ['CHAT', 'DIRECT'], users: [customerDoc({ user_id: 'CHAT' })] });
  const request = req({}, { assignment: 'mine', status: 'active', q: 'Mai', page: '2' });
  request.user.role = 'cskh';
  const res = response();
  await api.listCustomers(request, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen.listQuery.user_id, { $in: ['DIRECT', 'CHAT'] });
  assert.deepEqual(seen.chatScope.agent_id.$in, ['64b7f0c2a1b2c3d4e5f60718', 'STAFF1']);
  assert.deepEqual(seen.chatScope.status.$in, ['open', 'closed']);
  assert.equal(res.body.data[0].can_view_detail, true);
  assert.equal(res.body.assigned_total, 1);
  assert.equal(res.body.page, 2);
  assert.ok(seen.listQuery.$or);
});
