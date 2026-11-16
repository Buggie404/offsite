const mongoose = require('mongoose');
module.exports = mongoose.model('NotificationJobState', new mongoose.Schema({
  _id: String, enabled_at: { type: Date, required: true }
}, { collection: 'NotificationJobStates', versionKey: false }));
