// Community penalties. A suspension limits Community only: the customer still signs in and shops.
//   Level 1 warn:       warning, content hidden
//   Level 2 suspend_3d: 3 days, cannot post or comment
//   Level 3 suspend_7d: 7 days, can only view Community
// Every check compares `until` with the current time, so a suspension ends by itself with no job.
const DAY_MS = 24 * 60 * 60 * 1000;

const PENALTIES = {
  warn: { level: 1, days: 0 },
  suspend_3d: { level: 2, days: 3 },
  suspend_7d: { level: 3, days: 7 }
};
const ACTION_BY_LEVEL = { 1: 'warn', 2: 'suspend_3d', 3: 'suspend_7d' };
// Severity of a reason on its own: misleading starts at level 2, inappropriate at level 3.
const LEVEL_BY_REASON = { misleading: 2, inappropriate: 3 };

function activeRestriction(user, now = new Date()) {
  const restriction = user?.community_restriction;
  return restriction?.until && new Date(restriction.until) > now ? restriction : null;
}

// 'write' is posting and commenting, 'interact' is everything else that is not just viewing.
function isBlocked(restriction, kind) {
  if (!restriction) return false;
  return kind === 'write' || restriction.level >= 3;
}

// A new penalty during a suspension never shortens or softens it.
function nextRestriction(current, penalty, { reason, adminId, now = new Date() }) {
  const until = new Date(now.getTime() + penalty.days * DAY_MS);
  const active = activeRestriction({ community_restriction: current }, now);
  return {
    level: Math.max(penalty.level, active?.level || 0),
    until: active && new Date(active.until) > until ? new Date(active.until) : until,
    reason,
    admin_id: adminId,
    created_at: now
  };
}

function reasonLevel(reason) {
  return LEVEL_BY_REASON[reason] || 1;
}

// Earlier violations set the minimum level; a severe reason can raise it.
function recommendedAction(earlierViolations, reason) {
  const byHistory = Math.min(earlierViolations + 1, 3);
  return ACTION_BY_LEVEL[Math.max(byHistory, reasonLevel(reason))];
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// No mail or SMS provider yet: simulated in the server log, like the OTP codes.
function sendSimulatedNotice(user, message) {
  const channel = user?.email ? 'EMAIL' : user?.phone ? 'SMS' : null;
  if (channel) console.log(`[SIMULATED ${channel}] ${user.email || user.phone} -> ${message}`);
  return channel;
}

module.exports = { PENALTIES, activeRestriction, isBlocked, nextRestriction, reasonLevel, recommendedAction, formatDate, sendSimulatedNotice };
