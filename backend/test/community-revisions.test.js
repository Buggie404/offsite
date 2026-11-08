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
    // Only an open report blocks a second one; the re-report rules live in report-rereport.service.
    assert.equal(index[1].partialFilterExpression.status, 'pending');
  }
});

// Reporter USR2 reports P1 / C1 by USR1. `latest` is USR2's newest earlier report on it, if any.
async function reportContentAgain(kind, { latest = null, restriction = null, createError = null, openNow = null, restored = false } = {}) {
  const created = [];
  const ReportModel = {
    REPORT_REASONS: ['spam'],
    findOne: () => ({ sort: () => ({ lean: async () => latest }), lean: async () => openNow }),
    create: async (doc) => { if (createError) throw createError; created.push(doc); }
  };
  const [controller, method, model, doc, params] = kind === 'post'
    ? ['posts', 'reportPost', '../models/Post', { post_id: 'P1', user_id: 'USR1' }, { id: 'P1' }]
    : ['comments', 'reportComment', '../models/Comment', { comment_id: 'C1', post_id: 'P1', user_id: 'USR1' }, { id: 'C1' }];
  const api = load('../src/controllers/' + controller + '.controller.js', {
    '../models/PostReport': ReportModel, '../models/CommentReport': ReportModel,
    '../models/ModerationAction': { exists: async () => (restored ? { _id: 'A1' } : null) },
    '../models/User': { findOne: () => ({ lean: async () => ({ user_id: 'USR1', community_restriction: restriction }) }) },
    './profiles.controller': { currentCommunityUserId: async () => 'USR2' },
    [model]: { findOne: async () => doc }
  });
  const res = response();
  await api[method]({ params, body: { reason: 'spam' }, user: { user_id: '507f1f77bcf86cd799439011' } }, res);
  return { res, created };
}

test('posts and comments follow the same re-report rules as accounts', async () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (const kind of ['post', 'comment']) {
    const open = await reportContentAgain(kind, { latest: { status: 'pending' } });
    assert.equal(open.res.statusCode, 409, `${kind}: open report`);
    assert.match(open.res.body.error, new RegExp(`reported this ${kind}. We are still reviewing`));

    const serving = await reportContentAgain(kind, { latest: { status: 'reviewed' }, restriction: { level: 2, until: new Date(Date.now() + DAY_MS) } });
    assert.equal(serving.res.statusCode, 409, `${kind}: penalty running`);
    assert.match(serving.res.body.error, /Its author is already serving a penalty until/);

    // Staff restored the content after the report was closed: it can be reported again, penalty or not.
    const restored = await reportContentAgain(kind, {
      latest: { status: 'reviewed', updated_at: new Date(Date.now() - DAY_MS) },
      restriction: { level: 2, until: new Date(Date.now() + DAY_MS) },
      restored: true
    });
    assert.equal(restored.res.statusCode, 201, `${kind}: restored after the report`);

    for (const allowed of [
      {},
      { latest: { status: 'dismissed' } },
      { latest: { status: 'reviewed' } },
      { latest: { status: 'reviewed' }, restriction: { level: 3, until: new Date(Date.now() - DAY_MS) } }
    ]) {
      const { res, created } = await reportContentAgain(kind, allowed);
      assert.equal(res.statusCode, 201, `${kind}: ${JSON.stringify(allowed)}`);
      assert.equal(created.length, 1);
    }

    const duplicate = Object.assign(new Error('duplicate'), { code: 11000 });
    const race = await reportContentAgain(kind, { createError: duplicate, openNow: { _id: 'R1' } });
    assert.equal(race.res.statusCode, 409, `${kind}: double submit`);
    assert.match(race.res.body.error, /still reviewing/);

    // Old index still in place: a closed report blocks the insert, and the message must not say it is under review.
    const oldIndex = await reportContentAgain(kind, { latest: { status: 'dismissed' }, createError: duplicate });
    assert.equal(oldIndex.res.statusCode, 409, `${kind}: old index`);
    assert.doesNotMatch(oldIndex.res.body.error, /still reviewing/);
  }
});

// Reporter USR2 reports USR1. `latest` is USR2's newest earlier report on USR1, if any.
async function reportAccountAgain({ latest = null, restriction = null, createError = null, openNow = null, restored = false } = {}) {
  const created = [];
  const AccountReport = {
    // .sort() -> the latest report; plain .lean() -> the open-report lookup after a duplicate key error.
    findOne: () => ({ sort: () => ({ lean: async () => latest }), lean: async () => openNow }),
    create: async (doc) => { if (createError) throw createError; created.push(doc); }
  };
  const api = load('../src/controllers/profiles.controller.js', {
    '../models/AccountReport': AccountReport,
    '../models/ModerationAction': { exists: async () => (restored ? { _id: 'A1' } : null) },
    '../models/User': { findOne: () => ({ lean: async () => ({ user_id: 'USR1', community_restriction: restriction }) }) },
    '../services/follow.service': { resolveCommunityUserId: async () => 'USR2' }
  });
  const res = response();
  await api.reportAccount({ params: { userId: 'USR1' }, body: { reason: 'spam' } }, res);
  return { res, created };
}

const DAY = 24 * 60 * 60 * 1000;

test('an account can be reported when the reporter has no earlier report on it', async () => {
  const { res, created } = await reportAccountAgain();
  assert.equal(res.statusCode, 201);
  assert.equal(created.length, 1);
});

test('an account cannot be reported again while the earlier report is still open', async () => {
  const { res, created } = await reportAccountAgain({ latest: { status: 'pending' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ALREADY_REPORTED');
  assert.match(res.body.error, /still reviewing/);
  assert.equal(created.length, 0);
});

test('an account cannot be reported again while the penalty from the earlier report runs', async () => {
  const until = new Date(Date.now() + 2 * DAY);
  const { res, created } = await reportAccountAgain({ latest: { status: 'reviewed' }, restriction: { level: 2, until } });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /serving a penalty until/);
  assert.equal(created.length, 0);
});

test('an account can be reported again once staff lift its penalty early', async () => {
  const until = new Date(Date.now() + 2 * DAY);
  const { res } = await reportAccountAgain({ latest: { status: 'reviewed' }, restriction: { level: 2, until }, restored: true });
  assert.equal(res.statusCode, 201);
});

test('an account can be reported again once the penalty is over', async () => {
  const until = new Date(Date.now() - DAY);
  const { res, created } = await reportAccountAgain({ latest: { status: 'reviewed' }, restriction: { level: 3, until } });
  assert.equal(res.statusCode, 201);
  assert.equal(created.length, 1);
});

test('a warning without a suspension, or a dismissed report, does not block a new report', async () => {
  for (const latest of [{ status: 'reviewed' }, { status: 'dismissed' }]) {
    const { res } = await reportAccountAgain({ latest });
    assert.equal(res.statusCode, 201);
  }
});

test('two account reports sent at the same moment: the second gets 409', async () => {
  const { res } = await reportAccountAgain({ createError: Object.assign(new Error('duplicate'), { code: 11000 }), openNow: { _id: 'R1' } });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /still reviewing/);
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
