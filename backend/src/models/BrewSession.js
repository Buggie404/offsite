const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  public_id: { type: String, required: true }
}, { _id: false });

const feedbackSchema = new mongoose.Schema({
  flavor_intensity: { type: Number, required: true, min: 1, max: 5 },
  note: { type: String, default: '', maxlength: 1000 },
  rating: { type: Number, required: true, min: 1, max: 5 }
}, { _id: false });

const adjustmentSchema = new mongoose.Schema({
  ingredient_name: { type: String, required: true },
  delta_quantity: { type: Number, required: true },
  unit: { type: String, default: '' },
  // Powder actually taken from the tin, when the recipe line is a whisked drink.
  deduct_quantity: { type: Number, default: null },
  deduct_unit: { type: String, default: '' }
}, { _id: false });

const usedIngredientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, default: '' },
  product_id: { type: String, default: null }
}, { _id: false });

const pantryDeductionItemSchema = new mongoose.Schema({
  pantry_item_id: { type: String, default: '' },
  name: { type: String, default: '' },
  quantity: { type: Number, default: null },
  unit: { type: String, default: '' }
}, { _id: false });

const pantryDeductionSchema = new mongoose.Schema({
  ingredient_name: { type: String, required: true },
  quantity: { type: Number, default: null },
  unit: { type: String, default: '' },
  status: {
    type: String,
    enum: ['deducted', 'partial', 'staple', 'unconverted', 'missing'],
    required: true
  },
  deduct_quantity: { type: Number, default: null },
  deduct_unit: { type: String, default: '' },
  note: { type: String, default: '' },
  items: { type: [pantryDeductionItemSchema], default: [] }
}, { _id: false });

const brewSessionSchema = new mongoose.Schema({
  // "BSS00001" — unique id, assigned when the member saves a finished brew
  brewsession_id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  recipe_id: { type: String, required: true, index: true },
  feedback: { type: feedbackSchema, required: true },
  brewed_at: { type: Date, required: true },
  started_at: { type: Date, required: true },
  duration_seconds: { type: Number, required: true, min: 0 },
  ingredient_adjustments: { type: [adjustmentSchema], default: [] },
  ingredients_used: { type: [usedIngredientSchema], default: [] },
  // What the pantry actually drew down. Written by the server, not the client.
  pantry_deductions: { type: [pantryDeductionSchema], default: [] },
  result_image: { type: imageSchema, default: null },
  shared_post_id: { type: String, default: null }
}, {
  collection: 'BrewSessions',
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

brewSessionSchema.index({ user_id: 1, brewed_at: -1 });

module.exports = mongoose.model('BrewSession', brewSessionSchema);
