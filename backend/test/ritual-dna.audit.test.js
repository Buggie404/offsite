const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { QUESTIONS, ARCHETYPES } = require('../src/services/ritual-dna.config');
const answers = ['matcha_daily', 'fifteen_plus', 'full', 'fresh', 'light', 'hot', 'afternoon']
  .map((id, i) => ({ question_id: QUESTIONS[i].question_id, option_ids: [id] }));
function response() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }
function setup(status = 'testing', conflict = false) {
  const quiz = { _id: 'quiz1', version: 7, status, updated_at: new Date(), questions: structuredClone(QUESTIONS) };
  const archetypes = { version: 9, status: 'active', archetypes: structuredClone(ARCHETYPES).map(row => ({ ...row, is_active: true })) };
  const logs = []; let updates = 0;
  const models = {
    '../models/RitualQuizRelease': {
      findOne: () => ({ lean: async () => quiz }),
      findOneAndUpdate: (query, update, options) => ({ lean: async () => {
        assert.equal(query.status, 'testing'); assert.equal(query.updated_at, quiz.updated_at); assert.equal(options.new, false);
        if (conflict) return null;
        updates++; const before = structuredClone(quiz); Object.assign(quiz, update.$set); return before;
      } }),
      findOneAndDelete: async () => quiz
    },
    '../models/RitualArchetypeRelease': {
      findOne: () => ({ select() { return this; }, lean: async () => archetypes }),
      findOneAndDelete: async () => archetypes
    }
  };
  const filename = path.resolve(__dirname, '../src/controllers/admin-ritual-dna.controller.js');
  const realRequire = createRequire(filename), module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => models[name] || realRequire(name), module, module.exports);
  return { api: module.exports, logs, quiz, updates: () => updates,
    req: { params: { version: '7' }, body: { answers, quiz_version: 7, archetype_version: 9 }, writeActivityLog: async entry => logs.push(entry) } };
}
for (const handler of ['simulateQuiz', 'previewCustomerQuiz']) {
  test(`${handler} logs successful publish-qualifying tests with exact versions, without storing answers`, async () => {
    const s = setup(), res = response(); await s.api[handler](s.req, res);
    assert.equal(res.statusCode, 200); assert.equal(s.updates(), 1); assert.equal(s.logs.length, 1);
    assert.equal(s.logs[0].actionType, 'ritual-dna.quiz-tested');
    assert.equal(s.logs[0].newValue.quiz_version, 7); assert.equal(s.logs[0].newValue.archetype_version, 9);
    assert.ok(s.logs[0].newValue.tested_at); assert.equal(s.logs[0].newValue.answers, undefined);
  });
}
test('read-only preview and invalid/conflicting tests do not produce a success audit', async () => {
  const readonly = setup('active'); await readonly.api.previewCustomerQuiz(readonly.req, response());
  assert.equal(readonly.updates(), 0); assert.equal(readonly.logs.length, 0);
  const invalid = setup(), invalidRes = response(); invalid.req.body.answers = [];
  await invalid.api.simulateQuiz(invalid.req, invalidRes);
  assert.equal(invalidRes.statusCode, 400); assert.equal(invalid.logs.length, 0);
  const conflict = setup('testing', true), res = response(); await conflict.api.simulateQuiz(conflict.req, res);
  assert.equal(res.statusCode, 409); assert.equal(conflict.logs.length, 0);
});
test('deleted Ritual DNA drafts retain their contents in the audit', async () => {
  const s = setup(); await s.api.deleteDraft(s.req, response()); await s.api.deleteQuizDraft(s.req, response());
  assert.ok(s.logs[0].oldValue.archetypes.length); assert.ok(s.logs[1].oldValue.questions.length);
});
