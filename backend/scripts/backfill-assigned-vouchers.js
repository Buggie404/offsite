/**
 * One-time dev backfill.
 * Vouchers created before 2026-11-01 whose code embeds a customer id
 * (LEAF5_, BLOOMFS_, ZEN10_, WELCOME5_) get assigned_user_id and purpose.
 * Also stores every Orders.coupon.code in uppercase and ensures the lookup index.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
const mongoose = require('mongoose');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const Voucher = require('../src/models/Voucher');
const User = require('../src/models/User');
const Order = require('../src/models/Order');

const CUTOFF = '2026-11-01';
const PREFIXES = [
  { prefix: 'LEAF5_', purpose: 'loyalty_redeem' },
  { prefix: 'BLOOMFS_', purpose: 'loyalty_redeem' },
  { prefix: 'ZEN10_', purpose: 'loyalty_redeem' },
  { prefix: 'WELCOME5_', purpose: 'referral' }
];

async function resolveUserId(suffix) {
  const raw = String(suffix || '').trim();
  if (!raw) return null;
  const candidates = /^USR/i.test(raw) ? [raw.toUpperCase()] : [`USR${raw}`, raw];
  const user = await User.findOne({ user_id: { $in: candidates } }, 'user_id').lean();
  return user?.user_id || null;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);

  const vouchers = await Voucher.find({
    createdAt: { $lt: CUTOFF },
    $or: [
      { assigned_user_id: null },
      { assigned_user_id: '' },
      { assigned_user_id: { $exists: false } }
    ]
  }).lean();

  let updated = 0;
  let skipped = 0;
  for (const voucher of vouchers) {
    const code = String(voucher.code || '');
    const match = PREFIXES.find((entry) => code.toUpperCase().startsWith(entry.prefix));
    if (!match) {
      skipped += 1;
      continue;
    }
    const userId = await resolveUserId(code.slice(match.prefix.length));
    if (!userId) {
      console.log(`No customer for ${code}`);
      skipped += 1;
      continue;
    }
    await Voucher.updateOne(
      { _id: voucher._id },
      { $set: { assigned_user_id: userId, purpose: match.purpose } }
    );
    updated += 1;
    console.log(`${code} -> ${userId} (${match.purpose})`);
  }

  const orders = await Order.find({ 'coupon.code': { $type: 'string' } }, { 'coupon.code': 1 }).lean();
  let codes = 0;
  for (const order of orders) {
    const current = order.coupon?.code;
    if (!current) continue;
    const upper = String(current).trim().toUpperCase();
    if (upper !== current) {
      await Order.updateOne({ _id: order._id }, { $set: { 'coupon.code': upper } });
      codes += 1;
    }
  }
  await Order.collection.createIndex({ 'coupon.code': 1 });

  console.log(`Assigned ${updated} voucher(s), skipped ${skipped}, uppercased ${codes} coupon code(s).`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
