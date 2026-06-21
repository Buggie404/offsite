const mongoose = require('mongoose');

const blogAuthorSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  author_name: { type: String, required: true },
  author_avatar_url: { type: String, default: null }
}, { _id: false });

const blogContentBlockSchema = new mongoose.Schema({
  type: { type: String, required: true }, // e.g. 'paragraph', 'heading'
  text: { type: String },
  level: { type: Number } // e.g. 2, 3 for headings
}, { _id: false });

const blogSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  excerpt: { type: String, default: '' },
  featured_image_url: { type: String, default: null },
  featured_image_public_id: { type: String, default: null },
  author: { type: blogAuthorSchema, required: true },
  content: { type: [blogContentBlockSchema], default: [] },
  tags: { type: [String], default: [] },
  category: { type: String, required: true },
  read_time_minutes: { type: Number, default: 0 },
  views_count: { type: Number, default: 0 },
  likes_count: { type: Number, default: 0 },
  published_at: { type: Date, default: null }
}, {
  collection: 'Blogs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('Blog', blogSchema);
