const { writeActivityLogReliably, normalizeReason } = require('../services/activity-log.service');

// Makes the ActivityLogs writer available to authenticated admin controllers.
// Controllers call it right after a sensitive change is saved successfully. The change is already
// persisted then, so a failed log write is retried (see writeActivityLogReliably) instead of failing the request.
// requireReasonWhen(req): require a reason only for some requests on a route (e.g. one target status).
function adminActivityLog({ requireReason = false, requireReasonForActions = [], requireReasonWhen = null } = {}) {
  return (req, res, next) => {
    if (!req.user?.user_id) return res.status(401).json({ error: 'Authentication is required.' });
    const reason = normalizeReason(req.body?.reason);
    const actionRequiresReason = requireReason || requireReasonForActions.includes(req.params.action)
      || (typeof requireReasonWhen === 'function' && requireReasonWhen(req));
    if (actionRequiresReason && !reason) return res.status(400).json({ error: 'A valid reason is required.' });

    req.writeActivityLog = ({ actionType, targetEntity, targetId, oldValue, newValue, reason: explicitReason, ticketId } = {}) =>
      writeActivityLogReliably({
        admin: req.user, actionType, targetEntity, targetId, oldValue, newValue, reason: explicitReason ?? reason, ticketId
      });

    next();
  };
}

module.exports = { adminActivityLog };
