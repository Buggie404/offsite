const mongoose = require('mongoose');

const heroImageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  public_id: { type: String, required: true }
}, { _id: false });

const metadataSchema = new mongoose.Schema({
  servings: { type: Number, default: 1 },
  prepTime: { type: Number, default: 0 },
  cookTime: { type: Number, default: null },
  difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'] },
  // Chosen in admin. Older recipes were inferred from the title until catalog prep.
  base: { type: String, enum: ['MATCHA', 'COFFEE', 'OTHERS'] },
  tags: { type: [String], default: [] }
}, { _id: false });

const ingredientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  // Number for plain amounts; string for fractions/ranges like "1/2" or "6-8".
  quantity: { type: mongoose.Schema.Types.Mixed, default: null },
  unit: { type: String },
  optional: { type: Boolean, default: false }
}, { _id: false });

const toolSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });

const stepSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  // Optional countdown for the hands-free guide. Absent on older steps.
  timerSeconds: { type: Number, default: null }
}, { _id: false });

const sourceSchema = new mongoose.Schema({
  type: { type: String, required: true },
  author: { type: String },
  communityPostId: { type: String, default: null },
  communityPostTitle: { type: String, default: null },
  creatorName: { type: String, default: null },
  creatorAvatar: { type: String, default: null }
}, { _id: false });

const originSchema = new mongoose.Schema({
  communityRecipeId: { type: String, default: null },
  communityPostId: { type: String, default: null }
}, { _id: false });

const MODERATION_STATUSES = ['visible', 'hidden', 'resubmitted', 'hidden_final'];

const recipeSchema = new mongoose.Schema({
  recipe_id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  heroImage: { type: heroImageSchema, required: true },
  metadata: { type: metadataSchema, required: true },
  ingredients: { type: [ingredientSchema], default: [] },
  tools: { type: [toolSchema], default: [] },
  steps: { type: [stepSchema], default: [] },
  relatedProducts: { type: [String], default: [] },
  source: { type: sourceSchema, required: true },
  // community_origin = draft behind a community post; catalog = Recipes page copy; offsite = shop.
  lifecycle: {
    type: String,
    enum: ['offsite', 'community_origin', 'catalog'],
    default: 'offsite'
  },
  owner_user_id: { type: String, default: null },
  origin: { type: originSchema, default: null },
  saves: { type: Number, default: 0 },
  published: { type: Boolean, default: true },
  // Set when an admin hides the recipe. The 30-like sync must not publish it again.
  hiddenByAdmin: { type: Boolean, default: false },
  // Optional note from the hide dialog. Not shown on the public site.
  // Kept in sync with hidden_note for older admin reads.
  adminNote: { type: String, default: '' },
  // Admin moderation fields (Hide / Restore). Separate from `published`, which also
  // means "appears on the public Recipes page".
  moderation_status: {
    type: String,
    enum: MODERATION_STATUSES,
    default: 'visible'
  },
  hidden_reason: { type: String, default: null },
  hidden_note: { type: String, default: '' },
  hidden_by: { type: String, default: null },
  hidden_at: { type: Date, default: null },
  review_round: { type: Number, default: 0 },
  resubmitted_at: { type: Date, default: null },
  restored_by: { type: String, default: null },
  restored_at: { type: Date, default: null },
  // Soft-delete. Public treats as 404; no Restore in admin UI.
  deletedAt: { type: Date, default: null },
  deleted_reason: { type: String, default: null },
  deleted_note: { type: String, default: '' },
  deleted_by: { type: String, default: null },
  // Homepage rail. Existing recipes are marked on first read; see recipe-featured.js.
  featured: { type: Boolean, default: false },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true }
}, {
  collection: 'Recipes'
});

module.exports = mongoose.model('Recipe', recipeSchema);
module.exports.MODERATION_STATUSES = MODERATION_STATUSES;
