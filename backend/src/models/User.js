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

const oauthProviderSchema = new mongoose.Schema({
  provider: { type: String, enum: ['google', 'facebook'], required: true },
  provider_id: { type: String, required: true }
}, { _id: false });

const savedProductSchema = new mongoose.Schema({
  product_id: { type: String, required: true },
  saved_at: { type: Date, default: Date.now }
}, { _id: false });

const savedRecipeSchema = new mongoose.Schema({
  recipe_id: { type: String, required: true },
  saved_at: { type: Date, default: Date.now }
}, { _id: false });

const savedPostSchema = new mongoose.Schema({
  post_id: { type: String, required: true },
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
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  addresses: { type: [addressSchema], default: [] },
  payment_methods: { type: [paymentMethodSchema], default: [] },
  saved_products: { type: [savedProductSchema], default: [] },
  saved_recipes: { type: [savedRecipeSchema], default: [] },
  saved_posts: { type: [savedPostSchema], default: [] }
}, {
  collection: 'Users',
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
