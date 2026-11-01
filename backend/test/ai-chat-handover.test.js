const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(relative, mocks = {}, DateClass = Date) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports, Date) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports, DateClass);
  return module.exports;
}

function fixture() {
  const conversations = new Map(), messages = new Map(), events = [], updates = [];
  let ended = 0;
  const transaction = { withTransaction: async fn => fn(), endSession: async () => ended++ };
  const conversationModel = {
    db: { startSession: async () => transaction },
    findOne: query => ({ session: async () => conversations.get(query.ai_session_id) || null }),
    create: async ([data]) => {
      const value = { ...data, unread_agent: 0, save: async () => {}, toObject() { return { ...this }; } };
      conversations.set(data.ai_session_id, value);
      return [value];
    }
  };
  const messageModel = { bulkWrite: async operations => {
    let upsertedCount = 0;
    for (const { updateOne } of operations) {
      const key = JSON.stringify(updateOne.filter);
      if (!messages.has(key)) { messages.set(key, updateOne.update.$setOnInsert); upsertedCount++; }
    }
    return { upsertedCount };
  } };
  const mocks = {
    '../models/ChatConversation': conversationModel, '../models/ChatMessage': messageModel,
    '../models/AiChatSession': { updateOne: async (query, update) => updates.push({ query, update }) },
    '../models/User': { findById: () => ({ lean: async () => ({ user_id: 'USR1' }) }) },
    './chat.service': { newConversationId: () => 'CHAT1' },
    './socket.service': { emitChatEvent: (type, payload) => events.push({ type, payload }) }
  };
  const session = {
    session_id: 'AI1', user_id: '507f1f77bcf86cd799439011', summary: 'Customer needs an order change', handover_reason: 'order_change',
    dify_conversation_id: 'DIFY1', messages: [
      { message_id: 'M1', sender: 'user', text: 'Change my order', created_at: new Date('2026-10-27T02:00:00Z') },
      { message_id: 'M2', sender: 'ai', text: 'I can help', metadata: { orderCard: { code: 'ORD1' } }, created_at: new Date('2026-10-27T02:00:01Z') }
    ]
  };
  return { service: load('../src/services/ai-chat-handover.service.js', mocks), session, conversations, messages, events, updates, mocks, ended: () => ended };
}

test('customer mode follows the support conversation when AI session status is stale', async () => {
  const session = { session_id: 'AI1', user_id: null, status: 'ai_active', support_conversation_id: 'CHAT1', messages: [] };
  let status = 'open';
  const service = load('../src/services/ai-chat-session.js', {
    '../models/AiChatSession': { findOne: async () => session },
    '../models/ChatConversation': { findOne: () => ({ lean: async () => ({ status }) }) }
  });
  const open = await service.readSession({ sessionId: 'AI1', userId: null });
  assert.equal(open.body.human_chat, true);
  assert.equal(open.body.status, 'in_progress');
  status = 'closed';
  const closed = await service.readSession({ sessionId: 'AI1', userId: null });
  assert.equal(closed.body.human_chat, false);
  assert.equal(closed.body.status, 'ai_active');
});

test('customer session labels all agent replies as Offsite without personal names', async () => {
  const session = { session_id: 'AI1', user_id: null, status: 'waiting', messages: [
    { message_id: 'M1', sender: 'agent', agent_id: 'STAFF1', text: 'Hello' },
    { message_id: 'M2', sender: 'agent', agent_id: '507f1f77bcf86cd799439011', text: 'Welcome' },
    { message_id: 'M3', sender: 'agent', agent_id: 'REMOVED', text: 'Old reply' }
  ] };
  const service = load('../src/services/ai-chat-session.js', {
    '../models/AiChatSession': { findOne: async () => session },
    '../models/User': { find: () => ({ lean: async () => [
      { user_id: 'STAFF1', _id: '507f1f77bcf86cd799439011', profile_name: 'Quỳnh Duyên' }
    ] }) }
  });
  const { body } = await service.readSession({ sessionId: 'AI1', userId: null });
  assert.equal(body.messages[0].metadata.agentInfo.senderName, 'Offsite');
  assert.equal(body.messages[1].metadata.agentInfo.avatarInitial, 'OS');
  assert.equal(body.messages[2].metadata.agentInfo.senderName, 'Offsite');
});

test('receipts require agent access and persist only customer messages up to the acknowledged time', async () => {
  const writes = [], mirrors = [];
  let allowed = true, query;
  const controller = load('../src/controllers/chat.controller.js', {
    '../services/chat.service': { canAccessConversation: async () => allowed },
    '../models/ChatConversation': { findOne: async () => ({ conversation_id: 'CHAT1', ai_session_id: 'AI1' }) },
    '../models/ChatMessage': {
      find: filter => { query = filter; return { lean: async () => [{ _id: 'DB1', source_message_id: 'M1' }] }; },
      updateMany: async (...args) => writes.push(args)
    },
    '../models/AiChatSession': { updateOne: async (...args) => mirrors.push(args) }
  });
  const res = { sendStatus(code) { this.code = code; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  const req = { params: { id: 'CHAT1' }, user: {}, body: { status: 'seen', through: '2026-11-01T06:00:00Z' } };
  await controller.receipt(req, res);
  assert.equal(res.body.success, true);
  assert.equal(query.sender_type, 'customer');
  assert.equal(query.created_at.$lte.toISOString(), req.body.through.replace('Z', '.000Z'));
  assert.equal(writes[0][0]['metadata.delivery_status'].$ne, 'seen');
  assert.equal(writes[0][1][0].$set.metadata.$mergeObjects[1].delivery_status, 'seen');
  assert.equal(mirrors[0][0].session_id, 'AI1');
  allowed = false;
  await controller.receipt(req, res);
  assert.equal(res.code, 403);
  assert.equal(writes.length, 1);
});

test('CSKH can read unclaimed waiting chats including guests, but not another agent thread', async () => {
  const { canAccessConversation } = load('../src/services/chat.service.js', {
    '../models/User': { findOne: () => ({ lean: async () => ({ assigned_chat_customer_ids: [] }) }) }
  });
  const agent = { user_id: 'STAFF1', role: 'cskh' };
  const waiting = { customer_id: 'guest:AI1', status: 'waiting', agent_id: null };
  assert.equal(await canAccessConversation(agent, waiting), true);
  assert.equal(await canAccessConversation(agent, { ...waiting, status: 'open', agent_id: 'STAFF1' }), true);
  assert.equal(await canAccessConversation(agent, { ...waiting, status: 'open', agent_id: 'STAFF2' }), false);
  assert.equal(await canAccessConversation({ user_id: 'CUSTOMER2', role: 'customer' }, waiting), false);
});

test('CSKH list includes the waiting queue and their own chats without assigned customers', async () => {
  let filter;
  const controller = load('../src/controllers/chat.controller.js', {
    '../models/User': {
      findOne: () => ({ lean: async () => ({ assigned_chat_customer_ids: [] }) }),
      find: () => ({ lean: async () => [] })
    },
    '../models/ChatConversation': { find: query => {
      filter = query;
      return { sort: () => ({ limit: () => ({ lean: async () => [{ conversation_id: 'CHAT1', customer_id: 'guest:AI1' }] }) }) };
    } }
  });
  const res = { json(body) { this.body = body; }, status() { return this; } };
  await controller.listConversations({ user: { user_id: 'STAFF1', role: 'cskh' }, query: {} }, res);
  assert.deepEqual(filter.$or, [
    { customer_id: { $in: [] } }, { agent_id: 'STAFF1' }, { status: 'waiting', agent_id: null }
  ]);
  assert.equal(res.body.data[0].conversation_id, 'CHAT1');
});

test('socket chat queue uses the stored admin role and canonical user ID', async () => {
  let authenticate, connection;
  class Server {
    use(handler) { authenticate = handler; }
    on(event, handler) { if (event === 'connection') connection = handler; }
  }
  let account = { user_id: 'ADMIN1', role: 'admin', status: 'active' };
  const service = load('../src/services/socket.service.js', {
    'socket.io': { Server },
    'jsonwebtoken': { verify: () => ({ user_id: '507f1f77bcf86cd799439011', role: 'customer' }) },
    '../models/User': { findOne: () => ({ lean: async () => account }) }
  });
  service.initSocket({});
  const handlers = {}, rooms = [], errors = [];
  const socket = {
    handshake: { headers: {}, auth: { token: 'valid' } },
    on: (event, handler) => { handlers[event] = handler; },
    join: room => rooms.push(room), emit: (event, payload) => errors.push({ event, payload })
  };
  await authenticate(socket, error => { assert.ifError(error); });
  assert.equal(socket.user.user_id, 'ADMIN1');
  assert.equal(socket.user.role, 'admin_cc');
  connection(socket);
  handlers.join_chat_agents();
  assert.deepEqual(rooms, ['chat_agents']);
  account = { ...account, status: 'suspended' };
  await authenticate(socket, error => { assert.ifError(error); });
  assert.equal(socket.user, null);
  handlers.join_chat_agents();
  assert.equal(rooms.length, 1);
  assert.equal(errors[0].event, 'error');
});

test('handover creates a waiting conversation, copies context and then emits to admin', async () => {
  const f = fixture();
  const conversation = await f.service.handoverAiSession(f.session);
  assert.equal(conversation.customer_id, 'USR1');
  assert.equal(conversation.status, 'waiting');
  assert.equal(conversation.summary, f.session.summary);
  assert.equal(conversation.handover_reason, 'order_change');
  assert.equal(conversation.dify_conversation_id, 'DIFY1');
  assert.deepEqual([...f.messages.values()].map(message => message.sender_type), ['customer', 'bot']);
  assert.deepEqual([...f.messages.values()][1].metadata, f.session.messages[1].metadata);
  assert.equal([...f.messages.values()][0].created_at, f.session.messages[0].created_at);
  assert.equal(f.updates[0].update.$set.support_conversation_id, 'CHAT1');
  assert.equal(f.events[0].type, 'chat_handoff');
  assert.equal(f.events[0].payload.conversation_id, 'CHAT1');
  assert.equal(f.ended(), 1);
});

test('repeated handovers do not duplicate the conversation or transcript, or unclaim an agent', async () => {
  const f = fixture();
  const conversation = await f.service.handoverAiSession(f.session);
  conversation.status = 'open'; conversation.agent_id = 'ADMIN1';
  await f.service.handoverAiSession(f.session);
  assert.equal(f.conversations.size, 1);
  assert.equal(f.messages.size, 2);
  assert.equal(conversation.unread_agent, 1);
  assert.equal(conversation.agent_id, 'ADMIN1');
  assert.equal(f.session.status, 'in_progress');
});

test('guest handovers use an isolated customer identity and retain legacy message IDs', async () => {
  const f = fixture(); f.session.user_id = null;
  f.session.messages[0].message_id = null;
  const conversation = await f.service.handoverAiSession(f.session);
  assert.equal(conversation.customer_id, 'guest:AI1');
  assert.equal([...f.messages.values()][0].source_message_id, 'AI1:0');
});

test('a failed transcript copy does not emit a successful handover', async () => {
  const f = fixture();
  f.mocks['../models/ChatMessage'].bulkWrite = async () => { throw new Error('write failed'); };
  await assert.rejects(f.service.handoverAiSession(f.session), /write failed/);
  assert.equal(f.events.length, 0);
  assert.equal(f.ended(), 1);
});

test('agent replies persist to the conversation and original AI session with the same source ID', async () => {
  const writes = [], mirrors = [];
  const session = { withTransaction: async fn => fn(), endSession: async () => {} };
  const service = load('../src/services/chat.service.js', {
    '../models/ChatConversation': { db: { startSession: async () => session }, updateOne: async () => {} },
    '../models/ChatMessage': { create: async ([data]) => { writes.push(data); return [{ ...data, _id: 'DB1', created_at: new Date() }]; } },
    '../models/AiChatSession': { updateOne: async (_, data) => mirrors.push(data) }
  });
  await service.appendMessage({ conversation_id: 'CHAT1', ai_session_id: 'AI1' }, { sender_type: 'agent', sender_id: 'ADMIN1', content: 'Hello' });
  assert.equal(mirrors[0].$push.messages.sender, 'agent');
  assert.equal(mirrors[0].$push.messages.agent_id, 'ADMIN1');
  assert.equal(writes[0].source_message_id, mirrors[0].$push.messages.message_id);
  assert.equal(writes[0].source_session_id, 'AI1');
});

test('live support sessions do not rotate because the AI message limit or idle time passed', () => {
  const { decisionFor } = require('../src/services/ai-chat-session.policy');
  assert.equal(decisionFor({ status: 'waiting', support_conversation_id: 'CHAT1', created_at: new Date(0), last_activity_at: new Date(0), messages: [] }), 'continue');
});

test('the human request endpoint invokes the shared handover service', async () => {
  const f = fixture(); let forwarded = false;
  const session = { ...f.session, handover_notes: [], save: async () => {} };
  class SupportHours extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-27T03:00:00Z'])); } }
  const api = load('../src/controllers/ai-chat.controller.js', {
    '../services/ai-chat-session': { prepareSession: async () => ({ session }), appendMessage: (value, message) => value.messages.push(message) },
    '../services/ai-chat-handover.service': { handoverAiSession: async value => { forwarded = value === session; } },
    '../models/User': { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    '../services/socket.service': { emitChatHandover: () => {} }
  }, SupportHours);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await api.requestHandover({ body: { session_id: 'AI1', reason: 'user_request' }, user: { user_id: 'USR1' }, headers: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.handover, true);
  assert.equal(session.status, 'waiting');
  assert.ok(forwarded);
});
