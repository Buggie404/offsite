require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    const fields = ['matcha.product_grade', 'matcha.pricing_tier', 'coffee.process_type', 'drinkware.ware_type',
      'drinkware.material', 'sets_bundles.set_type', 'tools.tool_category', 'tools.tool_type'];
    const rows = await mongoose.connection.db.collection('Products').find({}, { projection: Object.fromEntries(fields.map(field => [field, 1])) }).toArray();
    console.log(JSON.stringify({ total: rows.length, options: Object.fromEntries(fields.map(field => [field,
      [...new Set(rows.map(row => field.split('.').reduce((obj, key) => obj?.[key], row)).filter(value => typeof value === 'string' && value))].sort()
    ])) }, null, 2));
  } catch (error) { console.error(error.name + ': ' + error.message.replace(/mongodb[^\s]*/g, '[connection]')); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
