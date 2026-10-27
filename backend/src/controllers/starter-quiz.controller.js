const QuizConfig = require('../models/QuizConfig');
const QuizResult = require('../models/QuizResult');
const Product = require('../models/Product');
const { STARTER_QUESTIONS } = require('../services/starter-quiz.questions');
const { matchStarterKit } = require('../services/starter-quiz.matcher');
const { resolveUserIdString } = require('./cart.controller');

async function ensureStarterQuestions() {
  const count = await QuizConfig.countDocuments({ quiz_type: 'starter_kit' });
  if (count > 0) return;
  await QuizConfig.insertMany(STARTER_QUESTIONS);
}

async function nextResultId() {
  const last = await QuizResult.findOne({}).sort({ result_id: -1 }).select('result_id').lean();
  let n = 1;
  if (last?.result_id) {
    const match = String(last.result_id).match(/QR(\d+)/);
    if (match) n = parseInt(match[1], 10) + 1;
  }
  return `QR${String(n).padStart(5, '0')}`;
}

function publicQuestion(question) {
  return {
    question_id: question.question_id,
    quiz_type: question.quiz_type,
    code: question.code,
    question: question.question,
    order: question.order,
    visible_when: question.visible_when?.question_id
      ? {
          question_id: question.visible_when.question_id,
          option_id: question.visible_when.option_id
        }
      : null,
    options: (question.options || []).map((option) => ({
      option_id: option.option_id,
      code: option.code,
      text: option.text,
      hint: option.hint || '',
      icon: option.icon || '',
      score_weights: option.score_weights || {}
    }))
  };
}

async function loadQuestions() {
  await ensureStarterQuestions();
  const questions = await QuizConfig.find({ quiz_type: 'starter_kit', is_active: true })
    .sort({ order: 1 })
    .lean();
  return questions;
}

function codesFromAnswers(questions, answers) {
  const byId = new Map(questions.map((question) => [question.question_id, question]));
  const codes = {};
  for (const answer of answers) {
    const question = byId.get(answer.question_id);
    if (!question) continue;
    const option = (question.options || []).find((entry) => entry.option_id === answer.option_id);
    if (!option) continue;
    codes[question.code] = option.code;
  }
  return codes;
}

function accumulateScores(questions, answers) {
  const byId = new Map(questions.map((question) => [question.question_id, question]));
  const scores = {};
  for (const answer of answers) {
    const question = byId.get(answer.question_id);
    const option = question?.options?.find((entry) => entry.option_id === answer.option_id);
    const weights = option?.score_weights || {};
    for (const [key, value] of Object.entries(weights)) {
      scores[key] = (scores[key] || 0) + Number(value || 0);
    }
  }
  return scores;
}

function previousItemsFromSnapshot(snapshot) {
  return (snapshot?.items || []).map((item) => ({
    slotKey: item.slotKey,
    productId: item.productId,
    name: item.name
  }));
}

async function buildKit(questions, answers, previousSnapshot) {
  const products = await Product.find({ is_active: { $ne: false } }).lean();
  const matched = matchStarterKit(
    codesFromAnswers(questions, answers),
    products,
    previousItemsFromSnapshot(previousSnapshot)
  );
  if (matched.error) {
    const error = new Error(matched.error);
    error.status = 422;
    throw error;
  }
  return matched.kit;
}

async function getQuestions(_req, res) {
  try {
    const questions = await loadQuestions();
    return res.json({ questions: questions.map(publicQuestion) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function createResult(req, res) {
  try {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!answers.length) {
      return res.status(400).json({ error: 'Answers are required.' });
    }

    const userId = await resolveUserIdString(req.user);
    const sessionId = userId ? null : String(req.body?.session_id || '').trim();
    if (!userId && !sessionId) {
      return res.status(400).json({ error: 'A session id is required for guest results.' });
    }

    const questions = await loadQuestions();
    const knownAnswers = answers.filter((answer) =>
      questions.some((question) =>
        question.question_id === answer.question_id
        && (question.options || []).some((option) => option.option_id === answer.option_id)
      )
    );

    const kit = await buildKit(questions, knownAnswers);
    const scores = accumulateScores(questions, knownAnswers);
    const result = await QuizResult.create({
      result_id: await nextResultId(),
      user_id: userId,
      session_id: sessionId,
      quiz_type: 'starter_kit',
      answers: knownAnswers.map((answer) => ({
        question_id: answer.question_id,
        option_id: answer.option_id
      })),
      scores,
      bundle_id: kit.bundleId,
      archetype_id: kit.archetypeId,
      kit_snapshot: kit
    });

    return res.status(201).json({ result: publicResult(result) });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
  }
}

async function getLatestResult(req, res) {
  try {
    const userId = await resolveUserIdString(req.user);
    const sessionId = userId ? null : String(req.query.session_id || '').trim();
    if (!userId && !sessionId) {
      return res.json({ result: null });
    }

    const query = userId
      ? { quiz_type: 'starter_kit', user_id: userId }
      : { quiz_type: 'starter_kit', session_id: sessionId };
    const result = await QuizResult.findOne(query).sort({ created_at: -1 });
    if (!result) return res.json({ result: null });

    const questions = await loadQuestions();
    try {
      const kit = await buildKit(questions, result.answers, result.kit_snapshot);
      result.bundle_id = kit.bundleId;
      result.archetype_id = kit.archetypeId;
      result.kit_snapshot = kit;
      await result.save();
    } catch (error) {
      if (!result.kit_snapshot) {
        return res.status(error.status || 500).json({ error: error.message });
      }
    }

    return res.json({ result: publicResult(result) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function publicResult(result) {
  return {
    result_id: result.result_id,
    user_id: result.user_id,
    session_id: result.session_id,
    quiz_type: result.quiz_type,
    answers: result.answers,
    scores: result.scores || {},
    bundle_id: result.bundle_id,
    archetype_id: result.archetype_id,
    kit: result.kit_snapshot,
    created_at: result.created_at
  };
}

module.exports = {
  getQuestions,
  createResult,
  getLatestResult
};
