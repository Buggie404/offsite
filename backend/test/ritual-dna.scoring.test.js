const test = require('node:test');
const assert = require('node:assert/strict');
const { QUESTIONS, ARCHETYPES } = require('../src/services/ritual-dna.config');
const { scoreQuiz } = require('../src/services/ritual-dna.scoring');

function answer(ids) {
  return QUESTIONS.map((question, index) => ({
    question_id: question.question_id,
    option_ids: Array.isArray(ids[index]) ? ids[index] : [ids[index]]
  }));
}

test('representative rituals map to the intended archetypes', () => {
  const cases = [
    [['matcha_daily', 'fifteen_plus', 'full', 'fresh', 'light', 'hot', 'afternoon'], 'ARC0001'],
    [['balanced_lean', 'five_to_ten', 'full', ['fresh', 'warm_sweet'], 'balanced', 'mixed', ['social', 'afternoon']], 'ARC0002'],
    [['coffee_daily', 'under_3', 'none', 'deep_roasted', 'very_bold', 'iced', ['morning', 'work']], 'ARC0003'],
    [['matcha_lean', 'fifteen_plus', 'basic', ['warm_sweet', 'creamy'], 'light', 'milk', ['evening', 'afternoon']], 'ARC0004']
  ];
  for (const [ids, archetypeId] of cases) {
    assert.equal(scoreQuiz(QUESTIONS, answer(ids), ARCHETYPES).archetype.archetype_id, archetypeId);
  }
});

test('two selected flavours contribute their average rather than their sum', () => {
  const ids = ['balanced_lean', 'five_to_ten', 'basic', ['fresh', 'warm_sweet'], 'balanced', 'hot', 'afternoon'];
  const score = scoreQuiz(QUESTIONS, answer(ids), ARCHETYPES);
  assert.equal(score.radar.brightness, 70); // D4 (5+1)/2 + D5 2 + D6 2 = 7 / 10
  assert.equal(score.radar.sweetness, 20); // D4 (1+5)/2; raw range 1..11
});

test('unknown and duplicate answers are rejected', () => {
  const ids = ['balanced_lean', 'five_to_ten', 'basic', 'fresh', 'balanced', 'hot', 'afternoon'];
  const valid = answer(ids);
  valid[3].option_ids = ['fresh', 'fresh'];
  assert.throws(() => scoreQuiz(QUESTIONS, valid, ARCHETYPES), /Invalid selection/);
  valid[3].option_ids = ['unknown'];
  assert.throws(() => scoreQuiz(QUESTIONS, valid, ARCHETYPES), /Unknown option/);
});
