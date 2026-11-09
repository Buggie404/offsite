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

const AGENT_ID = '64b7f0c2a1b2c3d4e5f60718';
const lean = (value) => ({ lean: async () => value });

function service(assigned = []) {
  return load('../src/services/chat.service.js', {
    '../models/ChatConversation': {},
    '../models/ChatMessage': {},
    '../models/User': {
      findById: () => lean({ user_id: 'USR00002' }),
      findOne: () => lean({ assigned_chat_customer_ids: assigned })
    }
  });
}

const agent = { user_id: AGENT_ID, role: 'cskh' };

test('cskh can reach any waiting chat, so the shared queue can be claimed', async () => {
  const allowed = await service().canAccessConversation(agent, { customer_id: 'USR00050', status: 'waiting', agent_id: null });
  assert.equal(allowed, true);
});

test('cskh keeps the chats they claimed, staff ids are the Mongo _id', async () => {
  const allowed = await service().canAccessConversation(agent, { customer_id: 'USR00050', status: 'open', agent_id: AGENT_ID });
  assert.equal(allowed, true);
});

test('customer assignment does not grant access to another agent conversation', async () => {
  const taken = { customer_id: 'USR00050', status: 'open', agent_id: 'ANOTHER' };
  assert.equal(await service().canAccessConversation(agent, taken), false);
  assert.equal(await service(['USR00050']).canAccessConversation(agent, taken), false);
});

test('list resolves JWT Mongo identity and includes only own chats and unclaimed queue', async () => {
  let filter;
  const controller = load('../src/controllers/chat.controller.js', {
    '../services/chat.service': service(),
    '../services/socket.service': {},
    '../models/User': {
      findOne: query => {
        assert.equal(query.user_id, 'USR00002');
        return lean({ assigned_chat_customer_ids: ['CUSTOMER1'] });
      },
      find: () => lean([])
    },
    '../models/ChatConversation': {
      find: query => {
        filter = query;
        return { sort: () => ({ limit: () => lean([]) }) };
      }
    }
  });
  const res = { json() {}, status() { throw new Error('Unexpected error'); } };
  await controller.listConversations({ user: agent, query: {} }, res);
  assert.deepEqual(filter.$or, [{ agent_id: { $in: ['USR00002', AGENT_ID] } }, { status: 'waiting', agent_id: null }]);
});

test('claim accepts a legacy assignment and writes the application user ID atomically', async () => {
  const conversation = {
    conversation_id: 'CHAT1', customer_id: 'CUSTOMER1', status: 'open', agent_id: AGENT_ID,
    toObject() { return { ...this }; }
  };
  const controller = load('../src/controllers/chat.controller.js', {
    '../services/chat.service': { ...service(), appendMessage: async () => null },
    '../services/socket.service': { emitChatEvent() {} },
    '../services/chat-assignment.service': { assignConversation: async options => {
      assert.equal(options.targetId, 'USR00002');
      assert.ok(options.actorIds.includes(AGENT_ID));
      return { toObject: () => ({ ...conversation, agent_id: 'USR00002', status: 'open' }) };
    } },
    '../models/ChatConversation': {
      findOne: async () => conversation,
      findOneAndUpdate: async (query, update) => {
        assert.deepEqual(query.$or, [{ agent_id: null }, { agent_id: { $in: ['USR00002', AGENT_ID] } }]);
        assert.equal(update.$set.agent_id, 'USR00002');
        return { ...conversation, ...update.$set };
      }
    }
  });
  const res = { json(body) { this.body = body; }, status() { throw new Error('Unexpected error'); } };
  await controller.claimConversation({ user: agent, params: { id: 'CHAT1' } }, res);
  assert.equal(res.body.data.agent_id, 'USR00002');
});

test('senior admin can access all conversations', async () => {
  const senior = { ...agent, role: 'admin_cc' };
  assert.equal(await service().canAccessConversation(senior, { customer_id: 'C1', agent_id: 'OTHER', status: 'closed' }), true);
  assert.equal(await service().canAccessConversation(senior, { customer_id: 'C1', agent_id: 'USR00002', status: 'closed' }), true);
  assert.equal(await service().canAccessConversation(senior, { customer_id: 'C1', agent_id: null, status: 'waiting' }), true);
});

test('direct message API denies another admin conversation before reading messages', async () => {
  let read = false;
  const controller = load('../src/controllers/chat.controller.js', {
    '../services/chat.service': service(['CUSTOMER1']),
    '../models/ChatConversation': { findOne: async () => ({ conversation_id: 'PRIVATE', customer_id: 'CUSTOMER1', agent_id: 'OTHER', status: 'closed' }) },
    '../models/ChatMessage': { find: () => { read = true; throw new Error('Must not read'); } }
  });
  for (const role of ['cskh']) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await controller.getMessages({ user: { ...agent, role }, params: { id: 'PRIVATE' } }, res);
    assert.equal(res.code, 403);
    assert.equal(read, false);
  }
});

test('senior admin list is not scoped to an agent', async () => {
  let filter;
  const controller = load('../src/controllers/chat.controller.js', {
    '../models/User': { find: () => lean([]) },
    '../models/ChatConversation': { find: query => { filter = query; return { sort: () => ({ limit: () => lean([]) }) }; } }
  });
  await controller.listConversations({ user: { role: 'admin_cc', user_id: 'SENIOR' }, query: { status: 'closed' } }, { json() {}, status() { throw new Error('Unexpected failure'); } });
  assert.deepEqual(filter, { status: 'closed' });
});

test('handler display names are included only in the senior admin inbox response', async () => {
  const controller = load('../src/controllers/chat.controller.js', {
    '../services/chat.service': service(),
    '../models/User': { find: filter => lean(filter.role ? [{ _id: 'mongo-agent', user_id: 'STAFF1', profile_name: 'Quynh' }] : []) },
    '../models/ChatConversation': { find: () => ({ sort: () => ({ limit: () => lean([{ conversation_id: 'C1', customer_id: 'CUSTOMER1', agent_id: 'mongo-agent', status: 'closed', closed_by_name: 'Quynh' }]) }) }) }
  });
  for (const role of ['admin_cc', 'cskh']) {
    const res = { json(body) { this.body = body; }, status() { throw new Error('Unexpected failure'); } };
    await controller.listConversations({ user: { user_id: 'STAFF1', role }, query: {} }, res);
    assert.equal(res.body.data[0].agent_name, role === 'admin_cc' ? 'Quynh' : undefined);
    assert.equal(res.body.data[0].closed_by_name, role === 'admin_cc' ? 'Quynh' : null);
    if (role === 'admin_cc') assert.equal(res.body.data[0].agent_user_id, 'STAFF1');
  }
});
