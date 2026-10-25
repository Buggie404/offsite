const { writeActivityLog, normalizeReason } = require('../services/activity-log.service');

// Makes the ActivityLogs writer available to authenticated admin controllers.
// Controllers call it right after a sensitive change is saved successfully. The change is already
// persisted then, so a failed log write is reported in the server log instead of failing the request.
function adminActivityLog({ requireReason = false, requireReasonForActions = [] } = {}) {
  return (req, res, next) => {
    if (!req.user?.user_id) return res.status(401).json({ error: 'Authentication is required.' });
    const reason = normalizeReason(req.body?.reason);
    const actionRequiresReason = requireReason || requireReasonForActions.includes(req.params.action);
    if (actionRequiresReason && !reason) return res.status(400).json({ error: 'A valid reason is required.' });

    req.writeActivityLog = async ({ actionType, targetEntity, targetId, oldValue, newValue, reason: explicitReason, ticketId } = {}) => {
      try {
        return await writeActivityLog({
          admin: req.user, actionType, targetEntity, targetId, oldValue, newValue, reason: explicitReason ?? reason, ticketId
        });
      } catch (error) {
        console.error(`ActivityLog write failed for ${actionType} ${targetId}:`, error);
        return null;
      }
    };

    next();
  };
}

module.exports = { adminActivityLog };
