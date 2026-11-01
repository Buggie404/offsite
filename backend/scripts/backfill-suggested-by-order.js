require('dotenv').config();
const dns = require('dns');
const { MongoClient } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Subscriptions.suggested_by_order_id was added after some suggestions already existed.
// Which one-time order raised those older suggestions isn't recorded, so this script does NOT
// guess: it only reports how many open suggestions have no source order. They keep working
// as before and drop off by themselves after the 3-day suggestion window; canceling an order
// just can't withdraw them. Read-only, safe to run any number of times.
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const subscriptions = client.db().collection('Subscriptions');
    const open = { suggested_frequency_days: { $ne: null } };
    const [total, withoutOrder] = await Promise.all([
      subscriptions.countDocuments(open),
      subscriptions.countDocuments({ ...open, $or: [{ suggested_by_order_id: null }, { suggested_by_order_id: { $exists: false } }] })
    ]);
    console.log(`Open Ritual Box suggestions: ${total}`);
    console.log(`  without suggested_by_order_id (left as is, expire after 3 days): ${withoutOrder}`);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error('Backfill check failed:', error);
  process.exit(1);
});
