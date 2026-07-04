require('dotenv').config();
const dns = require('dns');
const { MongoClient } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const PRODUCT_IDS = [10014, 11015, 12000, 13003, 14000, 14001, 14002, 14004];

const STOCK_UPDATES = [
  { productId: 10014, sku: 'MAT022', stock: 0 },
  { productId: 11015, sku: 'COF032', stock: 0 },
  { productId: 12000, sku: 'TOM001', stock: 0 },
  { productId: 13003, sku: 'TEP001', stock: 0 },
  { productId: 14001, sku: 'SET002', stock: 4 },
  { productId: 14002, sku: 'SET003', stock: 8 },
  { productId: 14004, sku: 'SET005', stock: 0 }
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  try {
    await client.connect();
    const collection = client.db().collection('Products');

    if (process.argv.includes('--apply')) {
      for (const update of STOCK_UPDATES) {
        const result = await collection.updateOne(
          { product_id: update.productId, 'variants.sku': update.sku },
          {
            $set: {
              'variants.$.stock': update.stock,
              updatedAt: new Date().toISOString()
            }
          }
        );

        if (result.matchedCount !== 1) {
          throw new Error(`Product ${update.productId} / ${update.sku} was not found`);
        }
      }
    }

    const products = await collection.find(
      process.argv.includes('--all') || process.argv.includes('--filters')
        ? {}
        : { product_id: { $in: PRODUCT_IDS } },
      {
        projection: {
          _id: 0,
          product_id: 1,
          name: 1,
          category: 1,
          is_new_arrival: 1,
          is_best_seller: 1,
          total_sold_quantity: 1,
          matcha: 1,
          coffee: 1,
          tools: 1,
          drinkware: 1,
          'variants.price': 1,
          'variants.sku': 1,
          'variants.label': 1,
          'variants.stock': 1,
          'variants.is_default': 1
        }
      }
    ).sort({ product_id: 1 }).toArray();

    if (process.argv.includes('--filters')) {
      const unique = values => [...new Set(values.filter(Boolean))].sort();
      console.log(JSON.stringify({
        matchaGrades: unique(products.map(product => product.matcha?.product_grade)),
        matchaOrigins: unique(products.map(product => product.matcha?.origin)),
        coffeeTypes: unique(products.map(product => product.coffee?.process_type)),
        coffeeRoasts: unique(products.map(product => product.coffee?.roast_level)),
        coffeeOrigins: unique(products.map(product => product.coffee?.product_origin)),
        toolCategories: unique(products.map(product => product.tools?.tool_category)),
        toolTypes: unique(products.map(product => product.tools?.tool_type)),
        drinkwareTypes: unique(products.map(product => product.drinkware?.ware_type)),
        drinkwareMaterials: unique(products.map(product => product.drinkware?.material))
      }, null, 2));
      return;
    }

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
