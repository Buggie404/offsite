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
  reply_count: { type: Number, default: 0 }
}, {
  collection: 'Comments',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('Comment', commentSchema);
