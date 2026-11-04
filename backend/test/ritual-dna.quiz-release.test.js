const test = require('node:test');
const assert = require('node:assert/strict');
const { QUESTIONS, ARCHETYPES } = require('../src/services/ritual-dna.config');
const { fields, validate } = require('../src/services/ritual-dna.quiz-release');
const { scoreQuiz } = require('../src/services/ritual-dna.scoring');

const copy = () => QUESTIONS.map(fields);

test('live quiz imports as a complete valid release without changing its scoring', () => {
  const questions = copy();
  assert.equal(validate(questions), null);
  const answers = questions.map(row => ({ question_id: row.question_id, option_ids: [row.options[0].option_id] }));
  assert.deepEqual(scoreQuiz(questions, answers, ARCHETYPES).radar,
    scoreQuiz(QUESTIONS, answers, ARCHETYPES).radar);
});

test('release validation protects selection limits and answer scoring attributes', () => {
  const questions = copy();
  questions[3].selection_limit = 1;
  assert.match(validate(questions), /selection limit/);
  questions[3].selection_limit = 2;
  questions[0].options[0].drink_lean = null;
  assert.match(validate(questions), /matcha preference/);
  questions[0].options[0].drink_lean = 90;
  questions[2].options[0].equipment_level = 'invalid';
  assert.match(validate(questions), /attribute/);
});

test('display order can change while question codes and scoring stay attached to their answers', () => {
  const questions = copy();
  [questions[0], questions[1]] = [questions[1], questions[0]];
  questions.forEach((row, index) => { row.order = index + 1; });
  assert.equal(validate(questions), null);
  const answers = questions.map(row => ({ question_id: row.question_id, option_ids: [row.options[0].option_id] }));
  assert.deepEqual(scoreQuiz(questions, answers, ARCHETYPES).radar,
    scoreQuiz(QUESTIONS, answers, ARCHETYPES).radar);
});
