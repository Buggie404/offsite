const { resolveCommunityUserId } = require('../services/follow.service');
const { reportLimitMessage } = require('../services/report-abuse.service');

// Goes on every report route, after authMiddleware.
async function requireReportQuota(req, res, next) {
  try {
    const reporterId = await resolveCommunityUserId(req);
    const message = reporterId ? await reportLimitMessage(reporterId) : null;
    if (!message) return next();
    return res.status(429).json({ error: message, code: 'REPORT_LIMIT_REACHED' });
  } catch (error) {
    console.error('Error checking report limit:', error);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
}

module.exports = { requireReportQuota };
