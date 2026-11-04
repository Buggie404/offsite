require('dotenv').config();
const dns = require('dns');
const { MongoClient } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Run before deploying the unique index on Subscriptions { source_order_id, product_id, variant_id }
// (partial: source_order_id is a string). Lists every checkout line that already has more than one
// Ritual Box. Report only — nothing is deleted or changed; resolve each group by hand (keep one box,
// cancel the others and check what was charged) before the index can be built.
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const groups = await client.db().collection('Subscriptions').aggregate([
      { $match: { source_order_id: { $type: 'string' } } },
      { $sort: { created_at: 1 } },
      {
        $group: {
          _id: { source_order_id: '$source_order_id', product_id: '$product_id', variant_id: '$variant_id' },
          count: { $sum: 1 },
          subscriptions: { $push: { subscription_id: '$subscription_id', user_id: '$user_id', status: '$status', created_at: '$created_at' } }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { '_id.source_order_id': 1 } }
    ]).toArray();

    if (!groups.length) {
      console.log('No duplicate Ritual Boxes: the unique index can be built.');
      return;
    }
    console.log(`${groups.length} checkout line(s) with more than one Ritual Box (nothing was changed):`);
    for (const g of groups) {
      console.log(`- order ${g._id.source_order_id}, product ${g._id.product_id}, variant ${g._id.variant_id}: ${g.count} boxes`);
      for (const s of g.subscriptions) {
        console.log(`    ${s.subscription_id}  user ${s.user_id}  ${s.status}  created ${s.created_at?.toISOString?.() || s.created_at}`);
      }
    }
    process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error('Duplicate check failed:', error);
  process.exit(1);
});
