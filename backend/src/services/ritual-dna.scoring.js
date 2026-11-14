const { AXES } = require('./ritual-dna.config');

const RAW_LIMITS = {
  brightness: [0, 10], boldness: [0, 11], sweetness: [1, 11],
  skill: [0, 15], tempo: [1, 10]
};

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function scoreQuiz(questions, answers, archetypes, partial = false) {
  if (!Array.isArray(questions) || questions.length !== (partial ? 3 : 7)) invalid('Ritual DNA quiz is not configured.');
  if (!Array.isArray(answers) || answers.length !== questions.length) invalid(partial ? 'Answer all three questions.' : 'Answer all seven questions.');
  if (!Array.isArray(archetypes) || !archetypes.length) invalid('Ritual DNA archetypes are not configured.');

  const byQuestion = new Map();
  for (const answer of answers) {
    if (!answer || typeof answer.question_id !== 'string' || byQuestion.has(answer.question_id)) invalid('Duplicate or invalid question.');
    byQuestion.set(answer.question_id, answer);
  }

  const raw = Object.fromEntries(AXES.map(axis => [axis, 0]));
  const attributes = { drink_lean: 50, lean_confirmed: true, equipment_level: null, flavor_tags: [], intensity_preference: null, servings: [], occasions: [] };
  const normalizedAnswers = [];

  for (const question of questions) {
    const answer = byQuestion.get(question.question_id);
    if (!answer || !Array.isArray(answer.option_ids)) invalid(`Missing answer for ${question.code}.`);
    const ids = answer.option_ids;
    const limit = question.selection_limit || 1;
    if (ids.length < 1 || ids.length > limit || new Set(ids).size !== ids.length) invalid(`Invalid selection for ${question.code}.`);
    const selected = ids.map(id => question.options.find(option => option.option_id === id));
    if (selected.some(option => !option)) invalid(`Unknown option for ${question.code}.`);
    for (const axis of AXES) {
      raw[axis] += selected.reduce((sum, option) => sum + Number(option.score_weights?.[axis] || 0), 0) / selected.length;
    }
    for (const option of selected) {
      if (option.drink_lean != null) attributes.drink_lean = option.drink_lean;
      if (option.lean_confirmed === false) attributes.lean_confirmed = false;
      if (option.equipment_level) attributes.equipment_level = option.equipment_level;
      if (option.serving) attributes.servings.push(option.serving);
      if (option.occasion) attributes.occasions.push(option.occasion);
      if (question.code === 'D4') attributes.flavor_tags.push(option.option_id);
      if (question.code === 'D5') attributes.intensity_preference = option.option_id;
    }
    normalizedAnswers.push({ question_id: question.question_id, option_ids: [...ids] });
  }

  const radar = Object.fromEntries(AXES.map(axis => {
    const [min, max] = partial ? questions.reduce(([lo, hi], question) => {
      const weights = question.options.map(option => Number(option.score_weights?.[axis] || 0));
      return [lo + Math.min(...weights), hi + Math.max(...weights)];
    }, [0, 0]) : RAW_LIMITS[axis];
    if (max === min) return [axis, 50];
    return [axis, Math.round(Math.max(0, Math.min(100, (raw[axis] - min) * 100 / (max - min))))];
  }));
  const distance = profile => Math.sqrt(AXES.reduce((sum, axis) => sum + (radar[axis] - profile[axis]) ** 2, 0));
  const archetype = [...archetypes].sort((a, b) => distance(a.taste_profile) - distance(b.taste_profile) || a.archetype_id.localeCompare(b.archetype_id))[0];
  return { radar, archetype, attributes, answers: normalizedAnswers };
}

module.exports = { scoreQuiz };
