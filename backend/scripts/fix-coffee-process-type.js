require('dotenv').config();
const dns = require('dns');
const { MongoClient } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const TYPO_PATTERN = /^(wahse|wahsed)$/i;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  try {
    await client.connect();
    const collection = client.db().collection('Products');
    const filter = {
      category: 'coffee',
      'coffee.process_type': { $regex: TYPO_PATTERN }
    };

    const matches = await collection.find(filter, {
      projection: {
        _id: 0,
        product_id: 1,
        name: 1,
        'coffee.process_type': 1
      }
    }).sort({ product_id: 1 }).toArray();

    let modifiedCount = 0;
    if (process.argv.includes('--apply') && matches.length) {
      const result = await collection.updateMany(filter, {
        $set: {
          'coffee.process_type': 'washed',
          updatedAt: new Date().toISOString()
        }
      });
      modifiedCount = result.modifiedCount;
    }

    const coffeeTypes = await collection.distinct('coffee.process_type', { category: 'coffee' });

    console.log(JSON.stringify({
      mode: process.argv.includes('--apply') ? 'updated' : 'preview',
      matchedCount: matches.length,
      modifiedCount,
      matches,
      coffeeTypes: coffeeTypes.filter(Boolean).sort()
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
