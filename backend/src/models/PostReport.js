const mongoose = require('mongoose');

const REPORT_REASONS = ['spam', 'inappropriate', 'off_topic', 'misleading', 'other'];

const postReportSchema = new mongoose.Schema({
  post_id: { type: String, required: true },
  reporter_id: { type: String, required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  note: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['pending', 'reviewed', 'dismissed'], default: 'pending' }
}, {
  collection: 'PostReports',
  timestamps: { createdAt: 'created_at', updatedAt: 'updatedAt' }
});

// One report per user per post.
postReportSchema.index({ post_id: 1, reporter_id: 1 }, { unique: true });

module.exports = mongoose.model('PostReport', postReportSchema);
module.exports.REPORT_REASONS = REPORT_REASONS;
