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
    '../services/activity-log.service': { unsavedActivityLogCount: () => 0 }
  });
  return { api, seen };
}

test('filters by person (either id form), role, action, time and a literal search', async () => {
  const { api, seen } = loadApi([]);
  const res = response();
  await api.listActivityLogs({ query: {
    admin_id: 'USR00007', admin_role: 'qlsp', action_type: 'staff.change_role',
    from: '2026-10-01T00:00:00.000Z', to: '2026-10-07T23:59:59.999Z', q: 'COF.HB', page: '3', limit: '20'
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen.filter.admin_id, { $in: [ADMIN_MONGO_ID, 'USR00007'] });
  assert.equal(seen.filter.admin_role, 'qlsp');
  assert.equal(seen.filter.action_type, 'staff.change_role');
  assert.equal(seen.filter.created_at.$gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(seen.filter.created_at.$lte.toISOString(), '2026-10-07T23:59:59.999Z');
  assert.equal(seen.filter.$or[0].target_id.source, 'COF\\.HB');
  assert.equal(seen.skip, 40);
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
