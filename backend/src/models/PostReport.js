const mongoose = require('mongoose');
const Report = require('./Report');
const schema = new mongoose.Schema({
  post_id: { type: String, required: true }
});
module.exports = Report.discriminator('PostReport', schema, 'post');
module.exports.REPORT_REASONS = Report.REPORT_REASONS;
