const Recipe = require('../models/Recipe');
const User = require('../models/User');
const PantryItem = require('../models/PantryItem');
const { PANTRY_UNITS } = require('../services/pantry.logic');
const {
  ACTIVE_ITEM_LIMIT,
  daysUntil,
  getPantry,
  countActive,
  createItem,
  recordBrewStart,
  markRecipeDone,
  hidePantryRecipes,
  coverageForRecipe,
  findCatalogProduct
} = require('../services/pantry.service');

const CATEGORIES = new Set(['matcha', 'coffee', 'tools', 'drinkware', 'sets_bundles', 'other']);

async function owner(req, res) {
  const user = await User.findById(req.user?.user_id);
  if (!user?.user_id) {
    res.status(404).json({ error: 'User profile not found' });
    return null;
  }
  return user;
}

async function showPantry(req, res) {
  try {
    const user = await owner(req, res);
    if (!user) return;
    const pantry = await getPantry(user);
    return res.json(pantry);
  } catch (error) {
    console.error('showPantry failed:', error);
    return res.status(500).json({ error: 'Could not load pantry' });
  }
}

function parseManualExpiry(value) {
  if (value == null || value === '') return { date: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'Best before must be a date' };
  }
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return { error: 'Best before must be a date' };
  return { date };
}

async function addManualItem(req, res) {
  try {
    const user = await owner(req, res);
    if (!user) return;

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: 'Enter an item name.' });
    }
    let category = null;
    if (req.body?.category != null && req.body.category !== '') {
      category = typeof req.body.category === 'string' ? req.body.category : '';
      if (!CATEGORIES.has(category)) {
        return res.status(400).json({ error: 'Choose a group.' });
      }
    }
    const expiry = parseManualExpiry(req.body?.expiry_date);
    if (expiry.error) return res.status(400).json({ error: expiry.error });

    const rawQuantity = req.body?.quantity;
    const rawUnit = req.body?.unit;
    const quantityGiven = rawQuantity != null && rawQuantity !== '';
    const unitGiven = typeof rawUnit === 'string' && rawUnit.trim() !== '';
    let quantity = 1;
    let unit = '';
    if (quantityGiven || unitGiven) {
      quantity = Number(rawQuantity);
      unit = typeof rawUnit === 'string' ? rawUnit.trim().toLowerCase() : '';
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
        return res.status(400).json({ error: 'Enter a quantity.' });
      }
      if (!PANTRY_UNITS.includes(unit)) {
        return res.status(400).json({ error: 'Choose a unit.' });
      }
    }

    let product = null;
    const rawProductId = req.body?.product_id;
    if (rawProductId != null && String(rawProductId).trim() !== '') {
      product = await findCatalogProduct(rawProductId);
      if (!product) return res.status(400).json({ error: 'Choose a product from the catalog.' });
    }

    const active = await countActive(user.user_id);
    if (active >= ACTIVE_ITEM_LIMIT) {
      return res.status(400).json({ error: 'You can keep up to 100 active pantry items.' });
    }

    const now = new Date();
    const days = daysUntil(expiry.date, now);
    const image = product
      ? ((product.images || []).find(entry => entry.sort_order === 0) || product.images?.[0])
      : null;
    if (product && CATEGORIES.has(product.category)) category = product.category;
    await createItem({
      user_id: user.user_id,
      source: 'manual',
      order_id: null,
      subscription_id: null,
      product_id: product ? String(product._id) : null,
      variant_id: null,
      name,
      image_url: image?.url || null,
      category,
      quantity: Math.round(quantity * 1000) / 1000,
      unit,
      purchased_at: now,
      delivered_at: null,
      expiry_date: expiry.date,
      expiry_source: expiry.date ? 'manual' : null,
      expiry_notified_at: null,
      status: expiry.date && days != null && days < 0 ? 'expired' : 'active'
    });

    return res.status(201).json(await getPantry(user));
  } catch (error) {
    console.error('addManualItem failed:', error);
    return res.status(500).json({ error: 'Could not add pantry item' });
  }
}

async function updateItem(req, res) {
  try {
    const user = await owner(req, res);
    if (!user) return;
    const action = req.body?.action;
    if (action !== 'used_up' && action !== 'remove') {
      return res.status(400).json({ error: 'Unknown pantry action' });
    }

    const item = await PantryItem.findOne({
      pantry_item_id: req.params.id,
      user_id: user.user_id,
      status: { $ne: 'removed' }
    });
    if (!item) return res.status(404).json({ error: 'Pantry item not found' });

    if (action === 'used_up') {
      if (item.status !== 'used_up') {
        item.status = 'used_up';
        item.quantity = 0;
        await item.save();
      }
    } else {
      item.status = 'removed';
      await item.save();
    }

    return res.json(await getPantry(user));
  } catch (error) {
    console.error('updateItem failed:', error);
    return res.status(500).json({ error: 'Could not update pantry item' });
  }
}

async function startBrew(req, res) {
  try {
    const user = await owner(req, res);
    if (!user) return;
    const recipeId = typeof req.body?.recipe_id === 'string' ? req.body.recipe_id.trim() : '';
    if (!recipeId) return res.status(400).json({ error: 'recipe_id is required' });

    const recipe = await Recipe.findOne({ recipe_id: recipeId }).select('recipe_id').lean();
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    await recordBrewStart(user, recipeId);
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('startBrew failed:', error);
    return res.status(500).json({ error: 'Could not record brew start' });
  }
}

async function hideRecipes(req, res) {
  try {
    const user = await owner(req, res);
    if (!user) return;
    const raw = Array.isArray(req.body?.recipe_ids) ? req.body.recipe_ids : [];
    const ids = [...new Set(raw.map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))].slice(0, 100);
    if (!ids.length) return res.status(400).json({ error: 'Choose a recipe to remove.' });

    await hidePantryRecipes(user, ids);
    const fresh = await User.findById(user._id);
    return res.json(await getPantry(fresh));
  } catch (error) {
    console.error('hideRecipes failed:', error);
    return res.status(500).json({ error: 'Could not remove recipes' });
  }
}

async function showRecipeCoverage(req, res) {
  try {
    const user = await owner(req, res);
    if (!user) return;
    const recipeId = String(req.params.recipeId || '').trim();
    const recipe = await Recipe.findOne({ recipe_id: recipeId })
      .select('recipe_id ingredients tools relatedProducts')
      .lean();
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    return res.json(await coverageForRecipe(user.user_id, recipe));
  } catch (error) {
    console.error('showRecipeCoverage failed:', error);
    return res.status(500).json({ error: 'Could not check this recipe against your pantry' });
  }
}

async function doneRecipe(req, res) {
  try {
    const user = await owner(req, res);
    if (!user) return;
    const recipeId = String(req.params.recipeId || '').trim();
    const recipe = await Recipe.findOne({ recipe_id: recipeId }).select('recipe_id').lean();
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    await markRecipeDone(user, recipeId, new Date());
    const fresh = await User.findById(user._id);
    return res.json(await getPantry(fresh));
  } catch (error) {
    console.error('doneRecipe failed:', error);
    return res.status(500).json({ error: 'Could not mark recipe done' });
  }
}

module.exports = {
  showPantry,
  addManualItem,
  updateItem,
  startBrew,
  hideRecipes,
  showRecipeCoverage,
  doneRecipe
};
