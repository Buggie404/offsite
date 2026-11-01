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
function setup({ postStatus = 'visible', ownerStatus = 'active', restriction = null } = {}) {
  const calls = { hidden: [], restored: [], forfeited: [], notifications: [], reportUpdates: [], records: [], logs: [], abuseChecks: [] };
  const owner = {
    user_id: 'USR00009', role: 'customer', status: ownerStatus, email: 'mai@example.com', community_name: 'green.tea.deals', community_warnings: [], community_restriction: restriction,
    saved: 0, async save() { this.saved += 1; }, toObject() { return { ...this }; }
  };
  const api = load('../src/controllers/admin-moderation.controller.js', {
    '../models/Post': { findOne: () => ({ lean: async () => ({ post_id: 'P1', user_id: 'USR00009', author: { username: 'green.tea.deals' }, status: postStatus }) }) },
    '../models/Comment': {},
    '../models/User': {
      findOne: (query, fields) => {
        if (query.user_id === 'USR00009') return Object.assign(Promise.resolve(owner), { lean: async () => owner });
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
      unhidePost: async (id) => { calls.restored.push(id); return {}; },
      forfeitPostPoints: async (id) => { calls.forfeited.push(id); }
    },
    '../services/comment-moderation.service': { hideComment: async () => ({}), unhideComment: async () => ({}) },
    '../services/notification.service': { createNotification: async (n) => { calls.notifications.push(n); } },
    '../services/report-abuse.service': { warnReportAbusers: async (ids) => { calls.abuseChecks.push(ids); } }
  });
  const req = (body) => ({
    body: { target_type: 'post', target_id: 'P1', ...body },
    user: { user_id: '64b7f0c2a1b2c3d4e5f60718', role: 'cskh' },
    writeActivityLog: async (entry) => { calls.logs.push(entry); }
  });
  return { api, req, calls, owner };
}

test('hide and every penalty need the message the author receives', async () => {
  for (const action of ['hide', 'warn', 'suspend_3d', 'suspend_7d']) {
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
  await api.moderate(req({ action: 'hide', message: 'Your post was hidden because it contains misleading claims.' }), res);

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

test('a warning records level 1, hides the content and does not suspend', async () => {
  const { api, req, calls, owner } = setup();
  const res = response();
  await api.moderate(req({ action: 'warn', message: 'Please keep it kind.' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(owner.community_warnings[0].level, 1);
  assert.equal(owner.saved, 1);
  assert.equal(owner.community_restriction, null);
  assert.deepEqual(calls.hidden, ['P1']);
  assert.equal(calls.records[0].also_hidden, true);
  assert.equal(calls.notifications.filter((n) => n.type === 'COMMUNITY_REPORT_RESOLVED').length, 2);
});

test('suspensions last 3 or 7 days, hide the content, leave the account active and are logged', async () => {
  for (const [action, level, days] of [['suspend_3d', 2, 3], ['suspend_7d', 3, 7]]) {
    const { api, req, calls, owner } = setup();
    const before = Date.now();
    const res = response();
    await api.moderate(req({ action, message: 'Repeated spam.' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(owner.status, 'active');
    assert.equal(owner.community_restriction.level, level);
    const span = owner.community_restriction.until.getTime() - before;
    assert.ok(Math.abs(span - days * 86400000) < 5000, action);
    assert.deepEqual(calls.hidden, ['P1']);
    assert.equal(calls.records[0].action, action);
    assert.equal(calls.logs[0].actionType, `community.${action}`);
    assert.ok(calls.logs[0].newValue.restricted_until);
  }
});

test('reporters get the confirmation unless staff untick the box', async () => {
  const told = setup();
  await told.api.moderate(told.req({ action: 'warn', message: 'Please stop.' }), response());
  const sent = told.calls.notifications.filter((n) => n.type === 'COMMUNITY_REPORT_RESOLVED');
  assert.equal(sent.length, 2);
  assert.match(sent[0].message, /confirmed and applied/);

  const quiet = setup();
  await quiet.api.moderate(quiet.req({ action: 'warn', message: 'Please stop.', notify_reporters: false }), response());
  assert.equal(quiet.calls.notifications.filter((n) => n.type === 'COMMUNITY_REPORT_RESOLVED').length, 0);
  assert.equal(quiet.calls.notifications.filter((n) => n.recipient_id === 'USR00009').length, 1);
});

test('only rejected reports count towards report abuse', async () => {
  for (const [action, postStatus, counted] of [['dismiss', 'visible', true], ['restore', 'hidden', true], ['warn', 'visible', false], ['hide', 'visible', false]]) {
    const { api, req, calls } = setup({ postStatus });
    await api.moderate(req({ action, message: 'Reviewed.' }), response());
    assert.equal(calls.reportUpdates[0].update.$set.status, counted ? 'dismissed' : 'reviewed', action);
    assert.deepEqual(calls.abuseChecks, counted ? [['USR00001', 'USR00002']] : [], action);
  }
});

test('a penalty on an auto-hidden post keeps its points taken back', async () => {
  const { api, req, calls } = setup({ postStatus: 'hidden' });
  await api.moderate(req({ action: 'suspend_3d', message: 'Spam again.' }), response());
  assert.deepEqual(calls.hidden, []);
  assert.deepEqual(calls.forfeited, ['P1']);
});

// Runs the real hide / restore transitions on one post, counting what happens to its points.
function postService(initial = {}) {
  const post = { post_id: 'P1', status: 'visible', points_forfeited: false, ...initial };
  const points = { reversed: 0, restored: 0 };
  const session = { withTransaction: (fn) => fn(), endSession: async () => {} };
  const Post = {
    db: { startSession: async () => session },
    findOneAndUpdate: async (query, update) => {
      const hiding = update.$set.status === 'hidden';
      if ((post.status === 'hidden') === hiding) return null;
      Object.assign(post, update.$set);
      return post;
    }
  };
  const service = load('../src/services/post-moderation.service.js', {
    '../models/Post': Post,
    '../models/PostReport': { updateMany: async () => ({}) },
    './points.service': {
      reverseCommunityPoints: async () => { points.reversed += 1; },
      restoreCommunityPoints: async () => { points.restored += 1; }
    }
  });
  return { service, post, points };
}

test('points taken back by staff stay gone after a restore', async () => {
  const { service, post, points } = postService();
  await service.hidePost('P1', { reason: 'manual', adminId: 'A1' });
  await service.unhidePost('P1');
  assert.equal(post.status, 'visible');
  assert.equal(points.restored, 0);
});

test('an older auto-hidden post gets its points back when restored', async () => {
  const { service, points } = postService({ status: 'hidden', hidden_reason: 'auto_reports' });
  await service.unhidePost('P1');
  assert.equal(points.restored, 1);
});

test('a lighter penalty never shortens a running suspension', async () => {
  const until = new Date(Date.now() + 6 * 86400000);
  const { api, req, owner } = setup({ restriction: { level: 3, until } });
  await api.moderate(req({ action: 'suspend_3d', message: 'Again.' }), response());
  assert.equal(owner.community_restriction.level, 3);
  assert.equal(owner.community_restriction.until.getTime(), until.getTime());
});

test('lifting ends the suspension; an account with none cannot be lifted', async () => {
  const active = setup({ restriction: { level: 2, until: new Date(Date.now() + 86400000) } });
  const res = response();
  await active.api.moderate(active.req({ action: 'restore', target_type: 'account', target_id: 'USR00009' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(active.owner.community_restriction, null);
  assert.equal(active.calls.records[0].action, 'lift');

  const expired = setup({ restriction: { level: 2, until: new Date(Date.now() - 1000) } });
  const res2 = response();
  await expired.api.moderate(expired.req({ action: 'restore', target_type: 'account', target_id: 'USR00009' }), res2);
  assert.equal(res2.statusCode, 409);
});

test('no admin can lock the author from the reports queue', async () => {
  const { api, req, owner } = setup();
  const res = response();
  await api.moderate(req({ action: 'lock', message: 'Repeated scams.' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(owner.status, 'active');
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
