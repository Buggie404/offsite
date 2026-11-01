const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/activity-log-legacy-aliases.test.js
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

function response() {
  return {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(body) { this.body = body; return this; }
  };
}

const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) =>
  cond && typeof cond === 'object' && '$in' in cond ? cond.$in.includes(doc[key]) : doc[key] === cond);

function fixture() {
  const stored = [
    { log_id: 'L1', created_at: new Date('2026-09-01'), admin_id: 'USR1', admin_role: 'admin_cc', action_type: 'SUBSCRIPTION_PAUSED', target_entity: 'subscription', target_id: 'SUB0001' },
    { log_id: 'L2', created_at: new Date('2026-10-01'), admin_id: 'USR1', admin_role: 'admin_cc', action_type: 'subscription.pause', target_entity: 'Subscriptions', target_id: 'SUB0002' },
    { log_id: 'L3', created_at: new Date('2026-10-02'), admin_id: 'USR1', admin_role: 'cskh', action_type: 'subscription.skip', target_entity: 'Subscriptions', target_id: 'SUB0003' },
    { log_id: 'L4', created_at: new Date('2026-10-03'), admin_id: 'USR1', admin_role: 'admin_cc', action_type: 'order.status', target_entity: 'Orders', target_id: 'OFS-1' }
  ];
  const before = structuredClone(stored);
  const sorted = docs => docs.slice().sort((a, b) => b.created_at - a.created_at);
  // Read-only model: any write would throw, and the rows are compared with a copy afterwards.
  const ActivityLog = {
    countDocuments: async filter => stored.filter(d => matches(d, filter)).length,
    find: filter => {
      const rows = sorted(stored.filter(d => matches(d, filter)));
      const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => rows.map(r => ({ ...r })) };
      return chain;
    },
    distinct: async field => [...new Set(stored.map(d => d[field]))]
  };
  const User = {
    findOne: () => ({ lean: async () => null }),
    find: () => ({ lean: async () => [{ _id: 'x', user_id: 'USR1', profile_name: 'Mai', role: 'admin_cc' }] })
  };
  const api = load('../src/controllers/admin-activity-log.controller.js', {
    '../models/ActivityLog': ActivityLog,
    '../models/User': User,
    '../services/activity-log.service': load('../src/services/activity-log.service.js', { '../models/ActivityLog': {} })
  });
  return { api, stored, before };
}

async function list(api, query) {
  const res = response();
  await api.listActivityLogs({ query }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

test('a legacy SUBSCRIPTION_PAUSED log is shown as subscription.pause', async () => {
  const f = fixture();
  const body = await list(f.api, {});
  const legacy = body.data.find(l => l.log_id === 'L1');
  assert.equal(legacy.action_type, 'subscription.pause');
  assert.equal(legacy.target_entity, 'Subscriptions');
  assert.deepEqual(f.stored, f.before); // nothing written back
});

test('filtering by subscription.pause finds the legacy and the current log', async () => {
  const f = fixture();
  const body = await list(f.api, { action_type: 'subscription.pause' });
  assert.deepEqual(body.data.map(l => l.log_id), ['L2', 'L1']);
  assert.equal(body.total, 2);
  assert.ok(body.data.every(l => l.action_type === 'subscription.pause'));
  assert.deepEqual(f.stored, f.before);
});

test('filtering by the legacy name also finds both', async () => {
  const f = fixture();
  const body = await list(f.api, { action_type: 'SUBSCRIPTION_PAUSED' });
  assert.deepEqual(body.data.map(l => l.log_id).sort(), ['L1', 'L2']);
});

test('names without a legacy alias filter exactly as before', async () => {
  const f = fixture();
  assert.deepEqual((await list(f.api, { action_type: 'subscription.skip' })).data.map(l => l.log_id), ['L3']);
  assert.deepEqual((await list(f.api, { action_type: 'order.status' })).data.map(l => l.log_id), ['L4']);
});

test('target_entity Subscriptions also matches the legacy "subscription"', async () => {
  const f = fixture();
  const body = await list(f.api, { target_entity: 'Subscriptions' });
  assert.deepEqual(body.data.map(l => l.log_id).sort(), ['L1', 'L2', 'L3']);
});

test('the action filter dropdown offers only current names, never a legacy one', async () => {
  const f = fixture();
  const body = await list(f.api, { include_facets: 'true' });
  const values = body.facets.action_types.map(t => t.value);
  assert.ok(values.includes('subscription.pause'));
  assert.ok(values.every(v => !/^SUBSCRIPTION_/.test(v)));
  assert.equal(new Set(values).size, values.length);
});

test('CSV export shows the current name', async () => {
  const f = fixture();
  const res = response();
  await f.api.exportActivityLogs({ query: { action_type: 'subscription.pause' } }, res);
  assert.match(res.body, /subscription\.pause,Subscriptions,SUB0001/);
  assert.doesNotMatch(res.body, /SUBSCRIPTION_PAUSED/);
  assert.deepEqual(f.stored, f.before);
});
