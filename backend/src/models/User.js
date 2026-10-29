const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  recipient_name: { type: String, required: true },
  phone: { type: String, required: true },
  city: { type: String, required: true },
  detail_address: { type: String, required: true },
  label: { type: String, enum: ['home', 'office', 'other', null], default: null },
  is_default: { type: Boolean, default: false }
});

const paymentMethodSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  card_type: { type: String, enum: ['NAPAS', 'credit', 'debit'], required: true },
  card_number: { type: String, required: true },
  cardholder_name: { type: String, required: true },
  expire_date: { type: String, required: true }, // "MM/YY"
  issued_bank: { type: String }, // only NAPAS
  cvc: { type: String }, // only credit/debit
  is_default: { type: Boolean, default: false }
});

paymentMethodSchema.pre('validate', function(next) {
  if (this.card_type === 'NAPAS') {
    this.cvc = null;
  } else {
    this.issued_bank = null;
  }
  next();
});

const oauthProviderSchema = new mongoose.Schema({
  provider: { type: String, enum: ['google', 'facebook'], required: true },
  provider_id: { type: String, required: true }
}, { _id: false });

const savedProductSchema = new mongoose.Schema({
  product_id: { type: String, required: true },
  saved_at: { type: Date, default: Date.now }
}, { _id: false });

const personalAdjustmentSchema = new mongoose.Schema({
  ingredient_name: { type: String, required: true },
  delta_quantity: { type: Number, required: true },
  unit: { type: String, default: '' },
  deduct_quantity: { type: Number, default: null },
  deduct_unit: { type: String, default: '' }
}, { _id: false });

const savedRecipeSchema = new mongoose.Schema({
  recipe_id: { type: String, required: true },
  saved_at: { type: Date, default: Date.now },
  is_done: { type: Boolean, default: false },
  done_count: { type: Number, default: 0 },
  last_done_at: { type: Date, default: null },
  personal_adjustments: { type: [personalAdjustmentSchema], default: [] }
}, { _id: false });

const doneRecipeSchema = new mongoose.Schema({
  recipe_id: { type: String, required: true },
  is_done: { type: Boolean, default: false },
  done_count: { type: Number, default: 0 },
  last_done_at: { type: Date, default: null }
}, { _id: false });

const startedRecipeSchema = new mongoose.Schema({
  recipe_id: { type: String, required: true },
  started_at: { type: Date, default: Date.now }
}, { _id: false });

const savedPostSchema = new mongoose.Schema({
  post_id: { type: String, required: true },
  saved_at: { type: Date, default: Date.now }
}, { _id: false });

const likedPostSchema = new mongoose.Schema({
  post_id: { type: String, required: true },
  liked_at: { type: Date, default: Date.now }
}, { _id: false });

const savedBlogSchema = new mongoose.Schema({
  blog_id: { type: String, required: true },
  saved_at: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  email: { type: String, unique: true, sparse: true, default: null },
  phone: { type: String, unique: true, sparse: true, default: null },
  password_hash: { type: String, default: null },
  oauth_providers: { type: [oauthProviderSchema], default: [] },
  profile_name: { type: String, required: true },
  community_name: { type: String, unique: true, sparse: true, default: null },
  avatar_url: { type: String, default: null },
  // Cached counters, kept in sync by follow.service; is_following is computed per viewer, never stored.
  followers_count: { type: Number, default: 0, min: 0 },
  following_count: { type: Number, default: 0, min: 0 },
  role: { type: String, enum: ['customer', 'admin_cc', 'cskh', 'qlsp'], default: 'customer' },
  assigned_chat_customer_ids: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  // Membership: tier multiplies earned points and is never downgraded.
  membership_tier: { type: String, enum: ['Seed', 'Leaf', 'Bloom', 'Zen'], default: 'Seed' },
  // Posted (spendable) points; may go negative after a reversal and is made up by later credits.
  points: { type: Number, default: 0 },
  referral_code: { type: String, unique: true, sparse: true, default: null },
  referred_by: { type: String, default: null },
  welcome_voucher_code: { type: String, default: null },
  ritual_dna_quiz_completed: { type: Boolean, default: false },
  addresses: { type: [addressSchema], default: [] },
  payment_methods: { type: [paymentMethodSchema], default: [] },
  saved_products: { type: [savedProductSchema], default: [] },
  saved_recipes: { type: [savedRecipeSchema], default: [] },
  done_recipes: { type: [doneRecipeSchema], default: [] },
  started_recipes: { type: [startedRecipeSchema], default: [] },
  hidden_pantry_recipes: { type: [String], default: [] },
  saved_posts: { type: [savedPostSchema], default: [] },
  liked_posts: [{ post_id: {type: String,required: true}, liked_at: {type: Date, default: Date.now}}],
  liked_posts: { type: [likedPostSchema], default: [] },
  saved_blogs: { type: [savedBlogSchema], default: [] }
}, {
  collection: 'Users',
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
