require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    const rows = await mongoose.connection.db.collection('Products').find({}, { projection: {
      _id: 0, product_id: 1, name: 1, category: 1, variant_type: 1, 'variants.sku': 1,
      'variants.label': 1, 'variants.images.url': 1, 'coffee.roast_level': 1
    } }).toArray();
    console.log(JSON.stringify({ total: rows.length,
      productsWithoutVariantImages: rows.filter(row => row.variants?.every(variant => !variant.images?.some(image => image.url))).length,
      productsWithSomeMissingVariantImages: rows.filter(row => row.variants?.some(variant => !variant.images?.some(image => image.url))).length,
      variantsWithoutSku: rows.flatMap(row => row.variants || []).filter(variant => !variant.sku).length,
      coffee: rows.filter(row => row.category === 'coffee').map(row => ({ name: row.name, roast: row.coffee?.roast_level })),
      missingVariantLabelCount: rows.filter(row => row.variants?.some(variant => !variant.label)).length,
      optionProductsMissingLabels: rows.filter(row => row.variant_type !== 'none' && row.variants?.some(variant => !variant.label)),
      oribe: rows.filter(row => /oribe|tokoname/i.test(row.name)) }, null, 2));
  } catch (error) { console.error(error.name + ': ' + error.message.replace(/mongodb[^\s]*/g, '[connection]')); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
