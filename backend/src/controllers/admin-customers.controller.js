const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');
const CustomerNote = require('../models/CustomerNote');
const { activeRestriction } = require('../services/community-restriction.service');
const Voucher = require('../models/Voucher');
const ChatConversation = require('../models/ChatConversation');

async function scopedCustomerIds(req) {
  if (req.user.role !== 'cskh') return null;
  const id = String(req.user.user_id || '');
  const staff = await User.findOne(/^[a-f0-9]{24}$/i.test(id) ? { _id: id } : { user_id: id }, 'user_id assigned_chat_customer_ids').lean();
  if (!staff) return [];
  return staff.assigned_chat_customer_ids || [];
}

async function canReadCustomer(req, userId) {
  const scoped = await scopedCustomerIds(req);
  if (!scoped || scoped.includes(userId)) return true;
  const identity = String(req.user.user_id || '');
  const staff = await User.findOne(/^[a-f0-9]{24}$/i.test(identity) ? { _id: identity } : { user_id: identity }, 'user_id _id').lean();
  if (!staff) return false;
  const agentIds = [...new Set([identity, staff.user_id, staff._id?.toString()].filter(Boolean))];
  return !!(await ChatConversation.exists({ customer_id: String(userId), agent_id: { $in: agentIds }, status: { $in: ['open', 'closed'] } }));
}

// Admin Customers (1.4): list, profile, unlock, internal notes.
// Points / tier (group 6) and orders (group 3) are read here only, never changed.

const TIERS = ['Seed', 'Leaf', 'Bloom', 'Zen'];
const PAGE_SIZE = 20;
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'paused', 'payment_failed'];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function customerRow(user, stats = {}) {
  const restriction = activeRestriction(user);
  return {
    user_id: user.user_id,
    profile_name: user.profile_name,
    community_name: user.community_name || null,
    email: user.email || null,
    phone: user.phone || null,
    avatar_url: user.avatar_url || null,
    membership_tier: user.membership_tier || 'Seed',
    points: user.points || 0,
    status: user.status === 'suspended' ? 'suspended' : 'active',
    suspended_reason: user.suspended_reason || null,
    suspended_at: user.suspended_at || null,
    restricted_until: restriction?.until || null,
    restricted_reason: restriction?.reason || null,
    created_at: user.createdAt || null,
    order_count: stats.order_count || 0,
    last_order_at: stats.last_order_at || null
  };
}

async function findCustomer(userId) {
  return User.findOne({ user_id: String(userId || ''), role: 'customer' });
}

// GET /api/admin/customers?q=&tier=&status=&page=
async function listCustomers(req, res) {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const query = { role: 'customer' };
    const scoped = await scopedCustomerIds(req);
    if (scoped) query.user_id = { $in: scoped };
    if (TIERS.includes(req.query.tier)) query.membership_tier = req.query.tier;
    // Suspended: restricted in Community right now, or locked before locking was removed.
    const now = new Date();
    if (req.query.status === 'suspended') {
      query.$and = [{ $or: [{ status: 'suspended' }, { 'community_restriction.until': { $gt: now } }] }];
    }
    if (req.query.status === 'active') {
      query.status = { $ne: 'suspended' };
      query['community_restriction.until'] = { $not: { $gt: now } };
    }

    const q = String(req.query.q || '').trim().replace(/^@/, '').slice(0, 80);
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      const digits = q.replace(/\D/g, '');
      query.$or = [
        { profile_name: pattern }, { community_name: pattern }, { email: pattern }, { user_id: pattern },
        ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRegex(digits)) }] : [])
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query, 'user_id profile_name community_name email phone avatar_url membership_tier points status suspended_reason suspended_at community_restriction createdAt')
        .sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean()
    ]);

    const ids = users.map((user) => user.user_id);
    const stats = ids.length
      ? await Order.aggregate([
        { $match: { user_id: { $in: ids } } },
        { $group: { _id: '$user_id', order_count: { $sum: 1 }, last_order_at: { $max: '$created_at' } } }
      ])
      : [];
    const statsById = new Map(stats.map((row) => [row._id, row]));

    res.json({
      data: users.map((user) => customerRow(user, statsById.get(user.user_id))),
      total,
      page,
      limit: PAGE_SIZE
    });
  } catch (error) {
    console.error('Error listing customers:', error);
    res.status(500).json({ error: 'Failed to load customers.' });
  }
}

function orderRow(order) {
  return {
    order_id: order.order_id,
    created_at: order.created_at,
    item_count: (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0),
    total: order.pricing?.total || 0,
    status: order.order_status
  };
}

// GET /api/admin/customers/:userId -> profile, Ritual Box count, notes (orders come from /orders)
async function getCustomer(req, res) {
  try {
    if (!(await canReadCustomer(req, req.params.userId))) return res.status(403).json({ error: 'This customer is not assigned to you.' });
    const customer = await User.findOne({ user_id: String(req.params.userId || ''), role: 'customer' }).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const userId = customer.user_id;
    const [orderCount, totals, ritualBoxes, notes, vouchers, pastChats] = await Promise.all([
      Order.countDocuments({ user_id: userId }),
      Order.aggregate([
        { $match: { user_id: userId, order_status: { $nin: ['canceled', 'refund'] } } },
        { $group: { _id: null, spent: { $sum: '$pricing.total' }, last_order_at: { $max: '$created_at' } } }
      ]),
      Subscription.countDocuments({ user_id: userId, status: { $in: ACTIVE_SUBSCRIPTION_STATUSES } }),
      CustomerNote.find({ customer_id: userId }).sort({ created_at: -1 }).limit(100).lean(),
      Voucher.find({ assigned_user_id: userId }, 'code title discount_type discount_value is_active valid_from valid_to used_count usage_limit purpose').sort({ createdAt: -1 }).limit(50).lean(),
      ChatConversation.countDocuments({ customer_id: userId, status: 'closed' })
    ]);

    res.json({
      data: {
        ...customerRow(customer, { order_count: orderCount, last_order_at: totals[0]?.last_order_at }),
        total_spent: totals[0]?.spent || 0,
        ritual_boxes: ritualBoxes,
        past_chats: pastChats,
        vouchers,
        violations: (customer.community_warnings || []).map(warning => ({ reason: warning.reason, level: warning.level, created_at: warning.created_at })),
        notes: notes.map((note) => ({
          note_id: note.note_id,
          content: note.content,
          author_name: note.author_name,
          author_role: note.author_role,
          created_at: note.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Error loading customer:', error);
    res.status(500).json({ error: 'Failed to load customer.' });
  }
}

// GET /api/admin/customers/:userId/orders?page= -> every order of the customer, newest first, 20 a page
async function listCustomerOrders(req, res) {
  try {
    if (!(await canReadCustomer(req, req.params.userId))) return res.status(403).json({ error: 'This customer is not assigned to you.' });
    const customer = await User.findOne({ user_id: String(req.params.userId || ''), role: 'customer' }, 'user_id').lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const query = { user_id: customer.user_id };
    const [total, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query, 'order_id created_at items.quantity pricing.total order_status')
        .sort({ created_at: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean()
    ]);
    res.json({ data: orders.map(orderRow), total, page, limit: PAGE_SIZE });
  } catch (error) {
    console.error('Error loading customer orders:', error);
    res.status(500).json({ error: 'Failed to load orders.' });
  }
}

async function adminName(req) {
  const id = String(req.user?.user_id || '');
  const query = mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id) ? { _id: id } : { user_id: id };
  const admin = await User.findOne(query, 'profile_name email').lean();
  return admin?.profile_name || admin?.email || null;
}

// POST /api/admin/customers/:userId/notes  { content }
async function addCustomerNote(req, res) {
  try {
    const scoped = await scopedCustomerIds(req);
    if (scoped && !scoped.includes(req.params.userId)) return res.status(403).json({ error: 'This customer is not assigned to you.' });
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'The note cannot be empty.' });
    if (content.length > 1000) return res.status(400).json({ error: 'Notes are limited to 1,000 characters.' });
    const customer = await findCustomer(req.params.userId);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const note = await CustomerNote.create({
      customer_id: customer.user_id,
      author_id: String(req.user.user_id),
      author_name: await adminName(req),
      author_role: req.user.role,
      content
    });
    await req.writeActivityLog({
      actionType: 'customer.add_note', targetEntity: 'user', targetId: customer.user_id, newValue: { note: content }
    });
    res.status(201).json({
      data: { note_id: note.note_id, content: note.content, author_name: note.author_name, author_role: note.author_role, created_at: note.created_at }
    });
  } catch (error) {
    console.error('Error adding customer note:', error);
    res.status(500).json({ error: 'Failed to add the note.' });
  }
}

// PATCH /api/admin/customers/:userId/status  { status: 'active', reason }
// No admin can lock a customer account. Unlocking stays, for accounts locked before this rule.
async function setCustomerStatus(req, res) {
  try {
    const status = String(req.body?.status || '');
    if (status === 'suspended') return res.status(403).json({ error: 'Customer accounts cannot be locked.', code: 'CUSTOMER_LOCK_DISABLED' });
    if (status !== 'active') return res.status(400).json({ error: 'Invalid status.' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500);

    const customer = await findCustomer(req.params.userId);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    if (customer.status !== 'suspended') return res.json({ data: customerRow(customer.toObject()) });

    customer.status = 'active';
    customer.suspended_reason = null;
    customer.suspended_by = null;
    customer.suspended_at = null;
    await customer.save();

    await req.writeActivityLog({
      actionType: 'user.unsuspend', targetEntity: 'user', targetId: customer.user_id,
      oldValue: { status: 'suspended' }, newValue: { status }, reason: reason || null
    });
    res.json({ data: customerRow(customer.toObject()) });
  } catch (error) {
    console.error('Error updating customer status:', error);
    res.status(500).json({ error: 'Failed to update the account status.' });
  }
}

module.exports = { listCustomers, getCustomer, listCustomerOrders, addCustomerNote, setCustomerStatus };
