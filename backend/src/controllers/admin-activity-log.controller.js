const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const { unsavedActivityLogCount } = require('../services/activity-log.service');

// Activity log (Admin CC only, read-only): filter by who, role, action and time; search target.
// Logs are append-only, so this controller never updates or deletes.

const ADMIN_ROLES = ['admin_cc', 'cskh', 'qlsp'];
const MAX_EXPORT_ROWS = 5000;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function asDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

// admin_id is whatever the admin's JWT carried: usually the Mongo _id, sometimes a user_id (USR...).
async function actorIdsFor(staffUserId) {
  const user = await User.findOne({ user_id: staffUserId }, '_id user_id').lean();
  return user ? [String(user._id), user.user_id] : [staffUserId];
}

async function buildFilter(query) {
  const filter = {};
  if (query.admin_id) filter.admin_id = { $in: await actorIdsFor(String(query.admin_id)) };
  if (ADMIN_ROLES.includes(query.admin_role)) filter.admin_role = query.admin_role;
  if (query.action_type) filter.action_type = String(query.action_type);
  if (query.target_entity) filter.target_entity = String(query.target_entity);
  if (query.target_id) filter.target_id = String(query.target_id);

  const from = asDate(query.from);
  const to = asDate(query.to);
  if (from || to) filter.created_at = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const q = String(query.q || '').trim().slice(0, 80);
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ target_id: pattern }, { target_entity: pattern }, { reason: pattern }, { ticket_id: pattern }];
  }
  return filter;
}

function staffName(user) {
  return user?.profile_name || user?.email || null;
}

// Name / email for the admins who acted and for user targets (staff, customers), in two queries.
async function enrich(logs) {
  const actorIds = [...new Set(logs.map((log) => log.admin_id))];
  const objectIds = actorIds.filter((id) => mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id));
  const userTargetIds = [...new Set(logs.filter((log) => /^users?$/i.test(log.target_entity)).map((log) => log.target_id))];

  const [actors, targets] = await Promise.all([
    actorIds.length
      ? User.find({ $or: [{ _id: { $in: objectIds } }, { user_id: { $in: actorIds } }] }, 'user_id profile_name email role').lean()
      : [],
    userTargetIds.length ? User.find({ user_id: { $in: userTargetIds } }, 'user_id profile_name community_name email').lean() : []
  ]);

  const actorById = new Map();
  for (const actor of actors) {
    actorById.set(String(actor._id), actor);
    actorById.set(actor.user_id, actor);
  }
  const targetById = new Map(targets.map((target) => [target.user_id, target]));

  return logs.map((log) => {
    const actor = actorById.get(log.admin_id);
    const target = targetById.get(log.target_id);
    return {
      log_id: log.log_id,
      created_at: log.created_at,
      action_type: log.action_type,
      target_entity: log.target_entity,
      target_id: log.target_id,
      target_label: target ? (target.community_name ? `@${target.community_name}` : staffName(target)) : null,
      old_value: log.old_value,
      new_value: log.new_value,
      reason: log.reason,
      ticket_id: log.ticket_id,
      // Role at the time of the action (stored on the log), not the person's current role.
      actor: {
        id: log.admin_id,
        user_id: actor?.user_id || null,
        name: staffName(actor) || 'Unknown admin',
        email: actor?.email || null,
        role: log.admin_role
      }
    };
  });
}

// Filter dropdowns: everyone who has acted (plus current staff) and every action type logged so far.
async function getFacets() {
  const [actionTypes, actorIds, staff] = await Promise.all([
    ActivityLog.distinct('action_type'),
    ActivityLog.distinct('admin_id'),
    User.find({ role: { $in: [...ADMIN_ROLES, 'admin'] } }, 'user_id profile_name email role').lean()
  ]);
  const known = new Map(staff.map((user) => [String(user._id), user]));
  for (const user of staff) known.set(user.user_id, user);

  const missingIds = actorIds.filter((id) => !known.has(id));
  const objectIds = missingIds.filter((id) => /^[0-9a-f]{24}$/i.test(id));
  if (missingIds.length) {
    const former = await User.find({ $or: [{ _id: { $in: objectIds } }, { user_id: { $in: missingIds } }] }, 'user_id profile_name email role').lean();
    for (const user of former) {
      known.set(String(user._id), user);
      known.set(user.user_id, user);
    }
  }

  const people = new Map();
  for (const user of known.values()) {
    if (user.user_id) people.set(user.user_id, { user_id: user.user_id, name: staffName(user) || user.user_id });
  }
  return {
    action_types: actionTypes.filter(Boolean).sort(),
    actors: [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
}

// GET /api/admin/activity-logs?page=&limit=&q=&admin_id=&admin_role=&action_type=&from=&to=&include_facets=true
async function listActivityLogs(req, res) {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 200);
    const filter = await buildFilter(req.query);
    const [total, logs, facets] = await Promise.all([
      ActivityLog.countDocuments(filter),
      ActivityLog.find(filter).sort({ created_at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      req.query.include_facets === 'true' ? getFacets() : null
    ]);
    res.json({
      total,
      page,
      limit,
      data: await enrich(logs),
      ...(facets ? { facets } : {}),
      // Logs whose write failed and are still waiting to be retried; the change itself was saved.
      unsaved_count: unsavedActivityLogCount()
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to retrieve activity logs.' });
  }
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// GET /api/admin/activity-logs/export -> CSV with the same filters (newest first, capped)
async function exportActivityLogs(req, res) {
  try {
    const filter = await buildFilter(req.query);
    const logs = await ActivityLog.find(filter).sort({ created_at: -1, _id: -1 }).limit(MAX_EXPORT_ROWS).lean();
    const rows = await enrich(logs);
    const header = ['time', 'admin', 'admin_email', 'admin_role', 'action_type', 'target_entity', 'target_id', 'target_label', 'old_value', 'new_value', 'reason', 'ticket_id'];
    const lines = rows.map((row) => [
      new Date(row.created_at).toISOString(), row.actor.name, row.actor.email, row.actor.role, row.action_type,
      row.target_entity, row.target_id, row.target_label, row.old_value, row.new_value, row.reason, row.ticket_id
    ].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    // BOM so Excel opens Vietnamese names correctly
    res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
  } catch (error) {
    console.error('Error exporting activity logs:', error);
    res.status(500).json({ error: 'Failed to export activity logs.' });
  }
}

module.exports = { listActivityLogs, exportActivityLogs, csvCell };
