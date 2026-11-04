const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run with: node --test test/voucher-release.test.js
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

function fixture(rows) {
  const Voucher = {
    updateOne: async (filter, update) => {
      const row = rows.find(r => r.code === filter.code && r.used_count > filter.used_count.$gt);
      if (!row) return { modifiedCount: 0 };
      row.used_count += update.$inc.used_count;
      return { modifiedCount: 1 };
    }
  };
  return load('../src/services/voucher.service.js', { '../models/Voucher': Voucher, '../models/Order': {} });
}

test('a canceled order gives its one-use voucher back', async () => {
  const rows = [{ code: 'WELCOME', used_count: 1, usage_limit: 1 }];
  const service = fixture(rows);
  assert.equal(await service.releaseVoucherUsage(' welcome '), true);
  assert.equal(rows[0].used_count, 0);
});

test('used_count never goes below 0', async () => {
  const rows = [{ code: 'WELCOME', used_count: 0 }];
  const service = fixture(rows);
  assert.equal(await service.releaseVoucherUsage('WELCOME'), false);
  assert.equal(rows[0].used_count, 0);
});

test('no code, nothing to release', async () => {
  const service = fixture([]);
  assert.equal(await service.releaseVoucherUsage(null), false);
  assert.equal(await service.releaseVoucherUsage('  '), false);
});
