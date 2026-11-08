const mongoose = require('mongoose');

const productBatchSchema = new mongoose.Schema({
  batch_code: { type: String, required: true, trim: true },
  product_id: { type: Number, required: true, index: true },
  variant_sku: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  received_at: { type: Date, required: true },
  best_before: { type: Date, default: null },
  added_by: { type: String, required: true },
  added_by_name: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
}, { collection: 'ProductBatches', versionKey: false });

productBatchSchema.index({ product_id: 1, batch_code: 1 }, { unique: true });
module.exports = mongoose.model('ProductBatch', productBatchSchema);
