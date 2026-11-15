const Voucher = require('../models/Voucher');
const Order = require('../models/Order');

const BUSINESS_TZ = 'Asia/Ho_Chi_Minh';
const TIERS = ['seed', 'leaf', 'bloom', 'zen'];
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const SCOPES = ['all', 'category', 'product'];
const SCOPE_CATEGORIES = ['matcha', 'coffee', 'tools', 'drinkware', 'sets_bundles'];
const MAX_SCOPE_PRODUCTS = 50;
// Purposes that may carry a category / product scope. The others always cover the whole order.
const SCOPED_PURPOSES = ['campaign', 'loyalty_redeem'];
// Most points a voucher may cost: the lifetime points that open the next tier above its target tier.
// Zen has no next tier and caps at 2000. A voucher for every tier uses the same top cap.
const POINTS_CAP_BY_TIER = { seed: 150, leaf: 400, bloom: 1000, zen: 2000 };
const POINTS_CAP_ALL_TIERS = 2000;

function pointsCapFor(tier) {
  return POINTS_CAP_BY_TIER[String(tier || '').toLowerCase()] || POINTS_CAP_ALL_TIERS;
}

// A voucher that costs points is a template; only the personal copy issued on redeem can be used.
function needsRedeem(voucher) {
  return Number(voucher?.points_cost) > 0 && !voucher?.assigned_user_id;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SCOPE_ERRORS = {
  none: 'Mã này không áp dụng cho sản phẩm trong giỏ.'
};

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
 * Splits cart lines into the ones a voucher discounts and the ones it skips.
 * Shared by the voucher quote (cart / checkout) and createOrder, so both always agree.
 * Each line: { product_id, category, subtotal, purchase_type, from_quiz_bundle, product_active }.
 * Ritual Box (subscription) lines and Starter Quiz kit lines never get a voucher, whatever the scope.
 */
function getEligibleItems(voucher, cartItems = []) {
  const scope = voucher?.applies_to || 'all';
  const categories = new Set(voucher?.applicable_categories || []);
  const productIds = new Set((voucher?.applicable_product_ids || []).map(String));
  const lines = (cartItems || []).map((item) => {
    let reason = null;
    if (item.purchase_type === 'subscription') reason = 'ritual_box';
    else if (item.from_quiz_bundle) reason = 'starter_kit';
    else if (item.product_active === false) reason = 'unavailable';
    else if (scope === 'category' && !categories.has(item.category)) reason = 'out_of_scope';
    else if (scope === 'product' && !productIds.has(String(item.product_id))) reason = 'out_of_scope';
    return { ...item, eligible: !reason, reason };
  });
  const eligibleItems = lines.filter((line) => line.eligible);
  const eligibleSubtotal = round2(eligibleItems.reduce((sum, line) => sum + (Number(line.subtotal) || 0), 0));
  return { lines, eligibleItems, eligibleSubtotal };
}

/**
 * Adds category and active state from Products to raw cart lines
 * ({ product_id, variant_id, quantity, subtotal | unit_price, purchase_type, from_quiz_bundle, bundle_key }).
 * Prices sent by the client are only used by the quote; createOrder passes server-built lines.
 */
async function describeCartLines(items = []) {
  const Product = require('../models/Product');
  const ids = [...new Set((items || []).map((item) => String(item.product_id || '')).filter(Boolean))];
  const objectIds = ids.filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
  const numericIds = ids.filter((id) => /^\d+$/.test(id)).map(Number);
  const products = ids.length
    ? await Product.find({
      $or: [
        ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
        ...(numericIds.length ? [{ product_id: { $in: numericIds } }] : [])
      ]
    }, '_id product_id name category is_active').lean()
    : [];
  const byId = new Map();
  for (const product of products) {
    byId.set(String(product._id), product);
    byId.set(String(product.product_id), product);
  }
  return (items || []).map((item, index) => {
    const product = byId.get(String(item.product_id));
    const quantity = Number(item.quantity) || 1;
    const subtotal = item.subtotal != null ? Number(item.subtotal) : (Number(item.unit_price) || 0) * quantity;
    return {
      key: item.key || `${item.product_id}::${item.variant_id || ''}::${index}`,
      product_id: product ? String(product._id) : String(item.product_id),
      variant_id: item.variant_id || null,
      product_name: item.product_name || product?.name || '',
      category: product?.category || null,
      subtotal: round2(subtotal),
      purchase_type: item.purchase_type === 'subscription' ? 'subscription' : 'one_time',
      from_quiz_bundle: !!item.from_quiz_bundle,
      product_active: product ? product.is_active !== false : false
    };
  });
}

function scopeSnapshot(voucher) {
  const scope = voucher?.applies_to || 'all';
  return {
    applies_to: scope,
    applicable_categories: scope === 'category' ? [...(voucher.applicable_categories || [])] : undefined,
    applicable_product_ids: scope === 'product' ? [...(voucher.applicable_product_ids || [])] : undefined
  };
}

/**
 * Validates a voucher code against validity dates, usage limits, minimum order amount, and shipping method.
 * userId / userTier enforce assigned vouchers, the tier gate, and the per-account cap.
 * lines: cart lines from describeCartLines (or createOrder). With lines, an item discount is
 * measured on the eligible lines only (getEligibleItems). Without lines only whole-order
 * vouchers can be priced, and subtotal is used as is.
 * Returns { isValid, voucher, discountAmount, eligibleSubtotal, lines, error }.
 */
async function validateAndCalculateVoucher({ code, subtotal = 0, shippingMethod = 'standard', userId = null, userTier = null, lines = null }) {
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

  if (needsRedeem(voucher)) {
    return {
      isValid: false,
      voucher,
      discountAmount: 0,
      code: 'REDEEM_REQUIRED',
      error: `Mã "${codeUpper}" cần đổi ${voucher.points_cost} điểm trong mục Rewards trước khi dùng.`
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
  const scoped = voucher.voucher_type === 'discount';
  const eligibility = scoped && Array.isArray(lines) ? getEligibleItems(voucher, lines) : null;
  // Item discounts are measured on the eligible lines. Shipping vouchers always look at the whole order.
  const base = eligibility ? eligibility.eligibleSubtotal : numSubtotal;
  const extra = { eligibleSubtotal: base, lines: eligibility ? eligibility.lines : null };

  if (eligibility && !eligibility.eligibleItems.length) {
    return { isValid: false, voucher, discountAmount: 0, ...extra, code: 'NO_ELIGIBLE_ITEMS', error: SCOPE_ERRORS.none };
  }
  if (voucher.min_order_amount && base < voucher.min_order_amount) {
    const missing = round2(voucher.min_order_amount - base).toFixed(2);
    const onEligible = eligibility && (voucher.applies_to || 'all') !== 'all' ? ' sản phẩm được áp dụng' : '';
    return {
      isValid: false,
      voucher,
      discountAmount: 0,
      ...extra,
      code: 'MIN_ORDER',
      missing: Number(missing),
      error: `Mua thêm $${missing}${onEligible} để dùng mã "${codeUpper}" (tối thiểu $${voucher.min_order_amount}).`
    };
  }

  const shippingCost = shippingMethod === 'express' ? 15 : 0;
  let discountAmount = 0;

  if (voucher.voucher_type === 'discount') {
    if (voucher.discount_type === 'percentage') {
      discountAmount = base * (Math.min(voucher.discount_value, 100) / 100);
    } else if (voucher.discount_type === 'fixed') {
      discountAmount = voucher.discount_value;
    }
  } else if (voucher.voucher_type === 'shipping') {
    if (shippingMethod !== 'express') {
      return { 
        isValid: false, 
        voucher, 
        discountAmount: 0, 
        ...extra,
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
  // An item discount never exceeds the eligible amount.
  if (voucher.voucher_type === 'discount') discountAmount = Math.min(discountAmount, base);
  discountAmount = round2(discountAmount);

  return {
    isValid: true,
    voucher,
    discountAmount,
    ...extra,
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
function parseScope(source, { voucherType, purpose }) {
  const allowed = voucherType !== 'shipping' && SCOPED_PURPOSES.includes(purpose || 'campaign');
  const scope = source.applies_to == null || source.applies_to === '' ? 'all' : String(source.applies_to);
  if (!SCOPES.includes(scope)) return fail('applies_to', 'Choose Whole order, By category or By product.');
  if (!allowed || scope === 'all') {
    if (!allowed && scope !== 'all') {
      return fail('applies_to', voucherType === 'shipping'
        ? 'A shipping voucher always applies to the whole order.'
        : 'Only Campaign and Loyalty vouchers can be limited to categories or products.');
    }
    return { ok: true, value: { applies_to: 'all', applicable_categories: null, applicable_product_ids: null } };
  }
  const list = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (scope === 'category') {
    const categories = list(source.applicable_categories).map((item) => item.toLowerCase());
    if (!categories.length) return fail('applicable_categories', 'Pick at least one category.');
    if (categories.some((item) => !SCOPE_CATEGORIES.includes(item))) return fail('applicable_categories', 'Pick categories from the list.');
    if (list(source.applicable_product_ids).length) return fail('applies_to', 'Use either categories or products, not both.');
    return { ok: true, value: { applies_to: 'category', applicable_categories: categories, applicable_product_ids: null } };
  }
  const products = list(source.applicable_product_ids);
  if (!products.length) return fail('applicable_product_ids', 'Pick at least one product.');
  if (products.length > MAX_SCOPE_PRODUCTS) return fail('applicable_product_ids', `Pick at most ${MAX_SCOPE_PRODUCTS} products.`);
  if (list(source.applicable_categories).length) return fail('applies_to', 'Use either categories or products, not both.');
  return { ok: true, value: { applies_to: 'product', applicable_categories: null, applicable_product_ids: products } };
}

function validateVoucherPayload(input, { usedCount = 0, existing = null, purpose = null } = {}) {
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
    // The scope is locked too after the first use.
    terms = {
      applies_to: existing.applies_to || 'all',
      applicable_categories: existing.applicable_categories?.length ? [...existing.applicable_categories] : null,
      applicable_product_ids: existing.applicable_product_ids?.length ? [...existing.applicable_product_ids] : null,
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
    const scope = parseScope(source, { voucherType, purpose: purpose || existing?.purpose || source.purpose || 'campaign' });
    if (!scope.ok) return scope;
    terms = { ...terms, ...scope.value };
  }

  // Points to redeem can still change after the first use: it only prices future redemptions.
  const pointsPurpose = purpose || existing?.purpose || source.purpose || 'campaign';
  const pointsRaw = source.points_cost;
  let pointsCost = null;
  if (pointsRaw !== '' && pointsRaw != null) {
    pointsCost = parseAmount(pointsRaw);
    if (!Number.isInteger(pointsCost) || pointsCost < 0) {
      return fail('points_cost', 'Points must be a whole number, 0 or more.');
    }
    if (pointsCost === 0) pointsCost = null;
  }
  if (pointsCost != null && !SCOPED_PURPOSES.includes(pointsPurpose)) {
    return fail('points_cost', 'Only Campaign and Loyalty vouchers can cost points.');
  }
  const cap = pointsCapFor(terms.target_tier);
  if (pointsCost != null && pointsCost > cap) {
    const tierName = terms.target_tier ? terms.target_tier.charAt(0).toUpperCase() + terms.target_tier.slice(1) : null;
    return fail('points_cost', tierName
      ? `A ${tierName} voucher can cost at most ${cap} points.`
      : `A voucher can cost at most ${cap} points.`);
  }

  return {
    ok: true,
    value: {
      ...terms,
      valid_from: from,
      valid_to: to,
      usage_limit: usageLimit,
      points_cost: pointsCost
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
    buckets: filled.map((bucket) => ({
      ...bucket,
      discounted: round(each * bucket.count),
      revenue: round(Math.max(orderBase - each, 0) * bucket.count)
    }))
  };
}

// dayCounts: { 'YYYY-MM-DD': uses }. dayMoney (optional): { 'YYYY-MM-DD': { discounted, revenue } },
// summed per bucket for the chart tooltip.
function bucketUsage(dayCounts, start, end, dayMoney = {}) {
  const span = Math.max(1, daysBetween(start, end) + 1);
  const bucketCount = Math.min(12, span);
  const size = span / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = addDays(start, Math.floor(index * size));
    const bucketEnd = addDays(start, Math.floor((index + 1) * size) - 1);
    return { start: bucketStart, end: index === bucketCount - 1 ? end : bucketEnd, count: 0, discounted: 0, revenue: 0 };
  });
  const indexOf = (day) => Math.min(bucketCount - 1, Math.floor(daysBetween(start, day) / size));
  for (const [day, count] of Object.entries(dayCounts)) {
    if (day < start || day > end) continue;
    buckets[indexOf(day)].count += count;
  }
  for (const [day, money] of Object.entries(dayMoney || {})) {
    if (day < start || day > end) continue;
    const bucket = buckets[indexOf(day)];
    bucket.discounted = round2(bucket.discounted + (Number(money?.discounted) || 0));
    bucket.revenue = round2(bucket.revenue + (Number(money?.revenue) || 0));
  }
  return buckets;
}

module.exports = {
  POINTS_CAP_BY_TIER,
  POINTS_CAP_ALL_TIERS,
  pointsCapFor,
  needsRedeem,
  getEligibleItems,
  describeCartLines,
  scopeSnapshot,
  SCOPE_CATEGORIES,
  MAX_SCOPE_PRODUCTS,
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
