const QuizConfig = require('../models/QuizConfig');
const QuizResult = require('../models/QuizResult');
const Counter = require('../models/Counter');
const Product = require('../models/Product');
const { STARTER_QUESTIONS } = require('../services/starter-quiz.questions');
const { matchStarterKit } = require('../services/starter-quiz.matcher');
const { resolveUserIdString } = require('./cart.controller');

const RESULT_COUNTER_ID = 'starter_quiz_result';

async function ensureStarterQuestions() {
  const count = await QuizConfig.countDocuments({ quiz_type: 'starter_kit' });
  if (count > 0) return;
  await QuizConfig.insertMany(STARTER_QUESTIONS);
}

let resultCounterReady = null;

function ensureResultCounter() {
  if (!resultCounterReady) {
    resultCounterReady = (async () => {
      const existing = await Counter.findById(RESULT_COUNTER_ID).lean();
      if (existing) return;
      const rows = await QuizResult.find({ result_id: /^QR\d+$/ }).select('result_id').lean();
      let max = 0;
      for (const row of rows) {
        const match = String(row.result_id).match(/^QR(\d+)$/);
        if (match) max = Math.max(max, parseInt(match[1], 10));
      }
      try {
        await Counter.create({ _id: RESULT_COUNTER_ID, seq: max });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    })().catch((error) => {
      resultCounterReady = null;
      throw error;
    });
  }
  return resultCounterReady;
}

async function nextResultId() {
  await ensureResultCounter();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: RESULT_COUNTER_ID },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      return `QR${String(counter.seq).padStart(5, '0')}`;
    } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    }
  }
  throw new Error('Could not allocate a result id.');
}

function questionIsVisible(question, chosen) {
  const when = question.visible_when;
  if (!when?.question_id) return true;
  return chosen.get(when.question_id) === when.option_id;
}

function answersInView(questions, answers) {
  const chosen = new Map();
  for (const answer of answers) {
    if (!answer?.question_id || !answer?.option_id) continue;
    chosen.set(answer.question_id, answer.option_id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of questions) {
      if (questionIsVisible(question, chosen)) continue;
      if (chosen.delete(question.question_id)) changed = true;
    }
  }
  return [...chosen.entries()].map(([question_id, option_id]) => ({ question_id, option_id }));
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
    const knownAnswers = answersInView(
      questions,
      answers.filter((answer) =>
        questions.some((question) =>
          question.question_id === answer.question_id
          && (question.options || []).some((option) => option.option_id === answer.option_id)
        )
      )
    );

    const kit = await buildKit(questions, knownAnswers);
    const scores = accumulateScores(questions, knownAnswers);
    const resultDoc = {
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
    };

    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await QuizResult.create({
          ...resultDoc,
          result_id: await nextResultId()
        });
        break;
      } catch (error) {
        if (error.code !== 11000 || attempt === 1) throw error;
      }
    }

    return res.status(201).json({ result: publicResult(result) });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
  }
}

async function claimResult(req, res) {
  try {
    const userId = await resolveUserIdString(req.user);
    if (!userId) {
      return res.status(401).json({ error: 'Sign in to save this kit.' });
    }
    const sessionId = String(req.body?.session_id || '').trim();
    if (!sessionId) return res.json({ claimed: false });

    const updated = await QuizResult.updateMany(
      { quiz_type: 'starter_kit', session_id: sessionId, user_id: null },
      { $set: { user_id: userId, session_id: null } }
    );
    return res.json({ claimed: updated.modifiedCount > 0 });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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
  claimResult,
  getLatestResult
};
