// User-authorized correction of one field. No Product.save(), visibility changes or publishing.
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    const collection = mongoose.connection.db.collection('Products');
    const before = await collection.findOne({ product_id: 11010 });
    assert.ok(before, 'Product 11010 not found');
    assert.ok(['Medium', 'medium roast'].includes(before.coffee?.roast_level), 'Unexpected current roast; refusing to overwrite');
    const directory = path.resolve(__dirname, '../../docs/product-draft-audit');
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, `roast-repair-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify({ before, requested_change: { 'coffee.roast_level': 'medium roast' } }, null, 2));
    const result = await collection.updateOne({ _id: before._id, 'coffee.roast_level': before.coffee.roast_level },
      { $set: { 'coffee.roast_level': 'medium roast' } });
    assert.equal(result.matchedCount, 1, 'Product changed concurrently; repair did not match');
    const after = await collection.findOne({ _id: before._id });
    const expected = JSON.parse(JSON.stringify(before));
    expected.coffee.roast_level = 'medium roast';
    assert.deepEqual(JSON.parse(JSON.stringify(after)), expected, 'Fields other than roast changed; inspect audit');
    fs.writeFileSync(filename, JSON.stringify({ before, after, verified_only_roast_changed: true, completed_at: new Date() }, null, 2));
    const coffee = await collection.find({ category: 'coffee' }, { projection: { _id: 0, product_id: 1, 'coffee.roast_level': 1 } }).toArray();
    console.log(JSON.stringify({ product_id: 11010, before: before.coffee.roast_level, after: after.coffee.roast_level,
      is_active: after.is_active, modified: result.modifiedCount, onlyRoastChanged: true,
      otherNoncanonical: coffee.filter(p => !['light roast', 'medium light roast', 'medium roast', 'medium dark roast', 'dark roast'].includes(p.coffee?.roast_level)), audit: filename }));
  } catch (error) { console.error(error.name + ': ' + error.message.replace(/mongodb[^\s]*/g, '[connection]')); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
