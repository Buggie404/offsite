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

// A post by USR00009 with 2 pending reports from USR00001 / USR00002.
function setup({ postStatus = 'visible', ownerStatus = 'active' } = {}) {
  const calls = { hidden: [], restored: [], notifications: [], reportUpdates: [], records: [], logs: [] };
  const owner = {
    user_id: 'USR00009', role: 'customer', status: ownerStatus, community_name: 'green.tea.deals', community_warnings: [],
    saved: 0, async save() { this.saved += 1; }, toObject() { return { ...this }; }
  };
  const api = load('../src/controllers/admin-moderation.controller.js', {
    '../models/Post': { findOne: () => ({ lean: async () => ({ post_id: 'P1', user_id: 'USR00009', author: { username: 'green.tea.deals' }, status: postStatus }) }) },
    '../models/Comment': {},
    '../models/User': {
      findOne: (query, fields) => {
        if (query.user_id === 'USR00009') return Promise.resolve(owner);
        const admin = { profile_name: 'Ha Pham' };
        return Object.assign(Promise.resolve(admin), { lean: async () => admin });
      }
    },
    '../models/Report': {
      distinct: async () => ['USR00001', 'USR00002'],
      updateMany: async (filter, update) => { calls.reportUpdates.push({ filter, update }); return { modifiedCount: 2 }; }
    },
    '../models/ModerationAction': { create: async (doc) => { calls.records.push(doc); return { action_id: 'A1', ...doc }; } },
    '../services/post-moderation.service': {
      hidePost: async (id) => { calls.hidden.push(id); return {}; },
      unhidePost: async (id) => { calls.restored.push(id); return {}; }
    },
    '../services/comment-moderation.service': { hideComment: async () => ({}), unhideComment: async () => ({}) },
    '../services/notification.service': { createNotification: async (n) => { calls.notifications.push(n); } }
  });
  const req = (body) => ({
    body: { target_type: 'post', target_id: 'P1', ...body },
    user: { user_id: '64b7f0c2a1b2c3d4e5f60718', role: 'cskh' },
    writeActivityLog: async (entry) => { calls.logs.push(entry); }
  });
  return { api, req, calls, owner };
}

test('hide, warn and lock need the message the author receives', async () => {
  for (const action of ['hide', 'warn', 'lock']) {
    const { api, req, calls } = setup();
    const res = response();
    await api.moderate(req({ action, message: '  ' }), res);
    assert.equal(res.statusCode, 400, action);
    assert.equal(calls.hidden.length, 0);
  }
});

test('hiding uses the group 4 post service, closes reports, notifies the author and reporters, and logs', async () => {
  const { api, req, calls } = setup();
  const res = response();
  await api.moderate(req({ action: 'hide', message: 'Your post was hidden because it contains misleading claims.', notify_reporters: true }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.hidden, ['P1']);
  assert.deepEqual(calls.reportUpdates[0].filter, { target_type: 'post', post_id: 'P1', status: 'pending' });
  assert.equal(calls.reportUpdates[0].update.$set.status, 'reviewed');
  const toAuthor = calls.notifications.find((n) => n.recipient_id === 'USR00009');
  assert.equal(toAuthor.type, 'COMMUNITY_MODERATION');
  assert.equal(toAuthor.post_id, 'P1');
  assert.equal(calls.notifications.filter((n) => n.type === 'COMMUNITY_REPORT_RESOLVED').length, 2);
  assert.equal(calls.records[0].action, 'hide');
  assert.equal(calls.logs[0].actionType, 'community.hide');
  assert.match(calls.logs[0].reason, /misleading/);
});

test('warning adds a warning to the account and can also hide the post', async () => {
  const { api, req, calls, owner } = setup();
  const res = response();
  await api.moderate(req({ action: 'warn', message: 'Please keep it kind.', also_hide: true }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(owner.community_warnings.length, 1);
  assert.equal(owner.saved, 1);
  assert.deepEqual(calls.hidden, ['P1']);
  assert.equal(calls.records[0].also_hidden, true);
});

test('locking suspends the author; a locked author cannot be locked again', async () => {
  const { api, req, owner } = setup();
  const res = response();
  await api.moderate(req({ action: 'lock', message: 'Repeated scams.' }), res);
  assert.equal(owner.status, 'suspended');
  assert.equal(owner.suspended_reason, 'Repeated scams.');

  const again = setup({ ownerStatus: 'suspended' });
  const res2 = response();
  await again.api.moderate(again.req({ action: 'lock', message: 'Again' }), res2);
  assert.equal(res2.statusCode, 409);
});

test('restore only applies to hidden content; dismiss closes reports without notifying', async () => {
  const visible = setup();
  const res = response();
  await visible.api.moderate(visible.req({ action: 'restore' }), res);
  assert.equal(res.statusCode, 409);

  const hidden = setup({ postStatus: 'hidden' });
  const res2 = response();
  await hidden.api.moderate(hidden.req({ action: 'restore', message: 'Visible again.' }), res2);
  assert.equal(res2.statusCode, 200);
  assert.deepEqual(hidden.calls.restored, ['P1']);

  const dismiss = setup();
  const res3 = response();
  await dismiss.api.moderate(dismiss.req({ action: 'dismiss', message: 'ignored' }), res3);
  assert.equal(res3.statusCode, 200);
  assert.equal(dismiss.calls.reportUpdates[0].update.$set.status, 'dismissed');
  assert.equal(dismiss.calls.notifications.length, 0);
});
