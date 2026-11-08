const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  session_id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true, index: true },
  attempts: { type: Number, default: 1 },
  expires_at: { type: Date, required: true }
}, { collection: 'ProductSuggestionSessions' });
schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('ProductSuggestionSession', schema);
