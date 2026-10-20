const mongoose = require('mongoose');

const commentAuthorSchema = new mongoose.Schema({
  username: { type: String, default: "" },
  avatar_url: { type: String, default: "" },
  is_post_author: { type: Boolean, default: false }
}, { _id: false });

const commentSchema = new mongoose.Schema({
  comment_id: { type: String, required: true, unique: true },
  post_id: { type: String, required: true },
  parent_id: { type: String, default: null },
  user_id: { type: String, default: "" },
  author: { type: commentAuthorSchema, required: true },
  content: { type: String, required: true },
  reply_to_username: { type: String, default: null },
  like_count: { type: Number, default: 0 },
  reply_count: { type: Number, default: 0 },
  // 'hidden' comments are removed from the public thread (admin hide / unhide).
  // Old documents have no value here, so always filter with { $ne: 'hidden' }.
  moderation_status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  hidden_reason: { type: String, enum: ['manual', 'auto_reports', null], default: null },
  hidden_at: { type: Date, default: null },
  hidden_by: { type: String, default: null }
}, {
  collection: 'Comments',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('Comment', commentSchema);
