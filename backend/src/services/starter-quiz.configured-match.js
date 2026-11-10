const { bestInStock, slotMatches, inStockVariant, variantPrice, productsForSlot } = require('./starter-quiz.slots');

const BUNDLE_DISCOUNT_PERCENT = 20;

const DRINKS = new Set(['matcha', 'coffee', 'mixed', 'any']);
const LEVELS = new Set(['beginner', 'ritual', 'craft', 'any']);
const BUDGETS = new Set(['under_60', 'mid_60_120', 'over_120']);

const DRINK_ALIAS = { m: 'matcha', lm: 'matcha', c: 'coffee', lc: 'coffee', b: 'mixed' };
const LEVEL_ALIAS = { light: 'beginner', balanced: 'beginner', bold: 'ritual', sweet: 'craft' };
const BUDGET_ALIAS = { low: 'under_60', mid: 'mid_60_120', high: 'over_120', any: 'over_120' };

const ROLE_BY_CODE = {
  q1: 'primary',
  q2: 'primary',
  q2b: 'secondary',
  q3: 'secondary',
  q4: 'copy_only',
  q5: 'hard_filter'
};

function roleOf(question) {
  if (['copy_only', 'primary', 'secondary', 'hard_filter'].includes(question.matching_role)) {
    return question.matching_role;
  }
  return ROLE_BY_CODE[question.code] || 'secondary';
}

function axisValue(role, code) {
  const value = String(code || '').trim().toLowerCase();
  if (role === 'primary') return DRINKS.has(value) ? value : DRINK_ALIAS[value] || null;
  if (role === 'secondary') return LEVELS.has(value) ? value : LEVEL_ALIAS[value] || null;
  if (role === 'hard_filter') return BUDGETS.has(value) ? value : BUDGET_ALIAS[value] || null;
  return null;
}

function constraintsFrom(questions, answers) {
  const chosen = new Map((answers || []).map((answer) => [answer.question_id, answer.option_id]));
  const constraints = { drink: [], level: [], budget: [] };
  const headlines = [];

  for (const question of questions || []) {
    const optionId = chosen.get(question.question_id);
    if (!optionId) continue;
    const option = (question.options || []).find((entry) => entry.option_id === optionId);
    if (!option) continue;
    const role = roleOf(question);
    if (role === 'copy_only') {
      headlines.push(option.text);
      continue;
    }
    const value = axisValue(role, option.code);
    if (!value || value === 'any') continue;
    if (role === 'primary') constraints.drink.push(value);
    if (role === 'secondary') constraints.level.push(value);
    if (role === 'hard_filter') constraints.budget.push(value);
  }

  return { constraints, headlines };
}

function kitMatches(kit, constraints) {
  if (constraints.drink.some((value) => kit.drink !== 'any' && kit.drink !== value)) return false;
  if (constraints.level.some((value) => kit.level !== 'any' && kit.level !== value)) return false;
  if (constraints.budget.some((value) => kit.budget !== 'any' && kit.budget !== value)) return false;
  return true;
}

function shapeOf(slots) {
  const powders = slots.filter((slot) => slot.category === 'matcha' || slot.category === 'coffee');
  const lanes = new Set(powders.map((slot) => slot.category));
  const hasTool = slots.some((slot) => slot.category === 'tools');
  let kitType = 'bundle';
  if (lanes.size === 1 && lanes.has('matcha') && hasTool) kitType = 'matcha_kit';
  if (lanes.size === 1 && lanes.has('coffee') && hasTool) kitType = 'coffee_kit';
  const categoryFilter = lanes.size === 1 ? [...lanes][0] : 'all';
  return {
    kitType,
    packSize: slots.length >= 3 ? 3 : 2,
    categoryFilter
  };
}

function slotKeyFor(slot, index, shape) {
  if (slot.category === 'tools') return 'tool';
  if (slot.category === 'drinkware') return 'drinkware';
  if (shape.kitType === 'bundle') return `package-${index}`;
  return 'package';
}

function toItem(slot, product, slotKey) {
  const variant = inStockVariant(product);
  return {
    slotKey,
    slotLabel: slot.name,
    productId: product.product_id,
    variantSku: variant?.sku || '',
    name: product.name,
    price: variant?.price ?? variantPrice(product),
    image: variant?.images?.[0]?.url || product.images?.[0]?.url || '',
    product,
    note: null
  };
}

function fillKit(kit, products) {
  const filled = [];
  for (const slot of kit.slots || []) {
    const pool = productsForSlot(products, slot);
    const matches = [];
    for (let index = 0; index < pool.length; index += 1) {
      if (slotMatches(pool[index], slot)) matches.push(pool[index]);
    }
    const pick = bestInStock(matches);
    if (!pick) return null;
    filled.push({ slot, pick, matches });
  }
  return filled;
}

function matchConfiguredKit({ questions, answers, kits, products, previousItems }) {
  const active = (kits || []).filter((kit) => kit.status === 'active');
  if (!active.length) return { error: 'NO_ACTIVE_KITS' };

  const { constraints, headlines } = constraintsFrom(questions, answers);
  const matched = active.filter((kit) => kitMatches(kit, constraints));
  const catalog = Array.isArray(products) ? products : [];

  for (const kit of matched) {
    const filled = fillKit(kit, catalog);
    if (!filled) continue;
    const shape = shapeOf(filled.map((entry) => entry.slot));
    const items = filled.map((entry, index) => toItem(entry.slot, entry.pick, slotKeyFor(entry.slot, index, shape)));
    const original = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const discount = BUNDLE_DISCOUNT_PERCENT;
    const sale = original * (1 - discount / 100);
    const slotProductOrder = {};
    filled.forEach((entry, index) => {
      const key = slotKeyFor(entry.slot, index, shape);
      const stocked = entry.matches.filter((product) => bestInStock([product]));
      slotProductOrder[key] = stocked.map((product) => product.product_id);
    });
    const notes = [];
    if (Array.isArray(previousItems)) {
      items.forEach((item, index) => {
        const previous = previousItems.find((entry) => entry.slotKey === item.slotKey) || previousItems[index];
        if (previous && previous.productId !== item.productId) notes.push(`Replaces ${previous.name || 'the previous pick'}.`);
      });
    }
    const why = [kit.description, ...headlines].filter(Boolean).join(' ');
    return {
      kit: {
        title: kit.name,
        why: why || kit.name,
        archetypeId: kit.kit_id,
        kitType: shape.kitType,
        packSize: shape.packSize,
        categoryFilter: shape.categoryFilter,
        discountPercent: discount,
        pricing: { original: Math.round(original * 100) / 100, sale: Math.round(sale * 100) / 100 },
        notes,
        items,
        slotProductOrder,
        bundleId: `${kit.kit_id}-${items.map((item) => item.productId).join('-')}`
      }
    };
  }

  if (!matched.length) {
    return { error: 'No active kit matches these answers.' };
  }
  return { error: 'We could not find a starter kit from the products in stock. Please try Build Your Bundle.' };
}

module.exports = { matchConfiguredKit, constraintsFrom };
