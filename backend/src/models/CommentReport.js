const mongoose = require('mongoose');
const Report = require('./Report');
const schema = new mongoose.Schema({
  comment_id: { type: String, required: true },
  post_id: { type: String, required: true }
});
module.exports = Report.discriminator('CommentReport', schema, 'comment');
module.exports.REPORT_REASONS = Report.REPORT_REASONS;
