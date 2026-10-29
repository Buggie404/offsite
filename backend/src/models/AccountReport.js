const mongoose = require('mongoose');
const Report = require('./Report');
const schema = new mongoose.Schema({
  reported_user_id: { type: String, required: true }
});
module.exports = Report.discriminator('AccountReport', schema, 'account');
module.exports.REPORT_REASONS = Report.REPORT_REASONS;
