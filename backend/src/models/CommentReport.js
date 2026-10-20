const mongoose = require('mongoose');
const { REPORT_REASONS } = require('./PostReport');

const commentReportSchema = new mongoose.Schema({
  comment_id: { type: String, required: true },
  post_id: { type: String, required: true },
  reporter_id: { type: String, required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  note: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['pending', 'reviewed', 'dismissed'], default: 'pending' }
}, {
  collection: 'CommentReports',
  timestamps: { createdAt: 'created_at', updatedAt: 'updatedAt' }
});

// One report per user per comment.
commentReportSchema.index({ comment_id: 1, reporter_id: 1 }, { unique: true });

module.exports = mongoose.model('CommentReport', commentReportSchema);
