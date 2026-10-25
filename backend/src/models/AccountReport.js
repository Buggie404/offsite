const mongoose = require('mongoose');
const { REPORT_REASONS } = require('./PostReport');

const accountReportSchema = new mongoose.Schema({
  reported_user_id: { type: String, required: true, index: true },
  reporter_id: { type: String, required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  note: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['pending', 'reviewed', 'dismissed'], default: 'pending' }
}, { collection: 'AccountReports', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

accountReportSchema.index({ reported_user_id: 1, reporter_id: 1 }, { unique: true });

module.exports = mongoose.model('AccountReport', accountReportSchema);
