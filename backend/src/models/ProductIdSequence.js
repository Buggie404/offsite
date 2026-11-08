const mongoose = require('mongoose');
const schema = new mongoose.Schema({ _id: String, value: { type: Number, required: true } }, { collection: 'ProductIdSequences', versionKey: false });
module.exports = mongoose.model('ProductIdSequence', schema);
