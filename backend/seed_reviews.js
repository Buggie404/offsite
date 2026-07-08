const dns = require('dns');
const mongoose = require('mongoose');
require('dotenv').config();

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const Order = require('./src/models/Order');
const Product = require('./src/models/Product');
const Review = require('./src/models/Review');

const REAL_DELIVERED_COMMENTS = [
  'Arrived in great condition and matched what I ordered. I have been enjoying it all week.',
  'Delivery was smooth and the product felt fresh right out of the package.',
  'The quality is exactly what I hoped for. I would confidently order this again.',
  'Nicely packed, easy to use, and the product performed well from the first try.',
  'This was a pleasant surprise. The details feel thoughtful and the quality is consistent.'
];

function pick(list, index) {
  return list[index % list.length];
}

function defaultVariant(product) {
  return product.variants.find(variant => variant.is_default) || product.variants[0] || null;
}

function productImage(product, variant) {
  return variant?.images?.[0]?.url || product.images?.[0]?.url || '';
}

function productSnapshot(product, variant) {
  return {
    name: product.name,
    variant_label: variant?.label || 'Default',
    image_url: productImage(product, variant)
  };
}

async function createReviewIfMissing(payload) {
  const existing = await Review.findOne({
    order_id: payload.order_id,
    product_id: payload.product_id,
    variant_id: payload.variant_id
  });

  if (existing) return { review: existing, created: false };

  const review = new Review(payload);
  await review.save();
  return { review, created: true };
}

async function refreshProductReviewMetrics(productIds) {
  for (const productId of productIds) {
    const product = await Product.findById(productId);
    if (!product) continue;

    const reviews = await Review.find({
      product_id: { $in: [String(product._id), String(product.product_id)] }
    });
    const count = reviews.length;
    const total = reviews.reduce((sum, review) => sum + review.rating, 0);

    await Product.updateOne(
      { _id: product._id },
      {
        $set: {
          review_count: count,
          rating_avg: count ? Math.round((total / count) * 10) / 10 : null
        }
      }
    );
  }
}

async function refreshAllProductReviewMetrics() {
  const products = await Product.find({});
  let refreshedProducts = 0;
  let productsWithReviews = 0;

  for (const product of products) {
    const reviews = await Review.find({
      product_id: { $in: [String(product._id), String(product.product_id)] }
    });
    const count = reviews.length;
    const total = reviews.reduce((sum, review) => sum + review.rating, 0);

    await Product.updateOne(
      { _id: product._id },
      {
        $set: {
          review_count: count,
          rating_avg: count ? Math.round((total / count) * 10) / 10 : null
        }
      }
    );

    refreshedProducts += 1;
    if (count > 0) productsWithReviews += 1;
  }

  return {
    refreshedProducts,
    productsWithReviews
  };
}

async function seedDeliveredOrderReviews() {
  const orders = await Order.find({ order_status: 'delivered' });
  let created = 0;
  let skippedReviewed = 0;
  const affectedProductIds = new Set();

  for (const order of orders) {
    let orderChanged = false;

    for (let itemIndex = 0; itemIndex < order.items.length; itemIndex += 1) {
      const item = order.items[itemIndex];
      if (item.is_reviewed) {
        skippedReviewed += 1;
        continue;
      }

      const product = await Product.findById(item.product_id);
      if (!product) continue;

      const variant = product.variants.find(candidate => candidate.sku === item.variant_id) || defaultVariant(product);
      const reviewerName = order.delivery_info?.recipient_name || 'Verified Customer';

      const result = await createReviewIfMissing({
        user_id: order.user_id || null,
        order_id: order.order_id,
        product_id: String(item.product_id),
        variant_id: item.variant_id,
        rating: 4 + ((created + itemIndex) % 2),
        content: pick(REAL_DELIVERED_COMMENTS, created + itemIndex),
        is_anonymous: false,
        product_snapshot: productSnapshot(product, variant),
        user_snapshot: {
          name: reviewerName,
          avatar_url: null
        }
      });

      item.is_reviewed = true;
      item.review_id = result.review.review_id;
      orderChanged = true;
      affectedProductIds.add(String(item.product_id));
      if (result.created) created += 1;
    }

    if (orderChanged) {
      await order.save();
    }
  }

  await refreshProductReviewMetrics(affectedProductIds);

  return {
    deliveredOrderCount: orders.length,
    created,
    skippedReviewed,
    refreshedProducts: affectedProductIds.size
  };
}

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI is not defined in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  if (process.argv.includes('--refresh-only')) {
    const result = await refreshAllProductReviewMetrics();

    console.log('Product review metrics refresh complete.');
    console.log(`Products refreshed: ${result.refreshedProducts}`);
    console.log(`Products with real reviews: ${result.productsWithReviews}`);
    return;
  }

  const result = await seedDeliveredOrderReviews();

  console.log('Delivered review seed complete.');
  console.log(`Delivered orders scanned: ${result.deliveredOrderCount}`);
  console.log(`Reviews created from delivered orders: ${result.created}`);
  console.log(`Already-reviewed items skipped: ${result.skippedReviewed}`);
  console.log(`Products refreshed: ${result.refreshedProducts}`);
}

seed()
  .catch(error => {
    console.error('Delivered review seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
