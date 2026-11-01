const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { activeRestriction, isBlocked, recommendedAction } = require('../src/services/community-restriction.service');
const { requireCommunityAccess } = require('../src/middleware/community-restriction.middleware');

const DAY = 86400000;
const restricted = (level, ms) => ({ community_restriction: { level, until: new Date(Date.now() + ms) } });

function run(user, kind) {
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let passed = false;
  requireCommunityAccess(kind)({ user }, res, () => { passed = true; });
  return { passed, res };
}

test('level 2 blocks posting and commenting only; level 3 blocks every interaction', () => {
  assert.equal(run(restricted(2, DAY), 'write').passed, false);
  assert.equal(run(restricted(2, DAY), 'interact').passed, true);
  assert.equal(run(restricted(3, DAY), 'write').passed, false);
  const blocked = run(restricted(3, DAY), 'interact');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 403);
  assert.equal(blocked.res.body.code, 'COMMUNITY_RESTRICTED');
});

test('a suspension ends by itself when its time has passed', () => {
  const expired = restricted(3, -1000);
  assert.equal(activeRestriction(expired), null);
  assert.equal(isBlocked(activeRestriction(expired), 'write'), false);
  assert.equal(run(expired, 'write').passed, true);
  assert.equal(run({ community_restriction: null }, 'write').passed, true);
});

test('the suggested level follows the violation count and the severity of the reason', () => {
  assert.equal(recommendedAction(0, 'spam'), 'warn');
  assert.equal(recommendedAction(0, 'off_topic'), 'warn');
  assert.equal(recommendedAction(1, 'spam'), 'suspend_3d');
  assert.equal(recommendedAction(0, 'misleading'), 'suspend_3d');
  assert.equal(recommendedAction(2, 'spam'), 'suspend_7d');
  assert.equal(recommendedAction(0, 'inappropriate'), 'suspend_7d');
  assert.equal(recommendedAction(9, 'spam'), 'suspend_7d');
});

test('the old warn / suspend routes are gone and community routes are guarded', () => {
  const read = (file) => fs.readFileSync(path.resolve(__dirname, '../src/routes', file), 'utf8');
  assert.doesNotMatch(read('admin.routes.js'), /community\/users/);
  assert.match(read('posts.routes.js'), /router\.post\('\/', authMiddleware, requireCommunityAccess\('write'\)/);
  assert.match(read('comments.routes.js'), /router\.post\('\/post\/:postId', authMiddleware, requireCommunityAccess\('write'\)/);
  assert.match(read('follows.routes.js'), /requireCommunityAccess\('interact'\)/);
});
