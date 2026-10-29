const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');
const AiChatSession = require('../models/AiChatSession');
const { emitChatEvent } = require('../services/socket.service');

// Staff management (Admin CC only): create, change role, disable / enable, reset password.
// Rules: one role per account, an Admin CC cannot change their own role or disable themselves,
// and there is always at least one active Admin CC.

const STAFF_ROLES = ['admin_cc', 'cskh', 'qlsp'];
const STAFF_FIELDS = 'user_id email profile_name avatar_url role status suspended_reason suspended_at must_change_password last_login_at createdAt';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SPARSE_UNIQUE_FIELDS = ['phone', 'community_name', 'referral_code'];

// 12 characters (login accepts 8-15, no spaces), always with upper, lower and a digit.
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 9 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function nextUserId() {
  const last = await User.findOne({ user_id: /^USR\d+$/ }, 'user_id').sort({ user_id: -1 }).lean();
  const next = last ? parseInt(last.user_id.slice(3), 10) + 1 : 1;
  return `USR${String(next).padStart(5, '0')}`;
}

function toStaffRow(user) {
  return {
    user_id: user.user_id,
    email: user.email || '',
    profile_name: user.profile_name,
    avatar_url: user.avatar_url || null,
    role: user.role === 'admin' ? 'admin_cc' : user.role,
    status: user.status === 'suspended' ? 'disabled' : 'active',
    disabled_reason: user.suspended_reason || null,
    disabled_at: user.suspended_at || null,
    must_change_password: !!user.must_change_password,
    last_login_at: user.last_login_at || null,
    created_at: user.createdAt || null
  };
}

async function findStaff(userId) {
  return User.findOne({ user_id: String(userId || ''), role: { $in: [...STAFF_ROLES, 'admin'] } });
}

// The JWT of an admin carries the Mongo _id; compare against both ids.
function isSelf(req, staff) {
  const me = String(req.user?.user_id || '');
  return me === String(staff._id) || me === staff.user_id;
}

async function isLastActiveAdminCc(staff) {
  if (!['admin_cc', 'admin'].includes(staff.role) || staff.status === 'suspended') return false;
  const others = await User.countDocuments({ _id: { $ne: staff._id }, role: { $in: ['admin_cc', 'admin'] }, status: 'active' });
  return others === 0;
}

// Work the staff member has picked up and not finished. Chats are claimed with the admin's Mongo _id.
async function getOpenWork(staff) {
  const openChats = await ChatConversation.countDocuments({ agent_id: { $in: [String(staff._id), staff.user_id] }, status: 'open' });
  return { open_chats: openChats };
}

// Hand claimed chats back to the waiting queue so another agent can pick them up.
async function returnWorkToQueue(staff) {
  const agentIds = [String(staff._id), staff.user_id];
  const chats = await ChatConversation.find({ agent_id: { $in: agentIds }, status: 'open' });
  for (const chat of chats) {
    chat.agent_id = null;
    chat.status = 'waiting';
    await chat.save();
    if (chat.ai_session_id) {
      await AiChatSession.updateOne({ session_id: chat.ai_session_id }, { $set: { status: 'waiting', assigned_admin_id: null } });
    }
    emitChatEvent('chat_updated', chat.toObject());
  }
  return chats.length;
}

// GET /api/admin/staff?q=
async function listStaff(req, res) {
  try {
    const query = { role: { $in: [...STAFF_ROLES, 'admin'] } };
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q) {
      const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ profile_name: pattern }, { email: pattern }];
    }
    const staff = await User.find(query, STAFF_FIELDS).sort({ status: 1, createdAt: 1 }).lean();
    res.json({ data: staff.map(toStaffRow), total: staff.length });
  } catch (error) {
    console.error('Error listing staff:', error);
    res.status(500).json({ error: 'Failed to load staff.' });
  }
}

// POST /api/admin/staff  { profile_name, email, role } -> returns the temporary password once
async function createStaff(req, res) {
  try {
    const profileName = String(req.body?.profile_name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || '');
    if (!profileName) return res.status(400).json({ error: 'Full name is required.' });
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: 'Please choose a role.' });
    const existing = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, 'role').lean();
    if (existing) {
      const owner = STAFF_ROLES.includes(existing.role) || existing.role === 'admin' ? 'a staff account' : 'a customer account';
      return res.status(409).json({ error: `This email is already used by ${owner}.`, code: 'EMAIL_EXISTS' });
    }

    const tempPassword = generateTempPassword();
    const staff = new User({
      user_id: await nextUserId(),
      email,
      profile_name: profileName,
      password_hash: await bcrypt.hash(tempPassword, 10),
      role,
      status: 'active',
      must_change_password: true
    });
    await staff.validate();
    // phone / community_name / referral_code have unique sparse indexes: a stored null still counts
    // as a value, so a second account with null would clash. Leave the fields out instead.
    const doc = staff.toObject();
    for (const field of SPARSE_UNIQUE_FIELDS) {
      if (doc[field] == null) delete doc[field];
    }
    const now = new Date();
    await User.collection.insertOne({ ...doc, createdAt: now, updatedAt: now });
    staff.createdAt = now;

    await req.writeActivityLog({
      actionType: 'staff.create', targetEntity: 'user', targetId: staff.user_id,
      newValue: { email, profile_name: profileName, role }
    });
    res.status(201).json({ data: toStaffRow(staff.toObject()), temp_password: tempPassword });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'field';
      console.error(`Duplicate ${field} while creating staff:`, error.keyValue);
      return res.status(409).json({
        error: field === 'email' ? 'This email is already used by another account.' : `Could not create the account: duplicate ${field}.`,
        code: 'DUPLICATE_KEY'
      });
    }
    console.error('Error creating staff:', error);
    res.status(500).json({ error: 'Failed to create staff account.' });
  }
}

// GET /api/admin/staff/:userId/open-work -> shown as a warning before changing role / disabling
async function getStaffOpenWork(req, res) {
  try {
    const staff = await findStaff(req.params.userId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
    res.json({ data: await getOpenWork(staff) });
  } catch (error) {
    console.error('Error loading staff work:', error);
    res.status(500).json({ error: 'Failed to load open work.' });
  }
}

// PATCH /api/admin/staff/:userId/role  { role }
async function changeStaffRole(req, res) {
  try {
    const role = String(req.body?.role || '');
    if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: 'Please choose a role.' });
    const staff = await findStaff(req.params.userId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
    if (isSelf(req, staff)) return res.status(400).json({ error: 'You cannot change your own role.', code: 'SELF_ROLE_CHANGE' });

    const oldRole = staff.role === 'admin' ? 'admin_cc' : staff.role;
    if (oldRole === role) return res.status(400).json({ error: 'This account already has that role.' });
    if (oldRole === 'admin_cc' && await isLastActiveAdminCc(staff)) {
      return res.status(409).json({ error: 'There must always be at least one active Admin CC.', code: 'LAST_ADMIN_CC' });
    }

    staff.role = role;
    // Chat scope only applies to CSKH; a new role starts without inherited customers.
    staff.assigned_chat_customer_ids = [];
    await staff.save();
    const returnedChats = await returnWorkToQueue(staff);

    await req.writeActivityLog({
      actionType: 'staff.change_role', targetEntity: 'user', targetId: staff.user_id,
      oldValue: { role: oldRole }, newValue: { role, returned_chats: returnedChats }
    });
    res.json({ data: toStaffRow(staff.toObject()), returned_chats: returnedChats });
  } catch (error) {
    console.error('Error changing staff role:', error);
    res.status(500).json({ error: 'Failed to change role.' });
  }
}

// PATCH /api/admin/staff/:userId/status  { status: 'disabled' | 'active', reason }
async function setStaffStatus(req, res) {
  try {
    const status = String(req.body?.status || '');
    if (!['disabled', 'active'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (status === 'disabled' && !reason) return res.status(400).json({ error: 'A reason is required to disable an account.' });

    const staff = await findStaff(req.params.userId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
    if (isSelf(req, staff)) return res.status(400).json({ error: 'You cannot disable your own account.', code: 'SELF_DISABLE' });

    const oldStatus = staff.status === 'suspended' ? 'disabled' : 'active';
    if (oldStatus === status) return res.json({ data: toStaffRow(staff.toObject()), returned_chats: 0 });
    if (status === 'disabled' && await isLastActiveAdminCc(staff)) {
      return res.status(409).json({ error: 'There must always be at least one active Admin CC.', code: 'LAST_ADMIN_CC' });
    }

    let returnedChats = 0;
    if (status === 'disabled') {
      staff.status = 'suspended';
      staff.suspended_reason = reason;
      staff.suspended_by = String(req.user.user_id);
      staff.suspended_at = new Date();
      await staff.save();
      returnedChats = await returnWorkToQueue(staff);
    } else {
      staff.status = 'active';
      staff.suspended_reason = null;
      staff.suspended_by = null;
      staff.suspended_at = null;
      await staff.save();
    }

    await req.writeActivityLog({
      actionType: status === 'disabled' ? 'staff.disable' : 'staff.enable', targetEntity: 'user', targetId: staff.user_id,
      oldValue: { status: oldStatus }, newValue: { status, returned_chats: returnedChats }, reason: reason || null
    });
    res.json({ data: toStaffRow(staff.toObject()), returned_chats: returnedChats });
  } catch (error) {
    console.error('Error updating staff status:', error);
    res.status(500).json({ error: 'Failed to update account status.' });
  }
}

// POST /api/admin/staff/:userId/reset-password -> new temporary password, shown once
async function resetStaffPassword(req, res) {
  try {
    const staff = await findStaff(req.params.userId);
    if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
    if (isSelf(req, staff)) return res.status(400).json({ error: 'Use Change password to update your own password.' });

    const tempPassword = generateTempPassword();
    staff.password_hash = await bcrypt.hash(tempPassword, 10);
    staff.must_change_password = true;
    await staff.save();

    await req.writeActivityLog({ actionType: 'staff.reset_password', targetEntity: 'user', targetId: staff.user_id });
    res.json({ data: toStaffRow(staff.toObject()), temp_password: tempPassword });
  } catch (error) {
    console.error('Error resetting staff password:', error);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
}

module.exports = {
  listStaff,
  createStaff,
  getStaffOpenWork,
  changeStaffRole,
  setStaffStatus,
  resetStaffPassword,
  generateTempPassword
};
