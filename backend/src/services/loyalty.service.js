const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const PointTransaction = require('../models/PointTransaction');
const Referral = require('../models/Referral');
const Voucher = require('../models/Voucher');
const Order = require('../models/Order');
const { tierMultiplier, TIER_MULTIPLIER, HOLD_DAYS } = require('./points.service');

const REFERRALS_PER_YEAR_LIMIT = 10;
const COMMUNITY_DAILY_CAP = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIER_THRESHOLDS = [
  { tier: 'Seed', minLifetime: 0 },
  { tier: 'Leaf', minLifetime: 150 },
  { tier: 'Bloom', minLifetime: 400 },
  { tier: 'Zen', minLifetime: 1000 }
];

const REDEEM_REWARDS = [
  {
    id: 'off5_30',
    title: '$5 off',
    subtitle: 'Orders from $30',
    pointsCost: 500,
    voucherType: 'discount',
    discountType: 'fixed',
    discountValue: 5,
    minOrderAmount: 30
  },
  {
    id: 'free_shipping',
    title: 'Free shipping',
    subtitle: 'Any order',
    pointsCost: 800,
    voucherType: 'shipping',
    discountType: 'fixed',
    discountValue: 999,
    minOrderAmount: 0
  },
  {
    id: 'off20_80',
    title: '$20 off',
    subtitle: 'Orders from $80',
    pointsCost: 2000,
    voucherType: 'discount',
    discountType: 'fixed',
    discountValue: 20,
    minOrderAmount: 80
  }
];

const REFERRAL_CODE_REGEX = /^[A-Z0-9]+_[A-Z0-9]{8}$/;

async function resolveAppUserId(jwtUserId) {
  if (!jwtUserId) return null;
  if (/^USR/i.test(String(jwtUserId))) return String(jwtUserId);
  if (!mongoose.Types.ObjectId.isValid(String(jwtUserId))) return null;
  const user = await User.findById(String(jwtUserId), { user_id: 1 }).lean();
  return user?.user_id || null;
}

async function loadUserProfile(userId) {
  const { getCollections } = require('../config/db');
  const { ObjectId } = require('mongodb');
  const { userCollection } = await getCollections();

  let mongoUser = await User.findOne({ user_id: userId }).lean();
  if (!mongoUser) {
    const native = await userCollection.findOne({ user_id: userId });
    if (native) {
      mongoUser = native;
    }
  }

  if (!mongoUser && mongoose.Types.ObjectId.isValid(String(userId))) {
    const native = await userCollection.findOne({ _id: new ObjectId(String(userId)) });
    if (native) {
      mongoUser = native;
      userId = native.user_id;
    }
  }

  if (!mongoUser) return null;

  return { appUserId: mongoUser.user_id || userId, profile: mongoUser };
}

function sanitizeReferralPrefix(name) {
  const base = String(name || 'USER')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12) || 'USER';
  return base;
}

function randomReferralSuffix() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

async function ensureReferralCode(profile) {
  if (profile.referral_code) return profile.referral_code;

  const prefix = sanitizeReferralPrefix(profile.profile_name);
  let code = '';
  let attempts = 0;

  while (attempts < 12) {
    code = `${prefix}_${randomReferralSuffix()}`;
    const exists = await User.findOne({ referral_code: code }, { _id: 1 }).lean();
    if (!exists) break;
    attempts += 1;
  }

  await User.updateOne(
    { user_id: profile.user_id },
    { $set: { referral_code: code } },
    { upsert: false }
  );

  const { getCollections } = require('../config/db');
  const { userCollection } = await getCollections();
  await userCollection.updateOne({ user_id: profile.user_id }, { $set: { referral_code: code } });

  return code;
}

async function computeLifetimePoints(userId) {
  const rows = await PointTransaction.aggregate([
    {
      $match: {
        user_id: userId,
        amount: { $gt: 0 },
        status: { $in: ['posted', 'pending', 'used'] },
        type: { $ne: 'redeem_voucher' }
      }
    },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  return rows[0]?.total || 0;
}

function resolveTierFromLifetime(lifetimePoints) {
  let current = TIER_THRESHOLDS[0];
  for (const entry of TIER_THRESHOLDS) {
    if (lifetimePoints >= entry.minLifetime) {
      current = entry;
    }
  }
  return current.tier;
}

function getNextTierInfo(tier, lifetimePoints) {
  const index = TIER_THRESHOLDS.findIndex((entry) => entry.tier === tier);
  const next = index >= 0 ? TIER_THRESHOLDS[index + 1] : null;
  if (!next) {
    return { nextTier: null, pointsToNext: 0, progressPercent: 100 };
  }

  const currentMin = TIER_THRESHOLDS[index]?.minLifetime ?? 0;
  const span = next.minLifetime - currentMin;
  const earnedInBand = Math.max(0, lifetimePoints - currentMin);
  const pointsToNext = Math.max(0, next.minLifetime - lifetimePoints);
  const progressPercent = span > 0 ? Math.min(100, Math.round((earnedInBand / span) * 100)) : 0;

  return { nextTier: next.tier, pointsToNext, progressPercent };
}

async function syncMembershipTier(userId, lifetimePoints) {
  const tier = resolveTierFromLifetime(lifetimePoints);
  await User.updateOne({ user_id: userId }, { $set: { membership_tier: tier } });

  const { getCollections } = require('../config/db');
  const { userCollection } = await getCollections();
  await userCollection.updateOne({ user_id: userId }, { $set: { membership_tier: tier } });

  return tier;
}

function formatActivityLabel(txn) {
  switch (txn.type) {
    case 'purchase':
      return txn.ref_id ? `Order ${txn.ref_id}` : 'Purchase';
    case 'review':
      return 'Product review';
    case 'referral_register':
      return 'Referral signup bonus';
    case 'referral_order':
      return 'Referral first order';
    case 'post_approved':
      return 'Community post approved';
    case 'recipe_approved':
      return 'Recipe post approved';
    case 'recipe_curated':
      return 'Recipe published';
    case 'redeem_voucher':
      return txn.ref_id ? `Redeemed ${txn.ref_id}` : 'Points redeemed';
    case 'quiz':
      return 'Quiz completed';
    default:
      return 'Points activity';
  }
}

function formatStatusLabel(status) {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'posted':
      return 'Posted';
    case 'reversed':
      return 'Reversed';
    case 'used':
      return 'Used';
    default:
      return status;
  }
}

async function getDashboard(jwtUserId) {
  const appUserId = await resolveAppUserId(jwtUserId);
  if (!appUserId) return null;

  const loaded = await loadUserProfile(appUserId);
  if (!loaded) return null;

  const { profile } = loaded;
  const referralCode = await ensureReferralCode(profile);
  const availablePoints = profile.points ?? 0;
  const lifetimePoints = await computeLifetimePoints(appUserId);
  const tier = await syncMembershipTier(appUserId, lifetimePoints);
  const nextTier = getNextTierInfo(tier, lifetimePoints);

  const history = await PointTransaction.find({ user_id: appUserId })
    .sort({ created_at: -1 })
    .limit(50)
    .lean();

  const referrals = await Referral.find({ referrer_id: appUserId })
    .sort({ created_at: -1 })
    .limit(50)
    .lean();

  return {
    tier,
    availablePoints,
    lifetimePoints,
    pointsPerDollar: tierMultiplier(tier),
    referralCode,
    nextTier: nextTier.nextTier,
    pointsToNext: nextTier.pointsToNext,
    progressPercent: nextTier.progressPercent,
    redeemRewards: REDEEM_REWARDS.map((reward) => ({
      ...reward,
      canRedeem: availablePoints >= reward.pointsCost
    })),
    pointsHistory: history.map((txn) => ({
      id: txn.transaction_id,
      date: txn.created_at,
      activity: formatActivityLabel(txn),
      points: txn.amount,
      status: formatStatusLabel(txn.status)
    })),
    referralActivity: referrals.map((row) => ({
      id: row.referral_id,
      friend: row.referee_display || 'Friend',
      status: formatReferralStatus(row),
      points:
        (row.register_reward_status === 'posted' ? row.register_points : 0) +
        (row.order_reward_status === 'posted' ? row.order_points : 0)
    })),
    welcomeVoucherCode: profile.welcome_voucher_code || null
  };
}

function formatReferralStatus(row) {
  if (row.order_reward_status === 'posted') return 'First order rewarded';
  if (row.order_reward_status === 'awaiting_post') return 'First order · points pending';
  if (row.order_reward_status === 'ineligible') return 'Ineligible';
  if (row.register_reward_status === 'posted') return 'Signed up';
  if (row.register_reward_status === 'skipped') return 'Signed up · no bonus';
  return 'Pending';
}

async function redeemReward(jwtUserId, rewardId) {
  const appUserId = await resolveAppUserId(jwtUserId);
  if (!appUserId) return { ok: false, error: 'User not found.' };

  const reward = REDEEM_REWARDS.find((entry) => entry.id === rewardId);
  if (!reward) return { ok: false, error: 'Reward not found.' };

  const user = await User.findOne({ user_id: appUserId }, { points: 1, user_id: 1 }).lean();
  if (!user) return { ok: false, error: 'User not found.' };

  const balance = user.points ?? 0;
  if (balance < reward.pointsCost) {
    return { ok: false, error: 'Not enough points for this reward.' };
  }

  const code = `RW${Date.now().toString(36).toUpperCase()}${randomReferralSuffix().slice(0, 4)}`;
  const now = new Date();
  const validFrom = now.toISOString().slice(0, 10);
  const validTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await Voucher.create({
    code,
    voucher_type: reward.voucherType,
    discount_type: reward.discountType,
    discount_value: reward.discountValue,
    is_active: true,
    usage_limit: 1,
    used_count: 0,
    min_order_amount: reward.minOrderAmount,
    max_discount_value: reward.voucherType === 'shipping' ? null : reward.discountValue,
    valid_from: validFrom,
    valid_to: validTo,
    createdAt: now.toISOString()
  });

  await User.updateOne({ user_id: appUserId }, { $inc: { points: -reward.pointsCost } });

  const { getCollections } = require('../config/db');
  const { userCollection } = await getCollections();
  await userCollection.updateOne({ user_id: appUserId }, { $inc: { points: -reward.pointsCost } });

  await PointTransaction.create({
    user_id: appUserId,
    type: 'redeem_voucher',
    amount: -reward.pointsCost,
    status: 'used',
    ref_type: 'voucher',
    ref_id: code,
    posted_at: now
  });

  return {
    ok: true,
    voucherCode: code,
    message: `Redeemed successfully. Your voucher code is ${code}.`,
    availablePoints: balance - reward.pointsCost
  };
}

async function validateReferralCode(code) {
  if (!code || !REFERRAL_CODE_REGEX.test(String(code).trim().toUpperCase())) {
    return { ok: false, code: 'REFERRAL_INVALID_FORMAT', error: 'Invalid format. Expected: NAME_8CHARS (e.g. JOHN_AB12CD34)' };
  }

  const normalized = String(code).trim().toUpperCase();
  const referrer = await User.findOne({ referral_code: normalized }, { user_id: 1, profile_name: 1 }).lean();
  if (!referrer) {
    return { ok: false, code: 'REFERRAL_NOT_FOUND', error: 'Referral code not found. Please enter a valid code, or clear this field to continue.' };
  }

  return { ok: true, referrerId: referrer.user_id };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function phonesMatch(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function yearStart(date = new Date()) {
  return new Date(date.getFullYear(), 0, 1);
}

async function countReferralsThisYear(referrerId) {
  return Referral.countDocuments({
    referrer_id: referrerId,
    created_at: { $gte: yearStart() }
  });
}

async function creditPostedPoints(userId, amount) {
  if (!amount) return;
  await User.updateOne({ user_id: userId }, { $inc: { points: amount } });
  const { getCollections } = require('../config/db');
  const { userCollection } = await getCollections();
  await userCollection.updateOne({ user_id: userId }, { $inc: { points: amount } });
}

async function ensurePersonalWelcomeVoucher(refereeUserId) {
  const user = await User.findOne({ user_id: refereeUserId }, { welcome_voucher_code: 1 }).lean();
  if (user?.welcome_voucher_code) return user.welcome_voucher_code;

  const code = `WELCOME5_${refereeUserId.replace(/^USR/i, '')}`;
  const now = new Date();
  const validFrom = now.toISOString().slice(0, 10);
  const validTo = new Date(now.getTime() + 180 * DAY_MS).toISOString().slice(0, 10);

  await Voucher.findOneAndUpdate(
    { code },
    {
      code,
      voucher_type: 'discount',
      discount_type: 'fixed',
      discount_value: 5,
      is_active: true,
      usage_limit: 1,
      used_count: 0,
      min_order_amount: 0,
      max_discount_value: 5,
      valid_from: validFrom,
      valid_to: validTo,
      createdAt: now.toISOString()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await User.updateOne({ user_id: refereeUserId }, { $set: { welcome_voucher_code: code } });
  const { getCollections } = require('../config/db');
  const { userCollection } = await getCollections();
  await userCollection.updateOne({ user_id: refereeUserId }, { $set: { welcome_voucher_code: code } });

  return code;
}

async function isFirstDeliveredOrder(userId, orderId) {
  const count = await Order.countDocuments({
    user_id: userId,
    order_status: 'delivered'
  });
  return count === 1;
}

async function handleOrderDelivered(order) {
  if (!order || order.is_guest || !order.user_id) return null;

  const referral = await Referral.findOne({
    referee_id: order.user_id,
    order_reward_status: { $in: ['pending', 'awaiting_post'] }
  });

  if (!referral) return null;

  const firstOrder = await isFirstDeliveredOrder(order.user_id, order.order_id);
  if (!firstOrder) {
    if (referral.order_reward_status === 'pending') {
      referral.order_reward_status = 'ineligible';
      referral.ineligible_reason = 'not_first_order';
      await referral.save();
    }
    return null;
  }

  const [referrer, referee] = await Promise.all([
    User.findOne({ user_id: referral.referrer_id }, { phone: 1, user_id: 1 }).lean(),
    User.findOne({ user_id: order.user_id }, { phone: 1, user_id: 1 }).lean()
  ]);

  const deliveryPhone = order.delivery_info?.mobile;
  if (phonesMatch(referrer?.phone, deliveryPhone) || phonesMatch(referrer?.phone, referee?.phone)) {
    referral.order_reward_status = 'ineligible';
    referral.ineligible_reason = 'phone_match';
    referral.first_order_id = order.order_id;
    await referral.save();
    return null;
  }

  const welcomeCode = await ensurePersonalWelcomeVoucher(order.user_id);
  referral.welcome_voucher_code = welcomeCode;
  referral.first_order_id = order.order_id;
  referral.order_reward_status = 'awaiting_post';
  referral.order_reward_due_at = new Date(Date.now() + HOLD_DAYS * DAY_MS);
  await referral.save();

  const existingTxn = await PointTransaction.findOne({
    type: 'referral_order',
    ref_type: 'order',
    ref_id: order.order_id
  }).lean();

  if (!existingTxn) {
    await PointTransaction.create({
      user_id: referral.referrer_id,
      type: 'referral_order',
      amount: referral.order_points || 20,
      status: 'pending',
      ref_type: 'order',
      ref_id: order.order_id
    });
  }

  return referral;
}

async function finalizeReferralOrderRewards(now = new Date()) {
  const referrals = await Referral.find({
    order_reward_status: 'awaiting_post',
    order_reward_due_at: { $lte: now }
  });

  for (const referral of referrals) {
    const txn = await PointTransaction.findOne({
      user_id: referral.referrer_id,
      type: 'referral_order',
      ref_type: 'order',
      ref_id: referral.first_order_id
    });

    if (!txn) {
      referral.order_reward_status = 'posted';
      await referral.save();
      continue;
    }

    if (txn.status === 'posted') {
      referral.order_reward_status = 'posted';
      await referral.save();
    }
  }
}

async function communityPointsEarnedToday(userId, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rows = await PointTransaction.aggregate([
    {
      $match: {
        user_id: userId,
        type: { $in: ['post_approved', 'recipe_approved', 'recipe_curated'] },
        status: { $in: ['pending', 'posted'] },
        created_at: { $gte: start }
      }
    },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  return rows[0]?.total || 0;
}

async function scheduleCommunityPointsForPost(userId, post) {
  if (!userId || !post?.post_id) return null;

  const earnedToday = await communityPointsEarnedToday(userId);
  if (earnedToday >= COMMUNITY_DAILY_CAP) return null;

  const isRecipePost = Boolean(post.recipe_id) || post.post_type === 'recipe';
  const type = isRecipePost ? 'recipe_approved' : 'post_approved';
  const amount = isRecipePost ? 10 : 2;

  if (earnedToday + amount > COMMUNITY_DAILY_CAP) return null;

  const existing = await PointTransaction.findOne({
    user_id: userId,
    type,
    ref_type: 'post',
    ref_id: post.post_id
  }).lean();
  if (existing) return existing;

  return PointTransaction.create({
    user_id: userId,
    type,
    amount,
    status: 'pending',
    ref_type: 'post',
    ref_id: post.post_id
  });
}

async function scheduleRecipeCuratedPoints(userId, recipeId) {
  if (!userId || !recipeId) return null;

  const earnedToday = await communityPointsEarnedToday(userId);
  if (earnedToday >= COMMUNITY_DAILY_CAP) return null;
  if (earnedToday + 15 > COMMUNITY_DAILY_CAP) return null;

  const existing = await PointTransaction.findOne({
    user_id: userId,
    type: 'recipe_curated',
    ref_type: 'recipe',
    ref_id: recipeId
  }).lean();
  if (existing) return existing;

  return PointTransaction.create({
    user_id: userId,
    type: 'recipe_curated',
    amount: 15,
    status: 'pending',
    ref_type: 'recipe',
    ref_id: recipeId
  });
}

async function awardRitualDnaQuizPoints(jwtUserId) {
  const appUserId = await resolveAppUserId(jwtUserId);
  if (!appUserId) return { ok: false, error: 'User not found.' };

  const user = await User.findOne({ user_id: appUserId }, { ritual_dna_quiz_completed: 1 }).lean();
  if (user?.ritual_dna_quiz_completed) {
    return { ok: false, error: 'Quiz reward already claimed.' };
  }

  const existing = await PointTransaction.findOne({
    user_id: appUserId,
    type: 'quiz',
    ref_type: 'quiz',
    ref_id: 'ritual_dna'
  }).lean();
  if (existing) {
    return { ok: false, error: 'Quiz reward already claimed.' };
  }

  await PointTransaction.create({
    user_id: appUserId,
    type: 'quiz',
    amount: 15,
    status: 'posted',
    ref_type: 'quiz',
    ref_id: 'ritual_dna',
    posted_at: new Date()
  });

  await creditPostedPoints(appUserId, 15);
  await User.updateOne({ user_id: appUserId }, { $set: { ritual_dna_quiz_completed: true } });

  const { getCollections } = require('../config/db');
  const { userCollection } = await getCollections();
  await userCollection.updateOne(
    { user_id: appUserId },
    { $set: { ritual_dna_quiz_completed: true } }
  );

  const lifetime = await computeLifetimePoints(appUserId);
  await syncMembershipTier(appUserId, lifetime);

  return { ok: true, points: 15 };
}

async function handleReferralRegistration(referee, referralCode) {
  if (!referralCode || !referee?.user_id) return null;

  const validation = await validateReferralCode(referralCode);
  if (!validation.ok || validation.referrerId === referee.user_id) return null;

  const existing = await Referral.findOne({ referee_id: referee.user_id }).lean();
  if (existing) return existing;

  const yearlyCount = await countReferralsThisYear(validation.referrerId);
  if (yearlyCount >= REFERRALS_PER_YEAR_LIMIT) {
    return Referral.create({
      referrer_id: validation.referrerId,
      referee_id: referee.user_id,
      referral_code: String(referralCode).trim().toUpperCase(),
      referee_display: referee.profile_name || 'Friend',
      register_reward_status: 'skipped',
      order_reward_status: 'ineligible',
      ineligible_reason: 'yearly_limit',
      register_points: 0,
      order_points: 0
    });
  }

  const referral = await Referral.create({
    referrer_id: validation.referrerId,
    referee_id: referee.user_id,
    referral_code: String(referralCode).trim().toUpperCase(),
    referee_display: referee.profile_name || 'Friend',
    register_reward_status: 'posted',
    order_reward_status: 'pending'
  });

  const txn = await PointTransaction.create({
    user_id: validation.referrerId,
    type: 'referral_register',
    amount: 20,
    status: 'posted',
    ref_type: 'referral',
    ref_id: referral.referral_id,
    posted_at: new Date()
  });

  await User.updateOne({ user_id: validation.referrerId }, { $inc: { points: 20 } });

  const { getCollections } = require('../config/db');
  const { userCollection } = await getCollections();
  await userCollection.updateOne({ user_id: validation.referrerId }, { $inc: { points: 20 } });

  const lifetime = await computeLifetimePoints(validation.referrerId);
  await syncMembershipTier(validation.referrerId, lifetime);

  return { referral, txn };
}

module.exports = {
  TIER_THRESHOLDS,
  TIER_MULTIPLIER,
  REDEEM_REWARDS,
  REFERRAL_CODE_REGEX,
  REFERRALS_PER_YEAR_LIMIT,
  resolveAppUserId,
  getDashboard,
  redeemReward,
  validateReferralCode,
  handleReferralRegistration,
  handleOrderDelivered,
  finalizeReferralOrderRewards,
  scheduleCommunityPointsForPost,
  scheduleRecipeCuratedPoints,
  awardRitualDnaQuizPoints,
  computeLifetimePoints,
  syncMembershipTier
};
