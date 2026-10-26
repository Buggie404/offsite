const BrewSession = require('../models/BrewSession');
const Recipe = require('../models/Recipe');
const User = require('../models/User');

const MAX_DURATION_SECONDS = 60 * 60 * 24 * 7;

function asScore(value) {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) return null;
  return score;
}

function asText(value, max) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > max) return null;
  return trimmed;
}

function asDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseDeduct(row) {
  if (row?.deduct_quantity == null || row.deduct_quantity === '') return { value: null };
  const deduct_quantity = Number(row.deduct_quantity);
  const deduct_unit = asText(row?.deduct_unit, 24);
  if (!Number.isFinite(deduct_quantity) || deduct_quantity < 0 || !deduct_unit) {
    return { error: 'Each powder amount needs a quantity and a unit' };
  }
  return { value: { deduct_quantity, deduct_unit } };
}

function parseAdjustments(raw) {
  if (!Array.isArray(raw)) return { error: 'ingredient_adjustments must be a list' };
  const items = [];
  for (const row of raw) {
    const ingredient_name = asText(row?.ingredient_name, 120);
    const delta = Number(row?.delta_quantity);
    const unit = asText(row?.unit, 24);
    if (!ingredient_name || !Number.isFinite(delta) || unit == null) {
      return { error: 'Each ingredient adjustment needs a name, delta, and unit' };
    }
    const deduct = parseDeduct(row);
    if (deduct.error) return deduct;
    items.push({
      ingredient_name,
      delta_quantity: delta,
      unit,
      deduct_quantity: deduct.value ? deduct.value.deduct_quantity : null,
      deduct_unit: deduct.value ? deduct.value.deduct_unit : ''
    });
  }
  return { value: items };
}

function parseUsed(raw) {
  if (!Array.isArray(raw)) return { error: 'ingredients_used must be a list' };
  const items = [];
  for (const row of raw) {
    const name = asText(row?.name, 120);
    const quantity = Number(row?.quantity);
    const unit = asText(row?.unit, 24);
    let product_id = null;
    if (row?.product_id != null && String(row.product_id).trim() !== '') {
      product_id = asText(String(row.product_id), 64);
      if (!product_id) return { error: 'Each ingredient used needs a name, quantity, and unit' };
    }
    if (!name || !Number.isFinite(quantity) || quantity < 0 || unit == null) {
      return { error: 'Each ingredient used needs a name, quantity, and unit' };
    }
    items.push({ name, quantity, unit, product_id });
  }
  return { value: items };
}

function parseSelections(raw) {
  if (raw == null) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'pantry_selections must be a list' };
  const items = [];
  for (const row of raw) {
    const ingredient_name = asText(row?.ingredient_name, 120);
    const pantry_item_id = asText(String(row?.pantry_item_id || ''), 64);
    if (!ingredient_name || !pantry_item_id) {
      return { error: 'Each pantry selection needs an ingredient and a pantry item' };
    }
    items.push({ ingredient_name, pantry_item_id });
  }
  return { value: items };
}

function parseImage(raw) {
  if (raw == null) return { value: null };
  const url = asText(raw.url, 500);
  const public_id = asText(raw.public_id, 240);
  if (!url || !public_id) return { error: 'result_image needs a url and public_id' };
  return { value: { url, public_id } };
}

function parsePayload(body) {
  const recipe_id = asText(body?.recipe_id, 64);
  const rating = asScore(body?.feedback?.rating);
  const flavor_intensity = asScore(body?.feedback?.flavor_intensity);
  const note = asText(body?.feedback?.note, 1000);
  if (!recipe_id || rating == null || flavor_intensity == null || note == null) {
    return { error: 'Recipe, rating, and flavor intensity are required' };
  }

  const duration = Number(body?.duration_seconds);
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_SECONDS) {
    return { error: 'duration_seconds is invalid' };
  }
  const duration_seconds = Math.round(duration);

  let brewed_at = asDate(body?.brewed_at) || new Date();
  if (brewed_at.getTime() > Date.now() + 60_000) brewed_at = new Date();

  let started_at = asDate(body?.started_at);
  if (!started_at || started_at.getTime() > brewed_at.getTime()) {
    started_at = new Date(brewed_at.getTime() - duration_seconds * 1000);
  }

  const adjustments = parseAdjustments(body?.ingredient_adjustments);
  if (adjustments.error) return adjustments;
  const selections = parseSelections(body?.pantry_selections);
  if (selections.error) return selections;
  const used = parseUsed(body?.ingredients_used);
  if (used.error) return used;
  const image = parseImage(body?.result_image);
  if (image.error) return image;

  const shared = body?.shared_post_id == null || body?.shared_post_id === ''
    ? null
    : asText(body.shared_post_id, 64);
  if (shared === null && body?.shared_post_id) {
    return { error: 'shared_post_id is invalid' };
  }

  return {
    value: {
      recipe_id,
      feedback: { flavor_intensity, note, rating },
      brewed_at,
      started_at,
      duration_seconds,
      ingredient_adjustments: adjustments.value,
      pantry_selections: selections.value,
      ingredients_used: used.value,
      result_image: image.value,
      shared_post_id: shared
    }
  };
}

async function nextBrewSessionId() {
  const last = await BrewSession.findOne({ brewsession_id: /^BSS\d+$/ })
    .sort({ brewsession_id: -1 })
    .select('brewsession_id')
    .lean();
  let nextNum = 1;
  if (last?.brewsession_id) {
    const match = last.brewsession_id.match(/BSS(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `BSS${String(nextNum).padStart(5, '0')}`;
}

async function createBrewSession(req, res) {
  try {
    const user = await User.findById(req.user.user_id);
    if (!user?.user_id) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const parsed = parsePayload(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    let session = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      session = new BrewSession({
        brewsession_id: await nextBrewSessionId(),
        user_id: user.user_id,
        ...parsed.value
      });
      try {
        await session.save();
        break;
      } catch (error) {
        if (error && error.code === 11000 && attempt < 2) continue;
        throw error;
      }
    }

    const pantry = require('../services/pantry.service');
    try {
      await pantry.markRecipeDone(
        user,
        parsed.value.recipe_id,
        parsed.value.brewed_at,
        parsed.value.ingredient_adjustments
      );
      const deductions = await pantry.deductForBrew(
        user.user_id,
        parsed.value.recipe_id,
        parsed.value.ingredient_adjustments,
        parsed.value.pantry_selections
      );
      session.pantry_deductions = deductions.map(row => ({
        ingredient_name: row.name,
        quantity: row.quantity,
        unit: row.unit,
        status: row.status,
        deduct_quantity: row.deductQuantity,
        deduct_unit: row.deductUnit || '',
        note: row.note || '',
        items: (row.items || []).map(item => ({
          pantry_item_id: item.id || '',
          name: item.name || '',
          quantity: item.quantity,
          unit: item.unit || ''
        }))
      }));
      await session.save();
    } catch (error) {
      console.error('Pantry brew follow-up failed:', error);
    }

    let coverage = null;
    try {
      const recipe = await Recipe.findOne({ recipe_id: parsed.value.recipe_id })
        .select('recipe_id ingredients tools relatedProducts')
        .lean();
      if (recipe) coverage = await pantry.coverageForRecipe(user.user_id, recipe);
    } catch (error) {
      console.error('Brew coverage snapshot failed:', error);
    }

    return res.status(201).json({ brewSession: session, coverage });
  } catch (error) {
    console.error('createBrewSession failed:', error);
    return res.status(500).json({ error: 'Could not save brew session' });
  }
}

module.exports = { createBrewSession };
