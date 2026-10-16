require('dotenv').config();
const dns = require('dns');
const { MongoClient } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Only matcha & coffee can be subscribed to.
const SUBSCRIBABLE_CATEGORIES = ['matcha', 'coffee'];
const MIN_DISCOUNT = 5;
const MAX_DISCOUNT = 15;

const randomDiscount = () =>
  Math.floor(Math.random() * (MAX_DISCOUNT - MIN_DISCOUNT + 1)) + MIN_DISCOUNT;

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  try {
    await client.connect();
    const collection = client.db().collection('Products');

    const products = await collection.find(
      {},
      { projection: { _id: 1, product_id: 1, name: 1, category: 1 } }
    ).sort({ product_id: 1 }).toArray();

    const updates = products.map(product => {
      const isSubscribable = SUBSCRIBABLE_CATEGORIES.includes(product.category);
      return {
        product,
        is_subscribable: isSubscribable,
        // Non-subscribable products keep null (shop-wide default applies).
        subscribe_discount_percent: isSubscribable ? randomDiscount() : null
      };
    });

    if (apply) {
      const now = new Date().toISOString();
      const result = await collection.bulkWrite(updates.map(update => ({
        updateOne: {
          filter: { _id: update.product._id },
          update: {
            $set: {
              is_subscribable: update.is_subscribable,
              subscribe_discount_percent: update.subscribe_discount_percent,
              updatedAt: now
            }
          }
        }
      })));
      console.log(`Matched ${result.matchedCount}, modified ${result.modifiedCount}`);
    }

    console.table(updates.map(update => ({
      product_id: update.product.product_id,
      category: update.product.category,
      name: update.product.name,
      is_subscribable: update.is_subscribable,
      subscribe_discount_percent: update.subscribe_discount_percent
    })));
    console.log(apply ? 'Mode: updated' : 'Mode: preview (run with --apply to write)');
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
