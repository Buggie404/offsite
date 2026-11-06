const Voucher = require('../models/Voucher');
const Order = require('../models/Order');

const BUSINESS_TZ = 'Asia/Ho_Chi_Minh';
const TIERS = ['seed', 'leaf', 'bloom', 'zen'];
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;

function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

// Calendar day in Vietnam. A bare YYYY-MM-DD is already that day; a full ISO instant is converted.
function dateKey(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return businessToday(date);
}

function voucherStatus(voucher, today = businessToday()) {
  if (!voucher.is_active) return 'inactive';
  const from = dateKey(voucher.valid_from);
  const to = dateKey(voucher.valid_to);
  if (from && today < from) return 'upcoming';
  if (to && today > to) return 'expired';
  return 'active';
}

function perUserLimit(voucher) {
  // Missing on older rows means the default of one use per account. An explicit null is unlimited.
  if (voucher.usage_limit_per_user === undefined) return 1;
  return voucher.usage_limit_per_user;
}

async function countUserRedemptions(code, userId) {
  if (!userId) return 0;
  return Order.countDocuments({
    user_id: userId,
    order_status: { $ne: 'canceled' },
    'coupon.code': code
  });
}

/**
 * Validates a voucher code against validity dates, usage limits, minimum order amount, and shipping method.
 * userId / userTier enforce assigned vouchers, the tier gate, and the per-account cap.
 * Returns an object with { isValid, voucher, discountAmount, error }.
 */
async function validateAndCalculateVoucher({ code, subtotal = 0, shippingMethod = 'standard', userId = null, userTier = null }) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    return { isValid: false, voucher: null, discountAmount: 0, error: 'Mã giảm giá không hợp lệ.' };
  }

  const codeUpper = code.trim().toUpperCase();
  const voucher = await Voucher.findOne({ code: codeUpper, is_active: true });

  if (!voucher) {
    return { 
      isValid: false, 
      voucher: null, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" không tồn tại hoặc đã bị ngưng áp dụng.` 
    };
  }

  if (voucher.assigned_user_id && voucher.assigned_user_id !== userId) {
    return {
      isValid: false,
      voucher: null,
      discountAmount: 0,
      error: `Mã giảm giá "${codeUpper}" không tồn tại hoặc đã bị ngưng áp dụng.`
    };
  }

  const tier = String(userTier || '').toLowerCase();
  if (voucher.target_tier && voucher.target_tier !== tier) {
    return {
      isValid: false,
      voucher,
      discountAmount: 0,
      error: `Mã giảm giá "${codeUpper}" chỉ áp dụng cho hạng ${voucher.target_tier}.`
    };
  }

  const today = businessToday();
  const from = dateKey(voucher.valid_from);
  const to = dateKey(voucher.valid_to);
  if (from && today < from) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" chưa đến thời gian áp dụng.` 
    };
  }
  if (to && today > to) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" đã hết hạn.` 
    };
  }
  if (voucher.usage_limit != null && voucher.used_count >= voucher.usage_limit) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" đã hết lượt sử dụng.` 
    };
  }

  const accountLimit = perUserLimit(voucher);
  if (accountLimit != null && userId) {
    const redeemed = await countUserRedemptions(codeUpper, userId);
    if (redeemed >= accountLimit) {
      return {
        isValid: false,
        voucher,
        discountAmount: 0,
        error: `Mã giảm giá "${codeUpper}" đã hết lượt dùng cho tài khoản này.`
      };
    }
  }

  const numSubtotal = Number(subtotal) || 0;
  if (voucher.min_order_amount && numSubtotal < voucher.min_order_amount) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Đơn hàng chưa đạt giá trị tối thiểu ($${voucher.min_order_amount}) để áp dụng mã "${codeUpper}".` 
    };
  }

  const shippingCost = shippingMethod === 'express' ? 15 : 0;
  let discountAmount = 0;

  if (voucher.voucher_type === 'discount') {
    if (voucher.discount_type === 'percentage') {
      discountAmount = numSubtotal * (Math.min(voucher.discount_value, 100) / 100);
    } else if (voucher.discount_type === 'fixed') {
      discountAmount = voucher.discount_value;
    }
    discountAmount = Math.min(discountAmount, numSubtotal);
  } else if (voucher.voucher_type === 'shipping') {
    if (shippingMethod !== 'express') {
      return { 
        isValid: false, 
        voucher, 
        discountAmount: 0, 
        error: `Mã giảm giá vận chuyển "${codeUpper}" chỉ áp dụng cho phương thức Giao hàng Hỏa tốc.` 
      };
    }
    if (voucher.discount_type === 'percentage') {
      discountAmount = shippingCost * (Math.min(voucher.discount_value, 100) / 100);
    } else if (voucher.discount_type === 'fixed') {
      discountAmount = Math.min(voucher.discount_value, shippingCost);
    }
  }

  if (voucher.max_discount_value != null && discountAmount > voucher.max_discount_value) {
    discountAmount = voucher.max_discount_value;
  }
  discountAmount = Math.round(discountAmount * 100) / 100;

  return {
    isValid: true,
    voucher,
    discountAmount,
    error: null
  };
}

/**
 * Atomically increments the used_count of a voucher by 1.
 * Supports passing a Mongoose session for transaction safety.
 */
async function incrementVoucherUsage(voucherId, session = null) {
  const options = session ? { session } : {};
  const updateResult = await Voucher.updateOne(
    {
      _id: voucherId,
      is_active: true,
      $or: [
        { usage_limit: null },
        { $expr: { $lt: ['$used_count', '$usage_limit'] } }
      ]
    },
    { $inc: { used_count: 1 } },
    options
  );

  return updateResult.modifiedCount > 0;
}

/**
 * Gives back one use of a voucher (order canceled or discarded), so a one-use code isn't lost
 * on an order that never went through. Never goes below 0. Returns true when a use was returned.
 */
async function releaseVoucherUsage(code, session = null) {
  const codeUpper = String(code || '').trim().toUpperCase();
  if (!codeUpper) return false;
  const updateResult = await Voucher.updateOne(
    { code: codeUpper, used_count: { $gt: 0 } },
    { $inc: { used_count: -1 } },
    session ? { session } : {}
  );
  return updateResult.modifiedCount > 0;
}

function parseAmount(value, { allowEmpty = false } = {}) {
  if (value === '' || value == null) return allowEmpty ? null : NaN;
  const number = Number(String(value).replace(/[$,\s]/g, ''));
  return number;
}

function fail(field, error) {
  return { ok: false, field, error };
}

/**
 * Rules for vouchers created or edited in Admin.
 * Dates are Vietnam calendar days stored as YYYY-MM-DD.
 * Amounts are USD.
 */
function validateVoucherPayload(input, { usedCount = 0, existing = null } = {}) {
  const locked = usedCount > 0;
  const source = input || {};

  const code = String(source.code || '').trim().toUpperCase();
  const voucherType = source.voucher_type;
  const discountType = source.discount_type;
  const value = parseAmount(source.discount_value);
  const minOrder = source.min_order_amount === '' || source.min_order_amount == null
    ? 0
    : parseAmount(source.min_order_amount);
  const maxRaw = source.max_discount_value;
  const maxDiscount = maxRaw === '' || maxRaw == null ? null : parseAmount(maxRaw);
  const from = dateKey(source.valid_from);
  const to = dateKey(source.valid_to);
  const usageRaw = source.usage_limit;
  const usageLimit = usageRaw === '' || usageRaw == null ? null : parseAmount(usageRaw);
  const tierRaw = source.target_tier == null || source.target_tier === '' || source.target_tier === 'all'
    ? null
    : String(source.target_tier).toLowerCase();

  if (!from) return fail('valid_from', 'Choose a start date.');
  if (!to) return fail('valid_to', 'Choose an end date.');
  if (to <= from) return fail('valid_to', 'End date must be after start date.');
  if (usageLimit != null && (!Number.isInteger(usageLimit) || usageLimit <= 0)) {
    return fail('usage_limit', 'Usage limit must be a whole number greater than 0, or left empty for no limit.');
  }
  if (usageLimit != null && usageLimit < usedCount) {
    return fail('usage_limit', 'Usage limit cannot be lower than uses already recorded.');
  }

  // Once someone has used the code, past orders keep the saved discount.
  // Only the validity window and the usage limit can change.
  let terms = {
    code,
    voucher_type: voucherType,
    discount_type: discountType,
    discount_value: value,
    min_order_amount: minOrder,
    max_discount_value: maxDiscount,
    target_tier: tierRaw
  };
  if (locked && existing) {
    terms = {
      code: existing.code,
      voucher_type: existing.voucher_type,
      discount_type: existing.discount_type,
      discount_value: existing.discount_value,
      min_order_amount: existing.min_order_amount || 0,
      max_discount_value: existing.max_discount_value ?? null,
      target_tier: existing.target_tier || null
    };
  } else {
    if (!code) return fail('code', 'Code is required.');
    if (!CODE_PATTERN.test(code)) return fail('code', 'Use 2–30 letters, numbers, hyphens or underscores.');
    if (!['discount', 'shipping'].includes(voucherType)) return fail('voucher_type', 'Choose Discount or Shipping.');
    if (!['percentage', 'fixed'].includes(discountType)) return fail('discount_type', 'Choose Percentage or Fixed.');
    if (!Number.isFinite(value)) return fail('discount_value', 'Enter a discount value.');
    if (discountType === 'percentage') {
      if (value < 1) return fail('discount_value', 'Percentage must be at least 1.');
      if (value > 100) return fail('discount_value', 'Percentage cannot exceed 100.');
      if (value >= 30 && !(maxDiscount > 0)) {
        return fail('max_discount_value', 'Enter a maximum discount for percentages of 30% or more.');
      }
    } else if (value <= 0) {
      return fail('discount_value', 'Amount must be greater than 0.');
    }
    if (!Number.isFinite(minOrder) || minOrder < 0) return fail('min_order_amount', 'Minimum order cannot be negative.');
    if (discountType === 'fixed' && minOrder > 0 && value >= minOrder) {
      return fail('discount_value', 'Fixed amount must be less than the minimum order.');
    }
    if (maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0)) {
      return fail('max_discount_value', 'Maximum discount must be greater than 0.');
    }
    if (tierRaw && !TIERS.includes(tierRaw)) return fail('target_tier', 'Choose a customer tier.');
  }

  return {
    ok: true,
    value: {
      ...terms,
      valid_from: from,
      valid_to: to,
      usage_limit: usageLimit
    }
  };
}

function performanceWindow(voucher, today = businessToday()) {
  const from = dateKey(voucher.valid_from) || today;
  const to = dateKey(voucher.valid_to) || today;
  if (from > today) {
    const end = addDays(from, Math.min(29, Math.max(0, daysBetween(from, to))));
    return { start: from, end };
  }
  const end = to < today ? to : today;
  const start = from > addDays(end, -29) ? from : addDays(end, -29);
  return { start, end: end < start ? start : end };
}

function addDays(dateKeyValue, days) {
  const [year, month, day] = dateKeyValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

// Demo series for a voucher that has been used, when no matching orders fall in the window.
function samplePerformance(voucher) {
  const range = performanceWindow(voucher);
  const buckets = bucketUsage({}, range.start, range.end);
  const used = Math.max(0, Math.round(Number(voucher.used_count) || 0));
  const weights = buckets.map((_, index) => 3 + ((index * 5 + used) % 7));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let left = used;
  const filled = buckets.map((bucket, index) => {
    const count = index === buckets.length - 1
      ? left
      : Math.min(left, Math.round((used * weights[index]) / weightSum));
    left -= count;
    return { ...bucket, count };
  });
  const orderBase = Math.max(Number(voucher.min_order_amount) || 0, 42);
  let each = Number(voucher.discount_value) || 0;
  if (voucher.voucher_type === 'shipping') {
    each = Math.min(each || 15, 15);
  } else if (voucher.discount_type === 'percentage') {
    each = orderBase * each / 100;
    if (voucher.max_discount_value) each = Math.min(each, Number(voucher.max_discount_value));
  }
  const round = (amount) => Math.round((Number(amount) || 0) * 100) / 100;
  const totalDiscounted = round(each * used);
  return {
    code: voucher.code,
    used_count: used,
    usage_limit: voucher.usage_limit ?? null,
    times_used: used,
    total_discounted: totalDiscounted,
    revenue: round(Math.max(orderBase * used - totalDiscounted, 0)),
    range_from: range.start,
    range_to: range.end,
    buckets: filled
  };
}

function bucketUsage(dayCounts, start, end) {
  const span = Math.max(1, daysBetween(start, end) + 1);
  const bucketCount = Math.min(12, span);
  const size = span / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = addDays(start, Math.floor(index * size));
    const bucketEnd = addDays(start, Math.floor((index + 1) * size) - 1);
    return { start: bucketStart, end: index === bucketCount - 1 ? end : bucketEnd, count: 0 };
  });
  for (const [day, count] of Object.entries(dayCounts)) {
    if (day < start || day > end) continue;
    const offset = daysBetween(start, day);
    const index = Math.min(bucketCount - 1, Math.floor(offset / size));
    buckets[index].count += count;
  }
  return buckets;
}

module.exports = {
  validateAndCalculateVoucher,
  incrementVoucherUsage,
  releaseVoucherUsage,
  validateVoucherPayload,
  voucherStatus,
  businessToday,
  dateKey,
  performanceWindow,
  samplePerformance,
  bucketUsage,
  perUserLimit
};
