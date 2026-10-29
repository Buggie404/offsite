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

function loadApi({ customer = customerDoc(), users = [] } = {}) {
  const seen = { notes: [] };
  const api = load('../src/controllers/admin-customers.controller.js', {
    '../models/User': {
      findOne: (query) => {
        seen.findOne = query;
        const result = query.role === 'customer' ? customer : { profile_name: 'Khoa Nguyen' };
        return Object.assign(Promise.resolve(result), { lean: async () => result });
      },
      countDocuments: async (query) => { seen.listQuery = query; return users.length; },
      find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => users }) }) }) })
    },
    '../models/Order': { aggregate: async () => [] },
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

test('an unknown tier is ignored instead of matching nothing', async () => {
  const { api, req, seen } = loadApi();
  await api.listCustomers(req({}, { tier: 'Gold' }), response());
  assert.equal('membership_tier' in seen.listQuery, false);
});

test('locking a customer needs a reason, then is saved and logged as user.suspend', async () => {
  const { api, req, logs, customer } = loadApi();

  const missing = response();
  await api.setCustomerStatus(req({ status: 'suspended', reason: ' ' }), missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(customer.saved, false);

  const res = response();
  await api.setCustomerStatus(req({ status: 'suspended', reason: 'Chargeback fraud' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(customer.status, 'suspended');
  assert.equal(customer.suspended_reason, 'Chargeback fraud');
  assert.equal(res.body.data.status, 'suspended');
  assert.equal(logs[0].actionType, 'user.suspend');
  assert.equal(logs[0].reason, 'Chargeback fraud');
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
