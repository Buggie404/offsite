const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, default: 'archetype' },
  value: { type: Number, required: true, min: 1 }
}, { collection: 'RitualArchetypeVersionCounters', versionKey: false });

module.exports = mongoose.model('RitualArchetypeVersionCounter', schema);
