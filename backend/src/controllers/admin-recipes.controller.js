const Recipe = require('../models/Recipe');
const Post = require('../models/Post');
const Product = require('../models/Product');
const {
  sourceKind,
  authorLine,
  visibleInAdmin,
  prepareRecipeCatalog,
  likeCountByRecipe
} = require('../services/recipe-source');
const { ensureFeaturedRecipes, HOMEPAGE_FEATURED_LIMIT } = require('../services/recipe-featured');
const pantry = require('../services/pantry.logic');
const { createNotification } = require('../services/notification.service');
const { parseModerationBody, ownerNotice } = require('../constants/recipe-moderation-reasons');
const {
  applyHideFields,
  clearHideFields,
  softDeleteRecipe,
  isDeleted,
  MAX_REVIEW_ROUNDS
} = require('../services/recipe-moderation');

// Admin rows are 44px. Cloudinary originals are requested at 3840px wide,
// which is what makes the recipes table feel slow after the nav click.
function thumbnailUrl(url) {
  if (typeof url !== 'string' || !url.includes('/image/upload/')) return url || null;
  const marker = '/image/upload/';
  const index = url.indexOf(marker);
  const prefix = url.slice(0, index + marker.length);
  const rest = url.slice(index + marker.length);
  const slash = rest.indexOf('/');
  const first = slash === -1 ? rest : rest.slice(0, slash);
  const isTransform = first.includes(',') || /^(c_|f_|w_|h_|q_|g_|e_)/.test(first);
  const path = isTransform ? rest.slice(slash + 1) : rest;
  return `${prefix}c_fill,g_auto,w_128,h_128,f_auto,q_auto/${path}`;
}

function presentRecipe(recipe, communityUsername) {
  const kind = sourceKind(recipe);
  const linkedCount = Array.isArray(recipe.relatedProducts)
    ? recipe.relatedProducts.filter((item) => item != null && String(item).trim() !== '').length
    : 0;
  const deleted = isDeleted(recipe);
  const moderationStatus = deleted
    ? 'deleted'
    : (recipe.moderation_status || (recipe.hiddenByAdmin ? 'hidden' : 'visible'));
  return {
    recipe_id: recipe.recipe_id,
    title: recipe.title,
    slug: recipe.slug,
    image_url: thumbnailUrl(recipe.heroImage?.url),
    author_line: authorLine(recipe, communityUsername),
    source: kind,
    linked: kind === 'community' ? 'not_allowed' : (linkedCount > 0 ? 'linked' : 'not_linked'),
    linked_count: linkedCount,
    featured: Boolean(recipe.featured),
    published: !deleted && recipe.published !== false,
    deleted,
    moderation_status: moderationStatus,
    hidden_reason: recipe.hidden_reason || null,
    review_round: Number(recipe.review_round) || 0,
    updated_at: recipe.updatedAt || null
  };
}

function presentFeaturedSlot(recipe) {
  return {
    recipe_id: recipe.recipe_id,
    title: recipe.title || 'Untitled recipe',
    image_url: thumbnailUrl(recipe.heroImage?.url)
  };
}

// Homepage order is saves, then recipe id — the same order the public rail uses.
function homepageFeatured(exceptId) {
  const filter = { featured: true, published: { $ne: false }, deletedAt: null };
  if (exceptId) filter.recipe_id = { $ne: exceptId };
  return Recipe.find(filter)
    .sort({ saves: -1, recipe_id: 1 })
    .limit(HOMEPAGE_FEATURED_LIMIT)
    .select('recipe_id title heroImage.url')
    .lean();
}

// Featuring past the homepage cap replaces the recipe the admin picked.
// It does not drop whichever document happens to sort first.
async function claimFeaturedSlot(recipe, featured, replaceId) {
  if (!featured) {
    recipe.featured = false;
    return { replaced: null };
  }
  if (recipe.published === false) {
    return { error: 'Hidden recipes stay off the homepage.' };
  }
  if (recipe.featured) {
    recipe.featured = true;
    return { replaced: null };
  }
  const slots = await homepageFeatured(recipe.recipe_id);
  if (slots.length < HOMEPAGE_FEATURED_LIMIT) {
    recipe.featured = true;
    return { replaced: null };
  }
  const target = slots.find((item) => item.recipe_id === replaceId);
  if (!target) return { error: `The homepage already has ${HOMEPAGE_FEATURED_LIMIT} recipes. Choose which one to replace.` };
  recipe.featured = true;
  return { replaced: target };
}

async function releaseReplaced(replaced, updatedAt) {
  if (!replaced) return;
  await Recipe.updateOne(
    { recipe_id: replaced.recipe_id },
    { $set: { featured: false, updatedAt } }
  );
}

async function listRecipes(req, res) {
  try {
    await prepareRecipeCatalog();
    await ensureFeaturedRecipes();
    // deletedAt null sorts first → active recipes by updatedAt; soft-deleted sink to the bottom.
    const recipes = await Recipe.find({ lifecycle: { $ne: 'community_origin' } })
      .select('recipe_id title slug heroImage.url source relatedProducts featured published updatedAt lifecycle owner_user_id origin moderation_status hiddenByAdmin hidden_reason review_round deletedAt')
      .sort({ deletedAt: 1, updatedAt: -1, recipe_id: 1 })
      .lean();
    const communityIds = recipes.filter((recipe) => sourceKind(recipe) === 'community').map((recipe) => recipe.recipe_id);
    const { likes, names } = communityIds.length
      ? await likeCountByRecipe(communityIds)
      : { likes: new Map(), names: new Map() };
    const visible = recipes.filter((recipe) => visibleInAdmin(recipe, likes.get(recipe.recipe_id) || 0));
    const featured = await homepageFeatured();
    res.json({
      data: visible.map((recipe) => presentRecipe(recipe, names.get(recipe.recipe_id))),
      featured_recipes: featured.map(presentFeaturedSlot),
      featured_limit: HOMEPAGE_FEATURED_LIMIT
    });
  } catch (error) {
    console.error('Error listing admin recipes:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes' });
  }
}

async function updateFeatured(req, res) {
  try {
    const featured = req.body?.featured;
    if (typeof featured !== 'boolean') {
      return res.status(400).json({ error: 'featured must be true or false.' });
    }

    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
    if (featured && recipe.published === false) {
      return res.status(400).json({ error: 'Hidden recipes stay off the homepage.' });
    }

    const previous = Boolean(recipe.featured);
    const replaceId = typeof req.body?.replace_recipe_id === 'string' ? req.body.replace_recipe_id.trim() : '';
    const claimed = await claimFeaturedSlot(recipe, featured, replaceId);
    if (claimed.error) return res.status(400).json({ error: claimed.error });
    if (previous !== Boolean(recipe.featured) || claimed.replaced) {
      recipe.updatedAt = new Date().toISOString();
      await recipe.save();
      await releaseReplaced(claimed.replaced, recipe.updatedAt);
      await req.writeActivityLog({
        actionType: featured ? 'recipe.feature' : 'recipe.unfeature',
        targetEntity: 'Recipes',
        targetId: recipe.recipe_id,
        oldValue: { featured: previous },
        newValue: { featured: Boolean(recipe.featured), replaced: claimed.replaced?.recipe_id || null }
      });
    }

    res.json({ data: await loadPresented(recipe) });
  } catch (error) {
    console.error('Error updating recipe featured flag:', error);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
}

function adminId(req) {
  return req.user?.user_id || req.user?.id || null;
}

async function linkedPosts(recipe) {
  const recipeId = typeof recipe === 'string' ? recipe : recipe?.recipe_id;
  const originId = typeof recipe === 'string' ? null : recipe?.origin?.communityRecipeId;
  const filter = {
    $or: [
      { recipe_id: recipeId },
      { catalog_recipe_id: recipeId },
      ...(originId ? [{ recipe_id: originId }] : [])
    ]
  };
  return Post.find(filter)
    .select('post_id user_id like_count status author.username catalog_recipe_id recipe_id')
    .lean();
}

function pickOwnerPost(posts, recipe) {
  if (recipe?.owner_user_id) {
    const owned = posts.find((post) => post.user_id === recipe.owner_user_id);
    if (owned) return owned;
  }
  return [...posts]
    .sort((a, b) => (Number(b.like_count) || 0) - (Number(a.like_count) || 0))
    .find((post) => post.user_id) || null;
}

async function notifyOwner(ownerPost, message, recipe, { link = 'edit' } = {}) {
  const recipient_id = ownerPost?.user_id || recipe?.owner_user_id;
  if (!recipient_id) return;
  // Catalog moderation stays on Recipes — never deep-link into Community posts.
  const slug = recipe?.slug || null;
  await createNotification({
    recipient_id,
    type: 'RECIPE_MODERATION',
    post_id: null,
    recipe_slug: link === 'list' ? null : slug,
    message
  });
}

// Catalog hide/delete stays on the Recipes copy. Community posts are never mutated here.
async function setVisibility(req, res) {
  try {
    const published = req.body?.published;
    if (typeof published !== 'boolean') {
      return res.status(400).json({ error: 'published must be true or false.' });
    }

    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
    if (isDeleted(recipe)) {
      return res.status(400).json({ error: 'Deleted recipes cannot be restored.' });
    }
    const kind = sourceKind(recipe);
    const by = adminId(req);
    const previous = {
      published: recipe.published !== false,
      featured: Boolean(recipe.featured),
      hidden_reason: recipe.hidden_reason || null,
      moderation_status: recipe.moderation_status || null
    };

    if (published) {
      clearHideFields(recipe, { by });
      await recipe.save();
      if (kind === 'community') {
        const posts = await linkedPosts(recipe);
        const ownerPost = pickOwnerPost(posts, recipe);
        try {
          await notifyOwner(ownerPost, 'Your recipe is visible on the Recipes page again.', recipe, { link: 'recipe' });
        } catch (error) {
          console.error('Error notifying recipe owner on restore:', error);
        }
      }
      await req.writeActivityLog({
        actionType: 'recipe.unhide',
        targetEntity: 'Recipes',
        targetId: recipe.recipe_id,
        oldValue: previous,
        newValue: { published: true, featured: Boolean(recipe.featured), moderation_status: 'visible' }
      });
      return res.json({ data: await loadPresented(recipe) });
    }

    const parsed = parseModerationBody(req.body, { action: 'hide', source: kind });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const posts = kind === 'community' ? await linkedPosts(recipe) : [];
    const ownerPost = kind === 'community' ? pickOwnerPost(posts, recipe) : null;
    if (kind === 'community' && !ownerPost && !recipe.owner_user_id) {
      return res.status(400).json({ error: 'This Community recipe has no owner to notify.' });
    }

    applyHideFields(recipe, { reason: parsed.reason, note: parsed.note, by, status: 'hidden' });
    if (parsed.reason === 'low_quality') {
      recipe.review_round = Number(recipe.review_round) || 0;
    }
    await recipe.save();

    if (kind === 'community') {
      try {
        const roundsLeft = parsed.reason === 'low_quality'
          ? Math.max(0, MAX_REVIEW_ROUNDS - (Number(recipe.review_round) || 0))
          : null;
        const base = ownerNotice({ action: 'hide', label: parsed.label, note: parsed.note });
        const message = roundsLeft == null
          ? base
          : `${base} You can edit and submit for review (${roundsLeft} of ${MAX_REVIEW_ROUNDS} attempts left).`;
        await notifyOwner(ownerPost, message, recipe, { link: 'edit' });
      } catch (error) {
        console.error('Error notifying recipe owner:', error);
        return res.status(500).json({
          error: 'The recipe is hidden, but the owner was not notified. Try again.',
          data: presentRecipe(recipe, ownerPost?.author?.username)
        });
      }
    }

    await req.writeActivityLog({
      actionType: 'recipe.hide',
      targetEntity: 'Recipes',
      targetId: recipe.recipe_id,
      oldValue: previous,
      newValue: {
        published: false,
        featured: false,
        hidden_reason: parsed.reason,
        hidden_note: parsed.note || null,
        moderation_status: 'hidden',
        notified: kind === 'community'
      },
      reason: parsed.reason
    });
    res.json({ data: await loadPresented(recipe) });
  } catch (error) {
    console.error('Error updating recipe visibility:', error);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
}

// Soft-delete. Public 404; Saved/Pantry auto-cleared; no Restore. Community post stays.
async function deleteRecipe(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
    if (isDeleted(recipe)) return res.json({ data: { recipe_id: recipe.recipe_id, deleted: true } });

    const kind = sourceKind(recipe);
    const parsed = parseModerationBody(req.body, { action: 'delete', source: kind });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const by = adminId(req);
    const posts = kind === 'community' ? await linkedPosts(recipe) : [];
    const ownerPost = kind === 'community' ? pickOwnerPost(posts, recipe) : null;
    if (kind === 'community' && !ownerPost && !recipe.owner_user_id) {
      return res.status(400).json({ error: 'This Community recipe has no owner to notify.' });
    }

    if (kind === 'community') {
      try {
        await notifyOwner(ownerPost, ownerNotice({
          action: 'delete',
          label: parsed.label,
          note: parsed.note
        }), recipe, { link: 'list' });
      } catch (error) {
        console.error('Error notifying recipe owner on delete:', error);
        return res.status(500).json({ error: 'Could not notify the owner. The recipe was not deleted.' });
      }
    }

    const { saverIds } = await softDeleteRecipe(recipe, {
      reason: parsed.reason,
      note: parsed.note,
      by
    });

    await req.writeActivityLog({
      actionType: 'recipe.delete',
      targetEntity: 'Recipes',
      targetId: recipe.recipe_id,
      oldValue: {
        title: recipe.title,
        slug: recipe.slug,
        source: kind,
        published: recipe.published !== false,
        featured: Boolean(recipe.featured)
      },
      newValue: {
        soft_deleted: true,
        savers_notified: saverIds.length,
        notified: kind === 'community',
        note: parsed.note || null
      },
      reason: parsed.reason
    });
    res.json({ data: { recipe_id: recipe.recipe_id, deleted: true } });
  } catch (error) {
    console.error('Error deleting recipe:', error);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
}

async function requestMoreChanges(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
    if (isDeleted(recipe)) return res.status(400).json({ error: 'Deleted recipes cannot be reviewed.' });
    if (sourceKind(recipe) !== 'community') {
      return res.status(400).json({ error: 'Only Community recipes use review rounds.' });
    }
    if (recipe.moderation_status !== 'resubmitted') {
      return res.status(400).json({ error: 'This recipe is not waiting for review.' });
    }
    if ((Number(recipe.review_round) || 0) >= MAX_REVIEW_ROUNDS) {
      return res.status(400).json({ error: 'No review rounds left. Use final reject or restore.' });
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return res.status(400).json({ error: 'Add a note explaining what still needs fixing.' });
    if (note.length > 200) return res.status(400).json({ error: 'The note must be 200 characters or fewer.' });

    const by = adminId(req);
    applyHideFields(recipe, {
      reason: 'low_quality',
      note,
      by,
      status: 'hidden'
    });
    recipe.resubmitted_at = null;
    await recipe.save();

    const posts = await linkedPosts(recipe);
    const ownerPost = pickOwnerPost(posts, recipe);
    const roundsLeft = Math.max(0, MAX_REVIEW_ROUNDS - (Number(recipe.review_round) || 0));
    await notifyOwner(
      ownerPost,
      `More changes needed on your recipe: ${note} (${roundsLeft} of ${MAX_REVIEW_ROUNDS} attempts left).`,
      recipe,
      { link: 'edit' }
    );

    await req.writeActivityLog({
      actionType: 'recipe.request_changes',
      targetEntity: 'Recipes',
      targetId: recipe.recipe_id,
      oldValue: { moderation_status: 'resubmitted' },
      newValue: { moderation_status: 'hidden', hidden_note: note, review_round: recipe.review_round },
      reason: 'low_quality'
    });
    res.json({ data: await loadPresented(recipe) });
  } catch (error) {
    console.error('Error requesting recipe changes:', error);
    res.status(500).json({ error: 'Failed to request changes' });
  }
}

async function finalReject(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
    if (isDeleted(recipe)) return res.status(400).json({ error: 'Deleted recipes cannot be reviewed.' });
    if (sourceKind(recipe) !== 'community') {
      return res.status(400).json({ error: 'Only Community recipes use final reject.' });
    }
    if ((Number(recipe.review_round) || 0) < MAX_REVIEW_ROUNDS && recipe.moderation_status !== 'resubmitted') {
      return res.status(400).json({ error: 'Final reject is only for recipes that used all review rounds.' });
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const by = adminId(req);
    const previous = {
      moderation_status: recipe.moderation_status,
      review_round: recipe.review_round
    };
    applyHideFields(recipe, {
      reason: recipe.hidden_reason || 'low_quality',
      note: note || recipe.hidden_note || 'No further edits accepted.',
      by,
      status: 'hidden_final'
    });
    await recipe.save();

    const posts = await linkedPosts(recipe);
    const ownerPost = pickOwnerPost(posts, recipe);
    await notifyOwner(
      ownerPost,
      'Your recipe has reached the edit limit and stays hidden on Recipes. You can still delete it or contact support.',
      recipe,
      { link: 'recipe' }
    );

    await req.writeActivityLog({
      actionType: 'recipe.final_reject',
      targetEntity: 'Recipes',
      targetId: recipe.recipe_id,
      oldValue: previous,
      newValue: { moderation_status: 'hidden_final' },
      reason: 'low_quality'
    });
    res.json({ data: await loadPresented(recipe) });
  } catch (error) {
    console.error('Error final-rejecting recipe:', error);
    res.status(500).json({ error: 'Failed to final reject recipe' });
  }
}

const BASES = { matcha: 'MATCHA', coffee: 'COFFEE', others: 'OTHERS' };
const BASE_NAME_TAGS = new Set(Object.values(BASES));
const SERVE_TAGS = { hot: 'HOT', cold: 'COLD', dessert: 'DESSERT' };
const SERVE_ORDER = ['hot', 'cold', 'dessert'];
const DIFFICULTY = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };
const MANAGED_TAGS = new Set([...BASE_NAME_TAGS, ...Object.values(SERVE_TAGS), 'COCKTAIL', 'ICED']);
const OFFSITE_SOURCE = {
  type: 'offsite',
  author: 'Offsite',
  communityPostId: null,
  communityPostTitle: null,
  creatorName: null,
  creatorAvatar: null
};

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Pantry words and measures are not shop products. "Ice" must not match a coffee
// whose name merely contains those letters, while "2 shots of espresso" should.
const SUGGESTION_STOP = new Set([
  'and', 'the', 'for', 'from', 'with', 'into', 'per', 'hot', 'cold', 'warm', 'iced',
  'ice', 'ices', 'cube', 'cubes', 'water', 'sugar', 'salt', 'honey', 'syrup',
  'shot', 'shots', 'cup', 'cups', 'tsp', 'tbsp', 'ounce', 'ounces', 'gram', 'grams',
  'piece', 'pieces', 'pinch', 'dash', 'splash', 'fresh', 'large', 'small', 'room', 'optional'
]);
const TOKEN_ALIASES = {
  espresso: ['coffee'],
  coffee: ['espresso', 'bean', 'beans'],
  bean: ['coffee', 'beans'],
  beans: ['coffee', 'bean'],
  brew: ['coffee'],
  whisk: ['chasen'],
  chasen: ['whisk'],
  bowl: ['chawan'],
  chawan: ['bowl'],
  scoop: ['chashaku'],
  chashaku: ['scoop'],
  kettle: ['gooseneck'],
  gooseneck: ['kettle'],
  oat: ['oatly'],
  oatly: ['oat'],
  dripper: ['pourover', 'v60', 'pour'],
  pourover: ['dripper', 'v60'],
  v60: ['dripper', 'pourover'],
  filter: ['filters', 'paper'],
  filters: ['filter', 'paper'],
  frother: ['nanofoamer', 'foamer'],
  foamer: ['frother', 'nanofoamer'],
  almond: ['almondmilk'],
  soy: ['soymilk'],
  coconut: ['coconutmilk']
};
// Filler words that should not link a product on their own.
const GENERIC_TOKENS = new Set([
  'powder', 'grade', 'organic', 'premium', 'classic', 'blend', 'house', 'drink',
  'set', 'kit', 'natural', 'pure', 'style', 'extra', 'dark', 'light',
  'medium', 'fine', 'white', 'black', 'original', 'signature', 'special',
  'cream', 'foam', 'sauce', 'oil', 'juice', 'yogurt'
]);
// Head nouns that usually need a qualifier ("oat milk") but can still help rank.
const HEAD_NOUNS = new Set(['milk', 'tea', 'syrup', 'beans', 'bean', 'powder']);

function meaningfulTokens(value) {
  return normalizeName(value).split(' ').filter((token) => {
    if (!token || token.length <= 2 || /^\d/.test(token)) return false;
    return !SUGGESTION_STOP.has(token);
  });
}

function stem(token) {
  let value = token;
  if (value.length > 4 && value.endsWith('ies')) value = `${value.slice(0, -3)}y`;
  else if (value.length > 4 && value.endsWith('es') && !/(ss|ch|sh)es$/.test(value)) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss')) value = value.slice(0, -1);
  return value.length >= 3 ? value : token;
}

function isGeneric(token) {
  return GENERIC_TOKENS.has(token) || GENERIC_TOKENS.has(stem(token));
}

function editDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const next = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function tokenSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = stem(a);
  const right = stem(b);
  if (left === right) return 0.94;
  const aliases = new Set([...(TOKEN_ALIASES[a] || []), ...(TOKEN_ALIASES[left] || [])].map(stem));
  if (aliases.has(b) || aliases.has(right)) return 0.82;
  const longer = Math.max(left.length, right.length);
  if (longer >= 5 && editDistance(left, right) <= (longer >= 8 ? 2 : 1)) return 0.72;
  return 0;
}

function asProduct(product) {
  if (typeof product === 'string') return { name: product, category: '', product_tag: [] };
  return product || { name: '', category: '' };
}

function bestSimilarity(token, nameTokens, extraTokens) {
  let best = 0;
  for (const other of nameTokens) best = Math.max(best, tokenSimilarity(token, other));
  for (const other of extraTokens) best = Math.max(best, tokenSimilarity(token, other) * 0.92);
  return best;
}

// Name + catalog labels only. Tasting notes ("cherry", "key lime") must not
// turn a coffee bag into a match for cherry soda or lime juice.
function productText(product) {
  return [
    product.name,
    ...(Array.isArray(product.product_tag) ? product.product_tag : []),
    product.matcha?.product_grade,
    product.drinkware?.ware_type,
    product.tools?.tool_category,
    product.tools?.tool_type
  ].filter(Boolean).join(' ');
}

function hintMatchTokens(hint) {
  const all = meaningfulTokens(hint);
  const distinctive = all.filter((token) => !isGeneric(token) && !HEAD_NOUNS.has(token) && !HEAD_NOUNS.has(stem(token)));
  if (distinctive.length) return distinctive;
  // "milk", "green tea", or a bare head noun still need something to rank against.
  return all.filter((token) => !isGeneric(token) || HEAD_NOUNS.has(token) || HEAD_NOUNS.has(stem(token)));
}

// How much of the ingredient's specific words show up on the product.
// Qualifiers such as "oat" carry the match; head nouns like "milk" only help rank.
function nameAffinity(hint, product) {
  const hintTokens = hintMatchTokens(hint);
  const nameTokens = meaningfulTokens(product.name);
  const productBlob = normalizeName(productText(product));
  const extraTokens = meaningfulTokens(productBlob).filter((token) => !nameTokens.includes(token));
  if (!hintTokens.length || (!nameTokens.length && !extraTokens.length && !productBlob)) return 0;

  const hintNorm = normalizeName(hint);
  const nameNorm = normalizeName(product.name);
  if (hintNorm.length >= 3 && (nameNorm.includes(hintNorm) || hintNorm.includes(nameNorm))) return 92;
  if (hintNorm.length >= 4 && productBlob.includes(hintNorm)) return 88;

  const hintCompact = hintTokens.join('');
  const nameCompact = nameTokens.join('');
  if (hintCompact.length >= 4 && (nameCompact.includes(hintCompact) || productBlob.replace(/\s+/g, '').includes(hintCompact))) {
    return 86;
  }

  const weighted = hintTokens.map((token) => {
    const sim = bestSimilarity(token, nameTokens, extraTokens);
    const weight = HEAD_NOUNS.has(token) || HEAD_NOUNS.has(stem(token)) ? 0.55 : 1;
    return { sim, weight };
  });
  const strong = weighted.filter((item) => item.sim >= 0.68);
  if (!strong.length) return 0;
  const weightSum = hintTokens.reduce((sum, token) => (
    sum + (HEAD_NOUNS.has(token) || HEAD_NOUNS.has(stem(token)) ? 0.55 : 1)
  ), 0);
  const hitWeight = strong.reduce((sum, item) => sum + item.weight, 0);
  const coverage = weightSum ? hitWeight / weightSum : 0;
  const average = strong.reduce((sum, item) => sum + item.sim, 0) / strong.length;
  // Soft bonus when several distinctive tokens land, even if one filler word is missing.
  // Skip single-token hints so an alias like coffee≈espresso cannot beat a literal name hit.
  const bonus = hintTokens.length >= 2 && coverage >= 0.66 && strong.length >= 2 ? 8 : 0;
  const exactNameHits = hintTokens.filter((token) => (
    nameTokens.some((other) => tokenSimilarity(token, other) >= 0.94)
  )).length;
  const exactBoost = exactNameHits ? Math.min(12, exactNameHits * 6) : 0;
  return Math.min(100, Math.round(average * (58 + 42 * coverage) + bonus + exactBoost));
}

function softNamedMatch(productName, hint) {
  const needTokens = hintMatchTokens(hint);
  const coverTokens = meaningfulTokens(productName);
  if (!needTokens.length || !coverTokens.length) return false;
  let hits = 0;
  for (const token of needTokens) {
    // Exact / stemmed tokens only — aliases like brew≈coffee would link a
    // dripper to "cold brew concentrate".
    if (bestSimilarity(token, coverTokens, []) >= 0.94) hits += 1;
  }
  if (!hits) return false;
  // One strong distinctive hit is enough for short hints ("oat", "chasen").
  if (needTokens.length === 1) return hits === 1;
  return hits * 2 >= needTokens.length;
}

// A recipe line should point at the thing it actually is: a ceremonial tin, a
// chasen, an oat milk. Water "for whisking" is still water, and a shared word
// does not make a whisk set the same tool as a chasen.
function matchScore(hint, product) {
  const raw = asProduct(product);
  if (!raw.name || pantry.isStapleIngredient(hint)) return 0;

  if (pantry.itemCoversTool({ name: raw.name, category: raw.category }, raw, hint)) {
    let score = 88 + Math.round(nameAffinity(hint, raw) / 8);
    if (raw.category === 'tools') score += 18;
    if (raw.category === 'sets_bundles') score -= 30;
    return score;
  }

  const need = pantry.ingredientNeed(hint);
  if (!need || need.kind === 'staple') return 0;
  const covers = raw.category ? pantry.coversFromProduct(raw) : pantry.coversFromLabel(raw.name);
  const affinity = nameAffinity(hint, raw);
  if (need.kind !== 'named' && pantry.profileCoversNeed(covers, need)) {
    if (!affinity) return 0;
    let score = 70 + Math.round(affinity / 4);
    const gradeText = `${raw.matcha?.product_grade || ''} ${raw.name}`.toLowerCase();
    if (need.grade && need.grade !== 'any' && gradeText.includes(need.grade)) score += 22;
    if (raw.category === 'tools' || raw.category === 'drinkware' || raw.category === 'sets_bundles') score -= 36;
    return score;
  }
  if (need.kind !== 'named') return 0;
  if (pantry.namedCovers(raw.name, hint) || softNamedMatch(raw.name, hint)) {
    return 64 + Math.round(affinity / 5);
  }
  // Substring / compacted-name hits only (86–92). Token affinity alone used to
  // clear 55 via aliases or tasting-note bleed and force bad suggestions.
  return affinity >= 86 ? affinity : 0;
}

// Stored base wins. Recipes saved before the dropdown still fall back to the title.
function readBase(recipe) {
  const stored = String(recipe.metadata?.base || '').toUpperCase();
  if (BASES[stored.toLowerCase()]) return stored.toLowerCase();
  const title = String(recipe.title || '').toLowerCase();
  if (!title.trim()) return '';
  if (title.includes('matcha')) return 'matcha';
  if (title.includes('coffee')) return 'coffee';
  return 'others';
}

function readServes(recipe) {
  const tags = new Set((recipe.metadata?.tags || []).map((tag) => String(tag).toUpperCase()));
  return SERVE_ORDER.filter((key) => tags.has(SERVE_TAGS[key]));
}

function readDifficulty(recipe) {
  const value = String(recipe.metadata?.difficulty || '').toUpperCase();
  if (value === 'EASY') return 'easy';
  if (value === 'MEDIUM') return 'medium';
  if (value === 'HARD') return 'hard';
  return '';
}

function amountLabel(quantity, unit) {
  if (quantity == null || quantity === '') return '';
  return `${quantity}${unit || ''}`;
}

function productImageUrl(product) {
  const direct = (product.images || []).find((image) => image?.url)?.url;
  if (direct) return direct;
  for (const variant of product.variants || []) {
    const url = (variant.images || []).find((image) => image?.url)?.url;
    if (url) return url;
  }
  return null;
}

function presentLinkable(product, matchedHint = null) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const stock = variants.reduce((sum, variant) => sum + (Number(variant.stock) || 0), 0);
  const sku = variants.find((variant) => variant?.sku)?.sku || '';
  return {
    product_id: String(product.product_id),
    name: product.name || '',
    sku,
    image_url: thumbnailUrl(productImageUrl(product)),
    in_stock: stock > 0,
    matched_hint: matchedHint
  };
}

function suggestionsFor(names, products, linkedIds = []) {
  const linked = new Set((linkedIds || []).map((id) => String(id)));
  const used = new Set();
  const results = [];
  for (const name of names) {
    const trimmed = String(name || '').trim();
    if (!trimmed) continue;
    const ranked = products
      .map((product) => ({ product, score: matchScore(trimmed, product) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)));
    const linkedHit = ranked.find((item) => linked.has(String(item.product.product_id)));
    const fresh = ranked.find((item) => !linked.has(String(item.product.product_id)) && !used.has(String(item.product.product_id)));
    const chosen = linkedHit || fresh;
    if (!chosen) continue;
    if (!linkedHit) used.add(String(chosen.product.product_id));
    results.push(presentLinkable(chosen.product, trimmed));
  }
  return results;
}

function loadActiveProducts() {
  return Product.find({ is_active: { $ne: false } })
    .select('product_id name category product_tag images.url variants.sku variants.stock variants.images.url matcha.product_grade matcha.origin coffee.roast_level coffee.tasting_notes drinkware.ware_type tools.tool_category tools.tool_type')
    .lean();
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Accepts 2, 2.5, 1/2, 1 1/2, 6-8, and 1/2-1. Plain decimals stay numbers for pantry math.
function parseQuantity(value) {
  if (value == null || value === '') return { quantity: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return { error: 'Ingredient quantities must be zero or greater.' };
    }
    return { quantity: value };
  }
  const text = String(value)
    .trim()
    .replace(/,/g, '.')
    .replace(/[–—]/g, '-');
  if (!text) return { quantity: null };

  const part = String.raw`(?:\d+\s+)?(?:\d+\/\d+|\d+(?:\.\d+)?|\.\d+)`;
  const pattern = new RegExp(`^${part}(?:\\s*-\\s*${part})?$`);
  if (!pattern.test(text)) {
    return { error: 'Use amounts like 2, 1/2, 1 1/2, or 6-8.' };
  }

  const normalized = text.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  if (/^\d+(\.\d+)?$/.test(normalized)) {
    const number = Number(normalized);
    if (number < 0) return { error: 'Ingredient quantities must be zero or greater.' };
    return { quantity: number };
  }
  return { quantity: normalized };
}

function parseRecipeBody(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 140) return { error: 'Add a title (140 characters or fewer).' };
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (description.length > 500) return { error: 'The description must be 500 characters or fewer.' };

  const base = readSubmittedBase(body);
  if (base.error) return { error: base.error };
  const serves = readSubmittedServes(body);
  if (serves.error) return { error: serves.error };
  const difficulty = typeof body?.difficulty === 'string' ? body.difficulty : '';
  if (!DIFFICULTY[difficulty]) return { error: 'Choose a difficulty.' };

  const servings = readPositiveInt(body?.servings, { min: 1, max: 99, label: 'Servings' });
  if (servings.error) return { error: servings.error };
  const prepTime = readPositiveInt(body?.prepTime ?? body?.prep_time, {
    min: 0,
    max: 999,
    label: 'Prep time',
    allowZero: true
  });
  if (prepTime.error) return { error: prepTime.error };

  if (!Array.isArray(body?.ingredients)) return { error: 'Add at least one ingredient.' };
  if (body.ingredients.length > 40) return { error: 'Use 40 ingredients or fewer.' };
  const ingredients = [];
  for (const raw of body.ingredients) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    if (name.length > 120) return { error: 'Ingredient names must be 120 characters or fewer.' };
    const parsedQty = parseQuantity(raw?.quantity);
    if (parsedQty.error) return { error: parsedQty.error };
    const unit = typeof raw?.unit === 'string' ? raw.unit.trim().slice(0, 16) : '';
    if (unit && !/^[a-zA-Z]+$/.test(unit)) return { error: 'Use a unit such as g, ml, or cup.' };
    ingredients.push({ name, quantity: parsedQty.quantity, unit, optional: false });
  }
  if (!ingredients.length) return { error: 'Add at least one ingredient.' };

  if (!Array.isArray(body?.tools)) return { error: 'Tools must be a list.' };
  if (body.tools.length > 40) return { error: 'Use 40 tools or fewer.' };
  const tools = [];
  for (const raw of body.tools) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    if (name.length > 120) return { error: 'Tool names must be 120 characters or fewer.' };
    const quantity = numberOrNull(raw?.quantity);
    if (raw?.quantity != null && raw.quantity !== '' && quantity == null) {
      return { error: 'Tool quantities must be numbers.' };
    }
    if (quantity != null && quantity < 0) return { error: 'Tool quantities must be zero or greater.' };
    tools.push({ name, quantity });
  }

  if (!Array.isArray(body?.steps)) return { error: 'Add at least one step.' };
  if (body.steps.length > 40) return { error: 'Use 40 steps or fewer.' };
  const steps = [];
  for (const raw of body.steps) {
    let title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    let description = typeof raw?.description === 'string' ? raw.description.trim() : '';
    if (!title && !description && typeof raw?.text === 'string') {
      const text = raw.text.trim();
      const [titleLine, ...rest] = text.split('\n');
      title = titleLine.trim();
      description = rest.join('\n').trim();
    }
    const timer = readTimer(raw);
    if (timer.error) return { error: timer.error };
    if (!title && !description && timer.timer == null) continue;
    if (!title) title = `Step ${steps.length + 1}`;
    if (title.length > 140) return { error: 'Step titles must be 140 characters or fewer.' };
    if (description.length > 2000) return { error: 'Step instructions must be 2000 characters or fewer.' };
    steps.push({
      order: steps.length + 1,
      title,
      description,
      timerSeconds: timer.timer
    });
  }
  if (!steps.length) return { error: 'Add at least one step.' };

  const featured = typeof body?.featured === 'boolean' ? body.featured : false;
  const published = typeof body?.published === 'boolean' ? body.published : true;
  const relatedIds = Array.isArray(body?.related_products)
    ? [...new Set(body.related_products.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  if (relatedIds.length > 3) return { error: 'Link up to 3 products.' };
  if (relatedIds.some((id) => !/^\d+$/.test(id))) return { error: 'Unknown product.' };

  return {
    value: {
      title,
      description,
      base: base.value,
      serves: serves.values,
      difficulty: DIFFICULTY[difficulty],
      servings: servings.value,
      prepTime: prepTime.value,
      ingredients,
      tools,
      steps,
      featured,
      published,
      relatedIds
    }
  };
}

function readPositiveInt(raw, { min, max, label, allowZero = false }) {
  if (raw == null || raw === '') {
    return { value: allowZero ? 0 : min };
  }
  const number = Number(raw);
  if (!Number.isInteger(number) || number < min || number > max) {
    return { error: `${label} must be a whole number from ${min} to ${max}.` };
  }
  return { value: number };
}

function parseHero(hero) {
  if (hero == null) return { hero: null };
  const url = typeof hero.url === 'string' ? hero.url.trim() : '';
  const publicId = typeof hero.public_id === 'string' ? hero.public_id.trim() : '';
  if (!url || !publicId || !/^https:\/\//.test(url)) return { error: 'Add a cover image.' };
  return { hero: { url, public_id: publicId } };
}

function readSubmittedBase(body) {
  const value = typeof body?.base === 'string' ? body.base.trim().toLowerCase() : '';
  if (!BASES[value]) return { error: 'Choose a base.' };
  return { value: BASES[value] };
}

function readSubmittedServes(body) {
  const raw = Array.isArray(body?.serves)
    ? body.serves
    : (typeof body?.serve === 'string' && body.serve ? [body.serve] : []);
  if (raw.length > SERVE_ORDER.length) return { error: 'Choose how it is served.' };
  const chosen = new Set();
  for (const item of raw) {
    let value = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (value === 'iced') value = 'cold';
    if (!value) continue;
    if (!SERVE_TAGS[value]) return { error: 'Choose how it is served.' };
    chosen.add(value);
  }
  return { values: SERVE_ORDER.filter((key) => chosen.has(key)) };
}

function nextTags(existing, serves) {
  const kept = (existing || [])
    .map((tag) => String(tag).toUpperCase())
    .filter((tag) => tag && !MANAGED_TAGS.has(tag));
  const selected = SERVE_ORDER.filter((key) => (serves || []).includes(key)).map((key) => SERVE_TAGS[key]);
  return [...selected, ...kept];
}

function readTimer(raw) {
  const value = raw?.timer_seconds ?? raw?.timerSeconds;
  if (value == null || value === '') return { timer: null };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 3 * 60 * 60) {
    return { error: 'Step timers must be between 0 and 3 hours.' };
  }
  return { timer: number > 0 ? number : null };
}

async function resolveProductIds(ids) {
  if (!ids.length) return { ids: [] };
  const numeric = ids.map((id) => Number(id));
  const found = await Product.find({ product_id: { $in: numeric }, is_active: { $ne: false } })
    .select('product_id')
    .lean();
  if (found.length !== ids.length) return { error: 'One of the linked products is no longer available.' };
  return { ids };
}

async function presentDetail(recipe, products, featuredRecipes, communityUsername) {
  const kind = sourceKind(recipe);
  const ingredients = (recipe.ingredients || []).map((item) => ({
    name: item.name || '',
    quantity: item.quantity == null ? null : item.quantity,
    unit: item.unit || ''
  }));
  const tools = (recipe.tools || []).map((item) => ({
    name: item.name || '',
    quantity: item.quantity == null ? null : item.quantity
  }));
  const linkedIds = (recipe.relatedProducts || []).map((id) => String(id));
  const names = [
    ...ingredients.map((item) => item.name),
    ...tools.map((item) => item.name)
  ];
  const byId = new Map(products.map((product) => [String(product.product_id), product]));
  return {
    recipe_id: recipe.recipe_id,
    title: recipe.title || '',
    slug: recipe.slug || '',
    description: recipe.description || '',
    image_url: thumbnailUrl(recipe.heroImage?.url),
    hero_image: recipe.heroImage?.url
      ? { url: recipe.heroImage.url, public_id: recipe.heroImage.public_id || '' }
      : null,
    source: kind,
    author_line: authorLine(recipe, communityUsername),
    base: readBase(recipe),
    serves: readServes(recipe),
    difficulty: readDifficulty(recipe),
    servings: Number.isInteger(recipe.metadata?.servings) && recipe.metadata.servings > 0
      ? recipe.metadata.servings
      : 1,
    prepTime: Number.isInteger(recipe.metadata?.prepTime) && recipe.metadata.prepTime >= 0
      ? recipe.metadata.prepTime
      : 0,
    ingredients,
    tools,
    steps: (recipe.steps || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((step) => ({
        title: step.title || '',
        description: step.description || '',
        timer_seconds: Number.isInteger(step.timerSeconds) && step.timerSeconds > 0 ? step.timerSeconds : null
      }))
      .filter((step) => step.title || step.description),
    featured: Boolean(recipe.featured),
    published: !isDeleted(recipe) && recipe.published !== false,
    deleted: isDeleted(recipe),
    moderation_status: isDeleted(recipe)
      ? 'deleted'
      : (recipe.moderation_status || (recipe.hiddenByAdmin ? 'hidden' : 'visible')),
    hidden_reason: recipe.hidden_reason || null,
    hidden_note: recipe.hidden_note || '',
    review_round: Number(recipe.review_round) || 0,
    max_review_rounds: MAX_REVIEW_ROUNDS,
    can_edit_content: kind === 'offsite' && !isDeleted(recipe),
    updated_at: recipe.updatedAt || null,
    can_link_products: kind === 'offsite' && !isDeleted(recipe),
    linked_products: linkedIds.map((id) => byId.get(id)).filter(Boolean).map((product) => presentLinkable(product)),
    suggestions: suggestionsFor(names, products, linkedIds),
    featured_recipes: (featuredRecipes || []).map(presentFeaturedSlot),
    featured_limit: HOMEPAGE_FEATURED_LIMIT
  };
}

async function detailContext(recipe) {
  const kind = sourceKind(recipe);
  const [products, featuredRecipes, communityUsername] = await Promise.all([
    loadActiveProducts(),
    homepageFeatured(recipe.recipe_id),
    kind === 'community'
      ? likeCountByRecipe([recipe.recipe_id]).then((counts) => counts.names.get(recipe.recipe_id))
      : Promise.resolve(undefined)
  ]);
  return presentDetail(recipe, products, featuredRecipes, communityUsername);
}

async function searchLinkableProducts(req, res) {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const hints = (Array.isArray(req.query.hint) ? req.query.hint : (req.query.hint ? [req.query.hint] : []))
      .map((hint) => String(hint).trim())
      .filter(Boolean)
      .slice(0, 40);
    const products = await loadActiveProducts();
    if (q) {
      const query = normalizeName(q);
      const ranked = products.map((product) => {
        const name = normalizeName(product.name);
        const sku = (product.variants || []).some((variant) => normalizeName(variant.sku).includes(query));
        let score = matchScore(q, product);
        if (name.includes(query)) score += 40;
        if (sku) score += 50;
        return { product, score };
      }).filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)))
        .slice(0, 30)
        .map((item) => item.product);
      return res.json({ data: ranked.map((product) => presentLinkable(product)) });
    }
    res.json({ data: suggestionsFor(hints, products, []) });
  } catch (error) {
    console.error('Error searching linkable products:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
}

async function getRecipe(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId }).lean();
    if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
    if (sourceKind(recipe) === 'community') {
      const counts = await likeCountByRecipe([recipe.recipe_id]);
      if (!visibleInAdmin(recipe, counts.likes.get(recipe.recipe_id) || 0)) {
        return res.status(404).json({ error: 'Recipe not found.' });
      }
    }
    res.json({ data: await detailContext(recipe) });
  } catch (error) {
    console.error('Error reading admin recipe:', error);
    res.status(500).json({ error: 'Failed to retrieve recipe' });
  }
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function uniqueSlug(title, recipeId) {
  const base = slugify(title) || 'recipe';
  let slug = base;
  let suffix = 1;
  while (await Recipe.exists({ slug, ...(recipeId ? { recipe_id: { $ne: recipeId } } : {}) })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

async function nextRecipeId() {
  const lastRecipe = await Recipe.findOne({}, { recipe_id: 1 }).sort({ recipe_id: -1 }).lean();
  let nextNum = 1;
  const match = lastRecipe?.recipe_id?.match(/RCP(\d+)/);
  if (match) nextNum = parseInt(match[1], 10) + 1;
  return `RCP${String(nextNum).padStart(5, '0')}`;
}

async function createOffsiteRecipe(req, res) {
  try {
    const parsed = parseRecipeBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const hero = parseHero(req.body?.hero_image);
    if (hero.error || !hero.hero) return res.status(400).json({ error: hero.error || 'Add a cover image.' });
    const [products, recipeId, slug] = await Promise.all([
      resolveProductIds(parsed.value.relatedIds),
      nextRecipeId(),
      uniqueSlug(parsed.value.title)
    ]);
    if (products.error) return res.status(400).json({ error: products.error });

    const now = new Date().toISOString();
    const recipe = new Recipe({
      recipe_id: recipeId,
      title: parsed.value.title,
      slug,
      description: parsed.value.description,
      heroImage: hero.hero,
      metadata: {
        servings: parsed.value.servings,
        prepTime: parsed.value.prepTime,
        cookTime: null,
        difficulty: parsed.value.difficulty,
        base: parsed.value.base,
        tags: nextTags([], parsed.value.serves)
      },
      ingredients: parsed.value.ingredients,
      tools: parsed.value.tools,
      steps: parsed.value.steps,
      relatedProducts: products.ids,
      source: OFFSITE_SOURCE,
      lifecycle: 'offsite',
      owner_user_id: null,
      saves: 0,
      published: parsed.value.published !== false,
      hiddenByAdmin: parsed.value.published === false,
      moderation_status: parsed.value.published === false ? 'hidden' : 'visible',
      featured: false,
      createdAt: now,
      updatedAt: now
    });
    const claimed = await claimFeaturedSlot(
      recipe,
      parsed.value.featured,
      typeof req.body?.replace_recipe_id === 'string' ? req.body.replace_recipe_id.trim() : ''
    );
    if (claimed.error) return res.status(400).json({ error: claimed.error });
    await recipe.save();
    await releaseReplaced(claimed.replaced, recipe.updatedAt);
    await req.writeActivityLog({
      actionType: 'recipe.create',
      targetEntity: 'Recipes',
      targetId: recipe.recipe_id,
      oldValue: null,
      newValue: {
        title: recipe.title,
        featured: recipe.featured,
        relatedProducts: recipe.relatedProducts
      }
    });
    res.status(201).json({ data: await detailContext(recipe) });
  } catch (error) {
    console.error('Error creating offsite recipe:', error);
    res.status(500).json({ error: 'Failed to create recipe' });
  }
}

async function updateRecipe(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
    if (isDeleted(recipe)) return res.status(400).json({ error: 'Deleted recipes cannot be edited.' });

    const kind = sourceKind(recipe);
    // Community catalog content is owner-only. Admins moderate (hide/delete/feature) only.
    if (kind === 'community') {
      if (typeof req.body?.featured !== 'boolean') {
        return res.status(403).json({ error: 'Community recipes can only be moderated, not edited by admin.' });
      }
      const published = recipe.published !== false;
      if (req.body.featured && !published) {
        return res.status(400).json({ error: 'Hidden recipes stay off the homepage.' });
      }
      const previous = { featured: Boolean(recipe.featured) };
      const claimed = await claimFeaturedSlot(
        recipe,
        req.body.featured,
        typeof req.body?.replace_recipe_id === 'string' ? req.body.replace_recipe_id.trim() : ''
      );
      if (claimed.error) return res.status(400).json({ error: claimed.error });
      recipe.updatedAt = new Date().toISOString();
      await recipe.save();
      await releaseReplaced(claimed.replaced, recipe.updatedAt);
      await req.writeActivityLog({
        actionType: req.body.featured ? 'recipe.feature' : 'recipe.unfeature',
        targetEntity: 'Recipes',
        targetId: recipe.recipe_id,
        oldValue: previous,
        newValue: { featured: Boolean(recipe.featured), replaced: claimed.replaced?.recipe_id || null }
      });
      return res.json({ data: await detailContext(recipe) });
    }

    const parsed = parseRecipeBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const hero = parseHero(req.body?.hero_image);
    if (hero.error) return res.status(400).json({ error: hero.error });
    if (!hero.hero && !recipe.heroImage?.url) return res.status(400).json({ error: 'Add a cover image.' });

    const products = await resolveProductIds(parsed.value.relatedIds);
    if (products.error) return res.status(400).json({ error: products.error });

    const published = recipe.published !== false;
    if (parsed.value.featured && !published) {
      return res.status(400).json({ error: 'Hidden recipes stay off the homepage.' });
    }

    const previous = {
      title: recipe.title,
      description: recipe.description || '',
      featured: Boolean(recipe.featured),
      relatedProducts: (recipe.relatedProducts || []).map(String)
    };
    recipe.title = parsed.value.title;
    recipe.slug = await uniqueSlug(parsed.value.title, recipe.recipe_id);
    recipe.description = parsed.value.description;
    if (hero.hero) recipe.heroImage = hero.hero;
    recipe.metadata = {
      servings: parsed.value.servings,
      prepTime: parsed.value.prepTime,
      cookTime: recipe.metadata?.cookTime ?? null,
      difficulty: parsed.value.difficulty,
      base: parsed.value.base,
      tags: nextTags(recipe.metadata?.tags, parsed.value.serves)
    };
    recipe.ingredients = parsed.value.ingredients;
    recipe.tools = parsed.value.tools;
    recipe.steps = parsed.value.steps;
    recipe.relatedProducts = products.ids;
    const claimed = await claimFeaturedSlot(
      recipe,
      parsed.value.featured,
      typeof req.body?.replace_recipe_id === 'string' ? req.body.replace_recipe_id.trim() : ''
    );
    if (claimed.error) return res.status(400).json({ error: claimed.error });
    recipe.updatedAt = new Date().toISOString();
    recipe.markModified('metadata');
    recipe.markModified('ingredients');
    recipe.markModified('tools');
    recipe.markModified('steps');
    recipe.markModified('relatedProducts');
    await recipe.save();
    await releaseReplaced(claimed.replaced, recipe.updatedAt);
    await req.writeActivityLog({
      actionType: 'recipe.update',
      targetEntity: 'Recipes',
      targetId: recipe.recipe_id,
      oldValue: previous,
      newValue: {
        title: recipe.title,
        description: recipe.description,
        featured: recipe.featured,
        relatedProducts: recipe.relatedProducts,
        replaced: claimed.replaced?.recipe_id || null
      }
    });
    res.json({ data: await detailContext(recipe) });
  } catch (error) {
    console.error('Error updating recipe:', error);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
}

async function loadPresented(recipe) {
  let communityUsername;
  if (sourceKind(recipe) === 'community') {
    const counts = await likeCountByRecipe([recipe.recipe_id]);
    communityUsername = counts.names.get(recipe.recipe_id);
  }
  return presentRecipe(recipe, communityUsername);
}

module.exports = {
  listRecipes,
  updateFeatured,
  setVisibility,
  deleteRecipe,
  requestMoreChanges,
  finalReject,
  presentRecipe,
  getRecipe,
  createOffsiteRecipe,
  updateRecipe,
  searchLinkableProducts,
  parseRecipeBody,
  parseQuantity,
  parseHero,
  matchScore,
  suggestionsFor,
  readBase,
  readServes,
  nextTags
};
