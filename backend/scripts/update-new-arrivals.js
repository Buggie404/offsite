require('dotenv').config();
const dns = require('dns');
const { MongoClient } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const EXCLUDED_PRODUCT_IDS = [10014, 11015, 12000, 13003, 14000, 14004];
const REPLACEMENT_PRODUCT_IDS = [13016, 14011];
const ALL_PRODUCT_IDS = [...EXCLUDED_PRODUCT_IDS, ...REPLACEMENT_PRODUCT_IDS];

function isEligibleReplacement(product) {
  return product
    && product.is_best_seller !== true
    && product.variants.length > 0
    && product.variants.every(variant => (variant.stock ?? 0) > 0);
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  try {
    await client.connect();
    const collection = client.db().collection('Products');
    const before = await collection.find(
      { product_id: { $in: ALL_PRODUCT_IDS } },
      {
        projection: {
          _id: 0,
          product_id: 1,
          name: 1,
          category: 1,
          is_new_arrival: 1,
          is_best_seller: 1,
          'variants.sku': 1,
          'variants.stock': 1
        }
      }
    ).sort({ product_id: 1 }).toArray();

    const replacements = before.filter(product =>
      REPLACEMENT_PRODUCT_IDS.includes(product.product_id)
    );
    if (replacements.length !== REPLACEMENT_PRODUCT_IDS.length
        || replacements.some(product => !isEligibleReplacement(product))) {
      throw new Error('A replacement product is missing, a Best Seller, or has unavailable stock');
    }

    if (process.argv.includes('--apply')) {
      const now = new Date().toISOString();
      await collection.updateMany(
        { product_id: { $in: EXCLUDED_PRODUCT_IDS } },
        { $set: { is_new_arrival: false, updatedAt: now } }
      );
      await collection.updateMany(
        { product_id: { $in: REPLACEMENT_PRODUCT_IDS } },
        { $set: { is_new_arrival: true, updatedAt: now } }
      );
    }

    const products = await collection.find(
      { product_id: { $in: ALL_PRODUCT_IDS } },
      {
        projection: {
          _id: 0,
          product_id: 1,
          name: 1,
          category: 1,
          is_new_arrival: 1,
          is_best_seller: 1,
          'variants.sku': 1,
          'variants.stock': 1
        }
      }
    ).sort({ product_id: 1 }).toArray();

    console.log(JSON.stringify({
      mode: process.argv.includes('--apply') ? 'updated' : 'preview',
      products
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
