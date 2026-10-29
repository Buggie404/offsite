const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');
const CustomerNote = require('../models/CustomerNote');

// Admin Customers (1.4): list, profile, lock / unlock, internal notes.
// Points / tier (group 6) and orders (group 3) are read here only, never changed.

const TIERS = ['Seed', 'Leaf', 'Bloom', 'Zen'];
const PAGE_SIZE = 20;
const RECENT_ORDERS = 5;
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'paused', 'payment_failed'];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function customerRow(user, stats = {}) {
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
    if (TIERS.includes(req.query.tier)) query.membership_tier = req.query.tier;
    if (req.query.status === 'suspended') query.status = 'suspended';
    if (req.query.status === 'active') query.status = { $ne: 'suspended' };

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
      User.find(query, 'user_id profile_name community_name email phone avatar_url membership_tier points status suspended_reason suspended_at createdAt')
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

// GET /api/admin/customers/:userId -> profile, Ritual Box count, recent orders, notes
async function getCustomer(req, res) {
  try {
    const customer = await User.findOne({ user_id: String(req.params.userId || ''), role: 'customer' }).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const userId = customer.user_id;
    const [orderCount, recentOrders, totals, ritualBoxes, notes] = await Promise.all([
      Order.countDocuments({ user_id: userId }),
      Order.find({ user_id: userId }, 'order_id created_at items.quantity pricing.total order_status')
        .sort({ created_at: -1 }).limit(RECENT_ORDERS).lean(),
      Order.aggregate([
        { $match: { user_id: userId, order_status: { $nin: ['canceled', 'refund'] } } },
        { $group: { _id: null, spent: { $sum: '$pricing.total' }, last_order_at: { $max: '$created_at' } } }
      ]),
      Subscription.countDocuments({ user_id: userId, status: { $in: ACTIVE_SUBSCRIPTION_STATUSES } }),
      CustomerNote.find({ customer_id: userId }).sort({ created_at: -1 }).limit(100).lean()
    ]);

    res.json({
      data: {
        ...customerRow(customer, { order_count: orderCount, last_order_at: totals[0]?.last_order_at }),
        total_spent: totals[0]?.spent || 0,
        ritual_boxes: ritualBoxes,
        recent_orders: recentOrders.map((order) => ({
          order_id: order.order_id,
          created_at: order.created_at,
          item_count: (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0),
          total: order.pricing?.total || 0,
          status: order.order_status
        })),
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

async function adminName(req) {
  const id = String(req.user?.user_id || '');
  const query = mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id) ? { _id: id } : { user_id: id };
  const admin = await User.findOne(query, 'profile_name email').lean();
  return admin?.profile_name || admin?.email || null;
}

// POST /api/admin/customers/:userId/notes  { content }
async function addCustomerNote(req, res) {
  try {
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

// PATCH /api/admin/customers/:userId/status  { status: 'suspended' | 'active', reason }
// A suspended customer is blocked at sign-in and on every authenticated request (auth.middleware).
async function setCustomerStatus(req, res) {
  try {
    const status = String(req.body?.status || '');
    if (!['suspended', 'active'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (status === 'suspended' && !reason) return res.status(400).json({ error: 'A reason is required to lock an account.' });

    const customer = await findCustomer(req.params.userId);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const oldStatus = customer.status === 'suspended' ? 'suspended' : 'active';
    if (oldStatus === status) return res.json({ data: customerRow(customer.toObject()) });

    if (status === 'suspended') {
      customer.status = 'suspended';
      customer.suspended_reason = reason;
      customer.suspended_by = String(req.user.user_id);
      customer.suspended_at = new Date();
    } else {
      customer.status = 'active';
      customer.suspended_reason = null;
      customer.suspended_by = null;
      customer.suspended_at = null;
    }
    await customer.save();

    await req.writeActivityLog({
      actionType: status === 'suspended' ? 'user.suspend' : 'user.unsuspend', targetEntity: 'user', targetId: customer.user_id,
      oldValue: { status: oldStatus }, newValue: { status }, reason: reason || null
    });
    res.json({ data: customerRow(customer.toObject()) });
  } catch (error) {
    console.error('Error updating customer status:', error);
    res.status(500).json({ error: 'Failed to update the account status.' });
  }
}

module.exports = { listCustomers, getCustomer, addCustomerNote, setCustomerStatus };
