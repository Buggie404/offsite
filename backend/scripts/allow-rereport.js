// Run once on each database: node scripts/allow-rereport.js
// Post, comment and account reports used to be unique per reporter forever. Now only an open (pending)
// report is unique, so a customer can report the same target again after their report is closed and the
// author's penalty is over. This drops the old indexes and builds the new ones. Safe to run more than once.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const dns = require('dns');
const mongoose = require('mongoose');

// Same as src/config/db.js: the default resolver on Windows can refuse Atlas SRV lookups.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const Report = require('../src/models/Report');

const OLD_INDEXES = [
  'target_type_1_post_id_1_reporter_id_1',
  'target_type_1_comment_id_1_reporter_id_1',
  'target_type_1_reported_user_id_1_reporter_id_1'
];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not defined in backend/.env');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  const reports = mongoose.connection.db.collection('Reports');
  const existing = new Set((await reports.indexes()).map((index) => index.name));
  for (const name of OLD_INDEXES) {
    if (existing.has(name)) {
      await reports.dropIndex(name);
      console.log(`Dropped ${name}.`);
    } else {
      console.log(`${name} was already gone.`);
    }
  }
  await Report.createIndexes();
  console.log('Reports now allow one open report per reporter and target.');
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
