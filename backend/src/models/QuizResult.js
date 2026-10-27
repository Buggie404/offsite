const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  question_id: { type: String, required: true },
  option_id: { type: String, required: true }
}, { _id: false });

const quizResultSchema = new mongoose.Schema({
  result_id: { type: String, required: true, unique: true },
  user_id: { type: String, default: null },
  session_id: { type: String, default: null },
  quiz_type: { type: String, required: true, enum: ['starter_kit', 'ritual_dna'] },
  answers: { type: [answerSchema], default: [] },
  scores: { type: mongoose.Schema.Types.Mixed, default: {} },
  bundle_id: { type: String, default: null },
  archetype_id: { type: String, default: null },
  // Computed kit so a logged-in customer can reopen the same recommendation.
  kit_snapshot: { type: mongoose.Schema.Types.Mixed, default: null }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'QuizResults'
});

quizResultSchema.pre('validate', function validateOwner(next) {
  const hasUser = !!this.user_id;
  const hasSession = !!this.session_id;
  if (hasUser === hasSession) {
    return next(new Error('Quiz result must have exactly one of user_id or session_id'));
  }
  next();
});

quizResultSchema.index({ quiz_type: 1, user_id: 1, created_at: -1 });
quizResultSchema.index({ quiz_type: 1, session_id: 1, created_at: -1 });

module.exports = mongoose.model('QuizResult', quizResultSchema);
