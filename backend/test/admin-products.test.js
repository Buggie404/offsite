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

function loadBatchService(ProductBatch) {
  const filename = path.resolve(__dirname, '../src/services/product-batch-changes.js');
  const realRequire = createRequire(filename), module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => name === '../models/ProductBatch' ? ProductBatch : realRequire(name), module, module.exports);
  return module.exports;
}

test('saving/reopening/discarding a product draft carries batch changes without writing any live batch', async () => {
  const batchChanges = { upserts: [{ client_id: 'new-test', batch_code: 'B1', variant_sku: 'C1', quantity: 2,
    received_at: '2026-11-10', best_before: '2027-11-10' }], deletes: [] };
  const live = { product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', variant_type: 'none', is_active: true,
    variants: [{ sku: 'C1', price: 10, stock: 3, is_default: true }] };
  let saved;
  const batchService = loadBatchService(new Proxy({}, { get() { assert.fail('Save draft must not read/write live batches'); } }));
  const api = load({ findOne: () => ({ lean: async () => structuredClone(live) }) }, {
    '../services/product-batch-changes': batchService,
    '../models/ProductDraft': {
      findOneAndUpdate: (_query, update) => ({ lean: async () => { saved = update.$set; return saved; } }),
      findOne: () => ({ lean: async () => saved }),
      findOneAndDelete: () => ({ lean: async () => { const value = saved; saved = null; return value; } })
    }
  });
  const req = { params: { productId: '10001' }, user: { user_id: 'STAFF1' }, writeActivityLog: async () => {}, body: { ...live, batch_changes: batchChanges } };
  const res = response();
  await api.saveDraft(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.payload.batch_changes)), batchChanges);
  const reopened = response();
  await api.getProduct(req, reopened);
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.body.data.batch_changes)), batchChanges);
  const discarded = response();
  await api.discardDraft(req, discarded);
  assert.equal(discarded.statusCode, 200);
  assert.equal(saved, null);
  assert.equal(live.name, 'Coffee');
});

test('batch changes validate SKU, duplicate codes, positive integer quantity, dates and ownership identifiers before saving', () => {
  const { normalizeBatchChanges } = loadBatchService({});
  const row = { client_id: 'new1', batch_code: 'B1', variant_sku: 'C1', quantity: 1, received_at: '2026-11-10', best_before: null };
  const invalid = [
    { ...row, quantity: 0 }, { ...row, quantity: 1.5 }, { ...row, quantity: '1' },
    { ...row, variant_sku: 'missing' }, { ...row, received_at: '2026-02-31' },
    { ...row, best_before: '2026-11-09' }, { ...row, id: 'invalid-id' }
  ];
  for (const candidate of invalid) assert.throws(() => normalizeBatchChanges({ upserts: [candidate], deletes: [] }, [{ sku: 'C1' }]), error => error.status === 400);
  assert.throws(() => normalizeBatchChanges({ upserts: [row, { ...row, client_id: 'new2' }], deletes: [] }, [{ sku: 'C1' }]), /unique code/);
  assert.equal(normalizeBatchChanges({ upserts: [], deletes: [] }, [{ sku: 'C1' }]), null);
});

test('published batch changes use the transaction session for add/edit/delete and preserve original authors', async () => {
  const id1 = '6af100000000000000000001', id2 = '6af100000000000000000002', session = {};
  const base = { batch_code: 'B1', variant_sku: 'C1', quantity: 1, received_at: '2026-11-10', best_before: null };
  const current = [
    { ...base, _id: id1, received_at: new Date('2026-11-09T17:00:00Z'), product_id: 10001, added_by: 'ORIGINAL' },
    { ...base, _id: id2, batch_code: 'B2', received_at: new Date('2026-11-09T17:00:00Z'), product_id: 10001, added_by: 'ORIGINAL' }
  ];
  const writes = [];
  const service = loadBatchService({
    find: query => { assert.equal(query.product_id, 10001); return { session(value) { assert.equal(value, session); return this; }, lean: async () => current }; },
    deleteOne: async (query, options) => { assert.equal(options.session, session); writes.push(['delete', query]); },
    updateOne: async (query, update, options) => { assert.equal(options.session, session); writes.push(['update', query, update]); },
    create: async (rows, options) => { assert.equal(options.session, session); writes.push(['create', rows]); }
  });
  const changes = service.normalizeBatchChanges({ upserts: [
    { ...base, id: id1, quantity: 5, expected: base }, { ...base, client_id: 'new1', batch_code: 'B3', added_by: 'FORGED' }
  ], deletes: [{ id: id2, expected: { ...base, batch_code: 'B2' } }] }, [{ sku: 'C1' }]);
  const events = await service.applyBatchChanges(10001, changes, { user_id: 'PUBLISHER', profile_name: 'Admin' }, session, [{ sku: 'C1' }]);
  assert.deepEqual(events.map(event => event.actionType), ['product.batch-delete', 'product.batch-update', 'product.batch-create']);
  assert.equal(writes[1][2].$set.quantity, 5);
  assert.equal(writes[1][2].$set.added_by, undefined);
  assert.equal(writes[2][1][0].added_by, 'PUBLISHER');
  assert.equal(writes[2][1][0].client_id, undefined);
  assert.equal(writes[2][1][0].received_at.toISOString(), '2026-11-09T17:00:00.000Z');
});

test('stale/deleted/foreign batches and duplicate codes are rejected before any batch write', async () => {
  const id = '6af100000000000000000001', base = { batch_code: 'B1', variant_sku: 'C1', quantity: 1, received_at: '2026-11-10', best_before: null };
  const service = loadBatchService({
    find: () => ({ session() { return this; }, lean: async () => [{ _id: id, ...base }] }),
    deleteOne: () => assert.fail('No write on conflict'), updateOne: () => assert.fail('No write on conflict'), create: () => assert.fail('No write on conflict')
  });
  const scenarios = [
    { upserts: [{ id, ...base, expected: { ...base, quantity: 2 } }], deletes: [] },
    { upserts: [], deletes: [{ id: '6af100000000000000000099', expected: base }] },
    { upserts: [{ client_id: 'new1', ...base }], deletes: [] }
  ];
  for (const changes of scenarios) await assert.rejects(service.applyBatchChanges(10001, changes, { user_id: 'A1' }, {}, [{ sku: 'C1' }]), error => error.status === 409);
});

test('Publish commits product and batches together; failed product validation rolls back batch changes and keeps the draft', async () => {
  for (const failSave of [false, true]) {
    let state = { product: { product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', variant_type: 'none', is_active: false,
      variants: [{ sku: 'C1', price: 10, stock: 3, is_default: true }] }, batches: [], draft: true };
    const original = structuredClone(state), logs = [];
    let ended = false, transactions = 0;
    const session = { withTransaction: async callback => {
      transactions++; const before = structuredClone(state);
      try { await callback(); } catch (error) { state = before; throw error; }
    }, endSession: async () => { ended = true; } };
    const asDocument = () => ({ ...structuredClone(state.product),
      toObject() { const { save, toObject, ...value } = this; return value; },
      async save(options) { assert.equal(options.session, session);
        if (failSave) throw Object.assign(new Error('Rejected product'), { name: 'ValidationError', errors: { name: { message: 'Rejected product' } } });
        state.product = this.toObject();
      }
    });
    const body = { ...original.product, name: 'Published coffee', is_active: true,
      batch_changes: { upserts: [{ client_id: 'new1', batch_code: 'B1', variant_sku: 'C1', quantity: 1, received_at: '2026-11-10', best_before: null }], deletes: [] } };
    const actualService = loadBatchService({});
    const api = load({ db: { startSession: async () => session }, findOne() {
      const doc = asDocument(); return { then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); }, session(value) { assert.equal(value, session); return Promise.resolve(doc); } };
    } }, {
      '../services/product-batch-changes': { ...actualService, applyBatchChanges: async (_id, changes, _actor, value) => {
        assert.equal(value, session); state.batches.push(changes.upserts[0]);
        return [{ actionType: 'product.batch-create', oldValue: null, newValue: { batch_code: 'B1' } }];
      } },
      '../models/ProductDraft': { findOne: () => ({ lean: async () => ({ payload: body }) }),
        deleteOne: async (_query, options) => { assert.equal(options.session, session); state.draft = false; } }
    });
    const res = response();
    await api.publishDraft({ params: { productId: '10001' }, user: { user_id: 'A1' }, writeActivityLog: async entry => logs.push(entry) }, res);
    assert.equal(transactions, 1); assert.equal(ended, true);
    if (failSave) { assert.equal(res.statusCode, 400); assert.deepEqual(state, original); assert.equal(logs.length, 0); }
    else {
      assert.equal(res.statusCode, 200); assert.equal(state.product.name, 'Published coffee');
      assert.equal(state.product.is_active, false); assert.equal(state.product.batch_changes, undefined);
      assert.equal(state.batches.length, 1); assert.equal(state.draft, false);
      assert.deepEqual(logs.map(log => log.actionType), ['product.update', 'product.batch-create']);
    }
  }
});

test('composition search uses escaped name/SKU matches, excludes sets and inactive products, and limits its response', async () => {
  let filter, limit;
  const api = load({ find(query) { filter = query; return { sort() { return this; }, limit(value) { limit = value; return this; }, lean: async () => [] }; } });
  const res = response();
  await api.searchCompositionProducts({ query: { q: 'Coffee (250g).', exclude: '14001' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(filter.category.$ne, 'sets_bundles');
  assert.equal(filter.is_active.$ne, false);
  assert.equal(filter.product_id.$ne, 14001);
  assert.ok(filter.$or[0].name.test('Coffee (250g).'));
  assert.ok(!filter.$or[0].name.test('Coffee 250gx'));
  assert.ok(filter.$or[1]['variants.sku'].test('COFFEE (250G).'));
  assert.equal(limit, 20);
});

test('empty composition search does not scan the product collection', async () => {
  const api = load({ find: () => assert.fail('No database query for empty search') });
  const res = response();
  await api.searchCompositionProducts({ query: { q: '  ' } }, res);
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)), { data: [] });
});

test('composition accepts quantities 1 and above, rejects invalid edits and preserves untouched legacy entries', async () => {
  for (const [quantity, unchanged, expected] of [[1, false, 200], [2, false, 200], [0, false, 400], [-1, false, 400], [1.5, false, 400], ['2', false, 400], [null, false, 400], [0, true, 200]]) {
    const entry = { component_product_id: 10025, component_variant_sku: 'MAT036', quantity, custom_metadata: 'keep' };
    const product = { product_id: 14001, name: 'Set', slug: 'set', category: 'sets_bundles', variant_type: 'none', is_active: true,
      variants: [{ sku: 'SET1', price: 30, stock: 3, is_default: true }], sets_bundles: { composition: unchanged ? [entry] : [] } };
    let stored;
    const api = load({ findOne: () => ({ lean: async () => product }) }, {
      '../models/ProductDraft': { findOneAndUpdate: (_filter, update) => { stored = update.$set; return { lean: async () => stored }; } }
    });
    const res = response();
    await api.saveDraft({ params: { productId: '14001' }, user: { user_id: 'STAFF1' }, writeActivityLog: async () => {},
      body: { ...product, sets_bundles: { composition: [entry, 'Legacy item'] } } }, res);
    assert.equal(res.statusCode, expected, `quantity=${quantity}, unchanged=${unchanged}`);
    if (expected === 200) {
      assert.equal(stored.payload.sets_bundles.composition[0].quantity, quantity);
      assert.equal(stored.payload.sets_bundles.composition[0].custom_metadata, 'keep');
      assert.equal(stored.payload.sets_bundles.composition[1], 'Legacy item');
    } else assert.match(res.body.error, /Composition quantities/);
  }
});

test('unrelated saves do not introduce the legacy subscription flag and preserve stored values', () => {
  const Product = require('../src/models/Product');
  const product = Product.hydrate({ product_id: 10001, name: 'Coffee', is_active: true, variants: [] });
  product.is_active = false;
  assert.equal(product.is_subscription, undefined);
  assert.equal(Object.hasOwn(product.getChanges().$set || {}, 'is_subscription'), false);
  for (const value of [true, false]) {
    const existing = Product.hydrate({ product_id: 10001, is_subscription: value, variants: [] });
    existing.name = 'Edited';
    assert.equal(existing.is_subscription, value);
    assert.equal(Object.hasOwn(existing.getChanges().$set || {}, 'is_subscription'), false);
  }
});

test('unrelated model saves preserve quiz eligibility without materializing a missing field', () => {
  const Product = require('../src/models/Product');
  for (const value of [undefined, true, false]) {
    const raw = { product_id: 10001, name: 'Coffee', variants: [] };
    if (value !== undefined) raw.quiz_eligible = value;
    const product = Product.hydrate(raw);
    product.name = 'Edited';
    assert.equal(product.quiz_eligible, value);
    assert.equal(Object.hasOwn(product.getChanges().$set || {}, 'quiz_eligible'), false);
  }
});

test('publishing admin edits ignores quiz eligibility in old payloads and preserves the live setting', async () => {
  for (const value of [undefined, true, false]) {
    const product = { product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', is_active: true,
      variant_type: 'none', variants: [{ sku: 'C1', price: 10, stock: 2, is_default: true }],
      save: async () => {}, toObject() { return { ...this }; } };
    if (value !== undefined) product.quiz_eligible = value;
    const api = load({ findOne: async () => product }, {
      '../models/ProductDraft': { deleteOne: async () => {} }
    });
    const res = response();
    await api.updateProduct({ params: { productId: '10001' }, writeActivityLog: async () => {},
      body: { ...product, name: 'Edited coffee', quiz_eligible: value !== true } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(product.name, 'Edited coffee');
    assert.equal(product.quiz_eligible, value);
    assert.equal(Object.hasOwn(product, 'quiz_eligible'), value !== undefined);
  }
});

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
    body: { ...live, name: 'Edited coffee', coffee: { roast_level: 'Light' }, variant_type: 'none', is_active: false, is_subscription: true, quiz_eligible: true, variants: [{ ...live.variants[0], price: 20 }] } };
  const res = response();
  await api.saveDraft(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(live.name, 'Live coffee');
  assert.equal(live.variants[0].price, 10);
  assert.equal(live.is_active, true);
  assert.equal(stored.payload.name, 'Edited coffee');
  assert.equal(stored.payload.coffee.roast_level, 'light roast');
  assert.equal(stored.payload.is_active, undefined);
  assert.equal(Object.hasOwn(stored.payload, 'is_subscription'), false);
  assert.equal(Object.hasOwn(stored.payload, 'quiz_eligible'), false);
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

test('legacy batch write endpoints refuse immediate changes without touching any collection', async () => {
  const api = load(new Proxy({}, { get() { assert.fail('No immediate product writes'); } }), {
    '../models/ProductBatch': new Proxy({}, { get() { assert.fail('No immediate batch writes'); } })
  });
  for (const action of [api.addBatch, api.updateBatchBestBefore, api.updateBatchExpiry]) {
    const res = response();
    await action({ params: { productId: '10001' }, body: {} }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /Save draft or Publish/);
  }
});
