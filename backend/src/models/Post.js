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
  save_count: { type: Number, default: 0 },
  // Product.product_id values tagged on this post (max 3).
  linked_products: {
    type: [Number],
    default: [],
    validate: {
      validator: arr => arr.length <= 3,
      message: 'A post can link at most 3 products'
    }
  },
  // 'hidden' posts are removed from public feeds; the owner still sees them with a banner.
  status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  // Why/when/who hid it: 'manual' (admin) or 'auto_reports' (enough pending reports).
  hidden_reason: { type: String, enum: ['manual', 'auto_reports', null], default: null },
  hidden_at: { type: Date, default: null },
  hidden_by: { type: String, default: null }
}, {
  collection: 'Posts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('Post', postSchema);
