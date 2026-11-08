const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  product_id: { type: Number, required: true, unique: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  saved_by: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  saved_at: { type: Date, default: Date.now }
}, { collection: 'ProductDrafts', versionKey: false });
module.exports = mongoose.model('ProductDraft', schema);
