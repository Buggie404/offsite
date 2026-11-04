const { AXES } = require('./ritual-dna.config');

const RULE_VERSION = 'behavior-1';
const normalize = value => String(value || '').trim().toLowerCase();

function combineProfiles(entries) {
  const result = {};
  for (const axis of AXES) {
    let total = 0;
    let weight = 0;
    for (const entry of entries) {
      const value = entry.profile?.[axis];
      if (value == null || !Number.isFinite(Number(value))) continue;
      const amount = Number(entry.weight) || 1;
      total += Number(value) * amount;
      weight += amount;
    }
    if (weight) result[axis] = Math.round(total / weight);
  }
  return result;
}

function productProfile(product) {
  if (!product) return {};
  const category = normalize(product.category);
  if (category === 'matcha') {
    const grade = normalize(product.matcha?.product_grade);
    if (grade.includes('ceremonial')) return { brightness: 72, boldness: 30 };
    if (grade.includes('premium')) return { brightness: 58, boldness: 45 };
    if (grade.includes('barista')) return { brightness: 35, boldness: 65 };
    return {};
  }
  if (category === 'coffee') {
    const roast = normalize(product.coffee?.roast_level);
    const profiles = {
      'light roast': { brightness: 82, boldness: 25 },
      'medium light roast': { brightness: 70, boldness: 40 },
      'medium roast': { brightness: 52, boldness: 52 },
      'medium dark roast': { brightness: 34, boldness: 70 },
      'dark roast': { brightness: 20, boldness: 85 }
    };
    const profile = { ...(profiles[roast] || {}) };
    const notes = (product.coffee?.tasting_notes || []).map(normalize).join(' ');
    if (/citrus|lemon|lime|grapefruit|orange|clementine|bergamot|jasmine|apricot|peach|nectarine|melon|cherry|grape|fruit|tropical|juicy/.test(notes)) {
      profile.brightness = Math.round(((profile.brightness ?? 65) + 78) / 2);
    }
    if (/caramel|vanilla|chocolate|cocoa|syrup|honey|brown sugar|marzipan|marshmallow|crème brûlée|hazelnut/.test(notes)) {
      profile.sweetness = 65;
    }
    return profile;
  }
  if (category === 'tools') {
    const type = normalize(product.tools?.tool_type);
    const name = normalize(product.name);
    if (type === 'chasen' || type === 'chawan' || type === 'chashaku') return { skill: 75, tempo: 30 };
    if (type === 'dripper' || type === 'kettle' || type === 'grinder') return { skill: 85, tempo: 35 };
    if (type === 'brewer' && name.includes('french press')) return { skill: 55 };
    if (type === 'brewer') return { skill: 65 };
    return {};
  }
  // Drinkware and bundles without composition do not imply taste or brewing skill.
  return {};
}

function recipeProfile(recipe, relatedProducts = []) {
  if (!recipe) return {};
  const entries = relatedProducts.map(product => ({ profile: productProfile(product), weight: 1 }));
  const result = combineProfiles(entries);
  const difficulty = normalize(recipe.metadata?.difficulty);
  if (difficulty === 'easy') result.skill = 25;
  if (difficulty === 'medium') result.skill = 55;
  if (difficulty === 'hard') result.skill = 85;
  const minutes = Number(recipe.metadata?.prepTime);
  if (Number.isFinite(minutes) && minutes > 0) {
    result.tempo = minutes <= 5 ? 85 : minutes <= 10 ? 65 : minutes <= 20 ? 40 : 20;
  }
  return result;
}

function orderProfile(order, products) {
  const byId = new Map();
  for (const product of products || []) {
    byId.set(String(product._id || ''), product);
    byId.set(String(product.product_id || ''), product);
  }
  return combineProfiles((order.items || []).filter(item => !item.out_of_stock).map(item => ({
    profile: productProfile(byId.get(String(item.product_id))),
    weight: Math.min(1 + .25 * Math.max(0, Number(item.quantity || 1) - 1), 1.5)
  })));
}

module.exports = { RULE_VERSION, combineProfiles, productProfile, recipeProfile, orderProfile };
