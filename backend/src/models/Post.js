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
  ritual_preview: { type: new mongoose.Schema({
    archetype_id: String,
    name: String,
    radar: Object
  }, { _id: false }), default: null },
  recipe_id: { type: String, default: null },
  // Recipes-page fork created when the community recipe reaches 30 likes.
  catalog_recipe_id: { type: String, default: null },
  // RECIPE = legacy / uncategorised recipe posts. New recipe posts store MATCHA/COFFEE/OTHERS.
  base: { type: String, enum: ['MATCHA', 'COFFEE', 'OTHERS', 'RECIPE'], required: true },
  like_count: { type: Number, default: 0 },
  comment_count: { type: Number, default: 0 },
  share_count: { type: Number, default: 0 },
  save_count: { type: Number, default: 0 },
  // Five total tags, including at most three AI tags.
  linked_products: {
    type: [Number],
    default: [],
    validate: {
      validator: arr => arr.length <= 5,
      message: 'A post can link at most 5 products'
    }
  },
  ai_product_ids: { type: [Number], default: [], validate: { validator: ids => ids.length <= 3, message: 'At most 3 AI product tags' } },
  // 'hidden' posts are removed from public feeds; the owner still sees them with a banner.
  status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  // Why/when/who hid it: 'manual' (admin) or 'auto_reports' (older posts, reports no longer hide a post).
  hidden_reason: { type: String, enum: ['manual', 'auto_reports', null], default: null },
  // Set once staff hide or penalize the post: its points never come back, even if it is restored.
  points_forfeited: { type: Boolean, default: false },
  hidden_at: { type: Date, default: null },
  hidden_by: { type: String, default: null }
}, {
  collection: 'Posts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('Post', postSchema);
