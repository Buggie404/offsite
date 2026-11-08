const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('public product links hide drafts for slug, numeric id and Mongo id', async () => {
  const filename = path.resolve(__dirname, '../src/controllers/products.controller.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  let active = false;
  const Product = {
    findOne: async query => {
      assert.equal(query.is_active, true);
      return active ? { product_id: 10001, is_active: true } : null;
    },
    find: async query => { assert.equal(query.is_active, true); return []; }
  };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => name === '../models/Product' ? Product : realRequire(name), module, module.exports);
  for (const id of ['draft-coffee', '10001', '507f1f77bcf86cd799439011']) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await module.exports.getProductById({ params: { id } }, res);
    assert.equal(res.code, 404);
    active = true;
    await module.exports.getProductById({ params: { id } }, res);
    assert.equal(res.data.product_id, 10001);
    active = false;
  }
});
