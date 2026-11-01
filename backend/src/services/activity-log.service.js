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

// Logs are append-only, so a renamed action never touches old rows: add the old name here instead.
// Reads then show the new name, and filtering by the new name also finds the old rows.
const LEGACY_ACTION_TYPE_ALIASES = {
  SUBSCRIPTION_PAUSED: 'subscription.pause',
  SUBSCRIPTION_SKIPPED: 'subscription.skip',
  SUBSCRIPTION_RESUMED: 'subscription.unpause',
  SUBSCRIPTION_PROPOSAL_SENT: 'subscription.propose',
  SUBSCRIPTION_PROPOSAL_WITHDRAWN: 'subscription.withdraw_proposal',
  SUBSCRIPTION_CANCELLED: 'subscription.cancel',
  SUBSCRIPTION_NOTE_UPDATED: 'subscription.note',
  // Removed admin actions (before 9e34316) keep their meaning under the new scheme.
  SUBSCRIPTION_FREQUENCY_CHANGED: 'subscription.frequency',
  SUBSCRIPTION_REACTIVATED: 'subscription.reactivate'
};
// The SUBSCRIPTION_* logs above were written with this target_entity.
const LEGACY_TARGET_ENTITY = 'subscription';
const TARGET_ENTITY = 'Subscriptions';

const canonicalActionType = (type) => (Object.hasOwn(LEGACY_ACTION_TYPE_ALIASES, type) ? LEGACY_ACTION_TYPE_ALIASES[type] : type);

// Mongo condition matching an action under its current name and every older one.
function actionTypeQuery(type) {
  const canonical = canonicalActionType(type);
  const legacy = Object.keys(LEGACY_ACTION_TYPE_ALIASES).filter((name) => LEGACY_ACTION_TYPE_ALIASES[name] === canonical);
  return legacy.length ? { $in: [canonical, ...legacy] } : canonical;
}

function targetEntityQuery(entity) {
  return entity === TARGET_ENTITY || entity === LEGACY_TARGET_ENTITY ? { $in: [TARGET_ENTITY, LEGACY_TARGET_ENTITY] } : entity;
}

// The row as it is shown or exported; the stored log stays as written.
function presentActivityLog(log) {
  return {
    ...log,
    action_type: canonicalActionType(log.action_type),
    target_entity: log.target_entity === LEGACY_TARGET_ENTITY ? TARGET_ENTITY : log.target_entity
  };
}

module.exports = {
  writeActivityLog, writeActivityLogReliably, unsavedActivityLogCount, normalizeReason,
  LEGACY_ACTION_TYPE_ALIASES, canonicalActionType, actionTypeQuery, targetEntityQuery, presentActivityLog
};
