const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const PointTransaction = require('../models/PointTransaction');
const Referral = require('../models/Referral');
const Voucher = require('../models/Voucher');
const Order = require('../models/Order');
const { tierMultiplier, TIER_MULTIPLIER, HOLD_DAYS, adjustBalance } = require('./points.service');
const voucherService = require('./voucher.service');

const REFERRALS_PER_YEAR_LIMIT = 10;
const COMMUNITY_DAILY_CAP = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIER_THRESHOLDS = [
  { tier: 'Seed', minLifetime: 0 },
  { tier: 'Leaf', minLifetime: 150 },
  { tier: 'Bloom', minLifetime: 400 },
  { tier: 'Zen', minLifetime: 1000 }
];

// Redeem offers come from Vouchers with points_cost > 0 (created in Admin › Vouchers).
const REFERRAL_CODE_REGEX = /^[A-Z0-9]+_[A-Z0-9]{8}$/;

const TIER_RANK = { Seed: 0, Leaf: 1, Bloom: 2, Zen: 3 };

const TIER_PERK_VOUCHERS = [
  {
    tier: 'Leaf',
    title: '$5 off · Leaf perk',
    subtitle: 'Orders from $40',
    voucherType: 'discount',
    discountType: 'fixed',
    discountValue: 5,
    minOrderAmount: 40,
    codePrefix: 'LEAF5'
  },
  {
    tier: 'Bloom',
    title: 'Free shipping · Bloom perk',
    subtitle: 'Any order',
    voucherType: 'shipping',
    discountType: 'fixed',
    discountValue: 999,
    minOrderAmount: 0,
    codePrefix: 'BLOOMFS'
  },
  {
    tier: 'Zen',
    title: '$10 off · Zen perk',
    subtitle: 'Orders from $60',
    voucherType: 'discount',
    discountType: 'fixed',
    discountValue: 10,
    minOrderAmount: 60,
    codePrefix: 'ZEN10'
  }
];

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
        // Only settled earnings count toward tier qualification.
        status: 'posted',
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
  const lowerTiers = Object.keys(TIER_RANK).filter(name => TIER_RANK[name] < TIER_RANK[tier]);
  const before = await User.findOneAndUpdate({ user_id: userId, membership_tier: { $in: [...lowerTiers, null] } },
    { $set: { membership_tier: tier } }, { new: false }).lean();
  if (before && (TIER_RANK[tier] || 0) > (TIER_RANK[before.membership_tier] || 0)) {
    await require('./notification.service').notifyEvent({ recipient_id: userId, type: 'MEMBERSHIP_CHANGED',
      event_key: `membership:${tier}`, target_type: 'rewards', message: `You reached ${tier} membership. Explore your new benefits.` });
  }
  if (before) return tier;
  const current = await User.findOne({ user_id: userId }, 'membership_tier').lean();
  return current?.membership_tier || tier;
}

function tierVoucherCode(prefix, userId) {
  return `${prefix}_${String(userId).replace(/^USR/i, '')}`;
}

async function ensureTierPerkVouchers(userId, tier) {
  const rank = TIER_RANK[tier] ?? 0;
  const now = new Date();
  const validFrom = now.toISOString().slice(0, 10);
  const validTo = new Date(now.getTime() + 365 * DAY_MS).toISOString().slice(0, 10);

  for (const def of TIER_PERK_VOUCHERS) {
    if ((TIER_RANK[def.tier] ?? 0) > rank) continue;
    const code = tierVoucherCode(def.codePrefix, userId);
    // Repeat runs must not reset uses or extend the expiry. Those fields are written once.
    await Voucher.findOneAndUpdate(
      { code },
      {
        $set: {
          purpose: 'loyalty_redeem',
          assigned_user_id: userId
        },
        $setOnInsert: {
          code,
          title: def.title,
          subtitle: def.subtitle,
          voucher_type: def.voucherType,
          discount_type: def.discountType,
          discount_value: def.discountValue,
          is_active: true,
          usage_limit: 1,
          used_count: 0,
          min_order_amount: def.minOrderAmount,
          max_discount_value: def.voucherType === 'shipping' ? null : def.discountValue,
          valid_from: validFrom,
          valid_to: validTo,
          createdAt: now.toISOString(),
          usage_limit_per_user: 1,
          target_tier: null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

const CATEGORY_LABELS = { matcha: 'Matcha', coffee: 'Coffee', tools: 'Tools', drinkware: 'Drinkware', sets_bundles: 'Sets & bundles' };
const MY_VOUCHER_LIMIT = 30;

function money(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? `$${number}` : `$${number.toFixed(2)}`;
}

// Card title and subtitle built from the voucher terms, so new vouchers need no copywriting.
function offerTitle(voucher) {
  if (voucher.voucher_type === 'shipping') {
    const full = voucher.discount_type === 'percentage' ? Number(voucher.discount_value) >= 100 : Number(voucher.discount_value) >= 15;
    return full ? 'Free shipping' : `${voucher.discount_type === 'percentage' ? `${voucher.discount_value}%` : money(voucher.discount_value)} off shipping`;
  }
  return voucher.discount_type === 'percentage' ? `${voucher.discount_value}% off` : `${money(voucher.discount_value)} off`;
}

function offerSubtitle(voucher) {
  const parts = [];
  const scope = voucher.applies_to || 'all';
  if (scope === 'category' && voucher.applicable_categories?.length) {
    parts.push(`${voucher.applicable_categories.map((value) => CATEGORY_LABELS[value] || value).join(', ')} only`);
  } else if (scope === 'product') {
    parts.push('Selected products');
  }
  parts.push(Number(voucher.min_order_amount) > 0 ? `Orders from ${money(voucher.min_order_amount)}` : 'Any order');
  if (voucher.voucher_type === 'discount' && voucher.discount_type === 'percentage' && voucher.max_discount_value) {
    parts.push(`up to ${money(voucher.max_discount_value)}`);
  }
  return parts.join(' · ');
}

function tierAllows(voucher, tier) {
  return !voucher.target_tier || voucher.target_tier === String(tier || '').toLowerCase();
}

function todayKey() {
  return voucherService.businessToday();
}

function inWindow(voucher, today) {
  const from = voucherService.dateKey(voucher.valid_from);
  const to = voucherService.dateKey(voucher.valid_to);
  return !(from && today < from) && !(to && today > to);
}

function hasUsesLeft(voucher) {
  return voucher.usage_limit == null || (voucher.used_count || 0) < voucher.usage_limit;
}

const REDEEMABLE_FILTER = {
  is_active: true,
  points_cost: { $gt: 0 },
  purpose: { $in: ['campaign', 'loyalty_redeem'] },
  $or: [{ assigned_user_id: null }, { assigned_user_id: '' }, { assigned_user_id: { $exists: false } }]
};

async function redeemedCounts(userId, templateIds) {
  if (!templateIds.length) return new Map();
  const rows = await Voucher.aggregate([
    { $match: { assigned_user_id: userId, source_voucher_id: { $in: templateIds } } },
    { $group: { _id: '$source_voucher_id', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map((row) => [row._id, row.count]));
}

// Point vouchers this customer's tier can redeem now, cheapest first.
async function listRedeemOffers(userId, tier, balance) {
  const today = todayKey();
  const templates = (await Voucher.find(REDEEMABLE_FILTER).sort({ points_cost: 1, createdAt: -1 }).lean())
    .filter((voucher) => tierAllows(voucher, tier) && inWindow(voucher, today) && hasUsesLeft(voucher));
  const counts = await redeemedCounts(userId, templates.map((voucher) => String(voucher._id)));
  return templates.map((voucher) => {
    const perUser = voucherService.perUserLimit(voucher);
    const redeemed = counts.get(String(voucher._id)) || 0;
    const limitReached = perUser != null && redeemed >= perUser;
    const short = Math.max(0, voucher.points_cost - balance);
    return {
      id: String(voucher._id),
      title: offerTitle(voucher),
      subtitle: offerSubtitle(voucher),
      pointsCost: voucher.points_cost,
      tier: voucher.target_tier || null,
      validTo: voucherService.dateKey(voucher.valid_to),
      canRedeem: !limitReached && short === 0,
      reason: limitReached ? 'Already redeemed' : short > 0 ? `${short.toLocaleString('en-US')} more pts` : null
    };
  });
}

function sourceLabel(voucher) {
  if (voucher.source_voucher_id) return 'Redeemed';
  if (voucher.purpose === 'complaint') return 'From support';
  if (voucher.purpose === 'referral') return 'Welcome';
  if (voucher.assigned_user_id) return 'Tier perk';
  return voucher.target_tier ? 'Member offer' : 'Open to all';
}

function myVoucherRow(voucher) {
  return {
    code: voucher.code,
    title: offerTitle(voucher),
    subtitle: offerSubtitle(voucher),
    source: sourceLabel(voucher),
    personal: !!voucher.assigned_user_id,
    voucherType: voucher.voucher_type,
    validTo: voucherService.dateKey(voucher.valid_to)
  };
}

// My vouchers: personal codes (redeemed with points, tier perks, support, welcome) plus open codes
// that need no points and that this customer can still use.
async function listMyVouchers(userId, tier) {
  await ensureTierPerkVouchers(userId, tier);
  const today = todayKey();
  const [personal, open] = await Promise.all([
    Voucher.find({ assigned_user_id: userId, is_active: true }).sort({ createdAt: -1 }).lean(),
    Voucher.find({
      is_active: true,
      purpose: { $in: ['campaign', 'loyalty_redeem', 'referral'] },
      $and: [
        { $or: [{ assigned_user_id: null }, { assigned_user_id: '' }, { assigned_user_id: { $exists: false } }] },
        { $or: [{ points_cost: null }, { points_cost: { $lte: 0 } }, { points_cost: { $exists: false } }] }
      ]
    }).sort({ createdAt: -1 }).lean()
  ]);

  const usable = [
    ...personal.filter((voucher) => inWindow(voucher, today) && hasUsesLeft(voucher)),
    ...open.filter((voucher) => inWindow(voucher, today) && hasUsesLeft(voucher) && tierAllows(voucher, tier))
  ];
  if (!usable.length) return [];

  // Drop codes this customer already used up (per-account cap), counted from their orders.
  const codes = usable.map((voucher) => voucher.code);
  const usedRows = await Order.aggregate([
    { $match: { user_id: userId, order_status: { $ne: 'canceled' }, 'coupon.code': { $in: codes } } },
    { $group: { _id: '$coupon.code', count: { $sum: 1 } } }
  ]);
  const used = new Map(usedRows.map((row) => [row._id, row.count]));
  return usable
    .filter((voucher) => {
      const cap = voucherService.perUserLimit(voucher);
      return cap == null || (used.get(voucher.code) || 0) < cap;
    })
    .slice(0, MY_VOUCHER_LIMIT)
    .map(myVoucherRow);
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

  await retryPendingReferralRegistrations(appUserId);
  await require('./points.service').reconcilePurchasePoints(appUserId);

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

  const [redeemRewards, myVouchers] = await Promise.all([
    listRedeemOffers(appUserId, tier, availablePoints),
    listMyVouchers(appUserId, tier)
  ]);

  return {
    tier,
    availablePoints,
    lifetimePoints,
    pointsPerDollar: tierMultiplier(tier),
    referralCode,
    nextTier: nextTier.nextTier,
    pointsToNext: nextTier.pointsToNext,
    progressPercent: nextTier.progressPercent,
    redeemRewards,
    pointsHistory: history.map((txn) => ({
      id: txn.transaction_id,
      date: txn.created_at,
      activity: formatActivityLabel(txn),
      points: txn.amount,
      status: formatStatusLabel(txn.status)
    })),
    referralActivity: require('./referral-activity').referralActivityRows(referrals),
    welcomeVoucherCode: profile.welcome_voucher_code || null,
    myVouchers
  };
}

function personalCode(templateCode) {
  const base = String(templateCode).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
  return `${base}-${randomReferralSuffix().slice(0, 5)}`;
}

// rewardId is the template voucher's _id. Spends the points and issues a personal one-use copy
// with the same terms and scope, valid until the template ends.
async function redeemReward(jwtUserId, rewardId) {
  const appUserId = await resolveAppUserId(jwtUserId);
  if (!appUserId) return { ok: false, error: 'User not found.' };
  if (!mongoose.Types.ObjectId.isValid(String(rewardId))) return { ok: false, error: 'Reward not found.' };

  const template = await Voucher.findOne({ _id: rewardId, ...REDEEMABLE_FILTER }).lean();
  if (!template) return { ok: false, error: 'This reward is no longer available.' };

  const user = await User.findOne({ user_id: appUserId }, { points: 1, user_id: 1, membership_tier: 1 }).lean();
  if (!user) return { ok: false, error: 'User not found.' };
  if (!tierAllows(template, user.membership_tier)) return { ok: false, error: 'This reward is for another member tier.' };
  if (!inWindow(template, todayKey())) return { ok: false, error: 'This reward is not active right now.' };

  const perUser = voucherService.perUserLimit(template);
  if (perUser != null) {
    const redeemed = await Voucher.countDocuments({ assigned_user_id: appUserId, source_voucher_id: String(template._id) });
    if (redeemed >= perUser) return { ok: false, error: 'You have already redeemed this reward.' };
  }

  const cost = template.points_cost;
  // Spend the points only if the balance still covers them (two quick clicks cannot overspend).
  const spent = await User.updateOne({ user_id: appUserId, points: { $gte: cost } }, { $inc: { points: -cost } });
  if (!spent.modifiedCount) return { ok: false, error: 'Not enough points for this reward.' };

  // Take one redemption from the template's total limit.
  const taken = await Voucher.updateOne(
    { _id: template._id, $or: [{ usage_limit: null }, { $expr: { $lt: ['$used_count', '$usage_limit'] } }] },
    { $inc: { used_count: 1 } }
  );
  if (!taken.modifiedCount) {
    await adjustBalance(appUserId, cost);
    return { ok: false, error: 'This reward has run out.' };
  }

  const now = new Date();
  let code = personalCode(template.code);
  while (await Voucher.exists({ code })) code = personalCode(template.code);
  const scope = voucherService.scopeSnapshot(template);
  await Voucher.create({
    code,
    title: offerTitle(template),
    subtitle: offerSubtitle(template),
    voucher_type: template.voucher_type,
    discount_type: template.discount_type,
    discount_value: template.discount_value,
    is_active: true,
    usage_limit: 1,
    used_count: 0,
    min_order_amount: template.min_order_amount || 0,
    max_discount_value: template.max_discount_value ?? null,
    valid_from: todayKey(),
    valid_to: voucherService.dateKey(template.valid_to),
    createdAt: now.toISOString(),
    created_by: null,
    purpose: template.purpose,
    assigned_user_id: appUserId,
    usage_limit_per_user: 1,
    target_tier: null,
    applies_to: scope.applies_to,
    applicable_categories: scope.applicable_categories,
    applicable_product_ids: scope.applicable_product_ids,
    points_cost: null,
    source_voucher_id: String(template._id)
  });

  await PointTransaction.create({
    user_id: appUserId,
    type: 'redeem_voucher',
    amount: -cost,
    status: 'used',
    ref_type: 'voucher',
    ref_id: code,
    posted_at: now
  });

  return {
    ok: true,
    voucherCode: code,
    message: `Redeemed. ${code} is in My vouchers.`,
    availablePoints: (user.points ?? 0) - cost
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
  await adjustBalance(userId, amount);
}

async function ensurePersonalWelcomeVoucher(refereeUserId) {
  return require('./referral-registration.service').ensureWelcomeVoucher(refereeUserId);
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

  const firstOrder = referral.first_order_id
    ? referral.first_order_id === order.order_id
    : await isFirstDeliveredOrder(order.user_id, order.order_id);
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
  const deliveredAt = order.delivered_at
    || [...(order.status_history || [])].reverse().find(item => item.status === 'delivered')?.changed_at
    || new Date();
  // Retrying a missing transaction must not restart the holding period.
  referral.order_reward_due_at = referral.order_reward_due_at
    || new Date(new Date(deliveredAt).getTime() + HOLD_DAYS * DAY_MS);
  await referral.save();

  const existingTxn = await PointTransaction.findOne({
    type: 'referral_order',
    ref_type: 'order',
    ref_id: order.order_id
  }).lean();

  if (!existingTxn) {
    try {
      await PointTransaction.create({
        transaction_id: `PTXREFORDER_${order.order_id}`,
        user_id: referral.referrer_id,
        type: 'referral_order',
        amount: referral.order_points || 20,
        status: 'pending',
        ref_type: 'order',
        ref_id: order.order_id,
        created_at: deliveredAt
      });
    } catch (error) {
      if (error.code !== 11000 || !await PointTransaction.findOne({
        type: 'referral_order', ref_type: 'order', ref_id: order.order_id
      })) throw error;
    }
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
      // Never report a reward as posted when its point transaction was not created.
      const order = await Order.findOne({ order_id: referral.first_order_id }).lean();
      if (order?.order_status === 'delivered') await handleOrderDelivered(order);
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
  const remaining = COMMUNITY_DAILY_CAP - earnedToday;
  if (remaining <= 0) return null;

  const isRecipePost = Boolean(post.recipe_id) || post.post_type === 'recipe';
  const type = isRecipePost ? 'recipe_approved' : 'post_approved';
  const baseAmount = isRecipePost ? 10 : 2;
  const amount = Math.min(baseAmount, remaining);
  if (amount <= 0) return null;

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
  const remaining = COMMUNITY_DAILY_CAP - earnedToday;
  if (remaining <= 0) return null;
  const amount = Math.min(15, remaining);
  if (amount <= 0) return null;

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
    amount,
    status: 'pending',
    ref_type: 'recipe',
    ref_id: recipeId
  });
}

async function awardRitualDnaQuizPoints(jwtUserId) {
  const appUserId = await resolveAppUserId(jwtUserId);
  if (!appUserId) return { ok: false, error: 'User not found.' };

  const user = await User.findOne({ user_id: appUserId }, { ritual_dna_quiz_completed: 1, ritual_dna: 1 }).lean();
  if (!user?.ritual_dna?.quiz_taken_at) {
    return { ok: false, error: 'Complete the Ritual DNA quiz first.' };
  }
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
  const referral = await require('./referral-registration.service').completeRegistration(
    referee.user_id, validation.referrerId,
    String(referralCode).trim().toUpperCase(), REFERRALS_PER_YEAR_LIMIT
  );
  if (referral?.register_reward_status === 'posted') {
    await syncMembershipTier(validation.referrerId, await computeLifetimePoints(validation.referrerId));
  }
  return referral;
}

// Recover only referrals explicitly saved during registration, never arbitrary account codes.
async function retryPendingReferralRegistrations(appUserId) {
  const owner = await User.findOne({ user_id: appUserId }, { referral_code: 1 }).lean();
  const filters = [{ user_id: appUserId }];
  if (owner?.referral_code) filters.push({ referred_by: owner.referral_code });
  const pending = await User.find({
    referral_registration_pending: true, $or: filters
  }).limit(25).lean();
  for (const referee of pending) {
    try {
      await handleReferralRegistration(referee, referee.referred_by);
    } catch (error) {
      console.error('Pending referral reward retry failed:', error);
    }
  }
}

module.exports = {
  computeLifetimePoints,
  syncMembershipTier,
  TIER_THRESHOLDS,
  TIER_MULTIPLIER,
  listRedeemOffers,
  listMyVouchers,
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
