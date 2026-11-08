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

test('customer reopening returns to the same agent when there is room, otherwise queues without exceeding five', async () => {
  const policy = require('../src/services/chat-policy');
  let count = 5, sessionUpdate;
  const chat = { conversation_id: 'CHAT1', customer_id: 'USR1', agent_id: 'legacy', status: 'closed', close_reason: 'resolved', closed_at: new Date(Date.now() - 1000), ai_session_id: 'AI1' };
  const transaction = { withTransaction: async fn => fn(), endSession: async () => {} };
  const api = load('../src/services/chat-lifecycle.service.js', {
    './chat-policy': { ...policy, supportOpen: () => true },
    '../models/User': { findOne: () => ({ session: () => ({ lean: async () => ({ _id: 'legacy', user_id: 'STAFF1', role: 'cskh' }) }) }), updateOne: async () => {} },
    '../models/ChatConversation': {
      db: { startSession: async () => transaction }, findOne: () => ({ session: async () => chat }),
      countDocuments: () => ({ session: async () => count }),
      findOneAndUpdate: async (_, update) => { const result = { ...chat, ...update.$set }; return { ...result, toObject: () => result }; }
    },
    '../models/AiChatSession': { updateOne: async (_, update) => { sessionUpdate = update.$set; } },
    './socket.service': { emitChatEvent() {} }
  });
  assert.equal(await api.reopenForCustomer(chat, 'OTHER'), null);
  let result = await api.reopenForCustomer(chat, 'USR1');
  assert.equal(result.status, 'waiting'); assert.equal(result.agent_id, null);
  assert.equal(sessionUpdate.status, 'waiting');
  count = 4;
  result = await api.reopenForCustomer(chat, 'USR1');
  assert.equal(result.status, 'open'); assert.equal(result.agent_id, 'STAFF1');
  assert.equal(sessionUpdate.assigned_admin_id, 'STAFF1');
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

test('internal transfer notes are never broadcast to customer or shared agent socket rooms', () => {
  const emissions = [];
  class Server { use() {} on() {} to(room) { return { emit(event, payload) { emissions.push({ room, payload }); } }; } }
  const socket = load('../src/services/socket.service.js', { 'socket.io': { Server } });
  socket.initSocket({});
  socket.emitChatEvent('chat_updated', { conversation_id: 'CHAT1', customer_id: 'USR1', transfers: [{ note: 'Private context' }] });
  assert.equal(emissions.length, 3);
  assert.ok(emissions.every(row => !Object.hasOwn(row.payload, 'transfers')));
});

test('CSKH customer data follows the assigned-customer order scope; claiming a chat does not grant profile access', async () => {
  let filter;
  const api = load('../src/controllers/admin-customers.controller.js', {
    '../models/User': {
      findOne: () => ({ lean: async () => ({ _id: 'mongo', user_id: 'STAFF1', assigned_chat_customer_ids: ['USR1'] }) }),
      countDocuments: async query => { filter = query; return 0; },
      find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) })
    },
    '../models/ChatConversation': { distinct: async () => ['USR2'] }
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
