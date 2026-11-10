const QuizConfig = require('../models/QuizConfig');
const QuizSettings = require('../models/QuizSettings');
const StarterKit = require('../models/StarterKit');
const Product = require('../models/Product');
const StarterQuizDraft = require('../models/StarterQuizDraft');
const { annotateSlot, bestInStock, loadProductCatalog, productsForSlot, slotMatches, stockLabel } = require('../services/starter-quiz.slots');

const BUNDLE_DISCOUNT_PERCENT = 20;

const SETTINGS_ID = 'starter_kit';
const ROLES = ['copy_only', 'primary', 'secondary', 'hard_filter'];
const DRINKS = ['matcha', 'coffee', 'mixed', 'any'];
const LEVELS = ['beginner', 'ritual', 'craft', 'any'];
const BUDGETS = ['under_60', 'mid_60_120', 'over_120'];
const CATEGORIES = ['matcha', 'coffee', 'tools', 'drinkware'];

const ROLE_BY_CODE = {
  q1: 'primary',
  q2: 'primary',
  q2b: 'secondary',
  q3: 'secondary',
  q4: 'copy_only',
  q5: 'hard_filter'
};

const SEED_KITS = [
  {
    kit_id: 'SK001',
    name: 'The Matcha Starter',
    tier: 'Everyday Sip',
    description: 'Everything you need for your first bowl of matcha.',
    drink: 'matcha',
    level: 'beginner',
    budget: 'under_60',
    discount_percent: 20,
    status: 'active',
    order: 1,
    slots: [
      { slot_id: 'S1', name: 'Matcha powder', category: 'matcha', attribute: 'Any grade', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Matcha tool', category: 'tools', attribute: 'Any type', constraint: 'Any price', hero: false },
      { slot_id: 'S3', name: 'Drinkware', category: 'drinkware', attribute: 'Any type', constraint: 'Any price', hero: false }
    ]
  },
  {
    kit_id: 'SK002',
    name: 'The Coffee Starter',
    tier: 'Everyday Sip',
    description: 'A first coffee setup: beans, a brewer, and a mug.',
    drink: 'coffee',
    level: 'beginner',
    budget: 'under_60',
    discount_percent: 20,
    status: 'active',
    order: 2,
    slots: [
      { slot_id: 'S1', name: 'Coffee', category: 'coffee', attribute: 'Any roast', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Brewer', category: 'tools', attribute: 'Type: Dripper', constraint: 'Any price', hero: false },
      { slot_id: 'S3', name: 'Mug', category: 'drinkware', attribute: 'Type: Mug', constraint: 'Any price', hero: false }
    ]
  },
  {
    kit_id: 'SK003',
    name: 'The Matcha Ritual',
    tier: 'Ritual',
    description: 'Ceremonial matcha with the tools for a full bowl.',
    drink: 'matcha',
    level: 'ritual',
    budget: 'mid_60_120',
    discount_percent: 20,
    status: 'active',
    order: 3,
    slots: [
      { slot_id: 'S1', name: 'Ceremonial matcha', category: 'matcha', attribute: 'Ceremonial', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Tool', category: 'tools', attribute: 'Type: Chasen', constraint: 'Any price', hero: false },
      { slot_id: 'S3', name: 'Bowl', category: 'drinkware', attribute: 'Type: Bowl', constraint: 'Any price', hero: false }
    ]
  },
  {
    kit_id: 'SK004',
    name: 'The Pour-Over Set',
    tier: 'Ritual',
    description: 'Beans, a dripper, a kettle, and a cup.',
    drink: 'coffee',
    level: 'ritual',
    budget: 'mid_60_120',
    discount_percent: 20,
    status: 'suspended',
    order: 4,
    slots: [
      { slot_id: 'S1', name: 'Beans', category: 'coffee', attribute: 'Any roast', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Dripper', category: 'tools', attribute: 'Type: Dripper', constraint: 'Any price', hero: false },
      { slot_id: 'S3', name: 'Kettle', category: 'tools', attribute: 'Type: Kettle', constraint: 'Any price', hero: false },
      { slot_id: 'S4', name: 'Cup', category: 'drinkware', attribute: 'Type: Cup', constraint: 'Any price', hero: false }
    ]
  },
  {
    kit_id: 'SK005',
    name: 'The Café Duo',
    tier: 'Everyday Sip',
    description: 'One matcha, one coffee, and a cup.',
    drink: 'mixed',
    level: 'any',
    budget: 'mid_60_120',
    discount_percent: 20,
    status: 'active',
    order: 5,
    slots: [
      { slot_id: 'S1', name: 'Matcha', category: 'matcha', attribute: 'Any grade', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Coffee', category: 'coffee', attribute: 'Any roast', constraint: 'Any price', hero: false },
      { slot_id: 'S3', name: 'Cup', category: 'drinkware', attribute: 'Type: Cup', constraint: 'Any price', hero: false }
    ]
  },
  {
    kit_id: 'SK006',
    name: 'The Origin Edit',
    tier: 'Craft',
    description: 'A premium pick across tea or coffee, plus a tool and a cup.',
    drink: 'any',
    level: 'craft',
    budget: 'over_120',
    discount_percent: 20,
    status: 'draft',
    order: 6,
    slots: [
      { slot_id: 'S1', name: 'Premium tea or coffee', category: 'matcha', attribute: 'Premium', constraint: 'Any price', hero: true },
      { slot_id: 'S2', name: 'Tool', category: 'tools', attribute: 'Any type', constraint: 'Any price', hero: false },
      { slot_id: 'S3', name: 'Cup', category: 'drinkware', attribute: 'Type: Cup', constraint: 'Any price', hero: false }
    ]
  }
];

function money(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function budgetLabel(budget) {
  if (budget === 'under_60') return '< $60';
  if (budget === 'over_120') return '> $120';
  return '$60–120';
}

function defaultRole(question) {
  if (ROLES.includes(question.matching_role)) return question.matching_role;
  return ROLE_BY_CODE[question.code] || 'secondary';
}

function publicQuestion(question) {
  return {
    question_id: question.question_id,
    code: question.code,
    question: question.question,
    order: question.order,
    matching_role: defaultRole(question),
    is_active: question.is_active !== false,
    visible_when: question.visible_when || { question_id: null, option_id: null },
    options: (question.options || []).map((option) => ({
      option_id: option.option_id,
      text: option.text,
      hint: option.hint || '',
      icon: option.icon || '',
      code: option.code,
      score_weights: option.score_weights || {}
    }))
  };
}

function displayStatus(kit, stock) {
  if (kit.status === 'draft') return 'draft';
  if (kit.status === 'suspended' || stock.code === 'hero_oos' || stock.code === 'slot_oos') return 'suspended';
  return 'active';
}

function annotateKit(kit, products) {
  const slots = (kit.slots || []).map((slot) => annotateSlot(slot, products));
  const stock = stockLabel(slots);
  const retailMin = slots.reduce((sum, slot) => sum + slot.min_price, 0);
  const retailMax = slots.reduce((sum, slot) => sum + slot.max_price, 0);
  const factor = 1 - BUNDLE_DISCOUNT_PERCENT / 100;
  return {
    kit_id: kit.kit_id,
    name: kit.name,
    tier: kit.tier,
    description: kit.description || '',
    image_url: kit.image_url || '',
    drink: kit.drink,
    level: kit.level,
    budget: kit.budget,
    budget_label: budgetLabel(kit.budget),
    discount_percent: BUNDLE_DISCOUNT_PERCENT,
    status: kit.status,
    display_status: displayStatus(kit, stock),
    order: kit.order,
    slots: slots.map(({ pick, ...slot }) => slot),
    slot_summary: slots.map((slot) => slot.name).join(' · '),
    stock,
    retail: { min: retailMin, max: retailMax },
    bundle: { min: retailMin * factor, max: retailMax * factor },
    price_label: `${money(retailMin)} → ${money(retailMin * factor)}`
  };
}

async function loadProducts() {
  return loadProductCatalog(Product);
}

async function ensureSettings() {
  const existing = await QuizSettings.findById(SETTINGS_ID).lean();
  if (existing) return existing;
  await QuizSettings.create({ _id: SETTINGS_ID, enabled: true });
  return { _id: SETTINGS_ID, enabled: true };
}

async function ensureKits() {
  const count = await StarterKit.countDocuments();
  if (count > 0) return;
  await StarterKit.insertMany(SEED_KITS);
}

function cleanOption(option, index) {
  const text = String(option?.text || '').trim();
  const code = String(option?.code || '').trim();
  if (!text || !code) {
    const error = new Error('Each option needs a label and an answer value.');
    error.status = 400;
    throw error;
  }
  return {
    option_id: String(option.option_id || code || `OPT${index + 1}`).trim(),
    text,
    hint: String(option.hint || ''),
    icon: /^[a-z0-9-]{0,64}$/.test(String(option?.icon || '').trim().toLowerCase())
      ? String(option?.icon || '').trim().toLowerCase()
      : '',
    code,
    score_weights: option.score_weights && typeof option.score_weights === 'object' ? option.score_weights : {}
  };
}

function cleanQuestion(body, existing) {
  const question = String(body.question || '').trim();
  if (!question) {
    const error = new Error('Question text is required.');
    error.status = 400;
    throw error;
  }
  const role = ROLES.includes(body.matching_role) ? body.matching_role : 'secondary';
  const options = (Array.isArray(body.options) ? body.options : []).map(cleanOption);
  if (!options.length) {
    const error = new Error('A question needs at least one option.');
    error.status = 400;
    throw error;
  }
  const codes = new Set();
  for (const option of options) {
    if (codes.has(option.code)) {
      const error = new Error(`Answer value “${option.code}” is used more than once.`);
      error.status = 400;
      throw error;
    }
    codes.add(option.code);
  }
  return {
    question,
    matching_role: role,
    is_active: body.is_active !== false,
    options,
    visible_when: body.visible_when || existing?.visible_when || { question_id: null, option_id: null }
  };
}

function cleanSlot(slot, index) {
  const name = String(slot?.name || '').trim();
  const category = String(slot?.category || '').trim();
  if (!name || !CATEGORIES.includes(category)) {
    const error = new Error('Each slot needs a name and a product category.');
    error.status = 400;
    throw error;
  }
  return {
    slot_id: String(slot.slot_id || `S${index + 1}`),
    name,
    category,
    attribute: String(slot.attribute || 'Any').trim() || 'Any',
    constraint: String(slot.constraint || 'Any price').trim() || 'Any price',
    hero: !!slot.hero
  };
}

function cleanKit(body, { enforceSlotCount = true } = {}) {
  const name = String(body.name || '').trim();
  if (!name) {
    const error = new Error('Kit name is required.');
    error.status = 400;
    throw error;
  }
  if (!DRINKS.includes(body.drink) || !LEVELS.includes(body.level) || !BUDGETS.includes(body.budget)) {
    const error = new Error('Drink, level, and budget are required.');
    error.status = 400;
    throw error;
  }
  const slots = (Array.isArray(body.slots) ? body.slots : []).map(cleanSlot);
  if (enforceSlotCount && (slots.length < 2 || slots.length > 3)) {
    const error = new Error(`${name} needs 2 or 3 slots.`);
    error.status = 400;
    throw error;
  }
  if (!slots.length) {
    const error = new Error('A kit needs at least one slot.');
    error.status = 400;
    throw error;
  }
  if (slots.filter((slot) => slot.hero).length > 1) {
    const error = new Error('Only one slot can be the hero.');
    error.status = 400;
    throw error;
  }
  if (body.discount_percent != null && Number(body.discount_percent) !== BUNDLE_DISCOUNT_PERCENT) {
    const error = new Error('Bundle discount is fixed at 20%.');
    error.status = 400;
    throw error;
  }
  const status = ['active', 'suspended', 'draft'].includes(body.status) ? body.status : 'draft';
  return {
    name,
    tier: String(body.tier || 'Everyday Sip').trim() || 'Everyday Sip',
    description: String(body.description || '').trim(),
    image_url: String(body.image_url || '').trim(),
    slots,
    drink: body.drink,
    level: body.level,
    budget: body.budget,
    discount_percent: BUNDLE_DISCOUNT_PERCENT,
    status
  };
}

async function assertNoOverlap(kit, kitId) {
  if (kit.status !== 'active') return;
  const clash = await StarterKit.findOne({
    kit_id: { $ne: kitId || '' },
    status: 'active',
    drink: kit.drink,
    level: kit.level,
    budget: kit.budget
  }).lean();
  if (!clash) return;
  const error = new Error(`No overlap with other active kits. “${clash.name}” already uses this Drink + Level + Budget.`);
  error.status = 409;
  throw error;
}

function axisMatches(kitValue, answer) {
  return kitValue === 'any' || kitValue === answer;
}

function explainTest(kits, products, answers) {
  const drink = DRINKS.includes(answers.drink) ? answers.drink : 'matcha';
  const level = LEVELS.includes(answers.level) ? answers.level : 'beginner';
  const budget = BUDGETS.includes(answers.budget) ? answers.budget : 'under_60';
  const annotated = kits.map((kit) => annotateKit(kit, products));
  const playable = annotated.filter((kit) => kit.status !== 'draft');
  const afterBudget = playable.filter((kit) => axisMatches(kit.budget, budget));
  const afterDrink = afterBudget.filter((kit) => axisMatches(kit.drink, drink));
  const afterLevel = afterDrink.filter((kit) => axisMatches(kit.level, level));
  const usable = afterLevel.filter((kit) => kit.display_status !== 'suspended');
  const names = (list) => list.map((kit) => kit.name).join(', ') || 'none';
  const steps = [
    `Budget ${budgetLabel(budget)} keeps ${afterBudget.length} of ${playable.length} kits (${names(afterBudget)}).`,
    `Drink = ${drink} keeps ${names(afterDrink)}.`,
    `Level = ${level} matches ${names(afterLevel)} and skips suspended kits.`
  ];
  const winner = usable[0] || null;
  if (!winner) {
    const closest = afterLevel[0] || afterDrink[0] || afterBudget[0] || playable[0] || null;
    return {
      drink,
      level,
      budget,
      steps,
      kit: closest,
      suspended: !!closest && closest.display_status === 'suspended',
      picks: [],
      result: closest
        ? `No kit left after a step. Closest kit: ${closest.name}.`
        : 'No kit left after a step.'
    };
  }
  const full = winner.slots.map((slot) => {
    const source = (kits.find((kit) => kit.kit_id === winner.kit_id)?.slots || []).find((item) => item.slot_id === slot.slot_id) || slot;
    const pool = productsForSlot(products, source);
    const pick = bestInStock(pool.filter((product) => slotMatches(product, source)));
    return pick ? pick.name : `${slot.name} (none in stock)`;
  });
  steps.push(`Each slot picks the best in-stock product from its range (${full.join(', ')}).`);
  const sale = winner.bundle.min;
  return {
    drink,
    level,
    budget,
    steps,
    kit: winner,
    suspended: false,
    picks: full,
    result: `Result: ${winner.name} · ${money(sale)} · headline “${winner.description || winner.name}”`
  };
}

function sendError(res, error) {
  const status = error.status || 500;
  return res.status(status).json({ error: error.message || 'Something went wrong.' });
}

function summarizeKit(kit) {
  return {
    kit_id: kit.kit_id,
    name: kit.name,
    tier: kit.tier,
    description: kit.description || '',
    image_url: kit.image_url || '',
    drink: kit.drink,
    level: kit.level,
    budget: kit.budget,
    budget_label: budgetLabel(kit.budget),
    discount_percent: BUNDLE_DISCOUNT_PERCENT,
    status: kit.status,
    display_status: kit.status,
    order: kit.order,
    slots: kit.slots || [],
    slot_summary: (kit.slots || []).map((slot) => slot.name).join(' · '),
    stock: null,
    retail: null,
    bundle: null,
    price_label: ''
  };
}

function assertMatchingRoles(questions) {
  const active = (questions || []).filter((question) => question.is_active !== false);
  const roles = new Set(active.map((question) => defaultRole(question)));
  if (!roles.has('primary') || !roles.has('hard_filter')) {
    const error = new Error('Keep at least one Primary question and one Hard filter question. Without them every kit matches.');
    error.status = 400;
    throw error;
  }
}

function assertDraftOverlap(kits) {
  const seen = new Map();
  for (const kit of kits) {
    if (kit.status !== 'active') continue;
    const key = `${kit.drink}|${kit.level}|${kit.budget}`;
    if (seen.has(key)) {
      const error = new Error(`No overlap with other active kits. “${seen.get(key)}” already uses this Drink + Level + Budget.`);
      error.status = 409;
      throw error;
    }
    seen.set(key, kit.name);
  }
}

function cleanDraft(body) {
  const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
  if (rawQuestions.length > 6) {
    const error = new Error('The quiz can have at most 6 questions.');
    error.status = 400;
    throw error;
  }
  const questions = rawQuestions.map((question, index) => ({
    question_id: String(question.question_id || `SQ${index + 1}`),
    code: String(question.code || `q${index + 1}`),
    order: index + 1,
    ...cleanQuestion(question)
  }));
  assertMatchingRoles(questions);
  const kits = (Array.isArray(body.kits) ? body.kits : []).map((kit, index) => ({
    kit_id: String(kit.kit_id || `SK${index + 1}`),
    order: index + 1,
    ...cleanKit({ ...kit, discount_percent: BUNDLE_DISCOUNT_PERCENT })
  }));
  assertDraftOverlap(kits);
  const enabled = !!body.enabled;
  if (enabled) {
    const count = questions.filter((question) => question.is_active !== false).length;
    if (count < 5 || count > 6) {
      const error = new Error('Turn the quiz on only when it has 5 or 6 active questions.');
      error.status = 400;
      throw error;
    }
  }
  return { enabled, questions, kits };
}

async function publishedConfig() {
  const [settings, questions] = await Promise.all([
    ensureSettings(),
    QuizConfig.find({ quiz_type: 'starter_kit' }).sort({ order: 1 }).lean()
  ]);
  await ensureKits();
  const kits = await StarterKit.find().sort({ order: 1, name: 1 }).lean();
  return {
    enabled: settings.enabled !== false,
    questions: questions.map(publicQuestion),
    kits
  };
}

async function workingKits() {
  const draft = await StarterQuizDraft.findById(SETTINGS_ID).lean();
  if (draft) return draft.kits || [];
  await ensureKits();
  return StarterKit.find().sort({ order: 1, name: 1 }).lean();
}

async function publishCollections(config) {
  const questionIds = config.questions.map((question) => question.question_id);
  await QuizConfig.deleteMany({ quiz_type: 'starter_kit', question_id: { $nin: questionIds } });
  for (const question of config.questions) {
    await QuizConfig.updateOne(
      { question_id: question.question_id },
      { $set: { ...question, quiz_type: 'starter_kit' } },
      { upsert: true }
    );
  }
  const kitIds = config.kits.map((kit) => kit.kit_id);
  if (kitIds.length) await StarterKit.deleteMany({ kit_id: { $nin: kitIds } });
  for (const kit of config.kits) {
    await StarterKit.updateOne({ kit_id: kit.kit_id }, { $set: kit }, { upsert: true });
  }
  await QuizSettings.findByIdAndUpdate(
    SETTINGS_ID,
    { enabled: config.enabled },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function getConfig(_req, res) {
  try {
    const draft = await StarterQuizDraft.findById(SETTINGS_ID).lean();
    if (draft) {
      return res.json({
        enabled: draft.enabled !== false,
        questions: draft.questions || [],
        kits: (draft.kits || []).map(summarizeKit),
        unpublished: true
      });
    }
    const published = await publishedConfig();
    return res.json({
      enabled: published.enabled,
      questions: published.questions,
      kits: published.kits.map(summarizeKit),
      unpublished: false
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function getKitMetrics(_req, res) {
  try {
    const [kits, products] = await Promise.all([
      workingKits(),
      loadProducts()
    ]);
    return res.json({ kits: kits.map((kit) => annotateKit(kit, products)) });
  } catch (error) {
    return sendError(res, error);
  }
}

async function saveDraftConfig(req, res) {
  try {
    const cleaned = cleanDraft(req.body || {});
    await StarterQuizDraft.findByIdAndUpdate(SETTINGS_ID, cleaned, { upsert: true });
    return res.json({
      enabled: cleaned.enabled,
      questions: cleaned.questions,
      kits: cleaned.kits.map(summarizeKit),
      unpublished: true
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function publishDraft(_req, res) {
  try {
    const draft = await StarterQuizDraft.findById(SETTINGS_ID).lean();
    if (!draft) return res.status(400).json({ error: 'There are no unpublished changes.' });
    const cleaned = cleanDraft(draft);
    await publishCollections(cleaned);
    await StarterQuizDraft.deleteOne({ _id: SETTINGS_ID });
    const published = await publishedConfig();
    return res.json({
      enabled: published.enabled,
      questions: published.questions,
      kits: published.kits.map(summarizeKit),
      unpublished: false
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function updateSettings(req, res) {
  try {
    const enabled = !!req.body?.enabled;
    if (enabled) {
      const count = await QuizConfig.countDocuments({ quiz_type: 'starter_kit', is_active: { $ne: false } });
      if (count < 5 || count > 6) {
        return res.status(400).json({ error: 'Turn the quiz on only when it has 5 or 6 active questions.' });
      }
    }
    const settings = await QuizSettings.findByIdAndUpdate(
      SETTINGS_ID,
      { enabled },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ enabled: settings.enabled !== false });
  } catch (error) {
    return sendError(res, error);
  }
}

async function nextQuestionId() {
  const rows = await QuizConfig.find({ quiz_type: 'starter_kit', question_id: /^SQ\d+$/ }).select('question_id').lean();
  let max = 0;
  for (const row of rows) {
    const match = String(row.question_id).match(/^SQ(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `SQ${String(max + 1).padStart(3, '0')}`;
}

async function createQuestion(req, res) {
  try {
    const count = await QuizConfig.countDocuments({ quiz_type: 'starter_kit' });
    if (count >= 6) {
      return res.status(400).json({ error: 'The quiz already has 6 questions.' });
    }
    const cleaned = cleanQuestion({
      question: req.body?.question || 'New question',
      matching_role: req.body?.matching_role || 'secondary',
      options: req.body?.options || [{ text: 'New option', code: 'new_option', hint: '' }]
    });
    const questionId = await nextQuestionId();
    const created = await QuizConfig.create({
      question_id: questionId,
      quiz_type: 'starter_kit',
      code: `q${count + 1}`,
      order: count + 1,
      ...cleaned
    });
    return res.status(201).json({ question: publicQuestion(created.toObject()) });
  } catch (error) {
    return sendError(res, error);
  }
}

async function updateQuestion(req, res) {
  try {
    const existing = await QuizConfig.findOne({ question_id: req.params.questionId, quiz_type: 'starter_kit' });
    if (!existing) return res.status(404).json({ error: 'Question not found.' });
    const cleaned = cleanQuestion(req.body || {}, existing);
    const all = await QuizConfig.find({ quiz_type: 'starter_kit' }).lean();
    assertMatchingRoles(all.map((question) => (
      question.question_id === existing.question_id ? { ...question, ...cleaned } : question
    )));
    existing.question = cleaned.question;
    existing.matching_role = cleaned.matching_role;
    existing.is_active = cleaned.is_active;
    existing.options = cleaned.options;
    existing.visible_when = cleaned.visible_when;
    await existing.save();
    return res.json({ question: publicQuestion(existing.toObject()) });
  } catch (error) {
    return sendError(res, error);
  }
}

async function deleteQuestion(req, res) {
  try {
    const existing = await QuizConfig.findOne({ question_id: req.params.questionId, quiz_type: 'starter_kit' }).lean();
    if (!existing) return res.status(404).json({ error: 'Question not found.' });
    const all = await QuizConfig.find({ quiz_type: 'starter_kit' }).lean();
    assertMatchingRoles(all.filter((question) => question.question_id !== existing.question_id));
    await QuizConfig.deleteOne({ question_id: existing.question_id, quiz_type: 'starter_kit' });
    await QuizConfig.updateMany(
      { quiz_type: 'starter_kit', 'visible_when.question_id': existing.question_id },
      { $set: { visible_when: { question_id: null, option_id: null } } }
    );
    const remaining = await QuizConfig.find({ quiz_type: 'starter_kit' }).sort({ order: 1 }).select('question_id').lean();
    await Promise.all(remaining.map((row, index) => QuizConfig.updateOne({ question_id: row.question_id }, { order: index + 1 })));
    return res.json({ deleted: existing.question_id });
  } catch (error) {
    return sendError(res, error);
  }
}

async function reorderQuestions(req, res) {
  try {
    const ids = Array.isArray(req.body?.question_ids) ? req.body.question_ids.map(String) : [];
    const existing = await QuizConfig.find({ quiz_type: 'starter_kit' }).select('question_id').lean();
    const known = new Set(existing.map((row) => row.question_id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return res.status(400).json({ error: 'Reorder must include every question once.' });
    }
    await Promise.all(ids.map((id, index) => QuizConfig.updateOne({ question_id: id, quiz_type: 'starter_kit' }, { order: index + 1 })));
    return res.json({ question_ids: ids });
  } catch (error) {
    return sendError(res, error);
  }
}

async function nextKitId() {
  const rows = await StarterKit.find({ kit_id: /^SK\d+$/ }).select('kit_id').lean();
  let max = 0;
  for (const row of rows) {
    const match = String(row.kit_id).match(/^SK(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `SK${String(max + 1).padStart(3, '0')}`;
}

async function createKit(req, res) {
  try {
    const cleaned = cleanKit(req.body || {});
    await assertNoOverlap(cleaned);
    const count = await StarterKit.countDocuments();
    const created = await StarterKit.create({ kit_id: await nextKitId(), order: count + 1, ...cleaned });
    const products = await loadProducts();
    return res.status(201).json({ kit: annotateKit(created.toObject(), products) });
  } catch (error) {
    return sendError(res, error);
  }
}

async function updateKit(req, res) {
  try {
    const existing = await StarterKit.findOne({ kit_id: req.params.kitId });
    if (!existing) return res.status(404).json({ error: 'Kit not found.' });
    const cleaned = cleanKit(req.body || {});
    await assertNoOverlap(cleaned, existing.kit_id);
    Object.assign(existing, cleaned);
    await existing.save();
    const products = await loadProducts();
    return res.json({ kit: annotateKit(existing.toObject(), products) });
  } catch (error) {
    return sendError(res, error);
  }
}

async function previewKit(req, res) {
  try {
    const cleaned = cleanKit({
      name: req.body?.name || 'Preview',
      drink: req.body?.drink || 'any',
      level: req.body?.level || 'any',
      budget: req.body?.budget || 'under_60',
      discount_percent: BUNDLE_DISCOUNT_PERCENT,
      status: req.body?.status || 'draft',
      slots: req.body?.slots || []
    }, { enforceSlotCount: false });
    const products = await loadProducts();
    return res.json({ kit: annotateKit({ kit_id: 'preview', order: 0, ...cleaned }, products) });
  } catch (error) {
    return sendError(res, error);
  }
}

async function testRules(req, res) {
  try {
    const products = await loadProducts();
    const kits = Array.isArray(req.body?.kits)
      ? req.body.kits.map((kit, index) => ({
        kit_id: String(kit.kit_id || `SK${index + 1}`),
        order: Number(kit.order) || index + 1,
        ...cleanKit({ ...kit, discount_percent: BUNDLE_DISCOUNT_PERCENT }, { enforceSlotCount: false })
      }))
      : await workingKits();
    return res.json(explainTest(kits, products, req.body || {}));
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = {
  getConfig,
  getKitMetrics,
  saveDraftConfig,
  publishDraft,
  updateSettings,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  createKit,
  updateKit,
  previewKit,
  testRules,
  assertMatchingRoles
};
