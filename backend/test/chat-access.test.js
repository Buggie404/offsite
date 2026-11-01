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

test('cskh cannot open a chat another agent took, unless the customer is assigned to them', async () => {
  const taken = { customer_id: 'USR00050', status: 'open', agent_id: 'ANOTHER' };
  assert.equal(await service().canAccessConversation(agent, taken), false);
  assert.equal(await service(['USR00050']).canAccessConversation(agent, taken), true);
});
