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

module.exports = { writeActivityLog, writeActivityLogReliably, unsavedActivityLogCount, normalizeReason };
