const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, default: 'quiz' },
  value: { type: Number, required: true, min: 1 }
}, { collection: 'RitualQuizVersionCounters', versionKey: false });

module.exports = mongoose.model('RitualQuizVersionCounter', schema);
