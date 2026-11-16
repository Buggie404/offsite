const test = require('node:test');
const assert = require('node:assert/strict');
const { QUESTIONS, ARCHETYPES } = require('../src/services/ritual-dna.config');
const { previewResult } = require('../src/services/ritual-dna.admin-preview');

const answers = ['matcha_daily', 'fifteen_plus', 'full', 'fresh', 'light', 'hot', 'afternoon']
  .map((id, index) => ({ question_id: QUESTIONS[index].question_id, option_ids: [id] }));

test('customer preview scores selected releases without changing their snapshots', () => {
  const quiz = { version: 7, questions: structuredClone(QUESTIONS) };
  const archetypes = { version: 9, archetypes: structuredClone(ARCHETYPES).map(row => ({ ...row, is_active: true })) };
  archetypes.archetypes[0].name = 'Preview-only name';
  const result = previewResult(quiz, archetypes, answers);

  assert.equal(result.archetype.id, archetypes.archetypes[0].archetype_id);
  assert.equal(result.archetype.name, 'Preview-only name');
  assert.equal(result.archetype.profile_version, 9);
  assert.equal(archetypes.archetypes[0].profile_version, undefined);
  assert.equal(result.radar.skill >= 0 && result.radar.skill <= 100, true);
});

test('customer preview rejects an incomplete quiz', () => {
  assert.throws(() => previewResult(
    { questions: QUESTIONS }, { version: 2, archetypes: ARCHETYPES }, answers.slice(1)
  ), /Answer all seven questions/);
});
