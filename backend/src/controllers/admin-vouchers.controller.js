const mongoose = require('mongoose');
const Voucher = require('../models/Voucher');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const voucherService = require('../services/voucher.service');

const COMPLAINT_DAILY_LIMIT = 3;
const COMPLAINT_MAX_PERCENT = 20;
const ORDER_ID_PATTERN = /OFS-\d{4}-\d{5}/i;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Which voucher types each role may create (Voucher (new), section 8).
const CREATE_PURPOSES = {
  admin_cc: ['campaign', 'loyalty_redeem', 'referral', 'complaint'],
  qlsp: ['campaign', 'loyalty_redeem'],
  cskh: ['complaint']
};
const COMPLAINT_MAX_DAYS = 30;
const PAGE_LIMIT = 20;

const ADMIN_FIELDS = 'user_id profile_name role';

async function resolveAdmin(req) {
  const id = String(req.user?.user_id || '');
  if (!id) return null;
  const query = /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { user_id: id };
  return User.findOne(query, ADMIN_FIELDS).lean();
}

function toRow(voucher, creator, assignedName = null) {
  return {
    _id: String(voucher._id),
    code: voucher.code,
    voucher_type: voucher.voucher_type,
    discount_type: voucher.discount_type,
    discount_value: voucher.discount_value,
    min_order_amount: voucher.min_order_amount || 0,
    max_discount_value: voucher.max_discount_value ?? null,
    usage_limit: voucher.usage_limit ?? null,
    usage_limit_per_user: voucher.usage_limit_per_user === undefined ? 1 : voucher.usage_limit_per_user,
    used_count: voucher.used_count || 0,
    valid_from: voucherService.dateKey(voucher.valid_from),
    valid_to: voucherService.dateKey(voucher.valid_to),
    is_active: voucher.is_active !== false,
    target_tier: voucher.target_tier || null,
    applies_to: voucher.applies_to || 'all',
    applicable_categories: voucher.applicable_categories || [],
    applicable_product_ids: voucher.applicable_product_ids || [],
    related_ref: voucher.related_ref || null,
    points_cost: Number(voucher.points_cost) > 0 ? voucher.points_cost : null,
    source_voucher_id: voucher.source_voucher_id || null,
    purpose: voucher.purpose || 'campaign',
    assigned_user_id: voucher.assigned_user_id || null,
    assigned_user_name: assignedName || null,
    created_by: voucher.created_by || null,
    created_by_name: creator?.profile_name || null,
    created_by_role: creator?.role || null,
    status: voucherService.voucherStatus(voucher)
  };
}

async function creatorMap(vouchers) {
  const ids = [...new Set(vouchers.map((voucher) => voucher.created_by).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.find({ user_id: { $in: ids } }, ADMIN_FIELDS).lean();
  return new Map(users.map((user) => [user.user_id, user]));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PURPOSE_FILTERS = {
  campaign: 'campaign',
  complaint: 'complaint',
  loyalty: 'loyalty_redeem',
  referral: 'referral'
};

function listFilter(query) {
  const filter = {};
  const purposeKey = String(query.purpose || '');
  if (purposeKey === 'loyalty') filter.purpose = { $in: ['loyalty_redeem', 'archetype'] };
  else if (PURPOSE_FILTERS[purposeKey]) filter.purpose = PURPOSE_FILTERS[purposeKey];

  const type = String(query.type || '');
  if (type === 'discount' || type === 'shipping') filter.voucher_type = type;

  const today = voucherService.businessToday();
  const status = String(query.status || 'active');
  if (status === 'inactive') {
    filter.is_active = false;
  } else if (status === 'upcoming') {
    filter.is_active = { $ne: false };
    filter.valid_from = { $gt: today };
  } else if (status === 'expired') {
    filter.is_active = { $ne: false };
    filter.valid_to = { $lt: today };
  } else if (status === 'active') {
    filter.is_active = { $ne: false };
    filter.valid_from = { $lte: today };
    filter.valid_to = { $gte: today };
  }

  const and = [];
  // Personal vouchers (assigned to one customer) stay out of the default list.
  const personalPurpose = purposeKey === 'complaint' || purposeKey === 'loyalty' || purposeKey === 'referral';
  if (!personalPurpose) {
    and.push({
      $or: [
        { assigned_user_id: null },
        { assigned_user_id: '' },
        { assigned_user_id: { $exists: false } }
      ]
    });
  }
  const q = String(query.q || '').trim();
  if (q) and.push({ code: new RegExp(escapeRegex(q), 'i') });
  if (and.length) filter.$and = and;
  return filter;
}

async function assigneeMap(vouchers) {
  const ids = [...new Set(vouchers.map((voucher) => voucher.assigned_user_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.find({ user_id: { $in: ids } }, 'user_id profile_name').lean();
  return new Map(users.map((user) => [user.user_id, user.profile_name]));
}

async function listVouchers(req, res) {
  try {
    const filter = listFilter(req.query);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_LIMIT, 1), 50);
    const [total, vouchers] = await Promise.all([
      Voucher.countDocuments(filter),
      Voucher.find(filter).sort({ createdAt: -1, code: 1 }).skip((page - 1) * limit).limit(limit).lean()
    ]);
    const focusDoc = vouchers.find((voucher) => String(voucher._id) === String(req.query.focus || '')) || vouchers[0];
    const [creators, assignees, performance] = await Promise.all([
      creatorMap(vouchers),
      assigneeMap(vouchers),
      focusDoc ? performanceFor(focusDoc) : Promise.resolve(null)
    ]);
    const data = vouchers.map((voucher) => toRow(
      voucher,
      creators.get(voucher.created_by),
      assignees.get(voucher.assigned_user_id)
    ));
    res.json({ data, total, page, limit, performance });
  } catch (error) {
    console.error('Error listing admin vouchers:', error);
    res.status(500).json({ error: 'Vouchers could not be loaded.' });
  }
}

async function searchCustomers(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json({ data: [] });
    const pattern = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({
      role: 'customer',
      $or: [{ profile_name: pattern }, { user_id: pattern }, { email: pattern }]
    }, 'user_id profile_name email').limit(8).lean();
    res.json({
      data: users.map((user) => ({
        user_id: user.user_id,
        profile_name: user.profile_name || user.user_id,
        email: user.email || ''
      }))
    });
  } catch (error) {
    console.error('Error searching voucher customers:', error);
    res.status(500).json({ error: 'Customers could not be searched.' });
  }
}

function daySpan(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

function vietnamDayBounds(day) {
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, date, -7, 0, 0, 0));
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

async function resolveCustomer(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  return User.findOne({
    role: 'customer',
    $or: [{ user_id: key }, { email: key }, { email: key.toLowerCase() }]
  }, 'user_id profile_name').lean();
}

function orderIdFrom(text) {
  const match = ORDER_ID_PATTERN.exec(String(text || ''));
  return match ? match[0].toUpperCase() : null;
}

async function complaintIssuedToday(adminUserId) {
  const bounds = vietnamDayBounds(voucherService.businessToday());
  return Voucher.countDocuments({
    created_by: adminUserId,
    purpose: 'complaint',
    createdAt: { $gte: bounds.start, $lt: bounds.end }
  });
}

// The complained order must exist and belong to the customer. Its total is the cap of a fixed voucher.
async function findComplaintOrder(orderId, userId) {
  if (!orderId) return { ok: false, field: 'related_ref', error: 'Include the order ID (OFS-YYYY-XXXXX) in the reason.' };
  const order = await Order.findOne({ order_id: orderId }, 'order_id user_id pricing.total order_status created_at').lean();
  if (!order) return { ok: false, field: 'related_ref', error: `Order ${orderId} does not exist.` };
  if (userId && order.user_id !== userId) {
    return { ok: false, field: 'related_ref', error: `Order ${orderId} belongs to another customer.` };
  }
  return { ok: true, order, cap: Math.round((Number(order.pricing?.total) || 0) * 100) / 100 };
}

async function generateComplaintCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let suffix = '';
    for (let i = 0; i < 5; i += 1) suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const code = `CMP-${suffix}`;
    if (!(await Voucher.exists({ code }))) return code;
  }
  throw new Error('Could not generate a unique complaint code.');
}

function complaintValueError(discountType, value, cap, orderId) {
  if (discountType === 'percentage' && value > COMPLAINT_MAX_PERCENT) {
    return 'A complaint voucher cannot exceed 20%.';
  }
  if (discountType === 'fixed' && value > cap) {
    return `A fixed complaint voucher cannot exceed ${cap.toFixed(2)} USD, the total of order ${orderId}.`;
  }
  return null;
}

// Complaint voucher (Services Ops, Senior Admin): one customer, one use, at most 30 days,
// tied to an order of that customer. Up to 20%, or a fixed amount up to that order's total.
// Services Ops may issue 3 a day; past that, a Senior Admin creates it. The code is generated: CMP-XXXXX.
async function buildComplaint(req, admin) {
  const discountType = req.body?.discount_type === 'percentage' ? 'percentage' : 'fixed';
  const today = voucherService.businessToday();
  const input = {
    ...req.body,
    code: 'CMP-PENDING',
    voucher_type: 'discount',
    discount_type: discountType,
    usage_limit: 1,
    min_order_amount: 0,
    max_discount_value: null,
    target_tier: '',
    applies_to: 'all',
    valid_from: req.body?.valid_from || today
  };
  const parsed = voucherService.validateVoucherPayload(input, { purpose: 'complaint' });
  if (!parsed.ok) return parsed;
  if (daySpan(parsed.value.valid_from, parsed.value.valid_to) > COMPLAINT_MAX_DAYS) {
    return { ok: false, field: 'valid_to', error: 'A complaint voucher can last at most 30 days.' };
  }

  const customer = await resolveCustomer(req.body?.assigned_user_id || req.body?.assigned_user);
  if (!customer) {
    return { ok: false, field: 'assigned_user', error: 'Choose the customer this voucher is for.' };
  }

  const orderId = orderIdFrom(req.body?.related_ref) || orderIdFrom(req.body?.reason);
  const found = await findComplaintOrder(orderId, customer.user_id);
  if (!found.ok) return found;
  const valueError = complaintValueError(discountType, parsed.value.discount_value, found.cap, orderId);
  if (valueError) return { ok: false, field: 'discount_value', error: valueError };

  if (req.user.role === 'cskh' && (await complaintIssuedToday(admin.user_id)) >= COMPLAINT_DAILY_LIMIT) {
    return {
      ok: false,
      status: 403,
      error: 'You can issue 3 complaint vouchers a day. Ask a Senior Admin to create the next one.'
    };
  }

  return {
    ok: true,
    value: {
      ...parsed.value,
      code: await generateComplaintCode(),
      purpose: 'complaint',
      assigned_user_id: customer.user_id,
      assigned_user_name: customer.profile_name || customer.user_id,
      related_ref: orderId,
      usage_limit_per_user: 1,
      message: String(req.body?.message || '').trim().slice(0, 280)
    }
  };
}

// Product ids in a product scope must be real products.
async function checkScopeProducts(value) {
  if (value.applies_to !== 'product') return null;
  const ids = value.applicable_product_ids || [];
  const objectIds = ids.filter((id) => mongoose.isValidObjectId(id));
  const found = await Product.countDocuments({ _id: { $in: objectIds } });
  if (found !== ids.length) {
    return { field: 'applicable_product_ids', error: 'Some picked products no longer exist. Remove them and try again.' };
  }
  return null;
}

function scopeLog(value) {
  return {
    applies_to: value.applies_to || 'all',
    applicable_categories: value.applicable_categories || null,
    applicable_product_ids: value.applicable_product_ids || null
  };
}

async function createVoucher(req, res) {
  try {
    const admin = await resolveAdmin(req);
    if (!admin?.user_id) return res.status(401).json({ error: 'Authentication is required.' });

    const role = req.user.role;
    const allowed = CREATE_PURPOSES[role] || [];
    const requested = role === 'cskh' ? 'complaint' : String(req.body?.purpose || 'campaign');
    if (!allowed.includes(requested)) {
      const message = role === 'cskh'
        ? 'Services Ops can only create a complaint voucher.'
        : role === 'qlsp' && requested === 'complaint'
          ? 'Sales Ops cannot create a complaint voucher.'
          : 'Your role cannot create this voucher type.';
      return res.status(403).json({ error: message, code: 'ROLE_FORBIDDEN' });
    }
    const complaint = requested === 'complaint';

    let parsed;
    if (complaint) {
      parsed = await buildComplaint(req, admin);
    } else {
      parsed = voucherService.validateVoucherPayload(req.body, { purpose: requested });
      if (parsed.ok && requested === 'loyalty_redeem' && !parsed.value.target_tier) {
        parsed = { ok: false, field: 'target_tier', error: 'Choose the member tier for a loyalty voucher.' };
      }
      if (parsed.ok && requested === 'referral') {
        parsed.value = { ...parsed.value, purpose: 'referral', usage_limit_per_user: 1, target_tier: null };
      } else if (parsed.ok) {
        parsed.value = { ...parsed.value, purpose: requested };
      }
      if (parsed.ok) {
        const productIssue = await checkScopeProducts(parsed.value);
        if (productIssue) parsed = { ok: false, ...productIssue };
      }
    }
    if (!parsed.ok) return res.status(parsed.status || 400).json({ error: parsed.error, field: parsed.field });

    const { purpose, assigned_user_id, assigned_user_name, related_ref, usage_limit_per_user, message, ...terms } = parsed.value;
    const voucher = await Voucher.create({
      ...terms,
      is_active: true,
      used_count: 0,
      createdAt: new Date().toISOString(),
      created_by: admin.user_id,
      purpose: purpose || 'campaign',
      assigned_user_id: assigned_user_id || null,
      related_ref: related_ref || null,
      usage_limit_per_user: usage_limit_per_user ?? (req.body?.usage_limit_per_user === '' || req.body?.usage_limit_per_user == null
        ? 1
        : perCustomerLimit(req.body.usage_limit_per_user)),
      title: null,
      subtitle: message || null
    });

    // The voucher is already stored. The log write must not hold the response.
    void req.writeActivityLog({
      actionType: 'voucher.create',
      targetEntity: 'Vouchers',
      targetId: voucher.code,
      newValue: {
        ...terms,
        ...scopeLog(terms),
        purpose: voucher.purpose,
        assigned_user_id: voucher.assigned_user_id,
        related_ref: voucher.related_ref
      }
    });

    res.status(201).json({ data: toRow(voucher.toObject(), admin, assigned_user_name || null) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'That code is already in use.', field: 'code' });
    }
    console.error('Error creating voucher:', error);
    res.status(500).json({ error: 'The voucher could not be created.' });
  }
}

async function stopVoucher(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Voucher not found.' });
    }
    const voucher = await Voucher.findById(req.params.id);
    if (!voucher) return res.status(404).json({ error: 'Voucher not found.' });
    if (!voucher.is_active) return res.status(400).json({ error: 'This voucher is already stopped.' });

    const creatorPromise = voucher.created_by
      ? User.findOne({ user_id: voucher.created_by }, ADMIN_FIELDS).lean()
      : null;
    voucher.is_active = false;
    await voucher.save();

    void req.writeActivityLog({
      actionType: 'voucher.stop',
      targetEntity: 'Vouchers',
      targetId: voucher.code,
      oldValue: { is_active: true },
      newValue: { is_active: false }
    });

    const creator = creatorPromise ? await creatorPromise : null;
    res.json({ data: toRow(voucher.toObject(), creator) });
  } catch (error) {
    console.error('Error stopping voucher:', error);
    res.status(500).json({ error: 'The voucher could not be stopped.' });
  }
}

async function updateVoucher(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Voucher not found.' });
    }
    const voucher = await Voucher.findById(req.params.id);
    if (!voucher) return res.status(404).json({ error: 'Voucher not found.' });

    const parsed = voucherService.validateVoucherPayload(req.body, {
      usedCount: voucher.used_count || 0,
      existing: voucher,
      purpose: voucher.purpose || 'campaign'
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    if (!(voucher.used_count > 0)) {
      const productIssue = await checkScopeProducts(parsed.value);
      if (productIssue) return res.status(400).json(productIssue);
    }

    if (voucher.purpose === 'complaint') {
      parsed.value.voucher_type = 'discount';
      parsed.value.usage_limit = 1;
      parsed.value.target_tier = null;
      const found = await findComplaintOrder(voucher.related_ref, voucher.assigned_user_id);
      const cap = found.ok ? found.cap : 0;
      const valueError = complaintValueError(parsed.value.discount_type, parsed.value.discount_value, cap, voucher.related_ref);
      if (valueError) return res.status(400).json({ error: valueError, field: 'discount_value' });
      if (daySpan(parsed.value.valid_from, parsed.value.valid_to) > COMPLAINT_MAX_DAYS) {
        return res.status(400).json({ error: 'A complaint voucher can last at most 30 days.', field: 'valid_to' });
      }
    }

    const before = {
      code: voucher.code,
      voucher_type: voucher.voucher_type,
      discount_type: voucher.discount_type,
      discount_value: voucher.discount_value,
      min_order_amount: voucher.min_order_amount,
      max_discount_value: voucher.max_discount_value,
      valid_from: voucher.valid_from,
      valid_to: voucher.valid_to,
      usage_limit: voucher.usage_limit,
      target_tier: voucher.target_tier,
      points_cost: voucher.points_cost ?? null,
      ...scopeLog(voucher)
    };

    const updated = await Voucher.findByIdAndUpdate(voucher._id, { $set: parsed.value }, { new: true }).lean();

    void req.writeActivityLog({
      actionType: 'voucher.update',
      targetEntity: 'Vouchers',
      targetId: updated.code,
      oldValue: before,
      newValue: { ...parsed.value, ...scopeLog(parsed.value) }
    });

    res.json({ data: toRow(updated) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'That code is already in use.', field: 'code' });
    }
    console.error('Error updating voucher:', error);
    res.status(500).json({ error: 'The voucher could not be saved.' });
  }
}

async function performanceFor(voucher) {
  if (!voucher) return null;
  if (!(voucher.used_count > 0)) return emptyPerformance(voucher);

  const days = await Order.aggregate([
    {
      $match: {
        order_status: { $ne: 'canceled' },
        'coupon.code': voucher.code
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'Asia/Ho_Chi_Minh' }
        },
        orders: { $sum: 1 },
        discounted: { $sum: { $ifNull: ['$pricing.discount_amount', 0] } },
        revenue: { $sum: { $ifNull: ['$pricing.total', 0] } }
      }
    }
  ]);

  const dayCounts = {};
  const dayMoney = {};
  let orders = 0;
  let discounted = 0;
  let revenue = 0;
  for (const day of days) {
    orders += day.orders || 0;
    discounted += day.discounted || 0;
    revenue += day.revenue || 0;
    if (day._id) {
      dayCounts[day._id] = day.orders || 0;
      dayMoney[day._id] = { discounted: day.discounted || 0, revenue: day.revenue || 0 };
    }
  }
  const range = voucherService.performanceWindow(voucher);
  const buckets = voucherService.bucketUsage(dayCounts, range.start, range.end, dayMoney);
  const shown = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (!orders || !shown) return voucherService.samplePerformance(voucher);
  const round = (amount) => Math.round((Number(amount) || 0) * 100) / 100;
  return {
    code: voucher.code,
    used_count: voucher.used_count || 0,
    usage_limit: voucher.usage_limit ?? null,
    times_used: orders,
    total_discounted: round(discounted),
    revenue: round(revenue),
    range_from: range.start,
    range_to: range.end,
    buckets: buckets.map((bucket) => ({
      start: bucket.start,
      end: bucket.end,
      count: bucket.count,
      discounted: bucket.discounted,
      revenue: bucket.revenue
    }))
  };
}

function emptyPerformance(voucher) {
  const range = voucherService.performanceWindow(voucher);
  const buckets = voucherService.bucketUsage({}, range.start, range.end);
  return {
    code: voucher.code,
    used_count: voucher.used_count || 0,
    usage_limit: voucher.usage_limit ?? null,
    times_used: 0,
    total_discounted: 0,
    revenue: 0,
    range_from: range.start,
    range_to: range.end,
    buckets: buckets.map((bucket) => ({
      start: bucket.start,
      end: bucket.end,
      count: bucket.count,
      discounted: bucket.discounted,
      revenue: bucket.revenue
    }))
  };
}

async function voucherPerformance(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Voucher not found.' });
    }
    const voucher = await Voucher.findById(req.params.id).lean();
    if (!voucher) return res.status(404).json({ error: 'Voucher not found.' });
    res.json({ data: await performanceFor(voucher) });
  } catch (error) {
    console.error('Error loading voucher performance:', error);
    res.status(500).json({ error: 'Performance could not be loaded.' });
  }
}

function perCustomerLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

// Product picker of the scope block: active products by name or variant SKU.
async function searchProducts(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    const ids = String(req.query.ids || '').split(',').map((id) => id.trim()).filter((id) => mongoose.isValidObjectId(id));
    let filter;
    if (ids.length) filter = { _id: { $in: ids.slice(0, voucherService.MAX_SCOPE_PRODUCTS) } };
    else if (q.length >= 2) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter = { is_active: { $ne: false }, $or: [{ name: pattern }, { 'variants.sku': pattern }] };
    } else return res.json({ data: [] });
    const products = await Product.find(filter, '_id name category is_active variants.sku variants.price').limit(ids.length ? 50 : 10).lean();
    res.json({
      data: products.map((product) => {
        const prices = (product.variants || []).map((variant) => Number(variant.price)).filter(Number.isFinite);
        return {
          _id: String(product._id),
          name: product.name,
          category: product.category,
          sku: product.variants?.[0]?.sku || '',
          price: prices.length ? Math.min(...prices) : 0,
          is_active: product.is_active !== false
        };
      })
    });
  } catch (error) {
    console.error('Error searching voucher products:', error);
    res.status(500).json({ error: 'Products could not be searched.' });
  }
}

// Complaint form: checks the order ID in the reason and returns the cap shown under the value.
async function complaintOrder(req, res) {
  try {
    const orderId = orderIdFrom(req.query.order_id);
    const found = await findComplaintOrder(orderId, String(req.query.user_id || '') || null);
    if (!found.ok) return res.status(orderId ? 404 : 400).json({ error: found.error, field: found.field });
    res.json({ data: { order_id: found.order.order_id, user_id: found.order.user_id, total: found.cap } });
  } catch (error) {
    console.error('Error checking complaint order:', error);
    res.status(500).json({ error: 'The order could not be checked.' });
  }
}

async function codeAvailable(req, res) {
  try {
    const code = String(req.query.code || '').trim().toUpperCase();
    if (!code) return res.json({ data: { available: false } });
    res.json({ data: { available: !(await Voucher.exists({ code })) } });
  } catch (error) {
    console.error('Error checking voucher code:', error);
    res.status(500).json({ error: 'The code could not be checked.' });
  }
}

async function complaintQuota(req, res) {
  try {
    const admin = await resolveAdmin(req);
    if (req.user.role !== 'cskh') return res.json({ data: { limit: null, used: 0, left: null } });
    const used = await complaintIssuedToday(admin?.user_id);
    res.json({ data: { limit: COMPLAINT_DAILY_LIMIT, used, left: Math.max(0, COMPLAINT_DAILY_LIMIT - used) } });
  } catch (error) {
    console.error('Error loading complaint quota:', error);
    res.status(500).json({ error: 'The daily limit could not be loaded.' });
  }
}

module.exports = {
  searchProducts,
  complaintOrder,
  complaintQuota,
  codeAvailable,
  listVouchers,
  searchCustomers,
  createVoucher,
  updateVoucher,
  stopVoucher,
  voucherPerformance
};
