const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  public_id: { type: String, required: true },
  type: { type: String, enum: ['image', 'video'], required: true }
}, { _id: false });

const authorSchema = new mongoose.Schema({
  username: { type: String, default: "" },
  avatar_url: { type: String, default: null }
}, { _id: false });

const postSchema = new mongoose.Schema({
  post_id: { type: String, required: true, unique: true },
  user_id: { type: String, default: "" },
  author: { type: authorSchema, required: true },
  post_type: { type: String, default: 'regular' },
  content: { type: String, default: "" },
  media: { type: [mediaSchema], default: [] },
  recipe_id: { type: String, default: null },
  base: { type: String, enum: ['MATCHA', 'COFFEE', 'RECIPE'], required: true },
  like_count: { type: Number, default: 0 },
  comment_count: { type: Number, default: 0 },
  share_count: { type: Number, default: 0 },
  save_count: { type: Number, default: 0 }
}, {
  collection: 'Posts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('Post', postSchema);
