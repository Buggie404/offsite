const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  public_id: { type: String, required: true },
  sort_order: { type: Number, default: 0 },
  alt_text: { type: String, default: '' }
}, { _id: false });

const variantSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  label: { type: String, default: '' },
  price: { type: Number, required: true },
  stock: { type: Number, required: true },
  sold_quantity: { type: Number, default: 0 },
  is_default: { type: Boolean, default: false },
  images: { type: [imageSchema], default: [] }
}, { _id: false });

const matchaDetailsSchema = new mongoose.Schema({
  product_grade: { type: String },
  origin: { type: String },
  pricing_tier: { type: String }
}, { _id: false });

const coffeeDetailsSchema = new mongoose.Schema({
  roast_level: { type: String },
  process_type: { type: String },
  product_origin: { type: String },
  tasting_notes: { type: [String], default: [] }
}, { _id: false });

const drinkwareDetailsSchema = new mongoose.Schema({
  ware_type: { type: String },
  material: { type: String },
  product_size: { type: String }
}, { _id: false });

const setsBundlesDetailsSchema = new mongoose.Schema({
  set_type: { type: String },
  is_exclusive: { type: Boolean, default: false },
  // Composition entries are embedded objects in MongoDB, not string IDs.
  composition: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { _id: false });

const toolsDetailsSchema = new mongoose.Schema({
  tool_category: { type: String },
  tool_type: { type: String }
}, { _id: false });

const productSchema = new mongoose.Schema({
  product_id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  seo_title: { type: String, default: '' },
  category: { 
    type: String, 
    required: true, 
    enum: ['matcha', 'coffee', 'drinkware', 'sets_bundles', 'tools'] 
  },
  product_tag: { type: [String], default: [] },
  is_best_seller: { type: Boolean, default: false },
  is_new_arrival: { type: Boolean, default: false },
  total_sold_quantity: { type: Number, default: 0 },
  variant_type: { type: String, required: true, default: 'none' },
  images: { type: [imageSchema], default: [] },
  variants: { type: [variantSchema], default: [] },
  rating_avg: { type: Number, default: null },
  review_count: { type: Number, default: 0 },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
  is_active: { type: Boolean, default: true },
  
  // Category-specific details
  matcha: { type: matchaDetailsSchema },
  coffee: { type: coffeeDetailsSchema },
  drinkware: { type: drinkwareDetailsSchema },
  sets_bundles: { type: setsBundlesDetailsSchema },
  tools: { type: toolsDetailsSchema }
}, {
  collection: 'Products'
});

productSchema.pre('validate', function preventUnavailableNewArrivals() {
  const hasUnavailableVariant = this.variants.length === 0
    || this.variants.some(variant => (variant.stock ?? 0) <= 0);

  if (hasUnavailableVariant) {
    this.is_new_arrival = false;
  }
});

module.exports = mongoose.model('Product', productSchema);
