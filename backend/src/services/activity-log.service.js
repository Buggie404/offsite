const ActivityLog = require('../models/ActivityLog');

function snapshot(value) {
  if (value === undefined || value === null) return null;
  if (typeof value.toObject === 'function') return value.toObject();
  return JSON.parse(JSON.stringify(value));
}

function normalizeReason(value) {
  if (typeof value !== 'string') return null;
  const reason = value.trim().replace(/\s+/g, ' ');
  return reason ? reason.slice(0, 500) : null;
}

async function writeActivityLog({ admin, actionType, targetEntity, targetId, oldValue = null, newValue = null, reason = null, ticketId = null, createdAt = null }) {
  if (!admin?.user_id || !admin?.role) {
    throw new Error('An authenticated admin is required to write an activity log.');
  }
  return ActivityLog.create({
    admin_id: String(admin.user_id),
    admin_role: admin.role,
    action_type: actionType,
    target_entity: targetEntity,
    target_id: String(targetId),
    old_value: snapshot(oldValue),
    new_value: snapshot(newValue),
    reason: normalizeReason(reason),
    ticket_id: ticketId || null,
    ...(createdAt ? { created_at: createdAt } : {})
  });
}

// The change is already saved when the log is written, so a failed write must not fail the request
// but must not be lost either: retry once, then keep the entry in memory and retry every minute.
// Admin CC sees how many are waiting via GET /admin/activity-logs (unsaved_count).
const RETRY_INTERVAL_MS = 60 * 1000;
const MAX_UNSAVED = 1000;
const unsavedLogs = [];
let retryTimer = null;

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    while (unsavedLogs.length) {
      try {
        await writeActivityLog(unsavedLogs[0]);
        unsavedLogs.shift();
      } catch (error) {
        console.error('ActivityLog retry failed, will try again:', error.message);
        return;
      }
    }
    clearInterval(retryTimer);
    retryTimer = null;
  }, RETRY_INTERVAL_MS);
  retryTimer.unref?.();
}

async function writeActivityLogReliably(entry) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await writeActivityLog(entry);
    } catch (error) {
      if (attempt === 2) {
        console.error(`ActivityLog write failed for ${entry.actionType} ${entry.targetId}; queued for retry:`, error);
      }
    }
  }
  if (unsavedLogs.length >= MAX_UNSAVED) {
    const dropped = unsavedLogs.shift();
    console.error(`ActivityLog retry queue full; dropped ${dropped.actionType} ${dropped.targetId}`);
  }
  // Keep the original time: the log records when the change happened, not when the retry succeeded.
  unsavedLogs.push({ ...entry, createdAt: entry.createdAt || new Date() });
  scheduleRetry();
  return null;
}

const unsavedActivityLogCount = () => unsavedLogs.length;

// ─── Legacy names, mapped when READING ─────────────────────────────────────────
// ActivityLogs are append-only (never updated or deleted), so Ritual Box logs written before
// the entity.action convention keep their stored SUBSCRIPTION_* action_type and 'subscription'
// target_entity. Lists, exports and filters show / match them under the current names instead.
const LEGACY_ACTION_TYPE_ALIASES = Object.freeze({
  SUBSCRIPTION_PAUSED: 'subscription.pause',
  SUBSCRIPTION_SKIPPED: 'subscription.skip',
  SUBSCRIPTION_RESUMED: 'subscription.unpause',
  SUBSCRIPTION_PROPOSAL_SENT: 'subscription.propose',
  SUBSCRIPTION_PROPOSAL_WITHDRAWN: 'subscription.withdraw_proposal',
  SUBSCRIPTION_CANCELLED: 'subscription.cancel',
  SUBSCRIPTION_NOTE_UPDATED: 'subscription.note',
  // Removed admin actions keep their meaning under the new scheme.
  SUBSCRIPTION_FREQUENCY_CHANGED: 'subscription.frequency',
  SUBSCRIPTION_REACTIVATED: 'subscription.reactivate'
});
const LEGACY_TARGET_ENTITY_ALIASES = Object.freeze({ subscription: 'Subscriptions' });

function legacyNamesFor(aliases, current) {
  return Object.keys(aliases).filter((legacy) => aliases[legacy] === current);
}

const canonicalActionType = (value) => LEGACY_ACTION_TYPE_ALIASES[value] || value;
const canonicalTargetEntity = (value) => LEGACY_TARGET_ENTITY_ALIASES[value] || value;

// Query value for a stored field: the name asked for plus any legacy name that maps to it.
function aliasQuery(aliases, value) {
  const name = String(value);
  const current = aliases[name] || name;
  const legacy = legacyNamesFor(aliases, current);
  return legacy.length ? { $in: [current, ...legacy] } : current;
}
const actionTypeQuery = (value) => aliasQuery(LEGACY_ACTION_TYPE_ALIASES, value);
const targetEntityQuery = (value) => aliasQuery(LEGACY_TARGET_ENTITY_ALIASES, value);

// A copy of a stored log with current names; the stored document is left untouched.
function presentActivityLog(log) {
  if (!log) return log;
  return {
    ...log,
    action_type: canonicalActionType(log.action_type),
    target_entity: canonicalTargetEntity(log.target_entity)
  };
}

module.exports = {
  writeActivityLog,
  writeActivityLogReliably,
  unsavedActivityLogCount,
  normalizeReason,
  LEGACY_ACTION_TYPE_ALIASES,
  canonicalActionType,
  actionTypeQuery,
  targetEntityQuery,
  presentActivityLog
};
