const crypto = require('crypto');
const Product = require('../models/Product');
const Recipe = require('../models/Recipe');
const AiCallLog = require('../models/AiCallLog');
const { productProfile, recipeProfile } = require('./ritual-dna.evidence');
const { AXES } = require('./ritual-dna.config');

const CACHE_TTL_MS = 15 * 60 * 1000;
const PROMPT_VERSION = 'ritual-recommendations-v1';
const cache = new Map();
const pending = new Map();

function profileFit(radar, target) {
  const axes = AXES.filter(axis => Number.isFinite(target?.[axis]));
  if (!axes.length) return 35;
  return 100 - axes.reduce((sum, axis) => sum + Math.abs(radar[axis] - target[axis]), 0) / axes.length;
}

function productDetailScore(candidate, dna, viewedProfile) {
  const dnaFit = profileFit(dna.taste_radar, candidate.profile);
  const commonAxes = AXES.filter(axis => Number.isFinite(viewedProfile?.[axis]) && Number.isFinite(candidate.profile?.[axis]));
  if (!commonAxes.length) return dnaFit;
  const contextFit = 100 - commonAxes.reduce((sum, axis) => sum + Math.abs(viewedProfile[axis] - candidate.profile[axis]), 0) / commonAxes.length;
  return Math.round((dnaFit * 0.6 + contextFit * 0.4) * 100) / 100;
}

function productCandidate(row, dna) {
  const available = (row.variants || []).filter(variant => Number(variant.stock) > 0);
  if (!row.is_active || !available.length) return null;
  const profile = productProfile(row);
  const lean = Number(dna.drink_lean);
  const categoryBonus = dna.lean_confirmed && Number.isFinite(lean)
    ? (row.category === 'matcha' ? (lean - 50) / 5 : row.category === 'coffee' ? (50 - lean) / 5 : 0)
    : 0;
  return {
    id: String(row.product_id), name: row.name, slug: row.slug, category: row.category,
    image: row.images?.[0]?.url || available[0]?.images?.[0]?.url || '',
    price: Math.min(...available.map(variant => Number(variant.price))),
    profile, fit_percent: Math.round(Math.max(0, Math.min(100, profileFit(dna.taste_radar, profile)))),
    score: profileFit(dna.taste_radar, profile) + categoryBonus
  };
}

function recipeCandidate(row, dna, products) {
  const related = (row.relatedProducts || []).map(id => products.get(String(id))).filter(Boolean);
  const profile = recipeProfile(row, related);
  return {
    id: String(row.recipe_id), name: row.title, slug: row.slug,
    image: row.heroImage?.url || '', difficulty: row.metadata?.difficulty || '',
    minutes: Number(row.metadata?.prepTime || 0) + Number(row.metadata?.cookTime || 0),
    profile, score: profileFit(dna.taste_radar, profile)
  };
}

function diverseProducts(candidates, limit = 12) {
  const counts = new Map();
  const picked = [];
  for (const candidate of candidates) {
    if ((counts.get(candidate.category) || 0) >= 5) continue;
    picked.push(candidate);
    counts.set(candidate.category, (counts.get(candidate.category) || 0) + 1);
    if (picked.length >= limit) break;
  }
  return picked;
}

function selection(items, candidates, limit, fallbackReason) {
  const allowed = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const selected = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || '');
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    selected.push({ ...allowed.get(id), reason: String(item.reason || '').trim().slice(0, 140) || fallbackReason });
    if (selected.length >= limit) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (!seen.has(candidate.id)) selected.push({ ...candidate, reason: fallbackReason });
  }
  return selected.map(({ profile, score, ...publicItem }) => publicItem);
}

function validatedRecommendations(output, products, recipes) {
  return {
    products: selection(output?.products, products, 4, 'Matches your current taste profile.'),
    recipes: selection(output?.recipes, recipes, 3, 'Fits your brewing rhythm and taste.')
  };
}

async function logGroqCall(context, details) {
  if (!context) return;
  try {
    const validProducts = new Set(details.products.map(item => item.id));
    const validRecipes = new Set(details.recipes.map(item => item.id));
    await AiCallLog.create({
      feature: 'ritual_dna', user_id: context.userId || null,
      session_id: null, ip: null,
      model: details.model,
      prompt_tokens: details.usage?.prompt_tokens ?? null,
      completion_tokens: details.usage?.completion_tokens ?? null,
      total_tokens: details.usage?.total_tokens ?? null,
      latency_ms: details.latencyMs,
      cost_usd: null, status: details.status,
      input_summary: null, output_summary: null,
      ritual_dna: {
        surface: details.viewingProduct ? 'product_detail' : 'account',
        prompt_version: PROMPT_VERSION,
        viewed_product_id: details.viewingProduct?.product_id ?? null,
        candidate_product_ids: details.products.map(item => item.id),
        candidate_recipe_ids: details.recipes.map(item => item.id),
        selected_product_ids: (details.result?.products || []).map(item => String(item.id)).filter(id => validProducts.has(id)),
        selected_recipe_ids: (details.result?.recipes || []).map(item => String(item.id)).filter(id => validRecipes.has(id))
      }
    });
  } catch (error) {
    console.warn('Ritual DNA AI log write failed:', error.message);
  }
}

async function askGroq(dna, events, products, recipes, fetchImpl = fetch, viewingProduct = null, logContext = null) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Groq key is not configured');
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const startedAt = Date.now();
  let usage = null;
  let result = null;
  let status = 'error';
  const input = {
    taste_radar: dna.taste_radar,
    archetype_id: dna.archetype_id,
    drink_lean: dna.lean_confirmed ? dna.drink_lean : null,
    servings: dna.servings || [],
    viewing_product: viewingProduct ? { name: viewingProduct.name, category: viewingProduct.category, profile: productProfile(viewingProduct) } : null,
    recent_behavior: events.slice(-8).map(event => ({ source: event.source, profile: event.target_profile })),
    products: products.map(item => ({ id: item.id, name: item.name, category: item.category, profile: item.profile })),
    recipes: recipes.map(item => ({ id: item.id, name: item.name, difficulty: item.difficulty, minutes: item.minutes, profile: item.profile }))
  };
  const rankedItem = {
    type: 'object', additionalProperties: false,
    properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason']
  };
  try {
    const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: viewingProduct
            ? 'Rank the supplied products for the You may also like section. All candidates are in the viewed product category. Balance similarity to the viewed product with this customer’s Ritual DNA and recent behavior. Use only candidate IDs, do not return the viewed item, and give a short factual reason for each choice. Do not invent user facts.'
            : 'Rank the provided Offsite products and recipes for this customer. Use only IDs from the supplied lists. Favor personal taste and recent behavior; keep the list diverse. Give a specific, short reason for each choice. Do not invent products, recipes, or user facts.' },
          { role: 'user', content: JSON.stringify(input) }
        ],
        temperature: 0.2, reasoning_effort: 'low', include_reasoning: false,
        max_completion_tokens: 700,
        response_format: { type: 'json_schema', json_schema: {
          name: 'ritual_recommendations', strict: true,
          schema: { type: 'object', additionalProperties: false,
            properties: { products: { type: 'array', items: rankedItem }, recipes: { type: 'array', items: rankedItem } },
            required: ['products', 'recipes'] }
        } }
      })
    });
    if (!response.ok) {
      status = response.status === 429 ? 'rate_limited' : 'error';
      throw new Error(`Groq returned ${response.status}`);
    }
    const body = await response.json();
    usage = body.usage || null;
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('Groq returned no recommendations');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.recipes)) throw new Error('Invalid Groq response');
    result = parsed;
    status = 'success';
    return parsed;
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') status = 'timeout';
    throw error;
  } finally {
    await logGroqCall(logContext, { model, usage, result, status, latencyMs: Date.now() - startedAt,
      products, recipes, viewingProduct });
  }
}

async function recommendationsFor(user, { surface = 'account' } = {}) {
  const dna = user.ritual_dna;
  const [productRows, recipeRows] = await Promise.all([
    Product.find({ is_active: true, 'variants.stock': { $gt: 0 } })
      .select('product_id name slug category images variants is_active matcha coffee tools').limit(200).lean(),
    Recipe.find({ published: true })
      .select('recipe_id title slug heroImage metadata relatedProducts').limit(100).lean()
  ]);
  const productsById = new Map();
  for (const row of productRows) {
    productsById.set(String(row.product_id), row);
    productsById.set(String(row._id), row);
  }
  const candidates = productRows.map(row => productCandidate(row, dna)).filter(Boolean);
  // Homepage is an explicit match ranking, without category quotas or AI reordering.
  const products = surface === 'home'
    ? candidates.sort((a, b) => b.fit_percent - a.fit_percent || b.score - a.score || a.id.localeCompare(b.id)).slice(0, 20)
    : diverseProducts(candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)));
  const recipes = recipeRows.map(row => recipeCandidate(row, dna, productsById))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 8);
  const activeEvents = (dna.behavior_events || [])
    .filter(event => !event.reversed_at && new Date(event.at) >= new Date(dna.quiz_taken_at));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    surface, user: user.user_id, updated: dna.updated_at,
    products: products.map(item => [item.id, item.price]), recipes: recipes.map(item => item.id)
  })).digest('hex');
  const cached = cache.get(fingerprint);
  if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };
  if (pending.has(fingerprint)) return pending.get(fingerprint);
  const work = (async () => {
    let source = 'ai';
    let ranked = { products: [], recipes: [] };
    try {
      if (products.length || recipes.length) ranked = await askGroq(dna, activeEvents, products, recipes, fetch, null, { userId: user.user_id });
      else source = 'rules';
    } catch (error) {
      source = 'rules';
      console.warn('Ritual DNA AI recommendation fallback:', error.message);
    }
    if (source === 'ai') {
      const validProductIds = new Set(products.map(item => item.id));
      const validRecipeIds = new Set(recipes.map(item => item.id));
      const choseValidItem = ranked.products?.some(item => validProductIds.has(String(item?.id)))
        || ranked.recipes?.some(item => validRecipeIds.has(String(item?.id)));
      if (!choseValidItem) source = 'rules';
    }
    const value = { ...validatedRecommendations(ranked, products, recipes), source };
    if (surface === 'home') {
      value.products = selection([], products, 20, 'Matches your current taste profile.');
    }
    cache.set(fingerprint, { value, expires: Date.now() + (source === 'ai' ? CACHE_TTL_MS : 60 * 1000) });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return { ...value, cached: false };
  })();
  pending.set(fingerprint, work);
  try { return await work; } finally { pending.delete(fingerprint); }
}

async function recommendationsForProduct(user, viewedProduct) {
  const dna = user.ritual_dna;
  const rows = await Product.find({
    category: viewedProduct.category, is_active: true,
    product_id: { $ne: viewedProduct.product_id }, 'variants.stock': { $gt: 0 }
  }).select('product_id name slug category images variants is_active matcha coffee tools').limit(200).lean();
  const viewedProfile = productProfile(viewedProduct);
  const candidates = rows.map(row => productCandidate(row, dna))
    .filter(item => item && AXES.some(axis => Number.isFinite(item.profile[axis])))
    .map(item => ({ ...item, score: productDetailScore(item, dna, viewedProfile) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 12);
  const activeEvents = (dna.behavior_events || [])
    .filter(event => !event.reversed_at && new Date(event.at) >= new Date(dna.quiz_taken_at));
  const fingerprint = `product:${crypto.createHash('sha256').update(JSON.stringify({
    user: user.user_id, updated: dna.updated_at, viewed: viewedProduct.product_id,
    candidates: candidates.map(item => [item.id, item.price, item.score])
  })).digest('hex')}`;
  const cached = cache.get(fingerprint);
  if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };
  if (pending.has(fingerprint)) return pending.get(fingerprint);
  const work = (async () => {
    let source = 'rules';
    let ranked = { products: [], recipes: [] };
    if (candidates.length) {
      try {
        ranked = await askGroq(dna, activeEvents, candidates, [], fetch, viewedProduct, { userId: user.user_id });
        if (ranked.products.some(item => candidates.some(candidate => candidate.id === String(item?.id)))) source = 'ai';
      } catch (error) {
        console.warn('Ritual DNA product detail fallback:', error.message);
      }
    }
    const value = { products: validatedRecommendations(ranked, candidates, []).products, source };
    cache.set(fingerprint, { value, expires: Date.now() + (source === 'ai' ? CACHE_TTL_MS : 60 * 1000) });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return { ...value, cached: false };
  })();
  pending.set(fingerprint, work);
  try { return await work; } finally { pending.delete(fingerprint); }
}

function fitPercent(radar, profile) {
  // Items with no taste signal (drinkware, bundles) have no honest fit to show.
  if (!AXES.some(axis => Number.isFinite(profile?.[axis]))) return null;
  return Math.round(Math.max(0, Math.min(100, profileFit(radar, profile))));
}

async function fitsFor(user) {
  const radar = user.ritual_dna.taste_radar;
  const [productRows, recipeRows] = await Promise.all([
    Product.find({ is_active: true })
      .select('product_id name category matcha coffee tools').lean(),
    Recipe.find({ published: true })
      .select('recipe_id metadata relatedProducts').lean()
  ]);
  const productsById = new Map();
  const products = {};
  for (const row of productRows) {
    productsById.set(String(row.product_id), row);
    productsById.set(String(row._id), row);
    const fit = fitPercent(radar, productProfile(row));
    if (fit !== null) products[row.product_id] = fit;
  }
  const recipes = {};
  for (const row of recipeRows) {
    const related = (row.relatedProducts || []).map(id => productsById.get(String(id))).filter(Boolean);
    const fit = fitPercent(radar, recipeProfile(row, related));
    if (fit !== null) recipes[row.recipe_id] = fit;
  }
  return { products, recipes };
}

module.exports = { recommendationsFor, recommendationsForProduct, fitsFor, fitPercent, productCandidate, recipeCandidate, validatedRecommendations, askGroq };
