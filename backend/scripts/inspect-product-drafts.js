require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    const rows = await mongoose.connection.db.collection('Products').find({ is_active: false }, { projection: {
      _id: 0, product_id: 1, name: 1, slug: 1, is_active: 1, createdAt: 1, updatedAt: 1
    } }).sort({ updatedAt: -1 }).toArray();
    console.log(JSON.stringify({ inactiveCount: rows.length, products: rows }, null, 2));
  } catch (error) { console.error(error.name + ': ' + error.message.replace(/mongodb[^\s]*/g, '[connection]')); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
