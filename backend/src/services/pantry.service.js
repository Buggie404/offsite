const mongoose = require('mongoose');
const PantryItem = require('../models/PantryItem');
const Product = require('../models/Product');
const Recipe = require('../models/Recipe');
const BrewSession = require('../models/BrewSession');
const User = require('../models/User');
const { createNotification } = require('./notification.service');
const {
  ACTIVE_ITEM_LIMIT,
  startOfVnDay,
  daysUntil,
  countdownFor,
  resolveOrderExpiry,
  lineQuantity,
  applyDeduction,
  ingredientNeed,
  isSkippableTool,
  itemCoversTool,
  coversFromProduct,
  coversForItem,
  itemCoversNeed,
  profileCoversNeed,
  rankByExpiry,
  planConsumption,
  adjustedIngredientAmount,
  consumptionAmount,
  normalizePantryText,
  expiryNotice,
  msUntilVnHour,
  formatExpiryLabel,
  formatCompletedOn,
  roundQty,
  timeOf,
  isOpenBrew,
} = require('./pantry.logic');

const VISIBLE_STATUSES = ['active', 'used_up', 'expired'];
const DEDUCTABLE_STATUSES = ['active', 'expired'];

function displayName(line) {
  const productName = String(line.product_name || '').trim();
  const variantName = String(line.variant_name || '').trim();
  if (!variantName || variantName.toLowerCase() === productName.toLowerCase()) return productName || 'Offsite item';
  return `${productName} (${variantName})`;
}

function productKeys(product) {
  if (!product) return [];
  return [String(product._id), String(product.product_id)].filter(key => key && key !== 'undefined');
}

async function nextPantryItemId() {
  const last = await PantryItem.findOne({ pantry_item_id: /^PTI\d+$/ })
    .sort({ pantry_item_id: -1 })
    .select('pantry_item_id')
    .lean();
  let nextNum = 1;
  if (last?.pantry_item_id) {
    const match = last.pantry_item_id.match(/PTI(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `PTI${String(nextNum).padStart(5, '0')}`;
}

async function createItem(fields) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await PantryItem.create({
        pantry_item_id: await nextPantryItemId(),
        ...fields
      });
    } catch (error) {
      lastError = error;
      if (error && error.code === 11000 && attempt < 2) continue;
      throw error;
    }
  }
  throw lastError;
}

function presentItem(item, now = new Date()) {
  const status = item.status;
  const hasExpiry = !!item.expiry_date;
  const daysLeft = status === 'used_up' || !hasExpiry ? null : daysUntil(item.expiry_date, now);
  const expired = hasExpiry && (status === 'expired' || (daysLeft != null && daysLeft < 0));
  let countdown = 'unknown';
  if (status === 'used_up') countdown = 'used_up';
  else if (expired) countdown = 'expired';
  else countdown = countdownFor(daysLeft);

  const quantity = item.quantity == null ? null : roundQty(item.quantity);
  const unit = item.unit || '';
  const quantityLabel = quantity == null || !unit
    ? ''
    : `${Number.isInteger(quantity) ? quantity : quantity} ${unit}`;

  return {
    id: item.pantry_item_id,
    name: item.name,
    source: item.source,
    status: expired ? 'expired' : (status === 'expired' ? 'active' : status),
    category: item.category || null,
    imageUrl: item.image_url || null,
    quantity,
    unit,
    quantityLabel,
    daysLeft: countdown === 'used_up' ? null : daysLeft,
    countdown,
    expiryLabel: formatExpiryLabel(item.expiry_date),
    productId: item.product_id || null,
    purchasable: false
  };
}

async function markExpiredItems(userId, now = new Date()) {
  const today = startOfVnDay(now);
  if (!today) return;
  await PantryItem.updateMany(
    { user_id: userId, status: 'active', expiry_date: { $ne: null, $lt: today } },
    { $set: { status: 'expired' } }
  );
}

async function addItemsForDeliveredOrder(order) {
  if (!order?.user_id || !Array.isArray(order.items) || !order.items.length) return [];
  const deliveredAt = order.delivered_at ? new Date(order.delivered_at) : new Date();
  const productIds = order.items
    .map(line => line.product_id)
    .filter(id => mongoose.Types.ObjectId.isValid(id));
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } }).lean()
    : [];
  const byId = new Map(products.map(product => [String(product._id), product]));
  const created = [];

  for (const line of order.items) {
    const productId = String(line.product_id || '');
    const variantId = String(line.variant_id || '');
    const existing = await PantryItem.findOne({
      order_id: order.order_id,
      product_id: productId,
      variant_id: variantId
    }).select('_id').lean();
    if (existing) continue;

    const product = byId.get(productId) || null;
    const expiry = resolveOrderExpiry(product, deliveredAt);
    const amount = lineQuantity(line.variant_name, line.quantity);
    const purchasedAt = order.created_at ? new Date(order.created_at) : deliveredAt;
    const days = daysUntil(expiry.expiry_date, new Date());
    try {
      const item = await createItem({
        user_id: order.user_id,
        source: order.subscription_id ? 'subscription' : 'order',
        order_id: order.order_id,
        subscription_id: order.subscription_id || null,
        product_id: productId || null,
        variant_id: variantId,
        name: displayName(line),
        image_url: line.image?.url || null,
        category: product?.category || null,
        quantity: amount.quantity,
        unit: amount.unit,
        purchased_at: purchasedAt,
        delivered_at: deliveredAt,
        expiry_date: expiry.expiry_date,
        expiry_source: expiry.expiry_source,
        expiry_notified_at: null,
        status: expiry.expiry_date && days != null && days < 0 ? 'expired' : 'active'
      });
      created.push(item);
    } catch (error) {
      if (error && error.code === 11000) continue;
      throw error;
    }
  }
  return created;
}

async function removeItemsForRefund(order, refundItems) {
  if (!order?.user_id || !order.order_id) return;
  const lines = Array.isArray(refundItems) && refundItems.length ? refundItems : (order.items || []);
  for (const line of lines) {
    const productId = String(line.product_id || '');
    const variantId = String(line.variant_id || '');
    const item = await PantryItem.findOne({
      user_id: order.user_id,
      order_id: order.order_id,
      product_id: productId,
      variant_id: variantId,
      status: { $ne: 'removed' }
    });
    if (!item) continue;

    const orderLine = (order.items || []).find(entry =>
      String(entry.product_id) === productId && String(entry.variant_id || '') === variantId
    );
    const refundQty = Number(line.quantity);
    const fullLine = !orderLine
      || !Number.isFinite(refundQty)
      || refundQty >= Number(orderLine.quantity);

    if (fullLine) {
      item.status = 'removed';
    } else {
      const refunded = lineQuantity(orderLine.variant_name, refundQty);
      const next = applyDeduction(item.quantity, item.unit, refunded.quantity, refunded.unit);
      if (next == null || next <= 0) item.status = 'removed';
      else item.quantity = next;
    }
    await item.save();
  }
}

function productLookup(ids) {
  const raw = [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))];
  const objectIds = raw.filter(id => /^[a-fA-F0-9]{24}$/.test(id));
  const numericIds = raw.filter(id => /^\d+$/.test(id)).map(id => Number(id));
  const or = [];
  if (objectIds.length) or.push({ _id: { $in: objectIds } });
  if (numericIds.length) or.push({ product_id: { $in: numericIds } });
  return or;
}

async function productsByIds(ids) {
  const or = productLookup(ids);
  if (!or.length) return [];
  return Product.find({ $or: or })
    .select('product_id name slug category product_tag matcha tools images is_active')
    .lean();
}

function relatedKeySet(relatedProducts, products) {
  const keys = new Set((relatedProducts || []).map(id => String(id)));
  for (const product of products) {
    const own = productKeys(product);
    if (own.some(key => keys.has(key))) {
      for (const key of own) keys.add(key);
    }
  }
  return keys;
}

function poolRow(item, product) {
  return {
    doc: item,
    pantry_item_id: item.pantry_item_id,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    expiry_date: item.expiry_date,
    created_at: item.created_at,
    product_id: item.product_id,
    product,
    productKeys: product ? productKeys(product) : (item.product_id ? [String(item.product_id)] : []),
    originalQuantity: item.quantity
  };
}

function presentUsage(name, amount, plan) {
  const drawn = plan.staple ? [] : (plan.allocations || []);
  const listed = plan.staple
    ? []
    : drawn.length
      ? drawn.map(row => ({
        id: row.pantry_item_id,
        name: row.name,
        quantity: row.take,
        unit: row.unit
      }))
      : (plan.matches || []).slice(0, 3).map(row => ({
        id: row.pantry_item_id,
        name: row.name,
        quantity: null,
        unit: ''
      }));
  return {
    name,
    covered: plan.covered,
    staple: !!plan.staple,
    status: plan.status,
    quantity: amount.quantity,
    unit: amount.unit || '',
    deductQuantity: plan.taken > 0 ? plan.taken : null,
    deductUnit: plan.taken > 0 ? plan.deduct.unit : null,
    drawQuantity: plan.deduct && plan.deduct.amount > 0 ? plan.deduct.amount : null,
    drawUnit: plan.deduct && plan.deduct.amount > 0 ? plan.deduct.unit : '',
    note: plan.note || '',
    items: listed,
    candidates: (plan.matches || []).map(row => ({
      id: row.pantry_item_id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit || ''
    }))
  };
}

async function loadPantryPool(userId, relatedProducts) {
  const items = await PantryItem.find({
    user_id: userId,
    status: { $in: DEDUCTABLE_STATUSES }
  });
  const products = await productsByIds([
    ...items.map(item => item.product_id),
    ...(relatedProducts || [])
  ]);
  const productByKey = new Map();
  for (const product of products) {
    for (const key of productKeys(product)) productByKey.set(key, product);
  }
  const pool = items.map(item => poolRow(
    item,
    item.product_id ? productByKey.get(String(item.product_id)) || null : null
  ));
  return { pool, relatedKeys: relatedKeySet(relatedProducts, products) };
}

function usageFor(pool, relatedKeys, need, amount, preferredId) {
  if (!need || need.kind === 'staple') {
    return planConsumption(need, amount.quantity, amount.unit, []);
  }
  const matches = pool.filter(row => Number(row.quantity) > 0 && itemCoversNeed(row, row.product, need));
  const ranked = rankByExpiry(matches, relatedKeys);
  const wanted = String(preferredId || '').trim();
  const chosen = wanted ? ranked.filter(row => String(row.pantry_item_id) === wanted) : [];
  const plan = planConsumption(need, amount.quantity, amount.unit, chosen.length ? chosen : ranked);
  if (chosen.length) plan.matches = ranked;
  return plan;
}

function applyUsage(plan) {
  for (const allocation of plan.allocations || []) {
    const row = (plan.matches || []).find(item => item.pantry_item_id === allocation.pantry_item_id);
    if (!row) continue;
    row.quantity = allocation.nextQuantity;
  }
}

async function persistPool(pool) {
  for (const row of pool) {
    if (row.quantity === row.originalQuantity) continue;
    row.doc.quantity = row.quantity;
    if (row.quantity <= 0) row.doc.status = 'used_up';
    await row.doc.save();
  }
}

function selectionMap(selections) {
  const chosen = new Map();
  for (const row of selections || []) {
    const key = normalizePantryText(row?.ingredient_name);
    const id = String(row?.pantry_item_id || '').trim();
    if (key && id) chosen.set(key, id);
  }
  return chosen;
}

function ingredientUsages(pool, relatedKeys, ingredients, adjustments, selections) {
  const chosen = selectionMap(selections);
  return (ingredients || []).map(ingredient => {
    const need = ingredientNeed(ingredient?.name);
    const amount = adjustedIngredientAmount(ingredient, adjustments);
    const measured = consumptionAmount(ingredient, adjustments);
    const preferredId = chosen.get(normalizePantryText(ingredient?.name)) || '';
    const plan = usageFor(pool, relatedKeys, need, measured, preferredId);
    const usage = presentUsage(ingredient.name, amount, plan);
    applyUsage(plan);
    return usage;
  });
}

// The last saved brew wins. A brew saved before powder tweaks were stored can
// still carry the ounce change on the saved recipe.
async function adjustmentsForCoverage(userId, recipeId) {
  if (!userId || !recipeId) return [];
  const [user, latest] = await Promise.all([
    User.findOne({ user_id: userId }).select('saved_recipes').lean(),
    BrewSession.findOne({ user_id: userId, recipe_id: recipeId })
      .sort({ brewed_at: -1 })
      .select('ingredient_adjustments')
      .lean()
  ]);
  const saved = (user?.saved_recipes || []).find(row => row.recipe_id === recipeId);
  const sessionAdjustments = latest?.ingredient_adjustments || [];
  if (sessionAdjustments.length) return sessionAdjustments;
  return saved?.personal_adjustments || [];
}

// The brew tells us the recipe, any quantity edits, and which tin to draw
// when more than one pantry item can cover an ingredient.
async function deductForBrew(userId, recipeId, adjustments, selections) {
  if (!userId || !recipeId) return [];
  const recipe = await Recipe.findOne({ recipe_id: recipeId })
    .select('recipe_id ingredients relatedProducts')
    .lean();
  if (!recipe) return [];
  const { pool, relatedKeys } = await loadPantryPool(userId, recipe.relatedProducts);
  const usages = ingredientUsages(pool, relatedKeys, recipe.ingredients, adjustments, selections);
  await persistPool(pool);
  return usages;
}

async function coverageForRecipe(userId, recipe) {
  const { pool, relatedKeys } = await loadPantryPool(userId, recipe?.relatedProducts);
  const snapshot = pool.map(row => ({ ...row }));
  const stock = snapshot.map(row => ({
    id: row.pantry_item_id,
    quantity: row.quantity,
    unit: row.unit || ''
  }));
  const adjustments = await adjustmentsForCoverage(userId, recipe?.recipe_id);
  return {
    recipeId: recipe.recipe_id,
    stock,
    ingredients: ingredientUsages(snapshot, relatedKeys, recipe.ingredients, adjustments),
    tools: (recipe.tools || []).map(tool => {
      if (isSkippableTool(tool?.name)) {
        return presentUsage(tool?.name || '', { quantity: null, unit: '' }, {
          covered: false,
          staple: false,
          status: 'missing',
          taken: 0,
          deduct: null,
          allocations: [],
          matches: [],
          note: ''
        });
      }
      const matches = snapshot.filter(row => Number(row.quantity) > 0 && itemCoversTool(row, row.product, tool?.name));
      const ranked = rankByExpiry(matches, relatedKeys);
      const usage = presentUsage(tool.name, { quantity: null, unit: '' }, {
        covered: ranked.length > 0,
        staple: false,
        status: ranked.length ? 'tool' : 'missing',
        taken: 0,
        deduct: null,
        allocations: [],
        matches: ranked,
        note: ranked[0] ? `${ranked[0].name} is in your pantry` : ''
      });
      usage.deductQuantity = null;
      usage.deductUnit = null;
      usage.drawQuantity = null;
      usage.drawUnit = '';
      return usage;
    })
  };
}

async function findCatalogProduct(raw) {
  const id = String(raw || '').trim();
  if (!id) return null;
  const or = productLookup([id]);
  if (!or.length) return null;
  return Product.findOne({ $or: or }).select('product_id name category images').lean();
}

function arrayLacksRecipe(recipeId) {
  return { $not: { $elemMatch: { recipe_id: recipeId } } };
}

async function markRecipeDone(user, recipeId, at = new Date(), adjustments = null) {
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();
  const id = user._id;
  const savedUpdate = {
    $set: {
      'saved_recipes.$.is_done': true,
      'saved_recipes.$.last_done_at': when
    },
    $inc: { 'saved_recipes.$.done_count': 1 }
  };
  if (Array.isArray(adjustments)) {
    savedUpdate.$set['saved_recipes.$.personal_adjustments'] = adjustments;
  }
  await User.updateOne({ _id: id, 'saved_recipes.recipe_id': recipeId }, savedUpdate);

  const doneTouched = await User.updateOne(
    { _id: id, 'done_recipes.recipe_id': recipeId },
    {
      $set: {
        'done_recipes.$.is_done': true,
        'done_recipes.$.last_done_at': when
      },
      $inc: { 'done_recipes.$.done_count': 1 }
    }
  );
  if (!doneTouched.matchedCount) {
    await User.updateOne(
      { _id: id, done_recipes: arrayLacksRecipe(recipeId) },
      {
        $push: {
          done_recipes: {
            recipe_id: recipeId,
            is_done: true,
            done_count: 1,
            last_done_at: when
          }
        }
      }
    );
  }

  // A suggestion marked done has no brew start yet. Record one at the same
  // moment so Your brews shows it as completed, not still in progress.
  await User.updateOne(
    { _id: id, started_recipes: arrayLacksRecipe(recipeId) },
    { $push: { started_recipes: { recipe_id: recipeId, started_at: when } } }
  );
  await User.updateOne(
    { _id: id, hidden_pantry_recipes: recipeId },
    { $pull: { hidden_pantry_recipes: recipeId } }
  );
}

async function recordBrewStart(user, recipeId) {
  const now = new Date();
  const id = user._id;
  const touched = await User.updateOne(
    { _id: id, 'started_recipes.recipe_id': recipeId },
    { $set: { 'started_recipes.$.started_at': now } }
  );
  if (!touched.matchedCount) {
    await User.updateOne(
      { _id: id, started_recipes: arrayLacksRecipe(recipeId) },
      { $push: { started_recipes: { recipe_id: recipeId, started_at: now } } }
    );
  }
  await User.updateOne(
    { _id: id, hidden_pantry_recipes: recipeId },
    { $pull: { hidden_pantry_recipes: recipeId } }
  );
}

async function hidePantryRecipes(user, recipeIds) {
  const ids = [...new Set((recipeIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return;
  await User.updateOne(
    { _id: user._id },
    { $addToSet: { hidden_pantry_recipes: { $each: ids } } }
  );
}

function defaultVariantPrice(product) {
  const variant = (product.variants || []).find(entry => entry.is_default) || product.variants?.[0];
  return variant?.price ?? null;
}

function primaryImage(product) {
  const images = product.images || [];
  const primary = images.find(image => image.sort_order === 0) || images[0];
  return primary?.url || null;
}

function historyLabel(inProgress, doneCount) {
  const count = Number(doneCount) || 0;
  if (inProgress) return count > 0 ? `Resume · brewed ${count}` : 'Resume';
  return count > 1 ? `Brewed · ${count}` : 'Brewed';
}

async function startedRecipeCards(user) {
  const activity = new Map();
  const ensure = (recipeId) => {
    const id = String(recipeId || '').trim();
    if (!id) return null;
    let row = activity.get(id);
    if (!row) {
      row = { startedAt: 0, completedAt: 0, doneCount: 0, sessionCount: 0 };
      activity.set(id, row);
    }
    return row;
  };

  for (const row of user.started_recipes || []) {
    const entry = ensure(row.recipe_id);
    if (!entry) continue;
    entry.startedAt = Math.max(entry.startedAt, timeOf(row.started_at));
  }

  const sessions = await BrewSession.find({ user_id: user.user_id })
    .select('recipe_id brewed_at')
    .lean();
  for (const session of sessions) {
    const entry = ensure(session.recipe_id);
    if (!entry) continue;
    entry.completedAt = Math.max(entry.completedAt, timeOf(session.brewed_at));
    entry.sessionCount += 1;
  }

  const applyDone = (row) => {
    if (!row?.is_done && !(Number(row?.done_count) > 0)) return;
    const entry = activity.get(String(row.recipe_id || '').trim());
    if (!entry) return;
    entry.completedAt = Math.max(entry.completedAt, timeOf(row.last_done_at));
    entry.doneCount = Math.max(entry.doneCount, Number(row.done_count || 0));
  };
  for (const row of user.done_recipes || []) applyDone(row);
  for (const row of user.saved_recipes || []) applyDone(row);

  const hidden = new Set(user.hidden_pantry_recipes || []);
  const ordered = [...activity.entries()]
    .filter(([recipeId]) => !hidden.has(recipeId))
    .sort((a, b) => Math.max(b[1].startedAt, b[1].completedAt) - Math.max(a[1].startedAt, a[1].completedAt));
  if (!ordered.length) return [];

  const recipes = await Recipe.find({ recipe_id: { $in: ordered.map(([id]) => id) } })
    .select('recipe_id title slug heroImage steps')
    .lean();
  const byId = new Map(recipes.map(recipe => [recipe.recipe_id, recipe]));

  return ordered.map(([recipeId, meta]) => {
    const recipe = byId.get(recipeId);
    if (!recipe) return null;
    const totalSteps = Math.max(Array.isArray(recipe.steps) ? recipe.steps.length : 0, 1);
    const open = isOpenBrew(meta.startedAt, meta.completedAt)
      || (meta.completedAt === 0 && meta.sessionCount === 0 && meta.doneCount === 0);
    const doneCount = Math.max(meta.doneCount, meta.sessionCount);
    return {
      id: recipe.recipe_id,
      slug: recipe.slug,
      name: recipe.title,
      imageUrl: recipe.heroImage?.url || null,
      matchLabel: historyLabel(open, doneCount),
      matchTone: open ? 'warning' : 'success',
      status: open ? 'progress' : 'done',
      step: open ? 1 : totalSteps,
      totalSteps,
      completedOn: open ? null : formatCompletedOn(meta.completedAt),
      doneCount
    };
  }).filter(Boolean);
}

const READY_LIMIT = 3;
const ALMOST_LIMIT = 3;
const PRODUCT_LIMIT = 3;

function presentSuggestion(recipe, missingName) {
  return {
    id: recipe.recipe_id,
    slug: recipe.slug,
    name: recipe.title,
    imageUrl: recipe.heroImage?.url || null,
    matchLabel: missingName ? `Needs ${missingName}` : 'Ready',
    matchTone: missingName ? 'warning' : 'success'
  };
}

function productScore(product, need) {
  let score = product.is_best_seller ? 10 : 0;
  const grade = normalizePantryText(product.matcha?.product_grade);
  const name = normalizePantryText(product.name);
  if (need?.kind === 'matcha' && need.grade !== 'any' && grade.includes(need.grade)) score += 5;
  if (need?.kind === 'hojicha' && /houjicha|hojicha/.test(name)) score += 5;
  if (need?.kind === 'named' && name === need.name) score += 8;
  return score;
}

function productInStock(product) {
  return (product.variants || []).some(variant => Number(variant.stock) > 0);
}

function ownsProduct(product, ownedKeys) {
  return productKeys(product).some(key => ownedKeys.has(key));
}

// Every shop product that can stand in for this ingredient, not just the best one.
function productsForNeed(products, need, ownedKeys) {
  if (!need || need.kind === 'staple') return [];
  return products.filter(product => !ownsProduct(product, ownedKeys) && profileCoversNeed(coversFromProduct(product), need));
}

function phraseList(titles) {
  const shown = titles.slice(0, 2);
  const rest = titles.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

function shopLabel(unlocks, toward) {
  if (unlocks.length) return `Unlocks ${phraseList(unlocks)}`;
  if (toward.length) return `For ${phraseList(toward)}`;
  return '';
}

function cartImage(image) {
  if (!image?.url) return null;
  return {
    url: image.url,
    public_id: image.public_id || '',
    sort_order: image.sort_order ?? 0,
    alt_text: image.alt_text || ''
  };
}

function cartProduct(product) {
  return {
    _id: String(product._id),
    product_id: product.product_id,
    name: product.name,
    slug: product.slug || '',
    category: product.category,
    variant_type: product.variant_type || 'none',
    images: (product.images || []).map(cartImage).filter(Boolean),
    variants: (product.variants || []).map(variant => ({
      sku: variant.sku,
      label: variant.label || '',
      price: variant.price,
      stock: variant.stock ?? 0,
      is_default: !!variant.is_default,
      images: (variant.images || []).map(cartImage).filter(Boolean)
    })),
    is_subscribable: !!product.is_subscribable,
    is_subscription: !!product.is_subscription,
    subscribe_discount_percent: product.subscribe_discount_percent ?? null,
    is_active: product.is_active !== false,
    review_count: product.review_count || 0
  };
}

function rememberShopHit(grouped, product, title, completes, score = 0) {
  const key = String(product._id);
  const current = grouped.get(key) || {
    product,
    unlocks: [],
    toward: [],
    score: 0,
    filler: false,
    preferred: false
  };
  current.score = Math.max(current.score, score);
  current.filler = false;
  if (title && completes) {
    if (!current.unlocks.includes(title)) {
      current.toward = current.toward.filter(item => item !== title);
      current.unlocks.push(title);
    }
  } else if (title && !current.unlocks.includes(title) && !current.toward.includes(title)) {
    current.toward.push(title);
  }
  grouped.set(key, current);
}

function attachRecipeProducts(grouped, recipeTitle, missing, products, ownedKeys) {
  const picks = new Map();
  for (const miss of missing) {
    for (const product of productsForNeed(products, miss.need, ownedKeys)) {
      const score = productScore(product, miss.need);
      const key = String(product._id);
      const previous = picks.get(key);
      if (!previous || score > previous.score) picks.set(key, { product, score });
    }
  }
  for (const { product, score } of picks.values()) {
    const completes = missing.every(item => profileCoversNeed(coversFromProduct(product), item.need));
    rememberShopHit(grouped, product, recipeTitle, completes, score);
  }
}

function suggestionFamily(product) {
  const name = normalizePantryText(product?.name);
  const tags = (product?.product_tag || []).map(tag => normalizePantryText(tag));
  if (/houjicha|hojicha/.test(name) || tags.some(tag => /houjicha|hojicha/.test(tag))) return 'hojicha';
  if (tags.some(tag => tag.includes('related tea'))) return 'related-tea';
  if (product?.category === 'matcha') return 'matcha';
  if (product?.category === 'coffee') return 'coffee';
  return product?.category || 'other';
}

function familyRank(family) {
  const order = ['hojicha', 'related-tea', 'matcha', 'coffee', 'tools', 'drinkware', 'sets_bundles'];
  const index = order.indexOf(family);
  return index === -1 ? order.length : index;
}

function compareShopHits(a, b) {
  return b.unlocks.length - a.unlocks.length
    || b.toward.length - a.toward.length
    || Number(productInStock(b.product)) - Number(productInStock(a.product))
    || b.score - a.score
    || Number(b.preferred) - Number(a.preferred)
    || Number(!!b.product.is_best_seller) - Number(!!a.product.is_best_seller)
    || familyRank(a.family || suggestionFamily(a.product)) - familyRank(b.family || suggestionFamily(b.product))
    || String(a.product.name || '').localeCompare(String(b.product.name || ''));
}

function fillerLabel(product) {
  const family = suggestionFamily(product);
  if (family === 'related-tea') return 'A different tea to try';
  if (family === 'matcha') return 'Another matcha to try';
  if (family === 'coffee') return 'Another coffee to try';
  if (family === 'tools') return 'A tool for the brew';
  if (family === 'drinkware') return 'For the table';
  if (family === 'sets_bundles') return 'A set to try';
  return 'A different kind to try';
}

// One product per kind. A recipe missing hojicha and coffee contributes both,
// and a second hojicha tin does not take another slot.
function chooseSuggestions(grouped, products, ownedKeys, items, productByKey) {
  const byFamily = new Map();
  for (const entry of grouped.values()) {
    const family = suggestionFamily(entry.product);
    const candidate = { ...entry, family };
    const current = byFamily.get(family);
    if (!current || compareShopHits(candidate, current) < 0) byFamily.set(family, candidate);
  }

  const chosen = [...byFamily.values()].sort(compareShopHits);
  if (chosen.length >= PRODUCT_LIMIT) return chosen.slice(0, PRODUCT_LIMIT);

  const used = new Set(chosen.map(entry => entry.family));
  const ownedFamilies = new Set();
  for (const item of items) {
    const product = item.product_id ? productByKey.get(String(item.product_id)) : null;
    if (product) ownedFamilies.add(suggestionFamily(product));
  }

  const fillerByFamily = new Map();
  for (const product of products) {
    if (!productInStock(product) || ownsProduct(product, ownedKeys)) continue;
    const family = suggestionFamily(product);
    if (used.has(family)) continue;
    const entry = {
      product,
      unlocks: [],
      toward: [],
      score: 0,
      filler: true,
      preferred: !ownedFamilies.has(family),
      family
    };
    const current = fillerByFamily.get(family);
    if (!current || compareShopHits(entry, current) < 0) fillerByFamily.set(family, entry);
  }

  for (const entry of [...fillerByFamily.values()].sort(compareShopHits)) {
    if (chosen.length >= PRODUCT_LIMIT) break;
    chosen.push(entry);
  }
  return chosen.slice(0, PRODUCT_LIMIT);
}

// History stays in startedRecipeCards. Water and ice count as already at home.
// Matcha and coffee tins match by what they are. Almost there suggests exactly
// three products, one of each kind: a tin that finishes a recipe, then the
// other kind a recipe is still missing, then a different kind to fill the row.
async function pantryIdeas(userId, historyIds) {
  const empty = {
    suggestions: { ready: [], almost: [], readyTotal: 0, almostTotal: 0 },
    missing: []
  };
  const items = await PantryItem.find({
    user_id: userId,
    status: { $in: ['active', 'expired'] }
  }).select('name product_id category').lean();
  if (!items.length) return empty;

  const products = await Product.find({ is_active: true })
    .select('product_id name slug images variants is_best_seller is_subscribable is_subscription subscribe_discount_percent variant_type review_count is_active category product_tag matcha')
    .lean();
  const productByKey = new Map();
  for (const product of products) {
    for (const key of productKeys(product)) productByKey.set(key, product);
  }

  const ownedKeys = new Set();
  const covers = [];
  for (const item of items) {
    const product = item.product_id ? productByKey.get(String(item.product_id)) : null;
    if (product) {
      for (const key of productKeys(product)) ownedKeys.add(key);
    } else if (item.product_id) {
      ownedKeys.add(String(item.product_id));
    }
    covers.push(...coversForItem(item, product));
  }

  const recipes = await Recipe.find({ published: true })
    .select('recipe_id title slug heroImage ingredients')
    .limit(500)
    .lean();

  const ready = [];
  const almost = [];
  const near = [];
  const farther = [];
  for (const recipe of recipes) {
    if (!recipe?.recipe_id || historyIds.has(recipe.recipe_id)) continue;
    const required = (recipe.ingredients || []).filter(item => item && item.name && !item.optional);
    if (!required.length) continue;
    const missing = required
      .map(item => ({ name: item.name, need: ingredientNeed(item.name) }))
      .filter(item => !profileCoversNeed(covers, item.need));
    if (missing.length === 0) ready.push(recipe);
    else if (missing.length === 1) almost.push({ recipe, missingName: missing[0].name, need: missing[0].need });
    if (missing.length === 1 || missing.length === 2) near.push({ recipe, missing });
    else if (missing.length > 2) farther.push({ recipe, missing });
  }

  ready.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  almost.sort((a, b) => String(a.recipe.title).localeCompare(String(b.recipe.title)));

  const grouped = new Map();
  for (const entry of [...near, ...farther]) {
    attachRecipeProducts(grouped, entry.recipe.title, entry.missing, products, ownedKeys);
  }

  const missing = chooseSuggestions(grouped, products, ownedKeys, items, productByKey)
    .map(entry => ({
      id: String(entry.product._id),
      productId: entry.product.product_id,
      name: entry.product.name,
      slug: entry.product.slug || '',
      imageUrl: primaryImage(entry.product),
      unlocks: entry.filler ? fillerLabel(entry.product) : shopLabel(entry.unlocks, entry.toward),
      price: defaultVariantPrice(entry.product),
      product: cartProduct(entry.product)
    }));

  return {
    suggestions: {
      ready: ready.slice(0, READY_LIMIT).map(recipe => presentSuggestion(recipe)),
      almost: almost.slice(0, ALMOST_LIMIT).map(entry => presentSuggestion(entry.recipe, entry.missingName)),
      readyTotal: ready.length,
      almostTotal: almost.length
    },
    missing
  };
}

async function getPantry(user) {
  await markExpiredItems(user.user_id);
  const items = await PantryItem.find({
    user_id: user.user_id,
    status: { $in: VISIBLE_STATUSES }
  }).sort({ created_at: -1 });
  const recipes = await startedRecipeCards(user);
  const historyIds = new Set(recipes.map(recipe => recipe.id));
  const { suggestions, missing } = await pantryIdeas(user.user_id, historyIds);
  return {
    items: await presentPantryItems(items),
    recipes,
    suggestions,
    missing
  };
}

async function presentPantryItems(items) {
  const products = await productsByIds(items.map(item => item.product_id));
  const byKey = new Map();
  for (const product of products) {
    for (const key of productKeys(product)) byKey.set(key, product);
  }
  return items.map(item => {
    const presented = presentItem(item);
    const product = item.product_id ? byKey.get(String(item.product_id)) : null;
    if (!product) return presented;
    return {
      ...presented,
      productSlug: product.slug || '',
      productName: product.name || '',
      purchasable: product.is_active !== false
    };
  });
}

async function notifyExpiringPantry(now = new Date()) {
  const items = await PantryItem.find({
    status: 'active',
    expiry_date: { $ne: null },
    expiry_notified_at: null
  });
  const due = items.filter(item => daysUntil(item.expiry_date, now) === 7);
  const byUser = new Map();
  for (const item of due) {
    const list = byUser.get(item.user_id) || [];
    list.push(item);
    byUser.set(item.user_id, list);
  }

  let sent = 0;
  for (const [userId, rows] of byUser) {
    try {
      const message = expiryNotice(rows.map(row => row.name));
      if (!message) continue;
      await createNotification({
        recipient_id: userId,
        sender: null,
        type: 'PANTRY_EXPIRY_SOON',
        post_id: 'pantry',
        comment_content: message
      });
      await PantryItem.updateMany(
        { _id: { $in: rows.map(row => row._id) }, expiry_notified_at: null },
        { $set: { expiry_notified_at: now } }
      );
      sent += 1;
    } catch (error) {
      console.error('Pantry expiry notice failed:', userId, error);
    }
  }

  const today = startOfVnDay(now);
  if (today) {
    await PantryItem.updateMany(
      { status: 'active', expiry_date: { $ne: null, $lt: today } },
      { $set: { status: 'expired' } }
    );
  }
  return sent;
}

let expiryTimer = null;

function startPantryExpiryJob() {
  if (expiryTimer) return;
  const run = () => {
    const wait = msUntilVnHour(8);
    expiryTimer = setTimeout(() => {
      notifyExpiringPantry()
        .catch(error => console.error('Pantry expiry job failed:', error))
        .finally(() => {
          expiryTimer = null;
          run();
        });
    }, wait);
  };
  run();
}

async function countActive(userId) {
  return PantryItem.countDocuments({ user_id: userId, status: 'active' });
}

module.exports = {
  ACTIVE_ITEM_LIMIT,
  daysUntil,
  presentItem,
  addItemsForDeliveredOrder,
  removeItemsForRefund,
  deductForBrew,
  coverageForRecipe,
  findCatalogProduct,
  markRecipeDone,
  recordBrewStart,
  hidePantryRecipes,
  getPantry,
  notifyExpiringPantry,
  startPantryExpiryJob,
  countActive,
  createItem
};
