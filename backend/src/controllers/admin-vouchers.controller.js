const mongoose = require('mongoose');
const Voucher = require('../models/Voucher');
const User = require('../models/User');
const Order = require('../models/Order');
const ChatConversation = require('../models/ChatConversation');
const voucherService = require('../services/voucher.service');

const COMPLAINT_DAILY_LIMIT = 3;
const COMPLAINT_MAX_AMOUNT = 10;
const COMPLAINT_MAX_DAYS = 30;

const ADMIN_FIELDS = 'user_id profile_name role';

async function resolveAdmin(req) {
  const id = String(req.user?.user_id || '');
  if (!id) return null;
  const query = /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { user_id: id };
  return User.findOne(query, ADMIN_FIELDS).lean();
}

function toRow(voucher, creator) {
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

async function listVouchers(req, res) {
  try {
    const vouchers = await Voucher.find().sort({ createdAt: -1, code: 1 }).lean();
    const creators = await creatorMap(vouchers);
    const data = vouchers.map((voucher) => toRow(voucher, creators.get(voucher.created_by)));
    res.json({ data, total: data.length });
  } catch (error) {
    console.error('Error listing admin vouchers:', error);
    res.status(500).json({ error: 'Vouchers could not be loaded.' });
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

async function referenceExists(ref) {
  const [order, conversation] = await Promise.all([
    Order.exists({ order_id: ref }),
    ChatConversation.exists({ conversation_id: ref })
  ]);
  return Boolean(order || conversation);
}

// CSKH may only issue a complaint voucher: fixed amount, at most $10, one use,
// at most 30 days, assigned to one customer, tied to an order or a conversation.
// Three a day; past that, only Admin CC can create the next one.
async function buildComplaint(req, admin) {
  const input = {
    ...req.body,
    voucher_type: 'discount',
    discount_type: 'fixed',
    usage_limit: 1,
    target_tier: ''
  };
  const parsed = voucherService.validateVoucherPayload(input);
  if (!parsed.ok) return parsed;
  if (parsed.value.discount_value > COMPLAINT_MAX_AMOUNT) {
    return { ok: false, field: 'discount_value', error: 'A complaint voucher cannot exceed $10.' };
  }
  if (daySpan(parsed.value.valid_from, parsed.value.valid_to) > COMPLAINT_MAX_DAYS) {
    return { ok: false, field: 'valid_to', error: 'A complaint voucher can last at most 30 days.' };
  }

  const customer = await resolveCustomer(req.body?.assigned_user_id || req.body?.assigned_user);
  if (!customer) {
    return { ok: false, field: 'assigned_user', error: 'Enter the customer this voucher is for.' };
  }
  const relatedRef = String(req.body?.related_ref || '').trim();
  if (!relatedRef || !(await referenceExists(relatedRef))) {
    return { ok: false, field: 'related_ref', error: 'Enter an order id or a conversation id that exists.' };
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
      related_ref: relatedRef,
      usage_limit_per_user: 1
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

    const { purpose, assigned_user_id, related_ref, usage_limit_per_user, ...terms } = parsed.value;
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
      subtitle: null
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

    res.status(201).json({ data: toRow(voucher.toObject(), admin) });
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

    voucher.is_active = false;
    await voucher.save();

    void req.writeActivityLog({
      actionType: 'voucher.stop',
      targetEntity: 'Vouchers',
      targetId: voucher.code,
      oldValue: { is_active: true },
      newValue: { is_active: false }
    });

    const creators = await creatorMap([voucher]);
    res.json({ data: toRow(voucher.toObject(), creators.get(voucher.created_by)) });
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
      parsed.value.discount_type = 'fixed';
      parsed.value.usage_limit = 1;
      parsed.value.target_tier = null;
      if (parsed.value.discount_value > COMPLAINT_MAX_AMOUNT) {
        return res.status(400).json({ error: 'A complaint voucher cannot exceed $10.', field: 'discount_value' });
      }
      if (daySpan(parsed.value.valid_from, parsed.value.valid_to) > COMPLAINT_MAX_DAYS) {
        return res.status(400).json({ error: 'A complaint voucher can last at most 30 days.', field: 'valid_to' });
      }
    }

    if (parsed.value.code !== voucher.code) {
      const exists = await Voucher.findOne({ code: parsed.value.code, _id: { $ne: voucher._id } }, '_id').lean();
      if (exists) return res.status(409).json({ error: 'That code is already in use.', field: 'code' });
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

    Object.assign(voucher, parsed.value);
    await voucher.save();

    void req.writeActivityLog({
      actionType: 'voucher.update',
      targetEntity: 'Vouchers',
      targetId: voucher.code,
      oldValue: before,
      newValue: parsed.value
    });

    const creators = await creatorMap([voucher]);
    res.json({ data: toRow(voucher.toObject(), creators.get(voucher.created_by)) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'That code is already in use.', field: 'code' });
    }
    console.error('Error updating voucher:', error);
    res.status(500).json({ error: 'The voucher could not be saved.' });
  }
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

    // A new voucher has no orders. Skip the collection-wide scan.
    if (!(voucher.used_count > 0)) {
      return res.json({ data: emptyPerformance(voucher) });
    }

    const [stats] = await Order.aggregate([
      {
        $match: {
          order_status: { $ne: 'canceled' },
          $expr: { $eq: [{ $toUpper: { $ifNull: ['$coupon.code', ''] } }, voucher.code] }
        }
      },
      {
        $facet: {
          totals: [{
            $group: {
              _id: null,
              orders: { $sum: 1 },
              discounted: { $sum: { $ifNull: ['$pricing.discount_amount', 0] } },
              revenue: { $sum: { $ifNull: ['$pricing.total', 0] } }
            }
          }],
          days: [{
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'Asia/Ho_Chi_Minh' }
              },
              count: { $sum: 1 }
            }
          }]
        }
      }
    ]);

    const totals = stats?.totals?.[0] || { orders: 0, discounted: 0, revenue: 0 };
    const dayCounts = {};
    for (const day of stats?.days || []) {
      if (day._id) dayCounts[day._id] = day.count;
    }
    const range = voucherService.performanceWindow(voucher);
    const buckets = voucherService.bucketUsage(dayCounts, range.start, range.end);
    const round = (amount) => Math.round((Number(amount) || 0) * 100) / 100;

    res.json({
      data: {
        code: voucher.code,
        used_count: voucher.used_count || 0,
        usage_limit: voucher.usage_limit ?? null,
        times_used: totals.orders || 0,
        total_discounted: round(totals.discounted),
        revenue: round(totals.revenue),
        range_from: range.start,
        range_to: range.end,
        buckets: buckets.map((bucket) => ({
          start: bucket.start,
          end: bucket.end,
          count: bucket.count
        }))
      }
    });
  } catch (error) {
    console.error('Error loading voucher performance:', error);
    res.status(500).json({ error: 'Performance could not be loaded.' });
  }
}

module.exports = {
  listVouchers,
  createVoucher,
  updateVoucher,
  stopVoucher,
  voucherPerformance
};
