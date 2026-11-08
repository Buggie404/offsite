// User-authorized repair: variant_type only. Does not set variant images or publish.
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    const db = mongoose.connection.db;
    const products = db.collection('Products');
    const before = await products.findOne({ product_id: 10020 });
    assert.ok(before && before.name === 'Yuki', 'Unexpected target product');
    assert.ok(['yuki', 'none'].includes(before.variant_type), 'Unexpected current type; refusing to overwrite');
    assert.equal(before.variants.length, 1, 'Expected a single variant');
    const drafts = db.collection('ProductDrafts');
    const beforeDraft = await drafts.findOne({ product_id: 10020 });
    const folder = path.resolve(__dirname, '../../docs/product-draft-audit');
    fs.mkdirSync(folder, { recursive: true });
    const audit = path.join(folder, `yuki-type-repair-${Date.now()}.json`);
    fs.writeFileSync(audit, JSON.stringify({ before, beforeDraft }, null, 2));
    const result = await products.updateOne({ _id: before._id, variant_type: before.variant_type }, { $set: { variant_type: 'none' } });
    assert.equal(result.matchedCount, 1, 'Concurrent change detected');
    if (beforeDraft?.payload?.variant_type === 'yuki') {
      const draftResult = await drafts.updateOne({ _id: beforeDraft._id, 'payload.variant_type': 'yuki' }, { $set: { 'payload.variant_type': 'none' } });
      assert.equal(draftResult.matchedCount, 1, 'Draft changed concurrently');
    }
    const after = await products.findOne({ _id: before._id });
    const expected = JSON.parse(JSON.stringify(before));
    expected.variant_type = 'none';
    assert.deepEqual(JSON.parse(JSON.stringify(after)), expected);
    const afterDraft = await drafts.findOne({ product_id: 10020 });
    if (beforeDraft) {
      const expectedDraft = JSON.parse(JSON.stringify(beforeDraft));
      if (expectedDraft.payload.variant_type === 'yuki') expectedDraft.payload.variant_type = 'none';
      assert.deepEqual(JSON.parse(JSON.stringify(afterDraft)), expectedDraft);
    }
    const invalidProducts = await products.countDocuments({ variant_type: { $nin: ['none', 'size', 'color', 'type', 'package'] } });
    fs.writeFileSync(audit, JSON.stringify({ before, after, beforeDraft, afterDraft, verified_only_variant_type_changed: true, completed_at: new Date() }, null, 2));
    console.log(JSON.stringify({ product_id: 10020, name: after.name, from: before.variant_type, to: after.variant_type,
      sku: after.variants[0].sku, variantImages: after.variants[0].images, is_active: after.is_active,
      invalidProductsRemaining: invalidProducts, packageProducts: await products.countDocuments({ variant_type: 'package' }), audit }));
  } catch (error) { console.error(error.name + ': ' + error.message.replace(/mongodb[^\s]*/g, '[connection]')); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
