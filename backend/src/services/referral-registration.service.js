const User = require('../models/User');
const Referral = require('../models/Referral');
const PointTransaction = require('../models/PointTransaction');
const Voucher = require('../models/Voucher');

const DAY_MS = 24 * 60 * 60 * 1000;

// Both drivers address Users. Never increment the native-driver copy as well.
async function ensureWelcomeVoucher(userId, session = null) {
  const options = session ? { session } : {};
  const query = User.findOne({ user_id: userId }, { welcome_voucher_code: 1 });
  if (session) query.session(session);
  const user = await query.lean();
  const code = user?.welcome_voucher_code || `WELCOME5_${userId.replace(/^USR/i, '')}`;
  const now = new Date();
  await Voucher.findOneAndUpdate({ code }, {
    $setOnInsert: {
      code, purpose: 'referral', assigned_user_id: userId,
      voucher_type: 'discount', discount_type: 'fixed', discount_value: 5,
      is_active: true, usage_limit: 1, used_count: 0,
      min_order_amount: 0, max_discount_value: 5,
      valid_from: now.toISOString().slice(0, 10),
      valid_to: new Date(now.getTime() + 180 * DAY_MS).toISOString().slice(0, 10),
      createdAt: now.toISOString(), usage_limit_per_user: 1, target_tier: null
    }
  }, { upsert: true, new: true, setDefaultsOnInsert: true, ...options });
  await User.updateOne({ user_id: userId }, { $set: { welcome_voucher_code: code } }, options);
  return code;
}

async function completeRegistration(refereeId, referrerId, code, yearlyLimit = 10) {
  if (refereeId === referrerId) return null;
  const session = await User.db.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const referee = await User.findOne({ user_id: refereeId }).session(session).lean();
      // Only a code saved during password registration may earn a signup reward.
      if (!referee || referee.referred_by !== code || referee.oauth_providers?.length) return;
      const existing = await Referral.findOne({ referee_id: refereeId }).session(session).lean();
      if (existing) {
        await User.updateOne({ user_id: refereeId }, {
          $set: { referral_registration_pending: false }
        }, { session });
        result = existing;
        return;
      }

      const joined = new Date(referee.createdAt || Date.now());
      const start = new Date(joined.getFullYear(), 0, 1);
      const end = new Date(joined.getFullYear() + 1, 0, 1);
      const count = await Referral.countDocuments({
        referrer_id: referrerId, created_at: { $gte: start, $lt: end }
      }).session(session);
      const eligible = count < yearlyLimit;
      const referralId = `REFREG_${refereeId}`;
      const welcomeCode = eligible ? await ensureWelcomeVoucher(refereeId, session) : null;
      const [referral] = await Referral.create([{
        referral_id: referralId, referrer_id: referrerId, referee_id: refereeId,
        referral_code: code, referee_display: referee.profile_name || 'Friend',
        register_reward_status: eligible ? 'posted' : 'skipped',
        order_reward_status: eligible ? 'pending' : 'ineligible',
        ineligible_reason: eligible ? null : 'yearly_limit',
        register_points: eligible ? 20 : 0, order_points: eligible ? 20 : 0,
        welcome_voucher_code: welcomeCode, created_at: joined
      }], { session });

      if (eligible) {
        await PointTransaction.create([{
          transaction_id: `PTXREF_${refereeId}`,
          user_id: referrerId, type: 'referral_register', amount: 20,
          status: 'posted', ref_type: 'referral', ref_id: referralId,
          posted_at: new Date()
        }], { session });
        await User.updateOne({ user_id: referrerId }, { $inc: { points: 20 } }, { session });
      }
      await User.updateOne({ user_id: refereeId }, {
        $set: { referral_registration_pending: false }
      }, { session });
      result = referral;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { completeRegistration, ensureWelcomeVoucher };
