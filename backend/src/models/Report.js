const mongoose = require('mongoose');
const REPORT_REASONS = ['spam', 'inappropriate', 'off_topic', 'misleading', 'other'];
const schema = new mongoose.Schema({
  reporter_id: { type: String, required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  note: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['pending', 'reviewed', 'dismissed'], default: 'pending' }
}, { collection: 'Reports', discriminatorKey: 'target_type', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
// The same person can report a target again once their earlier report is closed and any penalty
// from it has run out (services/report-rereport.service), so only one open report per reporter and target.
// Existing databases: run scripts/allow-rereport.js to swap the old indexes for these.
for (const [type, field] of [['post', 'post_id'], ['comment', 'comment_id'], ['account', 'reported_user_id']]) {
  schema.index(
    { target_type: 1, [field]: 1, reporter_id: 1 },
    { unique: true, name: `${type}_report_open_unique`, partialFilterExpression: { target_type: type, status: 'pending' } }
  );
}
schema.index({ target_type: 1, status: 1, created_at: -1 });
schema.index({ reporter_id: 1, created_at: -1 });
module.exports = mongoose.model('Report', schema);
module.exports.REPORT_REASONS = REPORT_REASONS;
