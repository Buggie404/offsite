const mongoose = require('mongoose');

// Internal notes staff keep about a customer (admin Customers page). Never shown to the customer.
const customerNoteSchema = new mongoose.Schema({
  note_id: { type: String, required: true, unique: true, default: () => new mongoose.Types.ObjectId().toString() },
  customer_id: { type: String, required: true, index: true }, // User.user_id (USR...)
  author_id: { type: String, required: true },                // admin JWT id
  author_name: { type: String, default: null },
  author_role: { type: String, required: true, enum: ['admin_cc', 'cskh', 'qlsp'] },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
  created_at: { type: Date, default: Date.now, immutable: true }
}, { collection: 'CustomerNotes', versionKey: false });

customerNoteSchema.index({ customer_id: 1, created_at: -1 });

module.exports = mongoose.model('CustomerNote', customerNoteSchema);
