const mongoose = require('mongoose');

const productSnapshotSchema = new mongoose.Schema({
  name: { type: String, required: true },
  variant_label: { type: String, required: true },
  image_url: { type: String, required: true }
}, { _id: false });

const userSnapshotSchema = new mongoose.Schema({
  name: { type: String, required: true },
  avatar_url: { type: String, default: null }
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  // "RV500001" — custom cross-collection ID, auto-generated in pre-save hook
  review_id: { type: String, unique: true, index: true },

  // === Identity (verify purchase + enforce uniqueness) ===
  user_id: { type: String, required: true, ref: 'User', index: true }, // No guests allowed
  order_id: { type: String, required: true, ref: 'Order', index: true }, // To verify purchase
  product_id: { type: String, required: true, ref: 'Product', index: true },
  variant_id: { type: String, required: true }, // Review per variant (usually variant SKU or "default")

  // === Review content ===
  rating: { type: Number, required: true, min: 1, max: 5 }, // 1-5, required
  content: { type: String, maxlength: 500, default: "" }, // optional, max 500 chars
  is_anonymous: { type: Boolean, default: false },

  // === Snapshot: product/variant ===
  // Render review on PDP without re-fetching product document
  product_snapshot: { type: productSnapshotSchema, required: true },

  // === Snapshot: user ===
  // is_anonymous = true → frontend render "Anonymous", but data is still stored
  user_snapshot: { type: userSnapshotSchema, required: true }
}, {
  collection: 'Reviews',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Enforce uniqueness: a user can only review a specific variant once per order
reviewSchema.index({ order_id: 1, product_id: 1, variant_id: 1 }, { unique: true });

// Optimize query performances
reviewSchema.index({ product_id: 1, created_at: -1 }); // PDP reviews list
reviewSchema.index({ user_id: 1, created_at: -1 }); // User's reviews page

// Pre-save hook: auto-generate sequential review_id starting from RV500001
reviewSchema.pre('save', async function(next) {
  if (!this.review_id) {
    const prefix = 'RV';
    try {
      const latestReview = await this.constructor.findOne(
        { review_id: new RegExp(`^${prefix}`) },
        { review_id: 1 },
        { sort: { review_id: -1 } }
      );
      
      let nextNum = 500001;
      if (latestReview && latestReview.review_id) {
        const numPart = latestReview.review_id.substring(prefix.length);
        const lastNum = parseInt(numPart, 10);
        if (!isNaN(lastNum)) {
          nextNum = lastNum + 1;
        }
      }
      this.review_id = `${prefix}${nextNum}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

module.exports = mongoose.model('Review', reviewSchema);
