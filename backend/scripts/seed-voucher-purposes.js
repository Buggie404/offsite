/**
 * Gives existing vouchers a purpose, then adds one active voucher
 * for complaint, loyalty, referral and archetype so those filters have rows.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
const mongoose = require('mongoose');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const Voucher = require('../src/models/Voucher');

const SAMPLES = [
  {
    code: 'CARE10',
    voucher_type: 'discount',
    discount_type: 'percentage',
    discount_value: 10,
    min_order_amount: 30,
    usage_limit: 1,
    used_count: 1,
    purpose: 'complaint',
    assigned_user_id: 'USR00005',
    usage_limit_per_user: 1,
    valid_from: '2026-11-01',
    valid_to: '2026-11-30',
    title: 'Complaint voucher'
  },
  {
    code: 'LEAF5_00006',
    voucher_type: 'discount',
    discount_type: 'percentage',
    discount_value: 5,
    min_order_amount: 0,
    usage_limit: 12,
    used_count: 6,
    purpose: 'loyalty_redeem',
    assigned_user_id: 'USR00006',
    target_tier: 'leaf',
    usage_limit_per_user: 1,
    valid_from: '2026-11-01',
    valid_to: '2027-11-01',
    title: 'Leaf perk'
  },
  {
    code: 'WELCOME5_00007',
    voucher_type: 'discount',
    discount_type: 'percentage',
    discount_value: 5,
    min_order_amount: 25,
    usage_limit: 1,
    used_count: 1,
    purpose: 'referral',
    assigned_user_id: 'USR00007',
    usage_limit_per_user: 1,
    valid_from: '2026-11-01',
    valid_to: '2026-12-31',
    title: 'Welcome voucher'
  },
  {
    code: 'ZEN10_00004',
    voucher_type: 'discount',
    discount_type: 'percentage',
    discount_value: 10,
    min_order_amount: 40,
    max_discount_value: 15,
    usage_limit: 8,
    used_count: 4,
    purpose: 'archetype',
    assigned_user_id: 'USR00004',
    target_tier: 'zen',
    usage_limit_per_user: 1,
    valid_from: '2026-11-01',
    valid_to: '2027-05-01',
    title: 'Zen perk'
  }
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const backfill = await Voucher.updateMany(
    { $or: [{ purpose: null }, { purpose: '' }, { purpose: { $exists: false } }] },
    { $set: { purpose: 'campaign' } }
  );
  const now = new Date().toISOString();
  for (const sample of SAMPLES) {
    await Voucher.updateOne(
      { code: sample.code },
      {
        $setOnInsert: {
          ...sample,
          is_active: true,
          created_by: 'USR00001',
          createdAt: now
        }
      },
      { upsert: true }
    );
  }
  console.log(`Backfilled purpose on ${backfill.modifiedCount} voucher(s). Ensured ${SAMPLES.map((sample) => sample.code).join(', ')}.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
