const Report = require('../models/Report');
const User = require('../models/User');
const { createNotification } = require('./notification.service');

// How many reports a customer can send, and what happens to those who keep reporting nothing:
//   Normally:                  10 reports a day
//   5 dismissed in a row:      one warning, then 3 reports every 30 days from that moment on
// This is separate from community_warnings, so it never raises the customer's penalty level.
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 10;
const DISMISSED_STREAK = 5;
const WARNED_LIMIT = 3;
const WARNED_WINDOW_DAYS = 30;

const WARNING_MESSAGE = `Your last ${DISMISSED_STREAK} reports were dismissed because they did not break our community guidelines. `
  + `Please report only real violations. You can now send ${WARNED_LIMIT} reports every ${WARNED_WINDOW_DAYS} days.`;

// Returns the message to show when the limit is reached, otherwise null.
async function reportLimitMessage(reporterId, now = new Date()) {
  const user = await User.findOne({ user_id: reporterId }, 'report_warned_at').lean();
  const warnedAt = user?.report_warned_at;
  const windowMs = (warnedAt ? WARNED_WINDOW_DAYS : 1) * DAY_MS;
  // Reports from before the warning were already judged, so they do not use up the new limit.
  const since = new Date(Math.max(now.getTime() - windowMs, warnedAt ? new Date(warnedAt).getTime() : 0));
  const used = await Report.countDocuments({ reporter_id: reporterId, created_at: { $gte: since } });
  if (warnedAt) return used >= WARNED_LIMIT ? `You can send ${WARNED_LIMIT} reports every ${WARNED_WINDOW_DAYS} days. Please try again later.` : null;
  return used >= DAILY_LIMIT ? `You can send ${DAILY_LIMIT} reports a day. Please try again tomorrow.` : null;
}

// Called after reports are rejected. Pending reports do not break a streak: they have no result yet.
async function warnReportAbusers(reporterIds) {
  for (const reporterId of reporterIds) {
    const latest = await Report.find({ reporter_id: reporterId, status: { $ne: 'pending' } }, 'status')
      .sort({ updated_at: -1 }).limit(DISMISSED_STREAK).lean();
    if (latest.length < DISMISSED_STREAK || latest.some((report) => report.status !== 'dismissed')) continue;

    // The filter makes sure a customer is warned only once.
    const claimed = await User.updateOne({ user_id: reporterId, report_warned_at: null }, { $set: { report_warned_at: new Date() } });
    if (claimed.modifiedCount) {
      await createNotification({ recipient_id: reporterId, type: 'COMMUNITY_MODERATION', message: WARNING_MESSAGE });
    }
  }
}

module.exports = { DAILY_LIMIT, DISMISSED_STREAK, WARNED_LIMIT, reportLimitMessage, warnReportAbusers };
