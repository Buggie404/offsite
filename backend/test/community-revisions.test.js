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

test('all report types share Reports and queries remain scoped to their target type', async () => {
  const Report = require('../src/models/Report');
  for (const [name, type, fields] of [
    ['PostReport', 'post', { post_id: 'P1' }],
    ['CommentReport', 'comment', { post_id: 'P1', comment_id: 'C1' }],
    ['AccountReport', 'account', { reported_user_id: 'U1' }]
  ]) {
    const Model = require('../src/models/' + name);
    assert.equal(Model.collection.name, 'Reports');
    const row = new Model({ ...fields, reporter_id: 'U2', reason: 'spam' });
    await row.validate();
    assert.equal(row.target_type, type);
    assert.equal(Model.find({ status: 'pending' }).getFilter().target_type, type);
    const index = Report.schema.indexes().find(([, options]) => options.unique && options.partialFilterExpression.target_type === type);
    assert.ok(index, `missing unique index for ${type}`);
    assert.ok(!Object.hasOwn(index[0], 'status'), 'dismissed reports must still prevent a second report');
  }
});

test('duplicate post/comment/account reports return 409 with a consistent message', async () => {
  const duplicate = { create: async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); }, REPORT_REASONS: ['spam'] };
  const common = { '../models/PostReport': duplicate, '../models/CommentReport': duplicate, '../models/AccountReport': duplicate,
    './profiles.controller': { currentCommunityUserId: async () => 'USR2' } };
  for (const [controller, method, model, doc, params, extra] of [
    ['posts', 'reportPost', '../models/Post', { post_id: 'P1', user_id: 'USR1' }, { id: 'P1' }, {}],
    ['comments', 'reportComment', '../models/Comment', { comment_id: 'C1', post_id: 'P1', user_id: 'USR1' }, { id: 'C1' }, {}],
    ['profiles', 'reportAccount', '../models/User', null, { userId: 'USR1' }, {
      '../models/User': { findById: () => ({ lean: () => Promise.resolve({ user_id: 'USR2' }) }), exists: async () => true }
    }]
  ]) {
    const api = load('../src/controllers/' + controller + '.controller.js', { ...common, [model]: { findOne: async () => doc }, ...extra });
    const res = response();
    await api[method]({ params, body: { reason: 'spam' }, user: { user_id: '507f1f77bcf86cd799439011' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'You have already reported this');
  }
});

test('community point reversal/restoration is idempotent for pending and posted rewards', async () => {
  let balance = 12;
  const rows = [
    { _id: 'posted', status: 'posted', posted_at: new Date(), amount: 2, user_id: 'U1' },
    { _id: 'pending', status: 'pending', posted_at: null, amount: 10, user_id: 'U1' }
  ];
  const session = { withTransaction: async fn => fn(), endSession: async () => {} };
  const PointTransaction = {
    db: { startSession: async () => session },
    find: query => ({ session: async () => rows.filter(row => typeof query.status === 'string' ? row.status === query.status : query.status.$in.includes(row.status)).map(row => ({ ...row })) }),
    updateOne: async (query, update) => {
      const row = rows.find(row => row._id === query._id && row.status === query.status);
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    }
  };
  const points = load('../src/services/points.service.js', { '../models/PointTransaction': PointTransaction,
    '../models/User': { updateOne: async (_, update) => { balance += update.$inc.points; } } });
  await points.reverseCommunityPoints('P1');
  await points.reverseCommunityPoints('P1');
  assert.equal(balance, 10);
  assert.ok(rows.every(row => row.status === 'reversed'));
  await points.restoreCommunityPoints('P1');
  await points.restoreCommunityPoints('P1');
  assert.equal(balance, 12);
  assert.equal(rows[0].status, 'posted');
  assert.equal(rows[1].status, 'pending');
});

test('suggestions enforce 0.6 and reuse catalog cache', async () => {
  let reads = 0;
  const catalog = [
    { product_id: 1, name: 'Ceremonial Uji Matcha', category: 'matcha', variants: [{ stock: 2, price: 20 }], product_tag: [] },
    { product_id: 2, name: 'Matcha Everyday Blend', category: 'matcha', variants: [{ stock: 2, price: 10 }], product_tag: [] }
  ];
  const tags = load('../src/services/product-tag.service.js', { '../models/Product': { find: () => {
    reads++;
    return { limit: () => ({ lean: async () => catalog }) };
  } } });
  assert.equal((await tags.suggestProductTags({ content: 'matcha', base: 'MATCHA' })).length, 0);
  const results = await tags.suggestProductTags({ content: 'Ceremonial Uji Matcha', base: 'MATCHA' });
  assert.deepEqual(results.map(row => row.product_id), [1]);
  assert.ok(results.every(row => row.confidence >= 0.6 && row.source === 'ai'));
  assert.equal(reads, 1);
});

test('follow search uses literal text, correct relationship direction and pagination', async () => {
  let pipeline;
  const api = load('../src/controllers/follows.controller.js', {
    '../models/User': { collection: { name: 'Users' }, exists: async () => true },
    '../models/Follow': { aggregate: async stages => { pipeline = stages; return [{ data: [{ user_id: 'U2', username: 'a.b' }], count: [{ total: 1 }] }]; } }
  });
  const res = response();
  await api.getFollowList({ params: { userId: 'U1', type: 'followers' }, query: { q: 'a.b', page: 2 } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(pipeline[0], { $match: { following_id: 'U1' } });
  assert.equal(pipeline.find(stage => stage.$match?.username).$match.username.$regex, 'a\\.b');
  assert.equal(pipeline.at(-1).$facet.data[0].$skip, 20);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].is_self, false);
});

test('profile counts use the visible follow list totals instead of raw relationship counts', async () => {
  const calls = [];
  const api = load('../src/controllers/profiles.controller.js', {
    '../models/User': { findOne: () => ({ lean: async () => ({ user_id: 'U1' }) }) },
    '../models/Post': { countDocuments: async () => 0 },
    '../models/Follow': { countDocuments: () => assert.fail('must not count hidden or missing users') },
    '../services/follow-list': { countVisibleFollows: async (id, type) => {
      calls.push([id, type]);
      return type === 'followers' ? 1 : 0;
    } }
  });
  const res = response();
  await api.getPublicProfile({ params: { userId: 'U1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.follower_count, 1);
  assert.equal(res.body.following_count, 0);
  assert.deepEqual(calls, [['U1', 'followers'], ['U1', 'following']]);
});

test('admin moderation requires a reason and writes an activity log after saving', async () => {
  let update;
  const logs = [];
  const api = load('../src/controllers/admin-community.controller.js', {
    '../models/User': {
      findOne: () => ({ lean: async () => ({ user_id: 'U1', role: 'customer', status: 'active', community_warnings: [] }) }),
      findOneAndUpdate: async (_, value) => { update = value; return { user_id: 'U1', status: 'suspended', community_warnings: [] }; }
    }
  });
  const req = { params: { id: 'U1' }, body: { reason: '  Repeated spam  ' }, user: { user_id: 'ADMIN1' }, writeActivityLog: async log => logs.push(log) };
  const missing = response();
  await api.warnUser({ ...req, body: { reason: '  ' } }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(logs.length, 0);
  const res = response();
  await api.suspendUser(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(update.$set.status, 'suspended');
  assert.equal(logs[0].reason, 'Repeated spam');
  assert.equal(logs[0].actionType, 'community_user_suspend');
  await api.warnUser(req, response());
  assert.equal(update.$push.community_warnings.reason, 'Repeated spam');
  assert.equal(logs[1].actionType, 'community_user_warn');
});

test('suspended users cannot use a token issued before suspension', async () => {
  const auth = load('../src/middleware/auth.middleware.js', {
    jsonwebtoken: { verify: () => ({ user_id: 'U1' }) },
    '../models/User': { findOne: () => ({ lean: async () => ({ status: 'suspended' }) }) }
  });
  const res = response();
  await auth.authMiddleware({ headers: { authorization: 'Bearer token' } }, res, () => assert.fail('suspended request passed'));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ACCOUNT_SUSPENDED');
});

test('legacy reports normalize reporter IDs and infer comment targets before migration', () => {
  const { normalizeReport } = require('../scripts/migrate-community-reports');
  const _id = new (require('mongoose').Types.ObjectId)();
  const row = normalizeReport({ _id, comment_id: 'C1', post_id: 'P1', reporter_id: 'mongo-id', reason: 'spam' }, 'CommentReports', new Map([['mongo-id', 'U1']]));
  assert.equal(row.target_type, 'comment');
  assert.equal(row.reporter_id, 'U1');
  assert.equal(row.post_id, 'P1');
  assert.throws(() => normalizeReport({ _id, reporter_id: 'U1' }, 'Report', new Map()), /Unsupported report/);
});


test('legacy profile reports migrate to account inside Reports', () => {
  const { normalizeReport } = require('../scripts/migrate-community-reports');
  const _id = new (require('mongoose').Types.ObjectId)();
  const row = normalizeReport({ _id, target_type: 'profile', reported_user_id: 'U1', reporter_id: 'U2', reason: 'spam' }, 'Reports', new Map());
  assert.equal(row.target_type, 'account');
  assert.equal(row.reported_user_id, 'U1');
});
