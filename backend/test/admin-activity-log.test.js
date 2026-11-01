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

const ADMIN_MONGO_ID = '64b7f0c2a1b2c3d4e5f60718';

function loadApi(logs) {
  const seen = {};
  const api = load('../src/controllers/admin-activity-log.controller.js', {
    '../models/ActivityLog': {
      countDocuments: async filter => { seen.filter = filter; return logs.length; },
      find: () => ({ sort: () => ({ skip: n => { seen.skip = n; return { limit: () => ({ lean: async () => logs }) }; } }) }),
      distinct: async () => []
    },
    '../models/User': {
      findOne: () => ({ lean: async () => ({ _id: ADMIN_MONGO_ID, user_id: 'USR00007' }) }),
      find: () => ({ lean: async () => [{ _id: ADMIN_MONGO_ID, user_id: 'USR00007', profile_name: 'Khoa Nguyen', email: 'khoa@offsite.vn' }] })
    },
    '../services/activity-log.service': { ...require('../src/services/activity-log.service'), unsavedActivityLogCount: () => 0 }
  });
  return { api, seen };
}

test('filters by role, action, time and a literal search', async () => {
  const { api, seen } = loadApi([]);
  const res = response();
  await api.listActivityLogs({ query: {
    admin_role: 'qlsp', action_type: 'staff.change_role',
    from: '2026-10-01T00:00:00.000Z', to: '2026-10-07T23:59:59.999Z', q: 'COF.HB', page: '3', limit: '20'
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(seen.filter.admin_role, 'qlsp');
  assert.equal(seen.filter.action_type, 'staff.change_role');
  assert.equal(seen.filter.created_at.$gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(seen.filter.created_at.$lte.toISOString(), '2026-10-07T23:59:59.999Z');
  assert.equal(seen.filter.$or[0].target_id.source, 'COF\\.HB');
  assert.equal(seen.skip, 40);
});

test('searching a name finds logs by that admin and logs targeting that user', async () => {
  const { api, seen } = loadApi([]);
  await api.listActivityLogs({ query: { q: '@Khoa' } }, response());
  assert.ok(seen.filter.$or.some((clause) => clause.admin_id?.$in.includes(ADMIN_MONGO_ID)));
  assert.ok(seen.filter.$or.some((clause) => clause.target_id?.$in?.includes('USR00007')));
});

test('the action filter lists every known action, logged or not, and rows carry its name', async () => {
  const { ACTION_TYPES } = require('../src/constants/action-types');
  const { api } = loadApi([{
    log_id: 'L1', admin_id: ADMIN_MONGO_ID, admin_role: 'qlsp', action_type: 'staff.reset_password',
    target_entity: 'user', target_id: 'USR00007', created_at: new Date()
  }]);
  const res = response();
  await api.listActivityLogs({ query: { include_facets: 'true' } }, res);
  assert.deepEqual(res.body.facets.action_types, ACTION_TYPES);
  assert.equal(res.body.data[0].action_label, 'Password reset');
});

test('old action names read as the new name; filtering by the new name also finds old logs', async () => {
  const stored = {
    log_id: 'L1', admin_id: ADMIN_MONGO_ID, admin_role: 'admin_cc', action_type: 'SUBSCRIPTION_PAUSED',
    target_entity: 'subscription', target_id: 'SUB0001', created_at: new Date()
  };
  const { api, seen } = loadApi([stored]);
  const res = response();
  await api.listActivityLogs({ query: { action_type: 'subscription.pause', target_entity: 'Subscriptions', include_facets: 'true' } }, res);

  assert.deepEqual(seen.filter.action_type, { $in: ['subscription.pause', 'SUBSCRIPTION_PAUSED'] });
  assert.deepEqual(seen.filter.target_entity, { $in: ['Subscriptions', 'subscription'] });
  assert.equal(res.body.data[0].action_type, 'subscription.pause');
  assert.equal(res.body.data[0].action_label, 'Ritual Box paused');
  assert.equal(res.body.data[0].target_entity, 'Subscriptions');
  assert.ok(res.body.facets.action_types.every((type) => !type.value.startsWith('SUBSCRIPTION_')));
  assert.equal(stored.action_type, 'SUBSCRIPTION_PAUSED');
});

test('every action written by a controller is listed in ACTION_TYPES, with a unique name', () => {
  const { ACTION_TYPES, isKnownActionType } = require('../src/constants/action-types');
  const dir = path.resolve(__dirname, '../src/controllers');
  const source = fs.readdirSync(dir).map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n');
  const literals = [...source.matchAll(/actionType:[^,\n]*/g)].flatMap(([match]) => [...match.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.ok(literals.length >= 20);
  // suspended / disabled are the status values compared in the ternaries, not action types.
  for (const type of literals.filter((value) => !['suspended', 'disabled'].includes(value))) {
    assert.ok(isKnownActionType(type), type);
  }
  for (const action of ['pause', 'skip', 'unpause', 'propose', 'withdraw_proposal', 'cancel', 'note']) assert.ok(isKnownActionType(`subscription.${action}`));
  for (const action of ['hide', 'restore', 'warn', 'lock', 'unlock', 'dismiss']) assert.ok(isKnownActionType(`community.${action}`));
  assert.equal(new Set(ACTION_TYPES.map((type) => type.label)).size, ACTION_TYPES.length);
});

test('ignores an unknown role and an invalid date instead of failing', async () => {
  const { api, seen } = loadApi([]);
  const res = response();
  await api.listActivityLogs({ query: { admin_role: 'customer', from: 'not-a-date' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal('admin_role' in seen.filter, false);
  assert.equal('created_at' in seen.filter, false);
});

test('rows carry the acting admin name and the role stored on the log', async () => {
  const { api } = loadApi([{
    log_id: 'L1', admin_id: ADMIN_MONGO_ID, admin_role: 'qlsp', action_type: 'product.batch-expiry',
    target_entity: 'Products', target_id: 'COF-HB-250', old_value: { price: 30 }, new_value: { price: 32 }, created_at: new Date()
  }]);
  const res = response();
  await api.listActivityLogs({ query: {} }, res);
  assert.equal(res.body.data[0].actor.name, 'Khoa Nguyen');
  assert.equal(res.body.data[0].actor.role, 'qlsp');
});

test('CSV cells quote commas, quotes and line breaks', () => {
  const { csvCell } = load('../src/controllers/admin-activity-log.controller.js', {});
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell({ role: 'cskh' }), '"{""role"":""cskh""}"');
  assert.equal(csvCell(null), '');
});
