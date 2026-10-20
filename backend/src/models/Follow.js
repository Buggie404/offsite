const mongoose = require('mongoose');

// follower_id follows following_id (both are User.user_id).
const followSchema = new mongoose.Schema({
  follower_id: { type: String, required: true },
  following_id: { type: String, required: true }
}, {
  collection: 'Follows',
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

followSchema.index({ follower_id: 1, following_id: 1 }, { unique: true });
followSchema.index({ following_id: 1 });

module.exports = mongoose.model('Follow', followSchema);
