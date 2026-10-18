const ActivityLog = require('../models/ActivityLog');

function snapshot(value) {
  if (value === undefined || value === null) return null;
  if (typeof value.toObject === 'function') return value.toObject();
  return JSON.parse(JSON.stringify(value));
}

async function writeActivityLog({ admin, actionType, targetEntity, targetId, oldValue = null, newValue = null }) {
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
    new_value: snapshot(newValue)
  });
}

module.exports = { writeActivityLog };
