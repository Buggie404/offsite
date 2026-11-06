const mongoose = require('mongoose');
const Voucher = require('../models/Voucher');
const User = require('../models/User');
const Order = require('../models/Order');
const voucherService = require('../services/voucher.service');

const COMPLAINT_DAILY_LIMIT = 3;
const COMPLAINT_MAX_AMOUNT = 10;
const COMPLAINT_MAX_PERCENT = 20;
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

// CSKH may only issue a complaint voucher: one use, at most 30 days,
// at most $10 or 20%, assigned to one customer. Three a day; past that, only Admin CC.
async function buildComplaint(req, admin) {
  const discountType = req.body?.discount_type === 'percentage' ? 'percentage' : 'fixed';
  const input = {
    ...req.body,
    voucher_type: 'discount',
    discount_type: discountType,
    usage_limit: 1,
    target_tier: ''
  };
  const parsed = voucherService.validateVoucherPayload(input);
  if (!parsed.ok) return parsed;
  if (discountType === 'fixed' && parsed.value.discount_value > COMPLAINT_MAX_AMOUNT) {
    return { ok: false, field: 'discount_value', error: 'A complaint voucher cannot exceed $10.' };
  }
  if (discountType === 'percentage' && parsed.value.discount_value > COMPLAINT_MAX_PERCENT) {
    return { ok: false, field: 'discount_value', error: 'A complaint voucher cannot exceed 20%.' };
  }
  if (daySpan(parsed.value.valid_from, parsed.value.valid_to) > COMPLAINT_MAX_DAYS) {
    return { ok: false, field: 'valid_to', error: 'A complaint voucher can last at most 30 days.' };
  }

  const customer = await resolveCustomer(req.body?.assigned_user_id || req.body?.assigned_user);
  if (!customer) {
    return { ok: false, field: 'assigned_user', error: 'Choose the customer this voucher is for.' };
  }

  if (req.user.role === 'cskh') {
    const bounds = vietnamDayBounds(voucherService.businessToday());
    const issuedToday = await Voucher.countDocuments({
      created_by: admin.user_id,
      purpose: 'complaint',
      createdAt: { $gte: bounds.start, $lt: bounds.end }
    });
    if (issuedToday >= COMPLAINT_DAILY_LIMIT) {
      return {
        ok: false,
        status: 403,
        error: 'You can issue 3 complaint vouchers a day. Ask an Admin CC to create the next one.'
      };
    }
  }

  return {
    ok: true,
    value: {
      ...parsed.value,
      purpose: 'complaint',
      assigned_user_id: customer.user_id,
      assigned_user_name: customer.profile_name || customer.user_id,
      usage_limit_per_user: 1,
      message: String(req.body?.message || '').trim().slice(0, 280)
    }
  };
}

async function createVoucher(req, res) {
  try {
    const admin = await resolveAdmin(req);
    if (!admin?.user_id) return res.status(401).json({ error: 'Authentication is required.' });

    const role = req.user.role;
    const complaint = role === 'cskh' || req.body?.purpose === 'complaint';
    if (complaint && role === 'qlsp') {
      return res.status(403).json({ error: 'Sales-Ops cannot create a complaint voucher.', code: 'ROLE_FORBIDDEN' });
    }
    if (!complaint && role === 'cskh') {
      return res.status(403).json({ error: 'Support can only create a complaint voucher.', code: 'ROLE_FORBIDDEN' });
    }

    const parsed = complaint
      ? await buildComplaint(req, admin)
      : voucherService.validateVoucherPayload(req.body);
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
      usage_limit_per_user: usage_limit_per_user ?? 1,
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
      existing: voucher
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });

    if (voucher.purpose === 'complaint') {
      parsed.value.voucher_type = 'discount';
      parsed.value.usage_limit = 1;
      parsed.value.target_tier = null;
      if (parsed.value.discount_type === 'fixed' && parsed.value.discount_value > COMPLAINT_MAX_AMOUNT) {
        return res.status(400).json({ error: 'A complaint voucher cannot exceed $10.', field: 'discount_value' });
      }
      if (parsed.value.discount_type === 'percentage' && parsed.value.discount_value > COMPLAINT_MAX_PERCENT) {
        return res.status(400).json({ error: 'A complaint voucher cannot exceed 20%.', field: 'discount_value' });
      }
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
      target_tier: voucher.target_tier
    };

    const updated = await Voucher.findByIdAndUpdate(voucher._id, { $set: parsed.value }, { new: true }).lean();

    void req.writeActivityLog({
      actionType: 'voucher.update',
      targetEntity: 'Vouchers',
      targetId: updated.code,
      oldValue: before,
      newValue: parsed.value
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
  let orders = 0;
  let discounted = 0;
  let revenue = 0;
  for (const day of days) {
    orders += day.orders || 0;
    discounted += day.discounted || 0;
    revenue += day.revenue || 0;
    if (day._id) dayCounts[day._id] = day.orders || 0;
  }
  const range = voucherService.performanceWindow(voucher);
  const buckets = voucherService.bucketUsage(dayCounts, range.start, range.end);
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
      count: bucket.count
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
      count: bucket.count
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

module.exports = {
  listVouchers,
  searchCustomers,
  createVoucher,
  updateVoucher,
  stopVoucher,
  voucherPerformance
};
