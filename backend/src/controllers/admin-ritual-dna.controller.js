const RitualArchetype = require('../models/RitualArchetype');
const Release = require('../models/RitualArchetypeRelease');
const VersionCounter = require('../models/RitualArchetypeVersionCounter');
const QuizRelease = require('../models/RitualQuizRelease');
const QuizVersionCounter = require('../models/RitualQuizVersionCounter');
const { bootstrap: quizBootstrap, fields: quizFields, validate: validateQuiz } = require('../services/ritual-dna.quiz-release');
const { bootstrap, validate, fields } = require('../services/ritual-dna.archetype-release');
const { archetypeForProfile } = require('../services/ritual-dna.archetype-release');
const User = require('../models/User');
const { RULE_VERSION } = require('../services/ritual-dna.evidence');
const { EVENT_WEIGHTS, SAVE_DAILY_CAP } = require('../services/ritual-dna.behavior');
const { EVIDENCE_TARGET, MAX_BEHAVIOR_SHARE, ARCHETYPE_MARGIN, ARCHETYPE_COOLDOWN_MS } = require('../services/ritual-dna.evolution');
const { simulateSignatureImpact } = require('../services/ritual-dna.impact');
const { scoreQuiz } = require('../services/ritual-dna.scoring');
const { activeArchetypes } = require('../services/ritual-dna.archetype-release');

const pageNumber = value => Math.max(1, Math.min(100000, Number.parseInt(value, 10) || 1));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function customers(req, res) {
  try {
    const page = pageNumber(req.query.page);
    const limit = 20;
    const search = String(req.query.search || '').trim().slice(0, 100);
    const status = String(req.query.status || 'all');
    const archetype = String(req.query.archetype || '').trim().slice(0, 50);
    const filter = { role: 'customer' };
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ user_id: pattern }, { profile_name: pattern }, { email: pattern }];
    }
    if (status === 'completed') filter['ritual_dna.quiz_taken_at'] = { $type: 'date' };
    else if (status === 'missing') filter['ritual_dna.quiz_taken_at'] = { $not: { $type: 'date' } };
    else if (status !== 'all') return res.status(400).json({ error: 'Invalid DNA status.' });
    if (archetype) filter['ritual_dna.archetype_id'] = archetype;
    const [total, rows] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).select('user_id profile_name email ritual_dna.archetype_id ritual_dna.quiz_taken_at ritual_dna.updated_at')
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean()
    ]);
    res.json({ data: rows.map(row => ({
      user_id: row.user_id, name: row.profile_name, email: row.email,
      archetype_id: row.ritual_dna?.archetype_id || null,
      quiz_taken_at: row.ritual_dna?.quiz_taken_at || null,
      updated_at: row.ritual_dna?.updated_at || null
    })), total, page, limit });
  } catch (error) {
    console.error('Could not list Ritual DNA customers:', error);
    res.status(500).json({ error: 'Could not load customers.' });
  }
}

function displaySource(log, event) {
  if (log.source === 'quiz' || String(log.event_id).startsWith('quiz:')) return 'quiz';
  if (String(log.event_id).startsWith('refund:')) {
    if (event?.source === 'product_saved') return 'product_unsaved';
    if (event?.source === 'recipe_saved') return 'recipe_unsaved';
    return 'order_refund';
  }
  return log.source;
}

async function customerDetail(req, res) {
  try {
    const page = pageNumber(req.query.page);
    const limit = 20;
    const user = await User.findOne({ role: 'customer', user_id: req.params.userId })
      .select('user_id profile_name email ritual_dna').lean();
    if (!user) return res.status(404).json({ error: 'Customer not found.' });
    const dna = user.ritual_dna;
    if (!dna?.quiz_taken_at) return res.json({ data: {
      user_id: user.user_id, name: user.profile_name, email: user.email, dna: null,
      history: [], history_total: 0, page, limit
    } });
    const archetype = await archetypeForProfile(dna.archetype_id, dna.archetype_profile_version);
    const events = new Map((dna.behavior_events || []).map(event => [event.event_id, event]));
    const logs = [...(dna.evolution_logs || [])].reverse();
    const history = logs.slice((page - 1) * limit, page * limit).map(log => {
      const eventId = String(log.event_id || '');
      const behaviorId = eventId.startsWith('apply:') ? eventId.slice(6)
        : eventId.startsWith('refund:') ? eventId.slice(7).replace(/:\d+$/, '') : null;
      const event = behaviorId ? events.get(behaviorId) : null;
      return {
        event_id: eventId, at: log.at, source: displaySource(log, event),
        source_id: log.source_id || event?.source_id || null, rule_version: log.rule_version,
        weight: event?.weight || null, delta: log.delta,
        radar_before: log.radar_before || null, radar_after: log.radar_after,
        target_profile_before: log.target_profile_before || null,
        target_profile_after: log.target_profile_after || null,
        archetype_before: log.archetype_before || null, archetype_id: log.archetype_id
      };
    });
    res.json({ data: {
      user_id: user.user_id, name: user.profile_name, email: user.email,
      dna: { archetype_id: dna.archetype_id, archetype_name: archetype?.name || dna.archetype_id,
        archetype_tagline: archetype?.tagline || '', radar: dna.taste_radar,
        baseline: dna.quiz_baseline, quiz_version: dna.quiz_version,
        quiz_taken_at: dna.quiz_taken_at, updated_at: dna.updated_at,
        last_archetype_change_at: dna.last_archetype_change_at },
      history, history_total: logs.length, page, limit
    } });
  } catch (error) {
    console.error('Could not load Ritual DNA customer:', error);
    res.status(500).json({ error: 'Could not load customer Ritual DNA.' });
  }
}

async function overview(req, res) {
  try {
    await Promise.all([bootstrap(), quizBootstrap()]);
    const [releaseRows, quizReleaseRows] = await Promise.all([
      Release.find().sort({ version: -1 }).lean(),
      QuizRelease.find().sort({ version: 1 }).lean()
    ]);
    const activeRelease = releaseRows.find(row => row.status === 'active');
    const activeQuizRelease = quizReleaseRows.find(row => row.status === 'active');
    const [archetypes, totalCustomers, archetypeCounts, versionCounts] = await Promise.all([
      RitualArchetype.find()
        .select('archetype_id name tagline description badge_icon taste_profile profile_version is_active updated_at')
        .sort({ archetype_id: 1 }).lean(),
      User.countDocuments({ role: 'customer' }),
      User.aggregate([
        { $match: { 'ritual_dna.quiz_taken_at': { $type: 'date' } } },
        { $group: { _id: '$ritual_dna.archetype_id', count: { $sum: 1 } } }
      ]),
      User.aggregate([
        { $match: { 'ritual_dna.quiz_taken_at': { $type: 'date' } } },
        { $group: { _id: '$ritual_dna.quiz_version', count: { $sum: 1 } } }
      ])
    ]);

    const activeQuestions = activeQuizRelease.questions;
    const versionMembers = new Map(versionCounts.map(row => [String(row._id), row.count]));
    const versions = quizReleaseRows.map(row => {
      return {
        version: String(row.version), question_count: row.questions.length,
        active_question_count: row.status === 'active' ? row.questions.length : 0,
        member_count: versionMembers.get(String(row.version)) || 0
      };
    });
    const distribution = new Map(archetypeCounts.map(row => [String(row._id), row.count]));
    const profiles = archetypeCounts.reduce((sum, row) => sum + row.count, 0);
    res.json({ data: {
      summary: { total_customers: totalCustomers, profiles, active_question_count: activeQuestions.length,
        active_archetype_count: archetypes.filter(row => row.is_active).length },
      versions,
      active_quiz: { version: String(activeQuizRelease.version), questions: activeQuestions },
      quiz_releases: quizReleaseRows.map(row => ({ version: row.version, status: row.status,
        source_version: row.source_version, updated_at: row.updated_at, published_at: row.published_at,
        tested_at: row.tested_at,
        created_by: row.created_by, member_count: versionMembers.get(String(row.version)) || 0,
        questions: row.questions.map(question => ({ ...question, quiz_version: String(row.version) })) })),
      archetypes: activeRelease.archetypes.map(row => ({ ...row, profile_version: activeRelease.version, member_count: distribution.get(row.archetype_id) || 0 })),
      archetype_releases: releaseRows.map(row => ({ version: row.version, status: row.status, source_version: row.source_version,
        updated_at: row.updated_at, published_at: row.published_at, created_by: row.created_by,
        archetypes: row.archetypes.map(item => ({ ...item, profile_version: row.version, member_count: distribution.get(item.archetype_id) || 0 })) })),
      behavior_rules: {
        version: RULE_VERSION,
        evidence_target: EVIDENCE_TARGET,
        max_behavior_share: MAX_BEHAVIOR_SHARE,
        archetype_margin: ARCHETYPE_MARGIN,
        archetype_cooldown_days: ARCHETYPE_COOLDOWN_MS / (24 * 60 * 60 * 1000),
        save_daily_cap: SAVE_DAILY_CAP,
        events: [
          { key: 'order', label: 'Delivered order', weight: EVENT_WEIGHTS.order, daily_cap: null },
          { key: 'recipe_saved', label: 'Saved recipe', weight: EVENT_WEIGHTS.recipe_saved, daily_cap: SAVE_DAILY_CAP },
          { key: 'product_saved', label: 'Saved product', weight: EVENT_WEIGHTS.product_saved, daily_cap: SAVE_DAILY_CAP }
        ]
      }
    } });
  } catch (error) {
    console.error('Could not load Ritual DNA admin overview:', error);
    res.status(500).json({ error: 'Could not load Ritual DNA overview.' });
  }
}

async function createDraft(req, res) {
  try {
    await bootstrap();
    const active = await Release.findOne({ status: 'active' }).lean();
    const sourceVersion = req.body?.source_version;
    const source = sourceVersion == null ? active : await Release.findOne({ version: Number(sourceVersion), status: 'archived', published_at: { $ne: null } }).lean();
    if (!source) return res.status(404).json({ error: 'Archived source version not found.' });
    const latest = await Release.findOne().sort({ version: -1 }).lean();
    await VersionCounter.updateOne({ _id: 'archetype' }, { $max: { value: latest.version } }, { upsert: true });
    const counter = await VersionCounter.findOneAndUpdate({ _id: 'archetype' }, { $inc: { value: 1 } }, { new: true });
    const created = await Release.create({ version: counter.value, status: 'draft', source_version: active.version,
      archetypes: source.archetypes.map(fields), created_by: req.user.user_id });
    await req.writeActivityLog({ actionType: 'ritual-dna.draft', targetEntity: 'ritual_archetype_release', targetId: String(created.version), newValue: { status: 'draft', source_version: source.version } });
    res.status(201).json({ data: created });
  } catch (error) { res.status(error.code === 11000 ? 409 : 500).json({ error: 'Could not create draft.' }); }
}

async function saveDraft(req, res) {
  try {
    const release = await Release.findOne({ version: Number(req.params.version), status: 'draft' });
    if (!release) return res.status(404).json({ error: 'Editable draft not found.' });
    const rows = req.body?.archetypes;
    const issue = validate(rows);
    if (issue) return res.status(400).json({ error: issue });
    if (rows.some(row => !release.archetypes.some(old => old.archetype_id === row.archetype_id))) return res.status(400).json({ error: 'Archetype IDs cannot change in this release.' });
    const expectedDate = new Date(req.body?.updated_at);
    if (Number.isNaN(expectedDate.getTime())) return res.status(400).json({ error: 'Draft revision is required.' });
    const updated = await Release.findOneAndUpdate({ _id: release._id, status: 'draft', updated_at: expectedDate },
      { $set: { archetypes: rows.map(fields) } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ error: 'Draft changed. Reload before saving.' });
    await req.writeActivityLog({ actionType: 'ritual-dna.save-draft', targetEntity: 'ritual_archetype_release', targetId: String(updated.version), oldValue: { archetypes: release.archetypes }, newValue: { archetypes: updated.archetypes } });
    res.json({ data: updated });
  } catch (error) { res.status(500).json({ error: 'Could not save draft.' }); }
}

async function signatureImpact(req, res) {
  try {
    const version = Number(req.params.version);
    if (!Number.isSafeInteger(version) || version < 1) return res.status(400).json({ error: 'Invalid version.' });
    const [release, active] = await Promise.all([
      Release.findOne({ version, status: 'draft' }).lean(),
      Release.findOne({ status: 'active' }).lean()
    ]);
    if (!release || !active || release.source_version !== active.version) {
      return res.status(409).json({ error: 'Draft is no longer based on the live version.' });
    }
    const rows = req.body?.archetypes;
    const issue = validate(rows);
    if (issue) return res.status(400).json({ error: issue });
    const selectedId = String(req.body?.archetype_id || '');
    const selectedRow = rows.find(row => row.archetype_id === selectedId);
    if (!selectedRow || !active.archetypes.some(row => row.archetype_id === selectedId)) {
      return res.status(400).json({ error: 'Select a valid archetype.' });
    }

    const profiles = User.find({ role: 'customer', 'ritual_dna.quiz_taken_at': { $type: 'date' } })
      .select('ritual_dna.taste_radar').lean().cursor();
    const proposed = active.archetypes.map(row => row.archetype_id === selectedId ? selectedRow : row);
    const impact = await simulateSignatureImpact(profiles, active.archetypes, proposed, selectedId);
    res.json({ data: { ...impact, archetype_id: selectedId, source_version: active.version } });
  } catch (error) {
    console.error('Could not simulate Ritual DNA signature impact:', error);
    res.status(500).json({ error: 'Could not simulate signature impact.' });
  }
}

async function changeStatus(req, res) {
  const action = req.params.action;
  const transitions = { test: ['draft', 'testing'], edit: ['testing', 'draft'], publish: ['testing', 'active'] };
  if (!transitions[action]) return res.status(400).json({ error: 'Invalid action.' });
  try {
    const [from, to] = transitions[action];
    const release = await Release.findOne({ version: Number(req.params.version), status: from }).lean();
    if (!release) return res.status(409).json({ error: `Version must be ${from} first.` });
    const issue = validate(release.archetypes);
    if (issue) return res.status(400).json({ error: issue });
    if (action === 'publish') {
      if (!release.tested_at) return res.status(409).json({ error: 'Run a complete quiz simulation before publishing.' });
      const active = await Release.findOne({ status: 'active' }).lean();
      if (!active || release.source_version !== active.version) return res.status(409).json({ error: 'Active version changed; create a new draft.' });
      const session = await Release.db.startSession();
      try {
        await session.withTransaction(async () => {
          const archived = await Release.updateOne({ _id: active._id, status: 'active' }, { $set: { status: 'archived' } }, { session });
          if (archived.modifiedCount !== 1) throw new Error('Active version changed.');
          const published = await Release.updateOne({ _id: release._id, status: 'testing' },
            { $set: { status: 'active', published_at: new Date(), published_by: req.user.user_id } }, { session });
          if (published.modifiedCount !== 1) throw new Error('Testing version changed.');
        });
      } finally { await session.endSession(); }
    } else {
      const updated = await Release.updateOne({ _id: release._id, status: from }, { $set: { status: to } });
      if (updated.modifiedCount !== 1) return res.status(409).json({ error: 'Version changed. Reload.' });
    }
    await req.writeActivityLog({ actionType: `ritual-dna.${action}`, targetEntity: 'ritual_archetype_release', targetId: String(release.version), oldValue: { status: from }, newValue: { status: to } });
    res.json({ data: { version: release.version, status: to } });
  } catch (error) { console.error('Ritual DNA release transition failed:', error); res.status(500).json({ error: 'Could not change release status.' }); }
}

async function deleteDraft(req, res) {
  try {
    const version = Number(req.params.version);
    if (!Number.isSafeInteger(version) || version < 1) return res.status(400).json({ error: 'Invalid version.' });
    const release = await Release.findOneAndDelete({ version, status: { $in: ['draft', 'archived'] }, published_at: null });
    if (!release) return res.status(409).json({ error: 'Only an unpublished draft can be deleted. Reopen a testing version first.' });
    await req.writeActivityLog({ actionType: 'ritual-dna.delete-draft', targetEntity: 'ritual_archetype_release',
      targetId: String(version), oldValue: { status: release.status, source_version: release.source_version, archetypes: release.archetypes },
      newValue: { deleted: true } });
    res.json({ data: { version, deleted: true } });
  } catch (error) {
    console.error('Could not delete Ritual DNA draft:', error);
    res.status(500).json({ error: 'Could not delete draft.' });
  }
}

async function createQuizDraft(req, res) {
  try {
    await quizBootstrap();
    const active = await QuizRelease.findOne({ status: 'active' }).lean();
    const sourceVersion = req.body?.source_version;
    const source = sourceVersion == null ? active : await QuizRelease.findOne({ version: Number(sourceVersion), status: 'archived', published_at: { $ne: null } }).lean();
    if (!source) return res.status(404).json({ error: 'Published source version not found.' });
    const latest = await QuizRelease.findOne().sort({ version: -1 }).lean();
    await QuizVersionCounter.updateOne({ _id: 'quiz' }, { $max: { value: latest.version } }, { upsert: true });
    const counter = await QuizVersionCounter.findOneAndUpdate({ _id: 'quiz' }, { $inc: { value: 1 } }, { new: true });
    const created = await QuizRelease.create({ version: counter.value, status: 'draft', source_version: active.version,
      questions: source.questions.map(quizFields), created_by: req.user.user_id });
    await req.writeActivityLog({ actionType: 'ritual-dna.quiz-draft', targetEntity: 'ritual_quiz_release', targetId: String(created.version), newValue: { status: 'draft', source_version: source.version } });
    res.status(201).json({ data: created });
  } catch (error) {
    console.error('Could not create Ritual DNA quiz draft:', error);
    res.status(error.code === 11000 ? 409 : 500).json({ error: 'Could not create quiz draft.' });
  }
}

async function saveQuizDraft(req, res) {
  try {
    const release = await QuizRelease.findOne({ version: Number(req.params.version), status: 'draft' });
    if (!release) return res.status(404).json({ error: 'Editable quiz draft not found.' });
    const questions = req.body?.questions;
    const issue = validateQuiz(questions);
    if (issue) return res.status(400).json({ error: issue });
    const original = new Map(release.questions.map(row => [row.question_id, row]));
    if (questions.some(row => {
      const old = original.get(row.question_id);
      return !old || old.code !== row.code || old.options.length !== row.options.length ||
        row.options.some(option => !old.options.some(prior => prior.option_id === option.option_id));
    })) return res.status(400).json({ error: 'Question and answer IDs must stay fixed within a release.' });
    const expectedDate = new Date(req.body?.updated_at);
    if (Number.isNaN(expectedDate.getTime())) return res.status(400).json({ error: 'Draft revision is required.' });
    const updated = await QuizRelease.findOneAndUpdate({ _id: release._id, status: 'draft', updated_at: expectedDate },
      { $set: { questions: questions.map(quizFields) } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ error: 'Draft changed. Reload before saving.' });
    await req.writeActivityLog({ actionType: 'ritual-dna.quiz-save-draft', targetEntity: 'ritual_quiz_release', targetId: String(updated.version), oldValue: { questions: release.questions }, newValue: { questions: updated.questions } });
    res.json({ data: updated });
  } catch (error) {
    console.error('Could not save Ritual DNA quiz draft:', error);
    res.status(500).json({ error: 'Could not save quiz draft.' });
  }
}

async function changeQuizStatus(req, res) {
  const action = req.params.action;
  const transitions = { test: ['draft', 'testing'], edit: ['testing', 'draft'], publish: ['testing', 'active'] };
  if (!transitions[action]) return res.status(400).json({ error: 'Invalid action.' });
  try {
    const [from, to] = transitions[action];
    const release = await QuizRelease.findOne({ version: Number(req.params.version), status: from }).lean();
    if (!release) return res.status(409).json({ error: `Quiz version must be ${from} first.` });
    const issue = validateQuiz(release.questions);
    if (issue) return res.status(400).json({ error: issue });
    if (action === 'publish') {
      const active = await QuizRelease.findOne({ status: 'active' }).lean();
      if (!active || release.source_version !== active.version) return res.status(409).json({ error: 'Live quiz changed; create a new draft.' });
      const session = await QuizRelease.db.startSession();
      try {
        await session.withTransaction(async () => {
          const archived = await QuizRelease.updateOne({ _id: active._id, status: 'active' }, { $set: { status: 'archived' } }, { session });
          if (archived.modifiedCount !== 1) throw new Error('Live quiz changed.');
          const published = await QuizRelease.updateOne({ _id: release._id, status: 'testing' },
            { $set: { status: 'active', published_at: new Date(), published_by: req.user.user_id } }, { session });
          if (published.modifiedCount !== 1) throw new Error('Testing quiz changed.');
        });
      } finally { await session.endSession(); }
    } else {
      const updated = await QuizRelease.updateOne({ _id: release._id, status: from }, { $set: { status: to, tested_at: null } });
      if (updated.modifiedCount !== 1) return res.status(409).json({ error: 'Quiz version changed. Reload.' });
    }
    await req.writeActivityLog({ actionType: `ritual-dna.quiz-${action}`, targetEntity: 'ritual_quiz_release', targetId: String(release.version), oldValue: { status: from }, newValue: { status: to } });
    res.json({ data: { version: release.version, status: to } });
  } catch (error) {
    console.error('Could not transition Ritual DNA quiz version:', error);
    res.status(500).json({ error: 'Could not change quiz version.' });
  }
}

async function deleteQuizDraft(req, res) {
  try {
    const version = Number(req.params.version);
    if (!Number.isSafeInteger(version) || version < 1) return res.status(400).json({ error: 'Invalid version.' });
    const release = await QuizRelease.findOneAndDelete({ version, status: 'draft', published_at: null });
    if (!release) return res.status(409).json({ error: 'Only an unpublished quiz draft can be deleted. Reopen a testing version first.' });
    await req.writeActivityLog({ actionType: 'ritual-dna.quiz-delete-draft', targetEntity: 'ritual_quiz_release', targetId: String(version), oldValue: { questions: release.questions }, newValue: { deleted: true } });
    res.json({ data: { version, deleted: true } });
  } catch (error) {
    console.error('Could not delete Ritual DNA quiz draft:', error);
    res.status(500).json({ error: 'Could not delete quiz draft.' });
  }
}

async function simulateQuiz(req, res) {
  try {
    const release = await QuizRelease.findOne({ version: Number(req.params.version), status: 'testing' }).lean();
    if (!release) return res.status(409).json({ error: 'Send this quiz version to testing first.' });
    const archetypes = await activeArchetypes();
    const result = scoreQuiz(release.questions, req.body?.answers, archetypes);
    await QuizRelease.updateOne({ _id: release._id, status: 'testing' }, { $set: { tested_at: new Date() } });
    res.json({ data: { radar: result.radar, archetype: { id: result.archetype.archetype_id, name: result.archetype.name }, attributes: result.attributes } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not simulate quiz result.' });
  }
}

module.exports = { overview, customers, customerDetail, createDraft, saveDraft, signatureImpact, changeStatus, deleteDraft,
  createQuizDraft, saveQuizDraft, changeQuizStatus, deleteQuizDraft, simulateQuiz };
