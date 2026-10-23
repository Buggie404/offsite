const { writeActivityLog, normalizeReason } = require('../services/activity-log.service');

// Makes the ActivityLogs writer available to authenticated admin controllers.
// Controllers must call it immediately before persisting a sensitive change.
function adminActivityLog({ requireReason = false } = {}) {
  return (req, res, next) => {
    if (!req.user?.user_id) return res.status(401).json({ error: 'Authentication is required.' });
    const reason = normalizeReason(req.body?.reason);
    if (requireReason && !reason) return res.status(400).json({ error: 'A valid reason is required.' });

    req.writeActivityLog = ({ actionType, targetEntity, targetId, oldValue, newValue, reason: explicitReason } = {}) =>
      writeActivityLog({ admin: req.user, actionType, targetEntity, targetId, oldValue, newValue, reason: explicitReason ?? reason });

    next();
  };
}

module.exports = { adminActivityLog };
