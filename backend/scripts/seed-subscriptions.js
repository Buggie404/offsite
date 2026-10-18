// Seed demo Ritual Box subscriptions for one user (for testing account → Ritual Box).
//   node scripts/seed-subscriptions.js --email you@example.com        # create demo subs
//   node scripts/seed-subscriptions.js --email you@example.com --clear  # remove them again
// Demo records are tagged with source_order_id = 'SEED_DEMO'.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
const mongoose = require('mongoose');
const Subscription = require('../src/models/Subscription');
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const Order = require('../src/models/Order');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const TAG = 'SEED_DEMO';
const DAY = 24 * 60 * 60 * 1000;
const arg = name => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

async function main() {
  const email = arg('--email');
  if (!email) throw new Error('Pass --email <user email>');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const user = await User.findOne({ email }).lean();
  if (!user) throw new Error(`No user with email ${email}`);

  if (process.argv.includes('--clear')) {
    const demo = await Subscription.find({ user_id: user.user_id, source_order_id: TAG }, { subscription_id: 1 }).lean();
    const ids = demo.map(d => d.subscription_id);
    // Orders charged for demo subscriptions (e.g. by "Reactivate") go too.
    const orders = await Order.deleteMany({ user_id: user.user_id, subscription_id: { $in: ids } });
    const res = await Subscription.deleteMany({ user_id: user.user_id, source_order_id: TAG });
    console.log(`Removed ${res.deletedCount} demo subscriptions and ${orders.deletedCount} of their orders for ${user.user_id}`);
    return;
  }

  const pick = async category => Product.findOne({
    category, is_subscribable: true, is_active: true, 'variants.stock': { $gt: 0 }
  }).lean();
  const coffee = await pick('coffee');
  const matcha = await pick('matcha');
  const matcha2 = await Product.findOne({
    category: 'matcha', is_subscribable: true, is_active: true, _id: { $ne: matcha?._id }
  }).lean();
  if (!coffee || !matcha) throw new Error('Need at least one subscribable coffee and matcha product');

  const now = Date.now();
  const card = (user.payment_methods || []).find(pm => pm.is_default) || (user.payment_methods || [])[0];
  const delivery = {
    recipient_name: user.profile_name || 'Ritual tester',
    mobile: user.phone || '0900000000',
    email: user.email,
    city: 'Ho Chi Minh City',
    address: '1 Demo Street',
    note: ''
  };
  const price = (product) => {
    const variant = product.variants.find(v => v.stock > 0) || product.variants[0];
    const discount = product.subscribe_discount_percent ?? 10;
    return {
      variant,
      pricing_snapshot: {
        original_price: variant.price,
        subscribe_price: Math.round(variant.price * (1 - discount / 100) * 100) / 100,
        discount_percent: discount
      }
    };
  };

  const specs = [
    { product: coffee, frequency_days: 14, status: 'active', next: 1, skipped: [-13], suggest: 7 },
    { product: matcha, frequency_days: 30, status: 'payment_failed', next: -2, failedAt: -13 },
    matcha2 && { product: matcha2, frequency_days: 30, status: 'paused', next: 4, resume: 16 }
  ].filter(Boolean);

  for (const spec of specs) {
    const { variant, pricing_snapshot } = price(spec.product);
    const sub = new Subscription({
      user_id: user.user_id,
      product_id: String(spec.product._id),
      variant_id: variant.sku,
      quantity: 1,
      frequency_days: spec.frequency_days,
      next_charge_at: new Date(now + spec.next * DAY),
      status: spec.status,
      pricing_snapshot,
      payment_method_id: card ? String(card._id) : null,
      delivery_info: delivery,
      skipped_deliveries: (spec.skipped || []).map(d => new Date(now + d * DAY)),
      consecutive_skips: (spec.skipped || []).length,
      suggested_frequency_days: spec.suggest || null,
      suggested_at: spec.suggest ? new Date(now) : null,
      pause_option: spec.status === 'paused' ? '1_month' : null,
      failed_attempts: spec.status === 'payment_failed' ? 1 : 0,
      last_failure_reason: spec.status === 'payment_failed' ? 'Card declined' : null,
      last_failed_at: spec.failedAt ? new Date(now + spec.failedAt * DAY) : null,
      resume_at: spec.resume ? new Date(now + spec.resume * DAY) : null,
      source_order_id: TAG
    });
    await sub.save();
    console.log(`Created ${sub.subscription_id} · ${spec.product.name} · ${spec.status}`);
  }
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
