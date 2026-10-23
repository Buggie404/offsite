const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  log_id: { type: String, required: true, unique: true, default: () => new mongoose.Types.ObjectId().toString() },
  admin_id: { type: String, required: true, index: true },
  admin_role: { type: String, required: true, enum: ['admin_cc', 'cskh', 'qlsp'] },
  action_type: { type: String, required: true, index: true },
  target_entity: { type: String, required: true },
  target_id: { type: String, required: true, index: true },
  old_value: { type: mongoose.Schema.Types.Mixed, default: null },
  new_value: { type: mongoose.Schema.Types.Mixed, default: null },
  reason: { type: String, default: null, maxlength: 500 },
  created_at: { type: Date, default: Date.now, immutable: true }
}, { collection: 'ActivityLogs', versionKey: false });

activityLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
