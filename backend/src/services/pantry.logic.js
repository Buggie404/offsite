const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_ITEM_LIMIT = 100;
const CATEGORY_EXPIRY_DAYS = { matcha: 180, coffee: 90 };
const NO_EXPIRY_CATEGORIES = new Set(['tools', 'drinkware', 'sets_bundles']);

function vnDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function startOfVnDay(now = new Date()) {
  const key = vnDateKey(now);
  return key ? new Date(`${key}T00:00:00+07:00`) : null;
}

function daysUntil(expiry, now = new Date()) {
  if (expiry == null || expiry === '') return null;
  const fromKey = vnDateKey(now);
  const toKey = vnDateKey(expiry);
  if (!fromKey || !toKey) return null;
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((to - from) / DAY_MS);
}

function countdownFor(days) {
  if (days == null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= 7) return 'danger';
  if (days <= 30) return 'warning';
  return 'normal';
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS);
}

// Batch expiry applies only to orders delivered on a later Vietnam calendar day
// than the day QLSP saved the date. Same-day and earlier deliveries are unchanged.
function batchApplies(setAt, deliveredAt) {
  const saved = vnDateKey(setAt);
  const delivered = vnDateKey(deliveredAt);
  if (!saved || !delivered) return false;
  return delivered > saved;
}

function resolveOrderExpiry(product, deliveredAt) {
  if (!deliveredAt) return { expiry_date: null, expiry_source: null };
  if (product?.batch_expiry_date && batchApplies(product.batch_expiry_set_at, deliveredAt)) {
    return { expiry_date: new Date(product.batch_expiry_date), expiry_source: 'batch' };
  }
  const days = CATEGORY_EXPIRY_DAYS[product?.category];
  if (!days) return { expiry_date: null, expiry_source: null };
  return { expiry_date: addDays(deliveredAt, days), expiry_source: 'estimated' };
}

function parsePack(label) {
  if (!label) return null;
  const match = String(label).match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|oz|lb)\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit: match[2].toLowerCase() };
}

function roundQty(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function lineQuantity(variantName, packs) {
  const count = Number(packs);
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
  const parsed = parsePack(variantName);
  if (!parsed) return { quantity: safeCount, unit: 'pcs' };
  return { quantity: roundQty(parsed.amount * safeCount), unit: parsed.unit };
}

function canonicalUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase();
  if (normalized === 'kg') return { unit: 'g', factor: 1000 };
  if (normalized === 'g') return { unit: 'g', factor: 1 };
  if (normalized === 'l') return { unit: 'ml', factor: 1000 };
  if (normalized === 'ml') return { unit: 'ml', factor: 1 };
  if (!normalized) return { unit: '', factor: 1 };
  return { unit: normalized, factor: 1 };
}

// Returns the remaining quantity in the pantry item's unit, or null when the
// units cannot be compared (a gram brew must not zero out a "pcs" tool).
function applyDeduction(currentQty, currentUnit, usedQty, usedUnit) {
  const current = canonicalUnit(currentUnit);
  const used = canonicalUnit(usedUnit);
  if (!current.unit || current.unit !== used.unit) return null;
  const usedAmount = Number(usedQty);
  if (!Number.isFinite(usedAmount) || usedAmount <= 0) return roundQty(currentQty);
  const nextBase = Math.max(0, Number(currentQty) * current.factor - usedAmount * used.factor);
  const next = nextBase / current.factor;
  return next < 0.0005 ? 0 : roundQty(next);
}

function namesMatch(left, right) {
  const a = String(left || '').toLowerCase().trim();
  const b = String(right || '').toLowerCase().trim();
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

function expiryNotice(names) {
  const clean = (names || []).map(name => String(name || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  const shown = clean.slice(0, 3);
  const rest = clean.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
  const verb = clean.length === 1 ? 'expires' : 'expire';
  return `${list} ${verb} in 7 days.`;
}

function msUntilVnHour(hour, now = new Date()) {
  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  const next = new Date(vnNow);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= vnNow.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - vnNow.getTime();
}

function formatExpiryLabel(expiry) {
  if (!expiry) return 'No expiry date';
  const key = vnDateKey(expiry);
  if (!key) return 'No expiry date';
  const date = new Date(`${key}T00:00:00+07:00`);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  return `Best before ${formatted}`;
}

function formatCompletedOn(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}

function timeOf(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

// A later start means the latest brew is unfinished, even after older completions.
function isOpenBrew(startedAt, completedAt) {
  return timeOf(startedAt) > timeOf(completedAt);
}

function missingRequiredIngredients(ingredients, pantryNames) {
  const names = pantryNames || [];
  const missing = [];
  for (const ingredient of ingredients || []) {
    if (!ingredient || ingredient.optional) continue;
    const name = String(ingredient.name || '').trim();
    if (!name) continue;
    const covered = names.some(pantryName => namesMatch(pantryName, name));
    if (!covered) missing.push(name);
  }
  return missing;
}

function normalizePantryText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Water and ice are assumed to be at home. Milk is not: it only counts when
// it is actually in the pantry. Sweetener still does not block a brew.
function isStapleIngredient(raw) {
  const name = normalizePantryText(raw);
  if (!name) return false;
  if (/\bice\b/.test(name) && !/\bice cream\b/.test(name)) return true;
  if (/\bwater\b/.test(name) && !/\b(tonic|sparkling|soda)\b/.test(name)) return true;
  if (/\b(sugar|sweetener|honey|salt)\b/.test(name)) return true;
  return name === 'maple syrup' || name === 'simple syrup' || name === 'honey or maple syrup';
}

function ingredientNeed(raw) {
  const label = String(raw || '').trim();
  const visible = label.replace(/\([^)]*\)/g, ' ');
  const name = normalizePantryText(visible);
  if (!name || isStapleIngredient(label)) return { kind: 'staple', label };
  if (/houjicha|hojicha/.test(name)) return { kind: 'hojicha', label };
  if (/matcha/.test(name) && /lavender/.test(name)) return { kind: 'lavender-matcha', label };
  if (/matcha/.test(name)) {
    let grade = 'any';
    if (/premium/.test(name)) grade = 'premium';
    else if (/ceremonial/.test(name)) grade = 'ceremonial';
    else if (/barista/.test(name)) grade = 'barista';
    return { kind: 'matcha', grade, label };
  }
  if (/\b(coffee|espresso)\b/.test(name)) return { kind: 'coffee', label };
  return { kind: 'named', name, label };
}

function matchaGrades(gradeText, unspecifiedCoversAll) {
  const grade = normalizePantryText(gradeText);
  if (grade.includes('premium')) return ['any', 'premium', 'ceremonial', 'barista'];
  if (grade.includes('ceremonial')) return ['any', 'ceremonial', 'barista'];
  if (grade.includes('barista')) return ['any', 'barista'];
  if (unspecifiedCoversAll) return ['any', 'premium', 'ceremonial', 'barista'];
  return ['any', 'barista'];
}

// What a catalog product can stand in for. Premium matcha can brew a
// ceremonial recipe. Hojicha and other teas do not stand in for matcha powder.
function coversFromProduct(product) {
  if (!product) return [];
  const name = normalizePantryText(product.name);
  const tags = (product.product_tag || []).map(tag => normalizePantryText(tag));
  const relatedTea = tags.some(tag => tag === 'related tea' || tag.includes('related tea'));
  const hojicha = /houjicha|hojicha/.test(name) || tags.some(tag => /houjicha|hojicha/.test(tag));
  const covers = [];
  if (hojicha) covers.push({ kind: 'hojicha' });
  if (product.category === 'matcha' && !hojicha && !relatedTea) {
    covers.push({
      kind: 'matcha',
      grades: matchaGrades(product.matcha?.product_grade, false)
    });
  }
  if (product.category === 'coffee') covers.push({ kind: 'coffee' });
  if (name) covers.push({ kind: 'named', name });
  return covers;
}

function coversFromLabel(rawName, category) {
  const bare = normalizePantryText(String(rawName || '').replace(/\s*\([^)]*\)\s*$/, ''));
  let inferred = category || null;
  if (!inferred && /houjicha|hojicha|matcha/.test(bare)) inferred = 'matcha';
  if (!inferred && /\b(coffee|espresso)\b/.test(bare)) inferred = 'coffee';
  const covers = coversFromProduct({
    name: bare,
    category: inferred,
    product_tag: /houjicha|hojicha/.test(bare) ? ['hojicha'] : [],
    matcha: { product_grade: /matcha/.test(bare) ? bare : '' }
  });
  // A typed "matcha" with no grade is the tin they mean, whichever grade the recipe asks for.
  if (/matcha/.test(bare) && !/houjicha|hojicha|ceremonial|premium|barista/.test(bare)) {
    const matcha = covers.find(cover => cover.kind === 'matcha');
    if (matcha) matcha.grades = matchaGrades('', true);
  }
  return covers;
}

const PREP_WORDS = new Set([
  'cold', 'hot', 'steamed', 'warm', 'fresh', 'whole', 'skim', 'full', 'low', 'fat',
  'unsweetened', 'sweetened', 'frothed', 'foamed'
]);
const FILLER_WORDS = new Set(['or', 'of', 'and', 'choice', 'your', 'preferred', 'with']);
const GEAR_WORDS = new Set([
  'glass', 'mug', 'cup', 'tumbler', 'spoon', 'whisk', 'bowl', 'pot', 'strainer',
  'cloth', 'towel', 'holder', 'stand', 'pitcher', 'server', 'kettle', 'scale', 'timer',
  'frother', 'chasen', 'chawan', 'scoop', 'shaker', 'jigger'
]);

// Offsite drink recipes weigh matcha and hojicha, and also write them as spoons:
// 1 tsp Barista matcha, 1 tsp lavender matcha, 1 tbsp barista, 4 tbsp houjicha.
// Those spoons are locked at 1 tsp = 2 g. Coffee lines are ounces of espresso or
// drip, not grams of beans, so a bag of coffee is recognized and left untouched.
// Milk is poured in ounces and weighed in grams, so 1 g of milk counts as 1 ml.
// "Prepared teahouse matcha, 4 oz" is the whisked drink, not 4 oz of powder.
// One fluid ounce of that drink draws 1 g of powder (4 oz → 4 g, not 113 g).
const POWDER_GRAMS_PER_TSP = {
  matcha: 2,
  'lavender-matcha': 2,
  hojicha: 2
};
const PREPARED_ML_PER_POWDER_G = 30;
const SPOON_IN_TSP = { tsp: 1, tbsp: 3, cup: 48 };
const LIQUID_ML = { tsp: 5, tbsp: 15, cup: 240, oz: 30 };
const MASS_GRAMS = { oz: 28.3495, lb: 453.592 };
const UNIT_ALIASES = {
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cups: 'cup',
  ounce: 'oz',
  ounces: 'oz',
  pound: 'lb',
  pounds: 'lb'
};
const PANTRY_UNITS = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'oz', 'pcs'];

// "Cold milk" is covered by oat milk. A milk-glass mug is not.
function namedCovers(coverName, needName) {
  const coverWords = normalizePantryText(coverName).split(' ').filter(Boolean);
  const needWords = normalizePantryText(needName).split(' ').filter(Boolean);
  if (!coverWords.length || !needWords.length) return false;
  if (coverWords.join(' ') === needWords.join(' ')) return true;
  const core = needWords.filter(word => !PREP_WORDS.has(word) && !FILLER_WORDS.has(word));
  const required = core.length ? core : needWords;
  if (!required.every(word => coverWords.includes(word))) return false;
  if (coverWords.some(word => GEAR_WORDS.has(word)) && !needWords.some(word => GEAR_WORDS.has(word))) return false;
  return true;
}

// Recipe tools and catalog tools rarely share a full name: "Bamboo Whisk (Chasen)"
// is the same tool as "Chasen Matcha Whisk". A whisk stand is not a whisk.
const TOOL_IDENTITY_GROUPS = [
  ['whisk', 'chasen', 'chasaw'],
  ['chawan'],
  ['chashaku', 'scoop'],
  ['frother', 'nanofoamer'],
  ['strainer', 'sieve', 'cheesecloth'],
  ['kettle'],
  ['scale'],
  ['shaker'],
  ['grinder'],
  ['dripper'],
  ['filter'],
  ['jigger'],
  ['pitcher'],
  ['timer']
];
const TOOL_ACCESSORY_WORDS = new Set(['holder', 'stand', 'rest', 'cover', 'lid']);

function isSkippableTool(raw) {
  const name = normalizePantryText(raw);
  return !name || name === 'none' || name === 'optional' || name === 'optional tool';
}

function isToolAccessory(raw) {
  return normalizePantryText(raw).split(' ').some(word => TOOL_ACCESSORY_WORDS.has(word));
}

function toolPhrases(raw) {
  const text = String(raw || '');
  const parens = [...text.matchAll(/\(([^)]*)\)/g)].map(match => match[1]);
  const main = text.replace(/\([^)]*\)/g, ' ');
  const chunks = [main, ...parens].flatMap(part => String(part).split(/\s*(?:\/|\bor\b)\s*/i));
  return [...new Set(chunks.map(part => normalizePantryText(part)).filter(Boolean))];
}

function toolIdentities(raw) {
  const ids = new Set();
  for (const phrase of toolPhrases(raw)) {
    if (isToolAccessory(phrase)) continue;
    const words = phrase.split(' ').filter(Boolean);
    for (const group of TOOL_IDENTITY_GROUPS) {
      if (group.some(token => words.includes(token))) ids.add(group[0]);
    }
  }
  return ids;
}

function toolCovers(needName, coverName) {
  if (isSkippableTool(needName) || !normalizePantryText(coverName)) return false;
  if (isToolAccessory(needName) !== isToolAccessory(coverName)) return false;
  const needPhrases = toolPhrases(needName);
  const coverPhrases = toolPhrases(coverName);
  for (const need of needPhrases) {
    for (const cover of coverPhrases) {
      if (namedCovers(cover, need) || namedCovers(need, cover)) return true;
    }
  }
  const coverIds = toolIdentities(coverName);
  for (const id of toolIdentities(needName)) {
    if (coverIds.has(id)) return true;
  }
  return false;
}

function itemCoversTool(item, product, toolName) {
  if (isSkippableTool(toolName)) return false;
  const category = item?.category || product?.category || '';
  if (category === 'matcha' || category === 'coffee' || category === 'sets_bundles') return false;
  const coverNames = [item?.name, product?.name, product?.tools?.tool_type].filter(Boolean);
  const gear = category === 'tools'
    || category === 'drinkware'
    || coverNames.some(name => toolIdentities(name).size > 0 || isToolAccessory(name));
  if (!gear) return false;
  return coverNames.some(name => toolCovers(toolName, name));
}

function profileCoversNeed(covers, need) {
  if (!need || need.kind === 'staple') return true;
  for (const cover of covers || []) {
    if (need.kind === 'hojicha' && cover.kind === 'hojicha') return true;
    if (need.kind === 'coffee' && cover.kind === 'coffee') return true;
    if (need.kind === 'matcha' && cover.kind === 'matcha' && (need.grade === 'any' || (cover.grades || []).includes(need.grade))) {
      return true;
    }
    if (need.kind === 'lavender-matcha' && cover.kind === 'named' && /lavender/.test(cover.name) && /matcha/.test(cover.name)) {
      return true;
    }
    if (need.kind === 'named' && cover.kind === 'named' && namedCovers(cover.name, need.name)) return true;
  }
  return false;
}

// One answer for "does this pantry item stand for this ingredient".
// A catalog product speaks for itself. A handwritten item is read from its name.
function coversForItem(item, product) {
  if (product) return coversFromProduct(product);
  return coversFromLabel(item?.name, item?.category);
}

function itemCoversNeed(item, product, need) {
  return profileCoversNeed(coversForItem(item, product), need);
}

function unitKey(unit) {
  const normalized = String(unit || '').trim().toLowerCase();
  return UNIT_ALIASES[normalized] || normalized;
}

function isMilkNeed(need) {
  return need?.kind === 'named' && /\bmilk\b/.test(need.name);
}

function isPreparedDrink(need) {
  const label = normalizePantryText(need?.label || '');
  return /\b(prepared|brewed|whisked)\b/.test(label);
}

// Grams for matcha and hojicha. Millilitres for milk and other liquids.
// Null means this unit cannot be drawn down.
function measureToBase(quantity, unit, need) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) return null;
  const key = unitKey(unit);
  const perTsp = POWDER_GRAMS_PER_TSP[need?.kind];
  if (perTsp) {
    if (key === 'g' || key === 'kg') {
      const canon = canonicalUnit(key);
      return { amount: roundQty(qty * canon.factor), unit: 'g' };
    }
    if (isPreparedDrink(need)) {
      let ml = null;
      if (key === 'ml') ml = qty;
      else if (key === 'l') ml = qty * 1000;
      else if (LIQUID_ML[key]) ml = qty * LIQUID_ML[key];
      if (ml != null) return { amount: roundQty(ml / PREPARED_ML_PER_POWDER_G), unit: 'g' };
    }
    if (SPOON_IN_TSP[key]) {
      return { amount: roundQty(qty * SPOON_IN_TSP[key] * perTsp), unit: 'g' };
    }
    if (!isPreparedDrink(need) && MASS_GRAMS[key]) return { amount: roundQty(qty * MASS_GRAMS[key]), unit: 'g' };
    return null;
  }
  if (isMilkNeed(need) && (key === 'g' || key === 'kg')) {
    return { amount: roundQty(qty * (key === 'kg' ? 1000 : 1)), unit: 'ml' };
  }
  if (key === 'g' || key === 'kg' || key === 'ml' || key === 'l') {
    const canon = canonicalUnit(key);
    return { amount: roundQty(qty * canon.factor), unit: canon.unit };
  }
  if (LIQUID_ML[key]) return { amount: roundQty(qty * LIQUID_ML[key]), unit: 'ml' };
  return null;
}

function baseToStored(baseAmount, storedUnit, need) {
  const one = measureToBase(1, storedUnit, need);
  if (!one || !(one.amount > 0)) return null;
  const amount = Number(baseAmount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return roundQty(amount / one.amount);
}

function itemIsRelated(item, relatedKeys) {
  if (!relatedKeys || !relatedKeys.size) return false;
  const keys = item.productKeys || (item.product_id ? [String(item.product_id)] : []);
  return keys.some(key => relatedKeys.has(String(key)));
}

// Soonest expiry first. relatedProducts only breaks a tie between the same kind of tin.
function rankByExpiry(items, relatedKeys) {
  return [...(items || [])].sort((a, b) => {
    const ae = a.expiry_date ? new Date(a.expiry_date).getTime() : Number.POSITIVE_INFINITY;
    const be = b.expiry_date ? new Date(b.expiry_date).getTime() : Number.POSITIVE_INFINITY;
    const aTime = Number.isFinite(ae) ? ae : Number.POSITIVE_INFINITY;
    const bTime = Number.isFinite(be) ? be : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    const ar = itemIsRelated(a, relatedKeys) ? 0 : 1;
    const br = itemIsRelated(b, relatedKeys) ? 0 : 1;
    if (ar !== br) return ar - br;
    return timeOf(a.created_at) - timeOf(b.created_at);
  });
}

function formatMeasure(value) {
  const rounded = roundQty(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function usageNote(plan) {
  if (plan.staple) return 'Counted as on hand';
  const from = plan.allocations?.[0]?.name || plan.matches?.[0]?.name || '';
  if (plan.taken > 0 && plan.deduct?.unit) {
    const amount = `${formatMeasure(plan.taken)} ${plan.deduct.unit}`;
    return from ? `This brew uses ${amount} from ${from}` : `This brew uses ${amount}`;
  }
  if (from) return `${from} is in your pantry`;
  return '';
}

// Dry run. Does not change the items. Caller writes allocations back in order.
function planConsumption(need, quantity, unit, rankedItems) {
  const matches = rankedItems || [];
  if (!need || need.kind === 'staple') {
    return {
      covered: true,
      staple: true,
      status: 'staple',
      deduct: null,
      taken: 0,
      allocations: [],
      matches,
      note: 'Counted as on hand'
    };
  }

  const covered = matches.length > 0;
  const deduct = measureToBase(quantity, unit, need);
  const base = { covered, staple: false, deduct, matches, allocations: [], taken: 0 };
  if (!covered) return { ...base, status: 'missing', note: '' };
  if (!deduct) {
    const plan = { ...base, status: 'unconverted' };
    plan.note = usageNote(plan);
    return plan;
  }
  if (deduct.amount <= 0) {
    const plan = { ...base, status: 'deducted' };
    plan.note = usageNote(plan);
    return plan;
  }

  let remaining = deduct.amount;
  const allocations = [];
  for (const item of matches) {
    if (remaining <= 0.0005) break;
    const have = measureToBase(item.quantity, item.unit, need);
    if (!have || have.unit !== deduct.unit || have.amount <= 0) continue;
    const take = Math.min(have.amount, remaining);
    const nextBase = roundQty(have.amount - take);
    const nextQuantity = baseToStored(nextBase <= 0.0005 ? 0 : nextBase, item.unit, need);
    if (nextQuantity == null) continue;
    allocations.push({
      pantry_item_id: item.pantry_item_id,
      name: item.name,
      take: roundQty(take),
      unit: deduct.unit,
      nextQuantity: nextQuantity <= 0.0005 ? 0 : nextQuantity
    });
    remaining = roundQty(remaining - take);
  }

  if (!allocations.length) {
    const plan = { ...base, status: 'unconverted' };
    plan.note = usageNote(plan);
    return plan;
  }

  const plan = {
    ...base,
    status: remaining > 0.0005 ? 'partial' : 'deducted',
    taken: roundQty(deduct.amount - Math.max(0, remaining)),
    allocations
  };
  plan.note = usageNote(plan);
  return plan;
}

function matchingAdjustment(ingredient, adjustments) {
  const name = normalizePantryText(ingredient?.name);
  let found = null;
  for (const adjustment of adjustments || []) {
    if (normalizePantryText(adjustment?.ingredient_name) !== name) continue;
    found = adjustment;
  }
  return found;
}

function adjustedIngredientAmount(ingredient, adjustments) {
  const qty = Number(ingredient?.quantity);
  const unit = String(ingredient?.unit || '');
  if (!Number.isFinite(qty)) return { quantity: null, unit };
  const name = normalizePantryText(ingredient.name);
  let delta = 0;
  for (const adjustment of adjustments || []) {
    if (normalizePantryText(adjustment?.ingredient_name) !== name) continue;
    const change = Number(adjustment.delta_quantity);
    if (Number.isFinite(change)) delta += change;
  }
  return { quantity: roundQty(Math.max(0, qty + delta)), unit };
}

// The drink line stays in ounces. A saved powder amount, when the member set one,
// is what actually leaves the tin.
function consumptionAmount(ingredient, adjustments) {
  const drink = adjustedIngredientAmount(ingredient, adjustments);
  const adjustment = matchingAdjustment(ingredient, adjustments);
  const override = Number(adjustment?.deduct_quantity);
  const unit = String(adjustment?.deduct_unit || '').trim();
  if (Number.isFinite(override) && override >= 0 && unit) {
    return { quantity: roundQty(override), unit };
  }
  return drink;
}

module.exports = {
  VN_OFFSET_MS,
  DAY_MS,
  ACTIVE_ITEM_LIMIT,
  CATEGORY_EXPIRY_DAYS,
  NO_EXPIRY_CATEGORIES,
  vnDateKey,
  startOfVnDay,
  daysUntil,
  countdownFor,
  addDays,
  batchApplies,
  resolveOrderExpiry,
  parsePack,
  roundQty,
  lineQuantity,
  applyDeduction,
  namesMatch,
  normalizePantryText,
  isStapleIngredient,
  namedCovers,
  isSkippableTool,
  toolCovers,
  itemCoversTool,
  ingredientNeed,
  coversFromProduct,
  coversFromLabel,
  profileCoversNeed,
  coversForItem,
  itemCoversNeed,
  measureToBase,
  baseToStored,
  rankByExpiry,
  planConsumption,
  adjustedIngredientAmount,
  consumptionAmount,
  PANTRY_UNITS,
  expiryNotice,
  msUntilVnHour,
  formatExpiryLabel,
  formatCompletedOn,
  timeOf,
  isOpenBrew,
  missingRequiredIngredients
};
