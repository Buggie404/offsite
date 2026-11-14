const mongoose = require('mongoose');
const User = require('../models/User');
const { activeQuiz } = require('../services/ritual-dna.quiz-release');
const { activeArchetypes, archetypeForProfile } = require('../services/ritual-dna.archetype-release');
const Product = require('../models/Product');
const { scoreQuiz } = require('../services/ritual-dna.scoring');
const { awardRitualDnaQuizPoints } = require('../services/loyalty.service');
const { recommendationsFor, recommendationsForProduct, fitsFor } = require('../services/ritual-dna.recommendations');
const { estimateFor, nearest } = require('../services/ritual-dna.estimated');
const CONFIRM_CODES = new Set(['D2', 'D4', 'D6']);

function userQuery(jwtId) {
  return mongoose.isValidObjectId(jwtId) ? { _id: jwtId } : { user_id: jwtId };
}

async function questions(req, res) {
  try {
    const release = await activeQuiz();
    const rows = release?.questions || [];
    if (rows.length !== 7) return res.status(503).json({ error: 'Ritual DNA quiz is not ready.' });
    const confirmation = req.query.mode === 'confirmation';
    if (confirmation) {
      const user = await User.findOne(userQuery(req.user.user_id)).lean();
      if (!user || !await estimateFor(user, await activeArchetypes())) return res.status(409).json({ error: 'Three delivered orders and no completed quiz are required.' });
    }
    res.json({ mode: confirmation ? 'confirmation' : 'full', quiz_version: String(release.version), questions: rows.filter(row => !confirmation || CONFIRM_CODES.has(row.code)).map(row => ({
      question_id: row.question_id, code: row.code, question: row.question,
      order: row.order, selection_limit: row.selection_limit || 1,
      options: row.options.map(option => ({ option_id: option.option_id, text: option.text, hint: option.hint, icon: option.icon }))
    })) });
  } catch (error) { res.status(500).json({ error: 'Could not load Ritual DNA quiz.' }); }
}

async function profile(req, res) {
  try {
    const user = await User.findOne(userQuery(req.user.user_id)).select('user_id ritual_dna').lean();
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.ritual_dna?.quiz_taken_at) {
      const previous = user.ritual_dna;
      const estimate = await estimateFor(user, await activeArchetypes());
      const signature = dna => dna ? JSON.stringify([dna.archetype_id, dna.archetype_profile_version,
        dna.taste_radar, dna.drink_lean, dna.equipment_level, dna.intensity_preference,
        dna.behavior_events?.map(event => event.event_id)]) : null;
      if (signature(previous) !== signature(estimate)) {
      const filter = { _id: user._id, ...(previous?.updated_at ? { 'ritual_dna.updated_at': previous.updated_at } : { ritual_dna: null }) };
      const saved = await User.updateOne(filter, { $set: { ritual_dna: estimate } }, { runValidators: true });
      user.ritual_dna = saved.modifiedCount === 1 ? estimate : (await User.findById(user._id).select('ritual_dna').lean())?.ritual_dna;
      }
    }
    if (!user.ritual_dna) return res.json({ result: null });
    const archetype = await archetypeForProfile(user.ritual_dna.archetype_id, user.ritual_dna.archetype_profile_version);
    res.json({ result: { is_estimated: Boolean(user.ritual_dna.is_estimated), confirmation_eligible: Boolean(user.ritual_dna.is_estimated), radar: user.ritual_dna.taste_radar, baseline: user.ritual_dna.quiz_baseline, archetype: publicArchetype(archetype), drink_lean: user.ritual_dna.drink_lean, lean_confirmed: user.ritual_dna.lean_confirmed, equipment_level: user.ritual_dna.equipment_level, flavor_tags: user.ritual_dna.flavor_tags, intensity_preference: user.ritual_dna.intensity_preference, servings: user.ritual_dna.servings, occasions: user.ritual_dna.occasions, quiz_taken_at: user.ritual_dna.quiz_taken_at, updated_at: user.ritual_dna.updated_at, history: (user.ritual_dna.evolution_logs || []).slice(-20).reverse().map(log => ({ at: log.at, source: log.source, delta: log.delta, radar_after: log.radar_after, archetype_id: log.archetype_id })) } });
  } catch (error) { res.status(500).json({ error: 'Could not load Ritual DNA.' }); }
}

async function recommendations(req, res) {
  try {
    const user = await User.findOne(userQuery(req.user.user_id)).select('user_id ritual_dna').lean();
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.ritual_dna?.quiz_taken_at) return res.status(409).json({ error: 'Complete your Ritual DNA quiz first.' });
    res.json({ data: await recommendationsFor(user, { surface: req.query.surface === 'home' ? 'home' : 'account' }) });
  } catch (error) {
    console.error('Ritual DNA recommendations failed:', error);
    res.status(500).json({ error: 'Could not load Ritual DNA recommendations.' });
  }
}

async function productRecommendations(req, res) {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Invalid product ID.' });
    const [user, product] = await Promise.all([
      User.findOne(userQuery(req.user.user_id)).select('user_id ritual_dna').lean(),
      Product.findOne({ product_id: productId, is_active: true }).lean()
    ]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.ritual_dna?.quiz_taken_at) return res.status(409).json({ error: 'Complete your Ritual DNA quiz first.' });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    const [data, archetype] = await Promise.all([
      recommendationsForProduct(user, product),
      archetypeForProfile(user.ritual_dna.archetype_id, user.ritual_dna.archetype_profile_version)
    ]);
    res.json({ data: { ...data, archetype: publicArchetype(archetype) } });
  } catch (error) {
    console.error('Ritual DNA product recommendations failed:', error);
    res.status(500).json({ error: 'Could not load product recommendations.' });
  }
}

async function fits(req, res) {
  try {
    const user = await User.findOne(userQuery(req.user.user_id)).select('user_id ritual_dna').lean();
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.ritual_dna?.quiz_taken_at) return res.json({ data: null });
    const [data, archetype] = await Promise.all([
      fitsFor(user),
      archetypeForProfile(user.ritual_dna.archetype_id, user.ritual_dna.archetype_profile_version)
    ]);
    res.json({ data: { ...data, archetype: publicArchetype(archetype) } });
  } catch (error) {
    console.error('Ritual DNA fits failed:', error);
    res.status(500).json({ error: 'Could not load Ritual DNA fits.' });
  }
}

function publicArchetype(row) {
  return row ? { id: row.archetype_id, name: row.name, tagline: row.tagline, description: row.description,
    profile_version: row.profile_version || 1 } : null;
}

async function submit(req, res) {
  try {
    const [quizRelease, archetypes, user] = await Promise.all([
      activeQuiz(),
      activeArchetypes(),
      User.findOne(userQuery(req.user.user_id))
    ]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const allQuestions = quizRelease?.questions || [];
    if (allQuestions.length !== 7 || archetypes.length !== 4) return res.status(503).json({ error: 'Ritual DNA configuration is incomplete.' });
    if (req.body.quiz_version !== String(quizRelease.version)) return res.status(409).json({ error: 'Quiz changed. Please reload and try again.' });
    const confirmation = req.body.mode === 'confirmation';
    const estimate = confirmation ? await estimateFor(user, archetypes) : null;
    if (confirmation && !estimate) return res.status(409).json({ error: 'You are not eligible for the three-question confirmation. Please take the full quiz.' });
    const questions = allQuestions.filter(question => !confirmation || CONFIRM_CODES.has(question.code));
    const result = scoreQuiz(questions, req.body.answers, archetypes, confirmation);
    const baseline = { ...result.radar };
    if (confirmation) {
      result.radar = Object.fromEntries(Object.keys(baseline).map(axis => [axis, Math.round(.6 * baseline[axis] + .4 * estimate.taste_radar[axis])]));
      result.archetype = nearest(result.radar, archetypes);
      Object.assign(result.attributes, { drink_lean: estimate.drink_lean, lean_confirmed: estimate.lean_confirmed,
        equipment_level: estimate.equipment_level, intensity_preference: estimate.intensity_preference, occasions: estimate.occasions });
    }
    const previous = user.ritual_dna;
    const now = new Date();
    const delta = Object.fromEntries(Object.keys(result.radar).map(axis => [axis, result.radar[axis] - (previous?.taste_radar?.[axis] ?? result.radar[axis])]));
    const evolutionLogs = previous?.evolution_logs?.map(log => log.toObject?.() || log) || [];
    evolutionLogs.push({ event_id: `quiz:${user.user_id}:${now.getTime()}`, at: now, source: 'quiz', source_id: String(quizRelease.version),
      rule_version: String(quizRelease.version), radar_before: previous?.taste_radar || null,
      delta, radar_after: result.radar, archetype_before: previous?.archetype_id || null,
      archetype_id: result.archetype.archetype_id });
    const ritualDna = {
      archetype_id: result.archetype.archetype_id, archetype_profile_version: result.archetype.profile_version,
      taste_radar: result.radar, quiz_baseline: baseline, quiz_version: String(quizRelease.version), quiz_mode: confirmation ? 'confirmation' : 'full',
      quiz_taken_at: now, evolution_logs: evolutionLogs,
      behavior_events: confirmation ? estimate.behavior_events : previous?.behavior_events?.map(event => event.toObject?.() || event) || [],
      is_estimated: false, updated_at: now, last_archetype_change_at: now,
      drink_lean: result.attributes.drink_lean, lean_confirmed: result.attributes.lean_confirmed,
      equipment_level: result.attributes.equipment_level, flavor_tags: result.attributes.flavor_tags,
      intensity_preference: result.attributes.intensity_preference, servings: result.attributes.servings,
      occasions: result.attributes.occasions, quiz_answers: result.answers
    };
    const filter = { _id: user._id };
    if (previous?.updated_at) filter['ritual_dna.updated_at'] = previous.updated_at;
    else filter.ritual_dna = null;
    const saved = await User.updateOne(filter, { $set: { ritual_dna: ritualDna } }, { runValidators: true });
    if (saved.modifiedCount !== 1) return res.status(409).json({ error: 'Your Ritual DNA changed. Please reload and try again.' });
    if (!user.ritual_dna_quiz_completed) {
      try { await awardRitualDnaQuizPoints(user._id.toString()); } catch (error) { console.error('Ritual DNA quiz reward failed:', error); }
    }
    res.json({ result: { radar: result.radar, archetype: publicArchetype(result.archetype), drink_lean: result.attributes.drink_lean, lean_confirmed: result.attributes.lean_confirmed, equipment_level: result.attributes.equipment_level, flavor_tags: result.attributes.flavor_tags, intensity_preference: result.attributes.intensity_preference, servings: result.attributes.servings, occasions: result.attributes.occasions, updated_at: now } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save Ritual DNA.' });
  }
}

module.exports = { questions, profile, submit, recommendations, productRecommendations, fits };
