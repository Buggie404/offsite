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

function staffDoc(fields) {
  return {
    _id: fields._id || 'mongo-' + fields.user_id,
    status: 'active',
    saved: false,
    async save() { this.saved = true; },
    toObject() { return { ...this }; },
    ...fields
  };
}

function loadStaffApi({ staff, activeAdminCcOthers = 1, openChats = [] }) {
  const logs = [];
  const api = load('../src/controllers/admin-staff.controller.js', {
    '../models/User': {
      findOne: async () => staff,
      countDocuments: async () => activeAdminCcOthers
    },
    '../models/ChatConversation': {
      find: async () => openChats,
      countDocuments: async () => openChats.length
    },
    '../models/AiChatSession': { updateOne: async () => ({}) },
    '../services/socket.service': { emitChatEvent: () => {} }
  });
  const req = (body, params = { userId: staff?.user_id }, userId = 'mongo-ME') => ({
    body, params, query: {}, user: { user_id: userId, role: 'admin_cc' },
    writeActivityLog: async entry => { logs.push(entry); }
  });
  return { api, req, logs };
}

test('temporary passwords meet the admin sign-in rule (8-15 chars, mixed, no spaces)', () => {
  const { generateTempPassword } = load('../src/controllers/admin-staff.controller.js', {});
  for (let i = 0; i < 50; i += 1) {
    const password = generateTempPassword();
    assert.ok(password.length >= 8 && password.length <= 15);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /\d/);
    assert.doesNotMatch(password, /\s/);
  }
});

test('an Admin CC cannot change their own role', async () => {
  const me = staffDoc({ _id: 'mongo-ME', user_id: 'USR00001', role: 'admin_cc' });
  const { api, req, logs } = loadStaffApi({ staff: me });
  const res = response();
  await api.changeStaffRole(req({ role: 'cskh' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'SELF_ROLE_CHANGE');
  assert.equal(me.saved, false);
  assert.equal(logs.length, 0);
});

test('the last active Admin CC can be neither demoted nor disabled', async () => {
  const last = staffDoc({ user_id: 'USR00002', role: 'admin_cc' });
  const { api, req } = loadStaffApi({ staff: last, activeAdminCcOthers: 0 });

  const roleRes = response();
  await api.changeStaffRole(req({ role: 'qlsp' }), roleRes);
  assert.equal(roleRes.statusCode, 409);
  assert.equal(roleRes.body.code, 'LAST_ADMIN_CC');

  const statusRes = response();
  await api.setStaffStatus(req({ status: 'disabled', reason: 'Left the company' }), statusRes);
  assert.equal(statusRes.statusCode, 409);
  assert.equal(last.saved, false);
});

test('changing role returns open chats to the queue and writes staff.change_role', async () => {
  const chat = { agent_id: 'mongo-USR00003', status: 'open', ai_session_id: null, async save() {}, toObject() { return this; } };
  const agent = staffDoc({ user_id: 'USR00003', role: 'cskh', assigned_chat_customer_ids: ['USR00099'] });
  const { api, req, logs } = loadStaffApi({ staff: agent, openChats: [chat] });
  const res = response();
  await api.changeStaffRole(req({ role: 'qlsp' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(agent.role, 'qlsp');
  assert.deepEqual(agent.assigned_chat_customer_ids, []);
  assert.equal(chat.status, 'waiting');
  assert.equal(chat.agent_id, null);
  assert.equal(res.body.returned_chats, 1);
  assert.equal(logs[0].actionType, 'staff.change_role');
  assert.deepEqual(logs[0].oldValue, { role: 'cskh' });
});

test('disabling requires a reason and is logged with it', async () => {
  const agent = staffDoc({ user_id: 'USR00004', role: 'qlsp' });
  const { api, req, logs } = loadStaffApi({ staff: agent });

  const missing = response();
  await api.setStaffStatus(req({ status: 'disabled', reason: '  ' }), missing);
  assert.equal(missing.statusCode, 400);

  const res = response();
  await api.setStaffStatus(req({ status: 'disabled', reason: 'Contract ended' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(agent.status, 'suspended');
  assert.equal(res.body.data.status, 'disabled');
  assert.equal(logs[0].actionType, 'staff.disable');
  assert.equal(logs[0].reason, 'Contract ended');
});

test('creating staff leaves null sparse-unique fields out and reports a customer email clearly', async () => {
  const inserted = [];
  let existing = null;
  function FakeUser(fields) {
    Object.assign(this, { phone: null, community_name: null, referral_code: null, status: 'active' }, fields);
  }
  FakeUser.prototype.validate = async function () {};
  FakeUser.prototype.toObject = function () { return { ...this }; };
  FakeUser.findOne = (query) => (query.user_id ? { sort: () => ({ lean: async () => null }) } : { lean: async () => existing });
  FakeUser.collection = { insertOne: async doc => { inserted.push(doc); } };
  const logs = [];
  const api = load('../src/controllers/admin-staff.controller.js', {
    '../models/User': FakeUser,
    '../models/ChatConversation': {},
    '../models/AiChatSession': {},
    '../services/socket.service': { emitChatEvent: () => {} },
    '../services/user-id.service': { nextUserId: async () => 'USR00042' }
  });
  const req = { body: { profile_name: 'Thuy  Zy', email: 'Thuy.Zy@Offsite.vn', role: 'cskh' }, user: { user_id: 'mongo-ME', role: 'admin_cc' },
    writeActivityLog: async entry => { logs.push(entry); } };

  const res = response();
  await api.createStaff(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(inserted[0].email, 'thuy.zy@offsite.vn');
  assert.equal(inserted[0].profile_name, 'Thuy Zy');
  for (const field of ['phone', 'community_name', 'referral_code']) assert.equal(field in inserted[0], false);
  assert.equal(inserted[0].must_change_password, true);
  assert.equal(inserted[0].user_id, 'USR00042');
  assert.ok(res.body.temp_password);
  assert.equal(logs[0].actionType, 'staff.create');

  existing = { role: 'customer' };
  const dup = response();
  await api.createStaff(req, dup);
  assert.equal(dup.statusCode, 409);
  assert.match(dup.body.error, /customer account/);
});

test('creating staff enforces required fields, the name format and the email format', async () => {
  const { api, req } = loadStaffApi({ staff: null });
  const valid = { profile_name: 'Nguyễn Đặng Thư', email: 'nguyen.thu@offsite.vn', role: 'cskh' };
  const cases = [
    [{ profile_name: '' }, 'profile_name'],
    [{ profile_name: 'Thu' }, 'profile_name'],
    [{ profile_name: 'Thu 123' }, 'profile_name'],
    [{ email: '' }, 'email'],
    [{ email: 'thu@offsite.vn' }, 'email'],
    [{ email: 'nguyen.thu@gmail.com' }, 'email'],
    [{ email: 'nguyễn.thu@offsite.vn' }, 'email'],
    [{ role: '' }, 'role']
  ];
  for (const [change, field] of cases) {
    const res = response();
    await api.createStaff(req({ ...valid, ...change }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(change));
    assert.equal(res.body.field, field);
  }
});

test('check-email reports a taken email and rejects a bad format', async () => {
  const api = load('../src/controllers/admin-staff.controller.js', {
    '../models/User': { findOne: (query) => ({ lean: async () => (query.email.test('thao.vo@offsite.vn') ? { role: 'qlsp' } : null) }) },
    '../models/ChatConversation': {},
    '../models/AiChatSession': {},
    '../services/socket.service': { emitChatEvent: () => {} }
  });

  const used = response();
  await api.checkStaffEmail({ query: { email: 'Thao.Vo@offsite.vn' } }, used);
  assert.equal(used.body.available, false);
  assert.match(used.body.error, /staff account/);

  const free = response();
  await api.checkStaffEmail({ query: { email: 'thao.vo2@offsite.vn' } }, free);
  assert.equal(free.body.available, true);

  const bad = response();
  await api.checkStaffEmail({ query: { email: 'thao@offsite.vn' } }, bad);
  assert.equal(bad.statusCode, 400);
});

test('enabling an account also requires a reason and is logged with it', async () => {
  const agent = staffDoc({ user_id: 'USR00005', role: 'qlsp', status: 'suspended', suspended_reason: 'Leave' });
  const { api, req, logs } = loadStaffApi({ staff: agent });

  const missing = response();
  await api.setStaffStatus(req({ status: 'active', reason: ' ' }), missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(agent.status, 'suspended');

  const res = response();
  await api.setStaffStatus(req({ status: 'active', reason: 'Back from leave' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(agent.status, 'active');
  assert.equal(logs[0].actionType, 'staff.enable');
  assert.equal(logs[0].reason, 'Back from leave');
});

function loadAuthMiddleware(account) {
  const jwt = { verify: () => ({ user_id: 'USR00009', role: 'cskh' }) };
  return load('../src/middleware/auth.middleware.js', {
    jsonwebtoken: jwt,
    '../config/auth': { JWT_SECRET: 'test' },
    '../models/User': { findOne: () => ({ lean: async () => account }) }
  }).authMiddleware;
}

async function runAuth(account, method, originalUrl) {
  const req = { method, originalUrl, headers: { authorization: 'Bearer token' } };
  const res = response();
  let passed = false;
  await loadAuthMiddleware(account)(req, res, () => { passed = true; });
  return { passed, res };
}

test('a temporary password only opens PUT /api/admin/change-password', async () => {
  const account = { status: 'active', role: 'cskh', must_change_password: true };

  assert.equal((await runAuth(account, 'PUT', '/api/admin/change-password')).passed, true);
  assert.equal((await runAuth(account, 'PUT', '/api/admin/change-password?x=1')).passed, true);

  for (const [method, url] of [
    ['GET', '/api/admin/orders'],
    ['GET', '/api/admin/change-password'],
    ['PUT', '/api/auth/change-password'],
    ['PUT', '/api/admin/change-password/x'],
    ['GET', '/api/chat/conversations']
  ]) {
    const { passed, res } = await runAuth(account, method, url);
    assert.equal(passed, false, `${method} ${url}`);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'PASSWORD_CHANGE_REQUIRED');
  }

  const changed = await runAuth({ ...account, must_change_password: false }, 'GET', '/api/admin/orders');
  assert.equal(changed.passed, true);
});
