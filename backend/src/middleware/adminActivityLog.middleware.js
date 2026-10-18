const { writeActivityLog } = require('../services/activity-log.service');

// Makes the ActivityLogs writer available to authenticated admin controllers.
// Controllers must call it immediately before persisting a sensitive change.
function adminActivityLog(req, res, next) {
  if (!req.user?.user_id) {
    return res.status(401).json({ error: 'Authentication is required.' });
  }

  req.writeActivityLog = ({ actionType, targetEntity, targetId, oldValue, newValue }) =>
    writeActivityLog({ admin: req.user, actionType, targetEntity, targetId, oldValue, newValue });

  next();
}

module.exports = { adminActivityLog };
