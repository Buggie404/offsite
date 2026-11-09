const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative);
  const module = { exports: {} };
  const realRequire = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } });

test('customer follow-up creates an unassigned waiting session and preserves the closed chat', async () => {
  const policy = require('../src/services/chat-policy');
  let sessionUpdate, archived, created = 0, active = null;
  const chat = { conversation_id: 'CHAT1', customer_id: 'USR1', agent_id: 'STAFF1', status: 'closed', close_reason: 'resolved', close_outcome: 'resolved', closed_at: new Date(Date.now() - 1000), ai_session_id: 'AI1' };
  const transaction = { withTransaction: async fn => fn(), endSession: async () => {} };
  const api = load('../src/services/chat-lifecycle.service.js', {
    './chat-policy': { ...policy, supportOpen: () => true },
    '../models/ChatConversation': {
      db: { startSession: async () => transaction },
      findOne: filter => ({ session: async () => filter.conversation_id ? chat : active }),
      updateOne: async (_, update) => { archived = update.$set; },
      create: async docs => { created++; active = { ...docs[0], toObject() { return { ...this }; } }; return [active]; }
    },
    '../models/AiChatSession': { updateOne: async (_, update) => { sessionUpdate = update.$set; } },
    './socket.service': { emitChatEvent() {} }
  });
  assert.equal(await api.reopenForCustomer(chat, 'OTHER'), null);
  const result = await api.reopenForCustomer(chat, 'USR1');
  assert.notEqual(result.conversation_id, 'CHAT1');
  assert.equal(result.status, 'waiting'); assert.equal(result.agent_id, null);
  assert.equal(chat.status, 'closed'); assert.equal(chat.agent_id, 'STAFF1');
  assert.deepEqual(archived, { archived_ai_session_id: 'AI1', ai_session_id: null });
  assert.equal(sessionUpdate.support_conversation_id, result.conversation_id);
  assert.equal(sessionUpdate.assigned_admin_id, null);
  assert.equal(await api.reopenForCustomer(chat, 'USR1'), result);
  assert.equal(created, 1);
});

test('idle expiry closes chat and AI support together, but skips a chat with newer activity', async () => {
  const now = new Date('2026-11-08T06:00:00Z');
  let changed = false, syncs = 0, emits = 0;
  const transaction = { withTransaction: async fn => fn(), endSession: async () => {} };
  const chat = { conversation_id: 'CHAT1', status: 'open', ai_session_id: 'AI1' };
  const api = load('../src/services/chat-lifecycle.service.js', {
    '../models/ChatConversation': {
      db: { startSession: async () => transaction },
      find: query => { assert.equal(query.status, 'open'); return { limit: () => ({ lean: async () => [chat] }) }; },
      findOneAndUpdate: async (query, update) => {
        assert.equal(query.last_message_at.$lte.toISOString(), '2026-11-08T03:00:00.000Z');
        return changed ? null : { ...chat, ...update.$set, toObject: () => ({ ...chat, ...update.$set }) };
      }
    },
    '../models/AiChatSession': { updateOne: async (_, update) => { syncs++; assert.equal(update.$set.status, 'ai_active'); } },
    './socket.service': { emitChatEvent() { emits++; } }
  });
  await api.closeIdleChats(now);
  assert.equal(syncs, 1); assert.equal(emits, 1);
  changed = true;
  await api.closeIdleChats(now);
  assert.equal(syncs, 1); assert.equal(emits, 1);
});

test('realtime chat data reaches current agent, customer and senior admins after transfer', () => {
  const emissions = [];
  const client = (id, role, appId) => ({ user: { user_id: id, role, chat_user_id: appId }, rooms: new Set(['chat_CHAT1']), emit(event, payload) { emissions.push({ id, event, payload }); } });
  class Server {
    sockets = { sockets: new Map([['a', client('mongo-a', 'cskh', 'STAFF1')], ['b', client('mongo-b', 'admin_cc', 'STAFF2')], ['c', client('mongo-c', 'customer', 'USR1')], ['d', client('mongo-d', 'admin_cc', 'SENIOR')]]) };
    use() {} on() {} to() { return { emit() {} }; }
  }
  const socket = load('../src/services/socket.service.js', { 'socket.io': { Server } });
  socket.initSocket({});
  socket.emitChatEvent('chat_updated', { conversation_id: 'CHAT1', customer_id: 'USR1', agent_id: 'STAFF2', status: 'open', transfers: [{ note: 'Private context' }] });
  assert.deepEqual(emissions.map(row => row.id), ['mongo-b', 'mongo-c', 'mongo-d']);
  assert.ok(emissions.every(row => !Object.hasOwn(row.payload, 'transfers')));
  emissions.length = 0;
  socket.emitChatEvent('chat_message', { conversation_id: 'CHAT1', content: 'Private reply' }, { customer_id: 'USR1', agent_id: 'STAFF2', status: 'open' });
  assert.deepEqual(emissions.map(row => row.id), ['mongo-b', 'mongo-c', 'mongo-d']);
});

test('CSKH customer list stays scoped and profile outside assignments and owned chats is denied', async () => {
  let filter;
  const api = load('../src/controllers/admin-customers.controller.js', {
    '../models/User': {
      findOne: () => ({ lean: async () => ({ _id: 'mongo', user_id: 'STAFF1', assigned_chat_customer_ids: ['USR1'] }) }),
      countDocuments: async query => { filter = query; return 0; },
      find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) })
    },
    '../models/ChatConversation': { exists: async () => null }
  });
  const req = { user: { user_id: 'STAFF1', role: 'cskh' }, query: {}, params: { userId: 'UNASSIGNED' } };
  let res = response(); await api.listCustomers(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(filter.user_id, { $in: ['USR1'] });
  res = response(); await api.getCustomer(req, res); assert.equal(res.statusCode, 403);
  res = response(); await api.addCustomerNote({ ...req, body: { content: 'No access' } }, res); assert.equal(res.statusCode, 403);
});

test('LLM gateway logs community_bridge usage without storing raw post text', async () => {
  const previousKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-key';
  let log;
  try {
    const service = load('../src/services/llm.service.js', { '../models/AiCallLog': { create: async row => { log = row; } } });
    const result = await service.completeJson({ feature: 'community_bridge', userId: 'USR1', sessionId: 'S1', system: 'test', input: { post: 'private post' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"products":[]}' } }], usage: { total_tokens: 20 } }) }) });
    assert.deepEqual(result, { products: [] });
    assert.equal(log.feature, 'community_bridge'); assert.equal(log.total_tokens, 20);
    assert.equal(JSON.stringify(log).includes('private post'), false);
  } finally { if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey; }
});

test('assignment locks staff before counting capacity and refuses the sixth CSKH chat', async () => {
  let locked = false, count = 5, written = false;
  const transaction = { withTransaction: async fn => fn(), endSession: async () => {} };
  const chat = { conversation_id: 'CHAT1', status: 'waiting', agent_id: null };
  const api = load('../src/services/chat-assignment.service.js', {
    './chat-policy': { MAX_AGENT_CHATS: 5, supportOpen: () => true },
    '../models/User': {
      findOne: () => ({ session: () => ({ lean: async () => ({ _id: 'mongo1', user_id: 'STAFF1', role: 'cskh' }) }) }),
      updateOne: async () => { locked = true; }
    },
    '../models/ChatConversation': {
      db: { startSession: async () => transaction },
      findOne: () => ({ session: async () => chat }),
      countDocuments: () => ({ session: async () => { assert.equal(locked, true); return count; } }),
      findOneAndUpdate: async (query, update) => { written = true; assert.equal(update.$set.agent_id, 'STAFF1'); return { ...chat, ...update.$set }; }
    }
  });
  const args = { conversationId: 'CHAT1', targetId: 'STAFF1', actorIds: ['STAFF1'], actorRole: 'cskh' };
  await assert.rejects(api.assignConversation(args), error => error.status === 409);
  assert.equal(written, false);
  count = 4;
  assert.equal((await api.assignConversation(args)).agent_id, 'STAFF1');
  chat.status = 'open'; chat.agent_id = 'OTHER';
  await assert.rejects(api.assignConversation({ ...args, transfer: true, note: 'context' }), error => error.status === 403);
});

test('AI fallback accepts only supplied in-stock product IDs with confidence >= 0.6', async () => {
  const catalog = [1, 2].map(id => ({ product_id: id, name: `Coffee ${id}`, category: 'coffee', product_tag: [], variants: [{ stock: 1, price: 10 }] }));
  const tags = load('../src/services/product-tag.service.js', {
    '../models/Product': { find: () => ({ limit: () => ({ lean: async () => catalog }) }) },
    './llm.service': { completeJson: async context => {
      assert.equal(context.feature, 'community_bridge');
      return { products: [{ product_id: 999, confidence: 1 }, { product_id: 1, confidence: 0.8 }, { product_id: 2, confidence: 0.4 }] };
    } }
  });
  const result = await tags.suggestProductTags({ content: 'something rich', userId: 'USR1' });
  assert.deepEqual(result.map(row => row.product_id), [1]);
});

test('suggest-again quota is stored on the server and scoped to the author, even for empty results', async () => {
  let attempts = 1;
  const api = load('../src/controllers/post-products.controller.js', {
    '../services/product-tag.service': { suggestProductTags: async () => [] },
    './profiles.controller': { currentCommunityUserId: async () => 'USR1' },
    '../models/ProductSuggestionSession': {
      create: async () => ({ session_id: 'S1', attempts }),
      findOneAndUpdate: async query => {
        assert.equal(query.user_id, 'USR1'); assert.equal(query.attempts.$lt, 3);
        return attempts < 3 ? { session_id: 'S1', attempts: ++attempts } : null;
      }
    }
  });
  const req = { body: { content: 'coffee' } };
  let res = response(); await api.suggestProducts(req, res);
  assert.equal(res.body.remaining, 2);
  req.body.suggestion_session_id = 'S1';
  for (const remaining of [1, 0]) { res = response(); await api.suggestProducts(req, res); assert.equal(res.body.remaining, remaining); }
  res = response(); await api.suggestProducts(req, res); assert.equal(res.statusCode, 429);
});

test('post schema permits five total products but rejects four AI tags', async () => {
  const Post = require('../src/models/Post');
  const post = new Post({ post_id: 'P1', base: 'COFFEE', author: {}, linked_products: [1, 2, 3, 4, 5], ai_product_ids: [1, 2, 3] });
  await post.validate();
  post.ai_product_ids = [1, 2, 3, 4];
  await assert.rejects(post.validate(), /At most 3 AI/);
});

test('public DNA badge uses the versioned archetype and does not expose the private radar', async () => {
  const api = load('../src/controllers/profiles.controller.js', {
    '../models/User': { findOne: () => ({ lean: async () => ({ user_id: 'USR1', ritual_dna: { quiz_taken_at: new Date(), archetype_id: 'A2', archetype_profile_version: 3, taste_radar: { private: true } } }) }) },
    '../models/Post': { countDocuments: async () => 0 },
    '../services/follow-list': { countVisibleFollows: async () => 0 },
    '../services/ritual-dna.archetype-release': { archetypeForProfile: async (id, version) => {
      assert.equal(id, 'A2'); assert.equal(version, 3);
      return { archetype_id: id, name: 'Bold explorer' };
    } }
  });
  const res = response();
  await api.getPublicProfile({ params: { userId: 'USR1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.ritual_dna_badge, { id: 'A2', name: 'Bold explorer' });
  assert.equal(res.body.ritual_dna, undefined);
});

test('feed always paginates even with all=true and intersects Following with suspension exclusions', async () => {
  let query, sort, skip, limit;
  const chain = { sort(value) { sort = value; return this; }, skip(value) { skip = value; return this; }, limit(value) { limit = value; return Promise.resolve([]); } };
  const api = load('../src/controllers/posts.controller.js', {
    '../models/Post': { find(value) { query = value; return chain; }, countDocuments: async () => 200 },
    '../models/User': { find: () => ({ lean: async () => [{ user_id: 'BLOCKED' }] }), findById: async () => ({ liked_posts: [], saved_posts: [] }) },
    './profiles.controller': { currentCommunityUserId: async () => 'USR1' },
    '../services/follow.service': { getFollowingIds: async id => { assert.equal(id, 'USR1'); return ['BLOCKED', 'USR2']; } },
    '../services/community-author.service': { hydrateAuthors: async () => [] }
  });
  const res = response();
  await api.getAllPosts({ user: { user_id: 'mongo-id' }, query: { all: 'true', page: '2', limit: '100000', following: 'true' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(limit, 100); assert.equal(skip, 100);
  assert.deepEqual(query.user_id, { $nin: ['BLOCKED'] });
  assert.deepEqual(query.$and, [{ user_id: { $in: ['BLOCKED', 'USR2'] } }]);
  assert.deepEqual(sort, { created_at: -1, _id: -1 });
  assert.equal(res.body.page, 2); assert.equal(res.body.limit, 100);
});

test('closing persists the selected outcome and private summary in the same transaction', async () => {
  const transaction = { withTransaction: async fn => fn(), endSession: async () => {} };
  let note, closure, synced;
  const chat = { conversation_id: 'CHAT1', customer_id: 'USR1', agent_id: 'STAFF1', status: 'open' };
  const api = load('../src/services/chat-lifecycle.service.js', {
    '../models/ChatConversation': { db: { startSession: async () => transaction }, findOneAndUpdate: async (_, update) => { closure = update.$set; return { ...chat, ...closure, ai_session_id: 'AI1' }; } },
    '../models/AiChatSession': { updateOne: async (_, update) => { synced = update.$set; } },
    '../models/CustomerNote': { create: async ([data], options) => { assert.equal(options.session, transaction); note = data; } }
  });
  await api.closeResolvedChat(chat, { outcome: 'forwarded', summary: 'Private resolution', actorId: 'STAFF1', actorRole: 'cskh', actorName: 'Ha' });
  assert.equal(closure.close_outcome, 'forwarded');
  assert.equal(closure.closed_by_name, 'Ha');
  assert.equal(closure.summary, undefined);
  assert.equal(note.content, 'Private resolution');
  assert.equal(synced.status, 'ai_active');
  await assert.rejects(api.closeResolvedChat(chat, { outcome: 'invalid' }), error => error.status === 400);
});

test('close checkbox controls customer notification and does not send internal summaries', async () => {
  for (const notify of [true, false]) {
    const sent = [];
    const chat = { conversation_id: 'CHAT1', agent_id: 'STAFF1', status: 'open', toObject() { return { ...this }; } };
    const api = load('../src/controllers/chat.controller.js', {
      '../models/ChatConversation': { findOne: async () => chat },
      '../models/User': { findOne: () => ({ lean: async () => ({ profile_name: 'Ha' }) }) },
      '../services/chat.service': { canAccessConversation: async () => true, resolveChatUserId: async () => 'STAFF1', appendMessage: async (_, data) => { sent.push(data); return null; } },
      '../services/chat-lifecycle.service': { closeResolvedChat: async (_, options) => { assert.equal(options.summary, 'Internal only'); return { toObject: () => ({ status: 'closed' }) }; } },
      '../services/socket.service': { emitChatEvent() {} }
    });
    const res = response();
    await api.closeConversation({ user: { role: 'cskh', user_id: 'STAFF1' }, params: { id: 'CHAT1' }, body: { summary: 'Internal only', outcome: 'resolved', send_closing_message: notify } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(sent.length, notify ? 1 : 0);
    if (notify) assert.ok(!sent[0].content.includes('Internal only'));
  }
});

test('transfer choices use live presence and real workload; offline and full agents cannot be selected', async () => {
  const api = load('../src/controllers/chat.controller.js', {
    '../models/User': { find: () => ({ lean: async () => [
      { _id: 'mongo1', user_id: 'STAFF1', profile_name: 'One', role: 'cskh' },
      { _id: 'mongo2', user_id: 'STAFF2', profile_name: 'Two', role: 'cskh' },
      { _id: 'mongo3', user_id: 'STAFF3', profile_name: 'Three', role: 'cskh' }
    ] }) },
    '../models/ChatConversation': { aggregate: async () => [{ _id: 'STAFF1', total: 2 }, { _id: 'mongo2', total: 5 }] },
    '../services/socket.service': { getIO: () => ({ in: () => ({ fetchSockets: async () => [{ user: { chat_user_id: 'STAFF1' } }, { user: { user_id: 'mongo2' } }] }) }) }
  });
  const res = response(); await api.listAgents({}, res);
  assert.equal(res.body.data[0].active_chats, 2); assert.equal(res.body.data[0].available, true);
  assert.equal(res.body.data[1].active_chats, 5); assert.equal(res.body.data[1].available, false);
  assert.equal(res.body.data[2].online, false); assert.equal(res.body.data[2].available, false);
});

test('transferring to an offline colleague is rejected before assignment', async () => {
  const api = load('../src/controllers/chat.controller.js', {
    '../services/chat.service': { resolveChatUserId: async () => 'STAFF1' },
    '../services/chat-assignment.service': { assignConversation: async () => assert.fail('must not assign offline agent') },
    '../services/socket.service': { getIO: () => ({ in: () => ({ fetchSockets: async () => [] }) }) }
  });
  const res = response();
  await api.transferConversation({ body: { agent_id: 'STAFF2', note: 'Issue context' }, params: { id: 'CHAT1' }, user: { user_id: 'STAFF1', role: 'cskh' } }, res);
  assert.equal(res.statusCode, 409);
});

test('agents can share only orders belonging to the selected customer and only in an open owned chat', async () => {
  for (const ownOrder of [true, false]) {
    let sent;
    const api = load('../src/controllers/chat.controller.js', {
      '../models/ChatConversation': { findOne: async () => ({ conversation_id: 'CHAT1', customer_id: 'USR1', agent_id: 'STAFF1', status: 'open' }) },
      '../models/Order': { findOne: filter => { assert.equal(filter.user_id, 'USR1'); return { lean: async () => ownOrder ? { order_id: 'OF1029', order_status: 'processing', pricing: { total: 50 }, items: [] } : null }; } },
      '../services/chat.service': { resolveChatUserId: async () => 'STAFF1', canAccessConversation: async () => true, appendMessage: async (_, message) => { sent = message; return { toObject: () => message }; } },
      '../services/socket.service': { emitChatEvent() {} }
    });
    const res = response();
    await api.shareOrder({ params: { id: 'CHAT1' }, body: { order_id: 'OF1029' }, user: { user_id: 'STAFF1', role: 'cskh' } }, res);
    assert.equal(res.statusCode, ownOrder ? 201 : 404);
    if (ownOrder) assert.equal(sent.metadata.orderCard.order_id, 'OF1029');
  }
});
