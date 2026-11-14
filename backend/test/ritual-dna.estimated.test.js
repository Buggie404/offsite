const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEstimate } = require('../src/services/ritual-dna.estimated');
const { scoreQuiz } = require('../src/services/ritual-dna.scoring');
const { recalculate } = require('../src/services/ritual-dna.evolution');
const { QUESTIONS, ARCHETYPES, AXES } = require('../src/services/ritual-dna.config');
const User = require('../src/models/User');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function controllerFor(user, estimate, onSave = () => {}) {
  const filename = path.resolve(__dirname, '../src/controllers/ritual-dna.controller.js');
  const local = { exports: {} };
  const realRequire = createRequire(filename);
  const mocks = {
    '../models/User': { findOne: () => Object.assign(Promise.resolve(user), { lean: async () => user }),
      updateOne: async (filter, update) => { onSave(update.$set.ritual_dna); return { modifiedCount: 1 }; } },
    '../services/ritual-dna.quiz-release': { activeQuiz: async () => ({ version: '1', questions: QUESTIONS }) },
    '../services/ritual-dna.archetype-release': { activeArchetypes: async () => ARCHETYPES },
    '../services/ritual-dna.estimated': { estimateFor: async () => estimate, nearest: require('../src/services/ritual-dna.estimated').nearest }
  };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => mocks[name] || realRequire(name), local, local.exports);
  return local.exports;
}
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
const products = [{ product_id: 1, category: 'coffee', coffee: { roast_level: 'dark roast' } }];
const orders = Array.from({ length: 3 }, (_, i) => ({ order_id: `O${i}`, delivered_at: new Date('2026-10-01'), items: [{ product_id: '1', quantity: 1 }] }));
const short = QUESTIONS.filter(q => ['D2', 'D4', 'D6'].includes(q.code));
const answers = short.map((q, i) => ({ question_id: q.question_id, option_ids: [['under_3'], ['fresh'], ['hot']][i] }));

test('two deliveries are insufficient; exactly three produce an unconfirmed estimate', () => {
  assert.equal(buildEstimate(orders.slice(0, 2), products, ARCHETYPES), null);
  const dna = buildEstimate(orders, products, ARCHETYPES);
  assert.equal(dna.is_estimated, true);
  assert.equal(dna.quiz_taken_at, null);
  assert.equal(dna.drink_lean, 0);
  assert.equal(dna.taste_radar.boldness, 85);
  assert.equal(dna.taste_radar.skill, 50);
  assert.deepEqual(dna.occasions, []);
  const error = new User({ user_id: 'TEST', profile_name: 'Test', ritual_dna: dna }).validateSync();
  assert.equal(error, undefined);
});

test('confirmation normalizes only D2, D4 and D6 and validates every selection', () => {
  const result = scoreQuiz(short, answers, ARCHETYPES, true);
  assert.equal(result.radar.brightness, 100);
  assert.equal(result.radar.tempo, 100);
  assert.equal(result.radar.skill, 13);
  assert.throws(() => scoreQuiz(short, answers.slice(1), ARCHETYPES, true), /three/);
  assert.throws(() => scoreQuiz(short, answers.map((a, i) => i ? a : { ...a, option_ids: ['unknown'] }), ARCHETYPES, true), /Unknown/);
  assert.throws(() => scoreQuiz(short, answers, ARCHETYPES), /configured/);
});

test('confirmation retains historical evidence at 40 percent after confirmation', () => {
  const estimated = buildEstimate(orders, products, ARCHETYPES);
  const baseline = scoreQuiz(short, answers, ARCHETYPES, true).radar;
  const dna = { ...estimated, quiz_mode: 'confirmation', quiz_taken_at: new Date(), quiz_baseline: baseline };
  const next = recalculate(dna, dna.behavior_events, ARCHETYPES);
  for (const axis of AXES) assert.equal(next.radar[axis], Math.round(.6 * baseline[axis] + .4 * estimated.taste_radar[axis]));
});

test('API serves only D2/D4/D6 for eligible confirmation and rejects an ineligible request', async () => {
  const req = { user: { user_id: 'USR1' }, query: { mode: 'confirmation' } };
  const res = response();
  await controllerFor({ user_id: 'USR1' }, {}).questions(req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(Array.from(res.body.questions, q => q.code), ['D2', 'D4', 'D6']);
  const rejected = response();
  await controllerFor({ user_id: 'USR1' }, null).questions(req, rejected);
  assert.equal(rejected.code, 409);
});

test('API refuses a confirmation submit when the user is no longer eligible', async () => {
  const res = response();
  await controllerFor({ user_id: 'USR1' }, null).submit({ user: { user_id: 'USR1' }, body: { mode: 'confirmation', quiz_version: '1', answers } }, res);
  assert.equal(res.code, 409);
});

test('successful confirmation saves three answers, inferred attributes and an actual quiz completion', async () => {
  const estimate = buildEstimate(orders, products, ARCHETYPES);
  let saved;
  const user = { _id: 'u1', user_id: 'USR1', ritual_dna: estimate, ritual_dna_quiz_completed: true };
  const res = response();
  await controllerFor(user, estimate, dna => { saved = dna; }).submit({ user: { user_id: 'USR1' }, body: { mode: 'confirmation', quiz_version: '1', answers } }, res);
  assert.equal(res.code, 200);
  assert.equal(saved.is_estimated, false);
  assert.equal(saved.quiz_mode, 'confirmation');
  assert.ok(saved.quiz_taken_at instanceof Date);
  assert.equal(saved.quiz_answers.length, 3);
  assert.equal(saved.drink_lean, estimate.drink_lean);
  assert.equal(saved.intensity_preference, estimate.intensity_preference);
  for (const axis of AXES) assert.equal(saved.taste_radar[axis], Math.round(.6 * saved.quiz_baseline[axis] + .4 * estimate.taste_radar[axis]));
});
