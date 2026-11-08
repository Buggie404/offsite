const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(Product, extra = {}) {
  const filename = path.resolve(__dirname, '../src/controllers/admin-products.controller.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => name === '../models/Product' ? Product : Object.hasOwn(extra, name) ? extra[name] : realRequire(name), module, module.exports);
  return module.exports;
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('live and draft lists expose different content without duplicating draft-only products in Products', async () => {
  const live = { product_id: 10001, name: 'Live coffee', is_active: true, variants: [{ sku: 'C1', price: 25 }] };
  const drafts = [
    { product_id: 10001, saved_at: new Date(), payload: { name: 'Edited coffee', variants: [{ sku: 'C1', price: 30 }] } },
    { product_id: 10002, saved_at: new Date(), payload: { name: 'Brand new draft', variants: [{ sku: 'NEW', price: 20 }] } }
  ];
  const api = load({ find: () => ({ sort() { return this; }, lean: async () => [live] }) }, {
    '../models/ProductDraft': { find: () => ({ sort() { return this; }, lean: async () => drafts }) }
  });
  const main = response(), draftList = response();
  await api.listProducts({}, main);
  await api.listDrafts({}, draftList);
  assert.equal(main.body.data.length, 1);
  assert.equal(main.body.data[0].name, 'Live coffee');
  assert.equal(main.body.data[0].variants[0].price, 25);
  assert.deepEqual(draftList.body.data.map(row => row.name), ['Edited coffee', 'Brand new draft']);
  assert.equal(draftList.body.data[0].variants[0].price, 30);
  assert.equal(draftList.body.data[0].is_active, true);
  assert.equal(draftList.body.data[1].is_new_product, true);
});

test('saving a brand new draft reserves an id without creating any live product', async () => {
  let stored, counter = 14011;
  const api = load({
    findOne: () => ({ sort() { return this; }, lean: async () => ({ product_id: 14011 }) }),
    create: () => assert.fail('Save draft must not create a live product')
  }, {
    '../models/ProductIdSequence': {
      updateOne: async () => {},
      findOneAndUpdate: () => ({ lean: async () => ({ value: ++counter }) })
    },
    '../models/ProductDraft': {
      findOne: () => ({ sort() { return this; }, lean: async () => null }),
      findOneAndUpdate: (query, update) => {
        stored = { product_id: query.product_id, ...update.$set, created_at: new Date() };
        return { lean: async () => stored };
      }
    }
  });
  const res = response();
  await api.saveDraft({ params: {}, user: { user_id: 'STAFF1' }, writeActivityLog: async () => {},
    body: { name: 'New draft', slug: 'new-draft', category: 'coffee', variant_type: 'none',
      variants: [{ sku: 'NEW', price: 20, stock: 2, is_default: true }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(stored.product_id, 14012);
  assert.equal(res.body.data.is_new_product, true);
  assert.equal(res.body.data.is_active, false);
  assert.equal(res.body.data.name, 'New draft');
});

test('a draft-only product is created in Products only on Publish', async () => {
  let created, cleared = false;
  const draft = { product_id: 14012, payload: { name: 'New draft', slug: 'new-draft', category: 'coffee', variant_type: 'none',
    variants: [{ sku: 'NEW', price: 20, stock: 2, is_default: true }] } };
  const api = load({ findOne: async () => null, create: async value => { created = value; return value; } }, {
    '../models/ProductDraft': { findOne: () => ({ lean: async () => draft }), deleteOne: async () => { cleared = true; } }
  });
  const res = response();
  await api.publishDraft({ params: { productId: '14012' }, body: {}, writeActivityLog: async () => {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(created.product_id, 14012);
  assert.equal(created.is_active, true);
  assert.equal(created.variants[0].price, 20);
  assert.equal(cleared, true);
});

test('discarding a draft does not write, deactivate or delete the live product', async () => {
  let removed;
  const api = load(new Proxy({}, { get() { assert.fail('Discard must not touch Products'); } }), {
    '../models/ProductDraft': { findOneAndDelete: query => {
      removed = query.product_id;
      return { lean: async () => ({ payload: { name: 'Draft' } }) };
    } }
  });
  const res = response();
  await api.discardDraft({ params: { productId: '10001' }, writeActivityLog: async () => {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(removed, 10001);
});

test('publishing content of an inactive existing product does not reactivate it', async () => {
  const product = { product_id: 10001, name: 'Inactive coffee', slug: 'inactive-coffee', category: 'coffee', is_active: false,
    variants: [{ sku: 'C1', price: 25, stock: 2, is_default: true }], save: async () => {}, toObject() { return { ...this }; } };
  const api = load({ findOne: async () => product }, { '../models/ProductDraft': { deleteOne: async () => {} } });
  const res = response();
  await api.updateProduct({ params: { productId: '10001' }, writeActivityLog: async () => {},
    body: { ...product, is_active: true, name: 'Edited inactive coffee', variant_type: 'none' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(product.name, 'Edited inactive coffee');
  assert.equal(product.is_active, false);
});

for (const [existingType, incomingType, expectedStatus] of [['package', 'package', 200], ['yuki', 'yuki', 400], ['size', 'made-up-type', 400]]) {
  test(`variant type ${existingType} -> ${incomingType} keeps stored values or rejects invalid replacements`, async () => {
    let stored;
    const live = { product_id: 10001, name: 'Matcha', slug: 'matcha', category: 'matcha', variant_type: existingType,
      is_active: true, variants: [{ sku: 'M1', label: '', price: 10, stock: 2, is_default: true }] };
    const api = load({ findOne: () => ({ lean: async () => live }) }, {
      '../models/ProductDraft': { findOneAndUpdate: (_filter, update) => {
        stored = update.$set.payload;
        return { lean: async () => ({ saved_at: new Date() }) };
      } }
    });
    const res = response();
    await api.saveDraft({ params: { productId: '10001' }, user: { user_id: 'STAFF1' }, writeActivityLog: async () => {},
      body: { ...live, variant_type: incomingType } }, res);
    assert.equal(res.statusCode, expectedStatus);
    if (expectedStatus === 200) assert.equal(stored.variant_type, incomingType);
    else assert.equal(stored, undefined);
    assert.equal(live.variant_type, existingType);
  });
}

test('saving a draft never changes live product fields or visibility', async () => {
  const live = { product_id: 10001, name: 'Live coffee', slug: 'live-coffee', category: 'coffee', is_active: true,
    variants: [{ sku: 'C1', price: 10, stock: 2, sold_quantity: 3, is_default: true }] };
  let stored;
  const api = load({ findOne: () => ({ lean: async () => structuredClone(live) }),
    create: () => assert.fail('must not replace a live product') }, {
    '../models/ProductDraft': { findOneAndUpdate: (filter, update) => {
      stored = { ...filter, ...update.$set };
      return { lean: async () => stored };
    } }
  });
  const req = { params: { productId: '10001' }, user: { user_id: 'STAFF1' }, writeActivityLog: async () => {},
    body: { ...live, name: 'Edited coffee', coffee: { roast_level: 'Light' }, variant_type: 'none', is_active: false, variants: [{ ...live.variants[0], price: 20 }] } };
  const res = response();
  await api.saveDraft(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(live.name, 'Live coffee');
  assert.equal(live.variants[0].price, 10);
  assert.equal(live.is_active, true);
  assert.equal(stored.payload.name, 'Edited coffee');
  assert.equal(stored.payload.coffee.roast_level, 'light roast');
  assert.equal(stored.payload.is_active, undefined);
  assert.equal(res.body.data.is_active, true);
  assert.equal(res.body.data.has_draft, true);
});

test('admin reopens draft content while published product stays active', async () => {
  const live = { product_id: 10001, name: 'Live', is_active: true, variants: [] };
  const api = load({ findOne: () => ({ lean: async () => live }) }, {
    '../models/ProductDraft': { findOne: () => ({ lean: async () => ({ payload: { name: 'Draft', is_active: false }, saved_at: new Date() }) }) }
  });
  const res = response();
  await api.getProduct({ params: { productId: '10001' } }, res);
  assert.equal(res.body.data.name, 'Draft');
  assert.equal(res.body.data.is_active, true);
  assert.equal(res.body.data.has_draft, true);
  assert.equal(live.name, 'Live');
});

test('Publish applies edited fields and clears the saved draft', async () => {
  let cleared = false;
  const product = { product_id: 10001, name: 'Live', slug: 'live', category: 'coffee', is_active: true,
    variants: [{ sku: 'C1', price: 10, stock: 2, is_default: true }],
    save: async () => {}, toObject() { return { ...this }; } };
  const api = load({ findOne: async () => product }, {
    '../models/ProductDraft': { deleteOne: async ({ product_id }) => { assert.equal(product_id, 10001); cleared = true; } }
  });
  const res = response();
  await api.updateProduct({ params: { productId: '10001' }, writeActivityLog: async () => {},
    body: { ...product, name: 'Published edit', coffee: { roast_level: 'Medium' }, variant_type: 'none', variants: [{ ...product.variants[0], price: 20 }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(product.name, 'Published edit');
  assert.equal(product.variants[0].price, 20);
  assert.equal(product.is_active, true);
  assert.equal(product.coffee.roast_level, 'medium roast');
  assert.equal(cleared, true);
});

test('admin create rejects a zero variant price before writing a product', async () => {
  const api = load({ create: () => assert.fail('invalid price must not be saved') });
  const res = response();
  await api.createProduct({ body: { name: 'Coffee', slug: 'coffee', category: 'coffee', variant_type: 'none',
    variants: [{ sku: 'C1', price: 0, stock: 2, is_default: true }] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /greater than 0/);
});

test('status-only update does not save or validate unrelated legacy product fields', async () => {
  let mutation;
  const api = load({ findOneAndUpdate(filter, update, options) {
    mutation = { filter, update, options };
    return { lean: async () => ({ product_id: 10001, is_active: true, variants: [{ stock: 0 }] }) };
  } });
  const logs = [];
  const res = response();
  await api.updateStatus({ params: { productId: '10001' }, body: { is_active: false }, writeActivityLog: async entry => logs.push(entry) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.is_active, false);
  assert.deepEqual(Object.keys(mutation.update.$set).sort(), ['is_active', 'updatedAt']);
  assert.equal(mutation.options.runValidators, true);
  assert.deepEqual(logs[0].oldValue, { is_active: true });
  assert.deepEqual(logs[0].newValue, { is_active: false });
});

test('status endpoint rejects malformed values instead of silently deactivating a product', async () => {
  const api = load({ findOneAndUpdate() { assert.fail('must not write'); } });
  for (const body of [{}, { is_active: 'false' }, { is_active: null }]) {
    const res = response();
    await api.updateStatus({ params: { productId: '10001' }, body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('bulk inactive changes use one bulk write and preserve unrelated inventory', async () => {
  let operations;
  const api = load({
    find: () => ({ lean: async () => [{ product_id: 10001, is_active: true }, { product_id: 10002, is_active: false }] }),
    bulkWrite: async value => { operations = value; }
  });
  const logs = [];
  const changes = [{ product_id: 10001, is_active: false }, { product_id: 10002, is_active: false }];
  const res = response();
  await api.updateStatuses({ body: { changes }, writeActivityLog: async entry => logs.push(entry) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(operations.length, 1);
  assert.deepEqual(Object.keys(operations[0].updateOne.update.$set).sort(), ['is_active', 'updatedAt']);
  assert.equal(logs.length, 1);
  assert.deepEqual(res.body.data, changes);
});

test('new batch is tied to an existing SKU and records actor and audit event', async () => {
  let created;
  const api = load({ findOne: () => ({ product_id: 10001, variants: [{ sku: 'COF-1' }] }) }, {
    '../models/ProductBatch': { create: async row => { created = row; return row; } }
  });
  const logs = [];
  const req = { params: { productId: '10001' }, user: { user_id: 'STAFF1', email: 'staff@example.com' },
    body: { batch_code: 'B-2409', variant_sku: 'COF-1', quantity: 40, received_at: '2026-09-12', best_before: '2027-03-12' },
    writeActivityLog: async entry => logs.push(entry) };
  const res = response();
  await api.addBatch(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(created.product_id, 10001);
  assert.equal(created.added_by, 'STAFF1');
  assert.equal(logs[0].actionType, 'product.batch-create');
  req.body.variant_sku = 'MISSING';
  const invalid = response();
  await api.addBatch(req, invalid);
  assert.equal(invalid.statusCode, 400);
});
