const Recipe = require('../models/Recipe');
const Post = require('../models/Post');
const User = require('../models/User');
const { createNotification } = require('./notification.service');

const COMMUNITY_RECIPE_LIKE_MIN = 30;

function linkedProductIds(post) {
  if (!post || !Array.isArray(post.linked_products)) return [];
  return [...new Set(post.linked_products.map((id) => String(id)).filter(Boolean))].slice(0, 3);
}

async function notifyCatalogPublished(fork, ownerPost) {
  const recipient_id = ownerPost?.user_id || fork?.owner_user_id;
  if (!recipient_id || !fork?.slug || !fork.published) return;
  try {
    await createNotification({
      recipient_id,
      type: 'RECIPE_PUBLISHED',
      post_id: ownerPost?.post_id || fork.origin?.communityPostId || null,
      recipe_slug: fork.slug,
      message: `Your recipe “${fork.title}” is now on the Recipes page.`
    });
  } catch (err) {
    console.error('Error notifying recipe catalog publish:', err);
  }
}

let catalogReady = false;

function sourceKind(recipe) {
  const source = recipe?.source || {};
  const type = String(source.type || '').toLowerCase();
  if (type !== 'community') return 'offsite';
  // Catalog imports were stored as COMMUNITY with a placeholder post and no user.
  // The public recipe page treats those as Offsite.
  if (/placeholder/i.test(String(source.communityPostId || ''))) return 'offsite';
  const name = source.creatorName || source.author;
  if (!name || !String(name).trim()) return 'offsite';
  return 'community';
}

function isCatalogCommunity(recipe) {
  if (sourceKind(recipe) !== 'community') return false;
  if (recipe.lifecycle === 'catalog') return true;
  if (recipe.lifecycle === 'community_origin') return false;
  // Legacy promoted-in-place rows (before fork): published community without origin fork marker.
  return recipe.published === true || Boolean(recipe.origin?.communityRecipeId);
}

function isCommunityOrigin(recipe) {
  if (sourceKind(recipe) !== 'community') return false;
  if (recipe.lifecycle === 'community_origin') return true;
  if (recipe.lifecycle === 'catalog') return false;
  return recipe.published === false && !recipe.origin?.communityRecipeId;
}

function authorLine(recipe, communityUsername) {
  if (sourceKind(recipe) !== 'community') return '';
  const name = communityUsername || recipe.source?.creatorName || recipe.source?.author;
  if (!name || !String(name).trim()) return '';
  return String(name).replace(/^@/, '').trim();
}

function visibleInAdmin(recipe, likeCount) {
  if (recipe?.deletedAt) return true; // listed under Deleted filter
  if (sourceKind(recipe) !== 'community') return true;
  if (recipe.lifecycle === 'catalog') return true;
  if (recipe.lifecycle === 'community_origin') return false;
  // Legacy: only show once it had enough likes / was published.
  return Number(likeCount) >= COMMUNITY_RECIPE_LIKE_MIN || recipe.published === true;
}

const OFFSITE_SOURCE = {
  'source.type': 'offsite',
  'source.author': 'Offsite',
  'source.communityPostId': null,
  'source.communityPostTitle': null,
  'source.creatorName': null,
  'source.creatorAvatar': null
};

async function ensureOffsiteCatalog() {
  await Recipe.updateMany(
    { 'source.communityPostId': /PLACEHOLDER/i },
    { $set: { ...OFFSITE_SOURCE, lifecycle: 'offsite' } }
  );
  await Recipe.updateMany(
    {
      'source.type': { $not: /^community$/i },
      $or: [
        { 'source.author': { $ne: 'Offsite' } },
        { 'source.creatorName': { $nin: [null, ''] } },
        { 'source.communityPostId': { $nin: [null, ''] } },
        { 'source.communityPostTitle': { $nin: [null, ''] } }
      ]
    },
    { $set: { ...OFFSITE_SOURCE, lifecycle: 'offsite' } }
  );
  await Recipe.updateMany(
    {
      $or: [{ lifecycle: { $exists: false } }, { lifecycle: null }],
      'source.type': { $not: /^community$/i }
    },
    { $set: { lifecycle: 'offsite' } }
  );
}

async function nextRecipeId() {
  const lastRecipe = await Recipe.findOne({}, {}, { sort: { recipe_id: -1 } }).select('recipe_id').lean();
  let nextNum = 1;
  if (lastRecipe?.recipe_id) {
    const match = String(lastRecipe.recipe_id).match(/RCP(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `RCP${String(nextNum).padStart(5, '0')}`;
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

async function uniqueSlug(title, recipeId, { excludeRecipeId } = {}) {
  const baseSlug = slugify(title) || String(recipeId).toLowerCase();
  let slug = baseSlug;
  let suffix = 1;
  while (await Recipe.exists({
    slug,
    ...(excludeRecipeId ? { recipe_id: { $ne: excludeRecipeId } } : {})
  })) {
    slug = `${baseSlug}-${suffix++}`;
  }
  return slug;
}

/** Community origins are not public recipe URLs — free the clean title slug for the catalog fork. */
async function assignInternalOriginSlug(origin) {
  if (!origin?.recipe_id) return null;
  const base = slugify(origin.title) || String(origin.recipe_id).toLowerCase();
  const preferred = `${base}-origin`;
  let slug = preferred;
  let n = 1;
  while (await Recipe.exists({ slug, recipe_id: { $ne: origin.recipe_id } })) {
    slug = `${preferred}-${n++}`;
  }
  if (origin.slug === slug) return slug;
  origin.slug = slug;
  if (typeof origin.save === 'function') await origin.save();
  else await Recipe.updateOne({ recipe_id: origin.recipe_id }, { $set: { slug } });
  return slug;
}

async function findCatalogFork(originRecipeId) {
  return Recipe.findOne({
    'origin.communityRecipeId': originRecipeId,
    lifecycle: 'catalog',
    deletedAt: null
  });
}

/** One-time heal: catalog kept -1 because origin still held the clean slug. */
async function healCatalogForkSlugs() {
  const forks = await Recipe.find({
    lifecycle: 'catalog',
    deletedAt: null,
    'origin.communityRecipeId': { $exists: true, $ne: null }
  }).select('recipe_id title slug origin.communityRecipeId').lean();

  for (const fork of forks) {
    const base = slugify(fork.title) || String(fork.recipe_id).toLowerCase();
    if (!fork.slug || fork.slug === base) continue;
    if (!fork.slug.startsWith(`${base}-`)) continue;

    const origin = await Recipe.findOne({ recipe_id: fork.origin.communityRecipeId });
    if (!origin) continue;

    const holder = await Recipe.findOne({ slug: base }).select('recipe_id lifecycle').lean();
    if (holder && holder.recipe_id !== origin.recipe_id && holder.recipe_id !== fork.recipe_id) continue;

    await assignInternalOriginSlug(origin);
    const taken = await Recipe.exists({ slug: base, recipe_id: { $ne: fork.recipe_id } });
    if (!taken) {
      await Recipe.updateOne({ recipe_id: fork.recipe_id }, { $set: { slug: base } });
    }
  }
}

async function createCatalogFork(origin, ownerPost, { notify = false } = {}) {
  const existing = await findCatalogFork(origin.recipe_id);
  if (existing) {
    if (ownerPost?.post_id && !ownerPost.catalog_recipe_id) {
      await Post.updateOne(
        { post_id: ownerPost.post_id },
        { $set: { catalog_recipe_id: existing.recipe_id } }
      );
    }
    return existing;
  }

  const originProducts = Array.isArray(origin.relatedProducts)
    ? origin.relatedProducts.map((id) => String(id)).filter(Boolean)
    : [];
  const relatedProducts = (originProducts.length ? originProducts : linkedProductIds(ownerPost)).slice(0, 3);

  const ownerUserId = origin.owner_user_id || ownerPost?.user_id || null;
  let ownerProfile = null;
  if (ownerUserId) {
    ownerProfile = await User.findOne(
      { user_id: ownerUserId },
      'avatar_url community_name profile_name'
    ).lean();
  }
  const creatorName = origin.source?.creatorName
    || ownerPost?.author?.username
    || ownerProfile?.community_name
    || ownerProfile?.profile_name
    || null;
  const creatorAvatar = origin.source?.creatorAvatar
    || ownerPost?.author?.avatar_url
    || ownerProfile?.avatar_url
    || null;

  const recipe_id = await nextRecipeId();
  const now = new Date().toISOString();
  // Origin keeps an internal slug; the Recipes-page fork gets the clean title slug.
  await assignInternalOriginSlug(origin);
  const slug = await uniqueSlug(origin.title, recipe_id);
  const fork = new Recipe({
    recipe_id,
    title: origin.title,
    slug,
    description: origin.description || '',
    heroImage: origin.heroImage,
    metadata: origin.metadata,
    ingredients: origin.ingredients || [],
    tools: origin.tools || [],
    steps: origin.steps || [],
    relatedProducts,
    source: {
      type: 'community',
      author: creatorName || origin.source?.author,
      communityPostId: ownerPost?.post_id || origin.source?.communityPostId || null,
      communityPostTitle: origin.source?.communityPostTitle || origin.title,
      creatorName,
      creatorAvatar
    },
    lifecycle: 'catalog',
    owner_user_id: ownerUserId,
    origin: {
      communityRecipeId: origin.recipe_id,
      communityPostId: ownerPost?.post_id || origin.source?.communityPostId || null
    },
    saves: 0,
    published: origin.hiddenByAdmin ? false : true,
    featured: false,
    hiddenByAdmin: Boolean(origin.hiddenByAdmin),
    moderation_status: origin.hiddenByAdmin ? (origin.moderation_status || 'hidden') : 'visible',
    hidden_reason: origin.hidden_reason || null,
    hidden_note: origin.hidden_note || '',
    adminNote: origin.adminNote || '',
    hidden_by: origin.hidden_by || null,
    hidden_at: origin.hidden_at || null,
    review_round: origin.review_round || 0,
    createdAt: now,
    updatedAt: now
  });
  await fork.save();

  if (ownerPost?.post_id) {
    await Post.updateOne(
      { post_id: ownerPost.post_id },
      { $set: { catalog_recipe_id: fork.recipe_id } }
    );
  }

  // Origin stays off the Recipes page forever.
  if (origin.published !== false || origin.lifecycle !== 'community_origin') {
    origin.published = false;
    origin.featured = false;
    origin.lifecycle = 'community_origin';
    origin.updatedAt = now;
    if (typeof origin.save === 'function') await origin.save();
    else {
      await Recipe.updateOne(
        { recipe_id: origin.recipe_id },
        { $set: { published: false, featured: false, lifecycle: 'community_origin', updatedAt: now } }
      );
    }
  }

  if (notify) await notifyCatalogPublished(fork, ownerPost);
  return fork;
}

// Promote already-published community recipes in place (no second document).
async function migrateLegacyPublishedCommunity() {
  const legacy = await Recipe.find({
    'source.type': /^community$/i,
    published: true,
    lifecycle: { $nin: ['catalog', 'offsite'] },
    $or: [
      { lifecycle: { $exists: false } },
      { lifecycle: null },
      { lifecycle: 'community_origin' }
    ],
    deletedAt: null
  }).lean();

  for (const recipe of legacy) {
    if (/placeholder/i.test(String(recipe.source?.communityPostId || ''))) continue;
    const posts = await Post.find({ recipe_id: recipe.recipe_id })
      .select('post_id user_id author.username author.avatar_url like_count catalog_recipe_id')
      .lean();
    const ownerPost = [...posts]
      .sort((a, b) => (Number(b.like_count) || 0) - (Number(a.like_count) || 0))
      .find((post) => post.user_id) || null;

    await Recipe.updateOne(
      { recipe_id: recipe.recipe_id },
      {
        $set: {
          lifecycle: 'catalog',
          owner_user_id: ownerPost?.user_id || recipe.owner_user_id || null,
          origin: {
            communityRecipeId: recipe.recipe_id,
            communityPostId: ownerPost?.post_id || recipe.source?.communityPostId || null
          },
          moderation_status: recipe.hiddenByAdmin
            ? (recipe.moderation_status || 'hidden')
            : (recipe.moderation_status || 'visible'),
          updatedAt: new Date().toISOString()
        }
      }
    );

    if (ownerPost?.post_id && !ownerPost.catalog_recipe_id) {
      await Post.updateOne(
        { post_id: ownerPost.post_id },
        { $set: { catalog_recipe_id: recipe.recipe_id } }
      );
    }
  }

  await Recipe.updateMany(
    {
      'source.type': /^community$/i,
      published: { $ne: true },
      lifecycle: { $nin: ['catalog', 'offsite', 'community_origin'] },
      deletedAt: null
    },
    { $set: { lifecycle: 'community_origin' } }
  );
}

// Keep hidden recipes unpublished; catalog forks are created by like sync, not by flipping origin.published.
async function syncCommunityCatalogPublication() {
  const now = new Date().toISOString();
  await Recipe.updateMany(
    { hiddenByAdmin: true, $or: [{ published: { $ne: false } }, { featured: true }] },
    { $set: { published: false, featured: false, updatedAt: now } }
  );
  await Recipe.updateMany(
    { deletedAt: { $ne: null }, $or: [{ published: { $ne: false } }, { featured: true }] },
    { $set: { published: false, featured: false, updatedAt: now } }
  );

  const posts = await Post.find({
    recipe_id: { $type: 'string', $ne: '' },
    like_count: { $gte: COMMUNITY_RECIPE_LIKE_MIN }
  }).select('post_id user_id recipe_id like_count author.username author.avatar_url catalog_recipe_id linked_products').lean();

  const byOrigin = new Map();
  for (const post of posts) {
    if (!post.recipe_id) continue;
    const prev = byOrigin.get(post.recipe_id);
    if (!prev || (Number(post.like_count) || 0) > (Number(prev.like_count) || 0)) {
      byOrigin.set(post.recipe_id, post);
    }
  }

  for (const [originId, ownerPost] of byOrigin) {
    const origin = await Recipe.findOne({ recipe_id: originId });
    if (!origin || sourceKind(origin) !== 'community') continue;
    if (origin.lifecycle === 'catalog') {
      // Already migrated in place.
      if (!ownerPost.catalog_recipe_id) {
        await Post.updateOne(
          { post_id: ownerPost.post_id },
          { $set: { catalog_recipe_id: origin.recipe_id } }
        );
      }
      continue;
    }
    await createCatalogFork(origin, ownerPost);
  }

  return [...byOrigin.keys()];
}

const LEGACY_TAGS = [
  'MATCHA', 'COFFEE', 'OTHERS', 'matcha', 'coffee', 'others',
  'COCKTAIL', 'cocktail', 'ICED', 'iced'
];
const STORED_BASES = ['MATCHA', 'COFFEE', 'OTHERS'];

function inferStoredBase(title) {
  const value = String(title || '').toLowerCase();
  if (value.includes('matcha')) return 'MATCHA';
  if (value.includes('coffee')) return 'COFFEE';
  return 'OTHERS';
}

async function stripBaseNameTags() {
  await Recipe.updateMany(
    { 'metadata.tags': { $in: ['ICED', 'iced'] } },
    { $addToSet: { 'metadata.tags': 'COLD' } }
  );
  await Recipe.updateMany(
    { 'metadata.tags': { $in: LEGACY_TAGS } },
    { $pull: { 'metadata.tags': { $in: LEGACY_TAGS } } }
  );
}

async function backfillRecipeBase() {
  const missing = { 'metadata.base': { $nin: STORED_BASES } };
  await Recipe.updateMany(
    { ...missing, title: /matcha/i },
    { $set: { 'metadata.base': 'MATCHA' } }
  );
  await Recipe.updateMany(
    {
      $and: [
        missing,
        { title: /coffee/i },
        { title: { $not: /matcha/i } }
      ]
    },
    { $set: { 'metadata.base': 'COFFEE' } }
  );
  await Recipe.updateMany(missing, { $set: { 'metadata.base': 'OTHERS' } });
}

async function prepareRecipeCatalog() {
  if (catalogReady) return;
  await ensureOffsiteCatalog();
  await stripBaseNameTags();
  await backfillRecipeBase();
  await migrateLegacyPublishedCommunity();
  await syncCommunityCatalogPublication();
  await healCatalogForkSlugs();
  catalogReady = true;
}

async function likeCountByRecipe(recipeIds) {
  if (!recipeIds.length) return { likes: new Map(), names: new Map() };
  const recipes = await Recipe.find({ recipe_id: { $in: recipeIds } })
    .select('recipe_id origin.communityRecipeId source.communityPostId')
    .lean();
  const originIds = new Set();
  const postIds = new Set();
  const mapToOrigin = new Map();
  for (const recipe of recipes) {
    const originId = recipe.origin?.communityRecipeId || recipe.recipe_id;
    originIds.add(originId);
    mapToOrigin.set(recipe.recipe_id, originId);
    if (recipe.source?.communityPostId) postIds.add(recipe.source.communityPostId);
  }

  const posts = await Post.find({
    $or: [
      { recipe_id: { $in: [...originIds] } },
      { catalog_recipe_id: { $in: recipeIds } },
      ...(postIds.size ? [{ post_id: { $in: [...postIds] } }] : [])
    ]
  }).select('recipe_id catalog_recipe_id author.username like_count').lean();

  const likes = new Map();
  const names = new Map();
  for (const post of posts) {
    const targets = new Set();
    if (post.catalog_recipe_id) targets.add(post.catalog_recipe_id);
    if (post.recipe_id) {
      targets.add(post.recipe_id);
      for (const [catalogId, originId] of mapToOrigin) {
        if (originId === post.recipe_id) targets.add(catalogId);
      }
    }
    const count = Number(post.like_count) || 0;
    for (const id of targets) {
      likes.set(id, Math.max(likes.get(id) || 0, count));
      if (post.author?.username) names.set(id, post.author.username);
    }
  }
  return { likes, names };
}

async function qualifiedCommunityRecipeIds() {
  const catalogs = await Recipe.find({
    lifecycle: 'catalog',
    published: true,
    deletedAt: null,
    hiddenByAdmin: { $ne: true }
  }).select('recipe_id').lean();
  return catalogs.map((recipe) => recipe.recipe_id);
}

async function syncCommunityRecipePublication(recipeId) {
  if (!recipeId) return;
  const origin = await Recipe.findOne({ recipe_id: recipeId });
  if (!origin || sourceKind(origin) !== 'community') return;

  // Likes always land on the origin recipe_id via Post.recipe_id.
  const posts = await Post.find({ recipe_id: recipeId })
    .select('post_id user_id like_count author.username author.avatar_url catalog_recipe_id linked_products')
    .lean();
  const likes = posts.reduce((max, post) => Math.max(max, Number(post.like_count) || 0), 0);
  const ownerPost = posts.find((post) => origin.owner_user_id && post.user_id === origin.owner_user_id)
    || [...posts]
      .sort((a, b) => (Number(b.like_count) || 0) - (Number(a.like_count) || 0))
      .find((post) => post.user_id)
    || null;

  if (origin.lifecycle === 'catalog') {
    if (origin.hiddenByAdmin || origin.deletedAt) {
      if (origin.published !== false || origin.featured) {
        origin.published = false;
        origin.featured = false;
        origin.updatedAt = new Date().toISOString();
        await origin.save();
      }
    }
    return;
  }

  // Origin never appears on the public Recipes page.
  if (origin.published !== false || origin.featured) {
    origin.published = false;
    origin.featured = false;
    origin.lifecycle = 'community_origin';
    origin.updatedAt = new Date().toISOString();
    await origin.save();
  } else if (origin.lifecycle !== 'community_origin') {
    origin.lifecycle = 'community_origin';
    await origin.save();
  }

  if (likes < COMMUNITY_RECIPE_LIKE_MIN || !ownerPost) return;
  await createCatalogFork(origin, ownerPost, { notify: true });
}

function communityRecipeFilter(qualifiedIds) {
  return {
    deletedAt: null,
    $or: [
      { 'source.type': { $not: /^community$/i }, lifecycle: { $ne: 'community_origin' } },
      { lifecycle: 'catalog', recipe_id: { $in: qualifiedIds } },
      // Legacy safety: published community still without lifecycle catalog.
      {
        'source.type': /^community$/i,
        lifecycle: { $nin: ['community_origin'] },
        recipe_id: { $in: qualifiedIds }
      }
    ]
  };
}

function resetCatalogReadyForTests() {
  catalogReady = false;
}

module.exports = {
  COMMUNITY_RECIPE_LIKE_MIN,
  sourceKind,
  isCatalogCommunity,
  isCommunityOrigin,
  authorLine,
  visibleInAdmin,
  ensureOffsiteCatalog,
  stripBaseNameTags,
  inferStoredBase,
  prepareRecipeCatalog,
  likeCountByRecipe,
  qualifiedCommunityRecipeIds,
  syncCommunityCatalogPublication,
  syncCommunityRecipePublication,
  communityRecipeFilter,
  createCatalogFork,
  findCatalogFork,
  nextRecipeId,
  uniqueSlug,
  assignInternalOriginSlug,
  healCatalogForkSlugs,
  migrateLegacyPublishedCommunity,
  resetCatalogReadyForTests
};
