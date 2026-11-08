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

// An in-memory Counters collection that applies $max and $inc like MongoDB.
function loadService(highestStoredId) {
  const counters = new Map();
  const Counter = {
    async updateOne({ _id }, { $max }) { counters.set(_id, Math.max(counters.get(_id) ?? 0, $max.seq)); },
    async findOneAndUpdate({ _id }, { $inc }) {
      counters.set(_id, (counters.get(_id) ?? 0) + $inc.seq);
      return { _id, seq: counters.get(_id) };
    }
  };
  const store = { highest: highestStoredId };
  const User = { findOne: () => ({ sort: () => ({ lean: async () => (store.highest ? { user_id: store.highest } : null) }) }) };
  const service = load('../src/services/user-id.service.js', { '../models/Counter': Counter, '../models/User': User });
  return { ...service, store };
}

test('user ids come from the counter, one after another', async () => {
  const { nextUserId } = loadService(null);
  assert.equal(await nextUserId(), 'USR00001');
  assert.equal(await nextUserId(), 'USR00002');
});

test('the counter starts above the highest id already stored', async () => {
  const { nextUserId } = loadService('USR00120');
  assert.equal(await nextUserId(), 'USR00121');
});

test('an id inserted outside the counter, e.g. by a seed script, is not handed out again', async () => {
  const { nextUserId, store } = loadService('USR00010');
  assert.equal(await nextUserId(), 'USR00011');
  store.highest = 'USR00030';
  assert.equal(await nextUserId(), 'USR00031');
});

test('two sign-ups at the same moment get different ids', async () => {
  const { nextUserId } = loadService('USR00005');
  const ids = await Promise.all([nextUserId(), nextUserId()]);
  assert.notEqual(ids[0], ids[1]);
});
