const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  option_id: { type: String, required: true },
  text: { type: String, required: true },
  hint: { type: String, default: '' },
  icon: { type: String, default: '' },
  // Rule code used by the starter-kit matcher (E1, M, light, ...).
  code: { type: String, required: true },
  score_weights: { type: mongoose.Schema.Types.Mixed, default: {} },
  drink_lean: { type: Number, default: null },
  lean_confirmed: { type: Boolean, default: null },
  equipment_level: { type: String, default: null },
  serving: { type: String, default: null },
  occasion: { type: String, default: null }
}, { _id: false });

const quizConfigSchema = new mongoose.Schema({
  question_id: { type: String, required: true, unique: true },
  quiz_type: { type: String, required: true, enum: ['starter_kit', 'ritual_dna'] },
  code: { type: String, required: true },
  question: { type: String, required: true },
  order: { type: Number, required: true },
  selection_limit: { type: Number, default: 1, min: 1, max: 2 },
  quiz_version: { type: String, default: '1' },
  // How an answer is used: copy_only, primary, secondary, or hard_filter.
  matching_role: {
    type: String,
    enum: ['copy_only', 'primary', 'secondary', 'hard_filter'],
    default: 'secondary'
  },
  options: { type: [optionSchema], default: [] },
  // Conditional question. Example: Q2b only when Q2 = B.
  visible_when: {
    question_id: { type: String, default: null },
    option_id: { type: String, default: null }
  },
  is_active: { type: Boolean, default: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'QuizConfigs'
});

quizConfigSchema.index({ quiz_type: 1, order: 1 });

module.exports = mongoose.model('QuizConfig', quizConfigSchema);
