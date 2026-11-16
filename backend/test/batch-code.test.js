const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('batch codes are sequential under concurrent requests and skip published or drafted codes', async () => {
  let counter = 0;
  const filename = path.resolve(__dirname, '../src/services/batch-code.service.js');
  const module = { exports: {} };
  const models = {
    '../models/ProductIdSequence': { findOneAndUpdate: (query, update, options) => {
      assert.equal(query._id, 'batch-codes'); assert.equal(update.$inc.value, 1); assert.equal(options.upsert, true);
      const value = ++counter;
      return { lean: async () => ({ value }) };
    } },
    '../models/ProductBatch': { exists: async query => query.batch_code === 'B-000002' },
    '../models/ProductDraft': { exists: async query => query['payload.batch_changes.upserts.batch_code'] === 'B-000003' }
  };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => models[name], module, module.exports);
  assert.equal(await module.exports.nextBatchCode(), 'B-000001');
  const codes = await Promise.all(Array.from({ length: 10 }, () => module.exports.nextBatchCode()));
  assert.equal(new Set(codes).size, 10);
  assert.deepEqual(codes.sort(), Array.from({ length: 10 }, (_, i) => `B-${String(i + 4).padStart(6, '0')}`));
});
