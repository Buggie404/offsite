const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 }
}, { collection: 'Counters' });

module.exports = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
