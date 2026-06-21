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
  tags: { type: [String], default: [] }
}, { _id: false });

const ingredientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number },
  unit: { type: String },
  optional: { type: Boolean, default: false }
}, { _id: false });

const toolSchema = new mongoose.Schema({
  name: { type: String, required: true }
}, { _id: false });

const stepSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' }
}, { _id: false });

const sourceSchema = new mongoose.Schema({
  type: { type: String, required: true },
  author: { type: String },
  communityPostId: { type: String, default: null },
  communityPostTitle: { type: String, default: null },
  creatorName: { type: String, default: null },
  creatorAvatar: { type: String, default: null }
}, { _id: false });

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
  saves: { type: Number, default: 0 },
  published: { type: Boolean, default: true },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true }
}, {
  collection: 'Recipes'
});

module.exports = mongoose.model('Recipe', recipeSchema);
