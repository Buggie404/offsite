const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referral_id: { type: String, unique: true, index: true },
  referrer_id: { type: String, required: true, index: true },
  referee_id: { type: String, required: true, unique: true, index: true },
  referral_code: { type: String, required: true, index: true },
  register_reward_status: { type: String, enum: ['posted', 'skipped'], default: 'posted' },
  order_reward_status: {
    type: String,
    enum: ['pending', 'awaiting_post', 'posted', 'ineligible'],
    default: 'pending'
  },
  first_order_id: { type: String, default: null, index: true },
  order_reward_due_at: { type: Date, default: null, index: true },
  welcome_voucher_code: { type: String, default: null },
  ineligible_reason: { type: String, default: null },
  referee_display: { type: String, default: 'Friend' },
  register_points: { type: Number, default: 20 },
  order_points: { type: Number, default: 20 }
}, {
  collection: 'Referrals',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

referralSchema.pre('validate', async function preValidate(next) {
  if (this.referral_id) return next();
  try {
    const latest = await this.constructor.findOne(
      { referral_id: /^REF\d+$/ },
      { referral_id: 1 },
      { sort: { created_at: -1 } }
    );
    const lastNum = latest ? parseInt(latest.referral_id.slice(3), 10) : 0;
    this.referral_id = `REF${String((Number.isNaN(lastNum) ? 0 : lastNum) + 1).padStart(6, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Referral', referralSchema);
