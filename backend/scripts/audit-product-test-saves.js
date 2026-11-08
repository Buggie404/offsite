require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    const db = mongoose.connection.db;
    const [products, logs, collections] = await Promise.all([
      db.collection('Products').find({}).sort({ product_id: 1 }).toArray(),
      db.collection('ActivityLogs').find({ $or: [{ target_entity: 'Products' }, { action_type: /^product\./ }] },
        { projection: { _id: 0, action_type: 1, target_id: 1, old_value: 1, new_value: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray(),
      db.listCollections({}, { nameOnly: true }).toArray()
    ]);
    const draftCollection = collections.some(c => c.name === 'ProductDrafts');
    const drafts = draftCollection ? await db.collection('ProductDrafts').find({}, { projection: { _id: 0, saved_by: 0 } }).toArray() : [];
    const output = path.resolve(__dirname, '../../docs/product-draft-audit');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'database-snapshot.json'), JSON.stringify({ read_at: new Date(), products, logs, drafts }, null, 2));
    console.log(JSON.stringify({ products: products.length, productLogs: logs.length, drafts: drafts.length,
      productRelatedCollections: collections.map(c => c.name).filter(name => /product|backup/i.test(name)),
      inactive: products.filter(p => p.is_active === false).map(p => ({ id: p.product_id, name: p.name, updatedAt: p.updatedAt })), logs }, null, 2));
  } catch (error) { console.error(error.name + ': ' + error.message.replace(/mongodb[^\s]*/g, '[connection]')); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
