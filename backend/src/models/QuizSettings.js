const mongoose = require('mongoose');

const quizSettingsSchema = new mongoose.Schema({
  _id: { type: String },
  enabled: { type: Boolean, default: true }
}, {
  collection: 'QuizSettings',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.models.QuizSettings || mongoose.model('QuizSettings', quizSettingsSchema);
