const QuizConfig = require('../models/QuizConfig');
const Release = require('../models/RitualQuizRelease');
const { AXES } = require('./ritual-dna.config');

const choices = { D3: ['none', 'basic', 'full'], D6: ['hot', 'iced', 'milk', 'mixed'],
  D7: ['morning', 'work', 'afternoon', 'evening', 'social'] };

const fields = row => ({
  question_id: row.question_id, code: row.code, question: row.question, order: row.order,
  selection_limit: row.selection_limit, is_active: true,
  options: row.options.map(option => ({
    option_id: option.option_id, code: option.code, text: option.text, hint: option.hint || '',
    icon: option.icon || '', score_weights: option.score_weights || {},
    drink_lean: option.drink_lean ?? null, lean_confirmed: option.lean_confirmed ?? null,
    equipment_level: option.equipment_level ?? null, serving: option.serving ?? null,
    occasion: option.occasion ?? null
  }))
});

function validate(questions) {
  if (!Array.isArray(questions) || questions.length !== 7) return 'A quiz release must contain exactly seven questions.';
  const ids = new Set();
  const codes = new Set();
  for (let index = 0; index < questions.length; index++) {
    const row = questions[index];
    const code = row?.code;
    if (!row || !/^D[1-7]$/.test(code) || codes.has(code) || row.order !== index + 1 ||
      typeof row.question_id !== 'string' || !row.question_id || ids.has(row.question_id)) {
      return 'Keep seven unique D1–D7 questions with sequential display positions.';
    }
    ids.add(row.question_id);
    codes.add(code);
    if (!String(row.question || '').trim()) return `${code}: question text is required.`;
    if (row.selection_limit !== (code === 'D4' || code === 'D7' ? 2 : 1)) return `${code}: selection limit does not match the agreed rules.`;
    if (!Array.isArray(row.options) || row.options.length < 2) return `${code}: at least two answers are required.`;
    const optionIds = new Set();
    for (const option of row.options) {
      if (!option || !option.option_id || optionIds.has(option.option_id) || !String(option.text || '').trim()) return `${code}: answer IDs and text must be unique and complete.`;
      optionIds.add(option.option_id);
      if (code === 'D1' && (!Number.isInteger(option.drink_lean) || option.drink_lean < 0 || option.drink_lean > 100)) return `${code}: matcha preference must be 0–100.`;
      if (code !== 'D1' && !AXES.some(axis => option.score_weights?.[axis] != null)) return `${code}: each answer needs an axis weight.`;
      if (AXES.some(axis => option.score_weights?.[axis] != null && (!Number.isInteger(option.score_weights[axis]) || option.score_weights[axis] < 0 || option.score_weights[axis] > 5))) return `${code}: axis weights must be 0–5.`;
      if (choices[code] && !choices[code].includes(option[code === 'D3' ? 'equipment_level' : code === 'D6' ? 'serving' : 'occasion'])) return `${code}: answer attribute is missing or invalid.`;
    }
  }
  return null;
}

async function bootstrap() {
  const active = await Release.findOne({ status: 'active' }).lean();
  if (active) return active;
  const legacy = await QuizConfig.find({ quiz_type: 'ritual_dna', is_active: true }).sort({ order: 1 }).lean();
  const questions = legacy.map(fields);
  const issue = validate(questions);
  if (issue) throw new Error(`Cannot import live Ritual DNA quiz: ${issue}`);
  const version = Number(legacy[0].quiz_version);
  if (!Number.isSafeInteger(version) || version < 1 || legacy.some(row => Number(row.quiz_version) !== version)) {
    throw new Error('Live Ritual DNA quiz version is inconsistent.');
  }
  try { return await Release.create({ version, status: 'active', questions, published_at: new Date() }); }
  catch (error) {
    if (error.code === 11000) return Release.findOne({ status: 'active' }).lean();
    throw error;
  }
}

async function activeQuiz() {
  return bootstrap();
}

module.exports = { fields, validate, bootstrap, activeQuiz };
