const Recipe = require('../models/Recipe');
const Post = require('../models/Post');
const User = require('../models/User');
const mongoose = require('mongoose');
const { ensureFeaturedRecipes, HOMEPAGE_FEATURED_LIMIT } = require('../services/recipe-featured');
const {
  prepareRecipeCatalog,
  qualifiedCommunityRecipeIds,
  communityRecipeFilter,
  inferStoredBase,
  sourceKind
} = require('../services/recipe-source');
const {
  isDeleted,
  softDeleteRecipe,
  ownerCanEdit,
  ownerCanSubmitReview,
  ownerCanDelete,
  MAX_REVIEW_ROUNDS
} = require('../services/recipe-moderation');
const {
  parseRecipeBody,
  parseQuantity,
  parseHero,
  nextTags,
  readBase,
  readServes
} = require('./admin-recipes.controller');
const { resolveUserIdString } = require('./cart.controller');

const STORED_BASES = new Set(['MATCHA', 'COFFEE', 'OTHERS']);

function resolveStoredBase(rawBase, title) {
  const value = String(rawBase || '').toUpperCase();
  if (STORED_BASES.has(value)) return value;
  return inferStoredBase(title);
}

function linkedProductIds(post) {
  if (!post || !Array.isArray(post.linked_products)) return [];
  return [...new Set(post.linked_products.map((id) => String(id)).filter(Boolean))].slice(0, 3);
}

async function getAllRecipes(req, res) {
  try {
    await prepareRecipeCatalog();
    const qualifiedCommunityIds = await qualifiedCommunityRecipeIds();
    const filter = {
      published: true,
      deletedAt: null,
      hiddenByAdmin: { $ne: true },
      moderation_status: { $nin: ['hidden', 'resubmitted', 'hidden_final'] },
      ...communityRecipeFilter(qualifiedCommunityIds)
    };

    if (req.query.difficulty) {
      filter['metadata.difficulty'] = req.query.difficulty.toUpperCase();
    }

    if (req.query.tag) {
      filter['metadata.tags'] = req.query.tag.toUpperCase();
    }

    if (req.query.source_type) {
      filter['source.type'] = req.query.source_type;
    }

    if (req.query.featured === 'true') {
      await ensureFeaturedRecipes();
      filter.featured = true;
    }

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 0, 0), 100);
    const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
    const sort = req.query.sort === 'saves' || req.query.featured === 'true'
      ? { saves: -1, recipe_id: 1 }
      : {};

    let query = Recipe.find(filter).sort(sort).skip(skip);
    if (req.query.featured === 'true') {
      const cap = limit > 0 ? Math.min(limit, HOMEPAGE_FEATURED_LIMIT) : HOMEPAGE_FEATURED_LIMIT;
      query = query.limit(cap);
    } else if (limit > 0) {
      query = query.limit(limit);
    }

    const recipes = await query;
    res.json(recipes);
  } catch (error) {
    console.error('Error fetching recipes:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes' });
  }
}

function findRecipeQuery(slugOrId) {
  if (mongoose.Types.ObjectId.isValid(slugOrId) && /^[0-9a-fA-F]{24}$/.test(slugOrId)) {
    return { _id: slugOrId };
  }
  if (slugOrId.startsWith('RCP')) return { recipe_id: slugOrId };
  return { slug: slugOrId };
}

async function requesterId(req) {
  // JWT carries Mongo _id; recipe.owner_user_id is the app string (USR…).
  return resolveUserIdString(req.user);
}

async function presentPublicRecipe(recipe, req, userId = null) {
  const resolvedUserId = userId ?? await requesterId(req);
  const isOwner = resolvedUserId && String(recipe.owner_user_id || '') === String(resolvedUserId);
  const deleted = isDeleted(recipe);
  const hidden = !deleted && (
    recipe.hiddenByAdmin
    || ['hidden', 'resubmitted', 'hidden_final'].includes(recipe.moderation_status)
    || recipe.published === false
  );

  if (deleted) return null;

  if (hidden && !isOwner) {
    return {
      availability: 'hidden',
      recipe_id: recipe.recipe_id,
      slug: recipe.slug,
      title: recipe.title,
      message: 'This brew is resting between pours — check back soon.'
    };
  }

  const payload = recipe.toObject ? recipe.toObject() : { ...recipe };
  payload.availability = hidden ? 'hidden_owner' : 'visible';
  payload.can_edit = ownerCanEdit(recipe, resolvedUserId);
  payload.can_delete = ownerCanDelete(recipe, resolvedUserId);
  payload.can_submit_review = ownerCanSubmitReview(recipe, resolvedUserId);
  payload.max_review_rounds = MAX_REVIEW_ROUNDS;
  payload.review_round = Number(recipe.review_round) || 0;
  payload.moderation_status = recipe.moderation_status || (hidden ? 'hidden' : 'visible');
  if (isOwner && hidden) {
    payload.owner_banner = {
      reason: recipe.hidden_reason || null,
      note: recipe.hidden_note || '',
      status: recipe.moderation_status || 'hidden',
      review_round: Number(recipe.review_round) || 0,
      max_review_rounds: MAX_REVIEW_ROUNDS
    };
  }
  return payload;
}

async function attachLinkedProducts(recipe) {
  const existing = Array.isArray(recipe.relatedProducts)
    ? recipe.relatedProducts.map((id) => String(id)).filter(Boolean)
    : [];
  if (existing.length || sourceKind(recipe) !== 'community') return existing;

  const postId = recipe.origin?.communityPostId || recipe.source?.communityPostId;
  let post = null;
  if (postId) {
    post = await Post.findOne({ post_id: postId }).select('linked_products').lean();
  }
  if (!post) {
    post = await Post.findOne({ catalog_recipe_id: recipe.recipe_id }).select('linked_products').lean();
  }
  const ids = linkedProductIds(post);
  if (!ids.length) return existing;

  recipe.relatedProducts = ids;
  recipe.markModified('relatedProducts');
  recipe.updatedAt = new Date().toISOString();
  await recipe.save();
  return ids;
}

/** Keep community author avatar/name in sync with the live profile (posts already do this). */
async function hydrateCreatorProfile(recipe) {
  if (!recipe || sourceKind(recipe) !== 'community' || !recipe.owner_user_id) return;
  const owner = await User.findOne(
    { user_id: recipe.owner_user_id },
    'avatar_url community_name profile_name'
  ).lean();
  if (!owner) return;

  const name = owner.community_name || owner.profile_name || null;
  const avatar = owner.avatar_url || null;
  if (!recipe.source) recipe.source = {};

  let dirty = false;
  if (avatar && recipe.source.creatorAvatar !== avatar) {
    recipe.source.creatorAvatar = avatar;
    dirty = true;
  }
  if (name) {
    if (recipe.source.creatorName !== name) {
      recipe.source.creatorName = name;
      dirty = true;
    }
    if (recipe.source.author !== name) {
      recipe.source.author = name;
      dirty = true;
    }
  }
  if (!dirty) return;

  recipe.markModified('source');
  recipe.updatedAt = new Date().toISOString();
  await recipe.save();
}

async function getRecipeBySlugOrId(req, res) {
  try {
    const { slugOrId } = req.params;
    if (!slugOrId) {
      return res.status(400).json({ error: 'Recipe identifier is required' });
    }

    const recipe = await Recipe.findOne(findRecipeQuery(slugOrId));
    if (!recipe || recipe.lifecycle === 'community_origin') {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    await attachLinkedProducts(recipe);
    await hydrateCreatorProfile(recipe);
    const userId = await requesterId(req);
    const presented = await presentPublicRecipe(recipe, req, userId);
    if (!presented) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    res.json(presented);
  } catch (error) {
    console.error('Error fetching recipe:', error);
    res.status(500).json({ error: 'Failed to retrieve recipe' });
  }
}

function slugify(text) {
  return text
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function parseJSONField(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function parseLinkedProducts(raw) {
  const list = parseJSONField(raw, []);
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(Number).filter(Number.isInteger))].slice(0, 3);
}

async function createRecipe(req, res) {
  try {
    const {
      title,
      description = '',
      heroImage: rawHeroImage,
      metadata: rawMetadata,
      ingredients: rawIngredients,
      tools: rawTools,
      steps: rawSteps,
      relatedProducts: rawRelatedProducts,
      linked_products: rawLinkedProducts,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const heroImage = parseJSONField(rawHeroImage, null);
    if (!heroImage || !heroImage.url || !heroImage.public_id) {
      return res.status(400).json({ error: 'Hero image is required' });
    }

    const metadata = parseJSONField(rawMetadata, {});
    const rawIngredientList = parseJSONField(rawIngredients, []);
    const tools = parseJSONField(rawTools, []);
    const steps = parseJSONField(rawSteps, []);
    const relatedProducts = parseJSONField(rawRelatedProducts, []);

    if (!Array.isArray(rawIngredientList) || rawIngredientList.length === 0) {
      return res.status(400).json({ error: 'At least one ingredient is required' });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'At least one step is required' });
    }

    const ingredients = [];
    for (const raw of rawIngredientList) {
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      if (!name) continue;
      const parsedQty = parseQuantity(raw?.quantity);
      if (parsedQty.error) {
        return res.status(400).json({ error: parsedQty.error });
      }
      ingredients.push({
        name,
        quantity: parsedQty.quantity,
        unit: typeof raw?.unit === 'string' ? raw.unit.trim() : '',
        optional: Boolean(raw?.optional)
      });
    }
    if (!ingredients.length) {
      return res.status(400).json({ error: 'At least one ingredient is required' });
    }

    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const lastRecipe = await Recipe.findOne({}, {}, { sort: { recipe_id: -1 } });
    let nextNum = 1;
    if (lastRecipe && lastRecipe.recipe_id) {
      const match = lastRecipe.recipe_id.match(/RCP(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    const recipe_id = `RCP${String(nextNum).padStart(5, '0')}`;

    const baseSlug = slugify(title);
    let slug = baseSlug || recipe_id.toLowerCase();
    let suffix = 1;
    while (await Recipe.exists({ slug })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const now = new Date().toISOString();
    const storedBase = resolveStoredBase(metadata.base, title.trim());

    const newRecipe = new Recipe({
      recipe_id,
      title: title.trim(),
      slug,
      description,
      heroImage,
      metadata: {
        servings: metadata.servings ?? 1,
        prepTime: metadata.prepTime ?? 0,
        cookTime: metadata.cookTime ?? null,
        difficulty: metadata.difficulty,
        base: storedBase,
        tags: [...new Set((Array.isArray(metadata.tags) ? metadata.tags : [])
          .map((tag) => String(tag).toUpperCase() === 'ICED' ? 'COLD' : String(tag).toUpperCase())
          .filter((tag) => tag === 'HOT' || tag === 'COLD' || tag === 'DESSERT'))]
      },
      ingredients,
      tools,
      steps,
      relatedProducts: Array.isArray(relatedProducts) && relatedProducts.length
        ? relatedProducts.map((id) => String(id)).filter(Boolean).slice(0, 3)
        : parseLinkedProducts(rawLinkedProducts).map(String),
      source: {
        type: 'community',
        author: user.community_name || user.profile_name || 'Anonymous',
        communityPostId: null,
        communityPostTitle: null,
        creatorName: user.community_name || user.profile_name || 'Anonymous',
        creatorAvatar: user.avatar_url || null
      },
      lifecycle: 'community_origin',
      owner_user_id: user.user_id,
      origin: null,
      saves: 0,
      published: false,
      featured: false,
      moderation_status: 'visible',
      createdAt: now,
      updatedAt: now
    });

    const savedRecipe = await newRecipe.save();

    const lastPost = await Post.findOne({}, {}, { sort: { post_id: -1 } });
    let nextNumPost = 600001;
    if (lastPost && lastPost.post_id) {
      const match = lastPost.post_id.match(/POST(\d+)/);
      if (match) {
        nextNumPost = parseInt(match[1], 10) + 1;
      }
    }
    const post_id = `POST${String(nextNumPost).padStart(6, '0')}`;

    const newPost = new Post({
      post_id,
      user_id: user.user_id,
      author: {
        username: user.community_name || user.profile_name || 'Anonymous',
        avatar_url: user.avatar_url || null
      },
      post_type: 'recipe',
      content: description || title.trim(),
      media: [{
        url: heroImage.url,
        public_id: heroImage.public_id,
        type: 'image'
      }],
      recipe_id: recipe_id,
      catalog_recipe_id: null,
      // Same Matcha/Coffee/Others chip as the recipe (not the legacy RECIPE placeholder).
      base: storedBase,
      linked_products: parseLinkedProducts(rawLinkedProducts),
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      save_count: 0
    });

    await newPost.save();

    savedRecipe.source.communityPostId = newPost.post_id;
    savedRecipe.source.communityPostTitle = title.trim();
    await savedRecipe.save();

    res.status(201).json({
      message: 'Recipe and Community Post created successfully',
      data: savedRecipe,
      post_id: newPost.post_id
    });
  } catch (error) {
    console.error('Error creating recipe:', error);
    res.status(500).json({ error: error.message || 'Failed to create recipe' });
  }
}

async function updateOwnRecipe(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe || isDeleted(recipe)) return res.status(404).json({ error: 'Recipe not found' });
    const userId = await requesterId(req);
    if (!ownerCanEdit(recipe, userId)) {
      return res.status(403).json({ error: 'You can only edit your own Recipes-page recipe.' });
    }

    const parsed = parseRecipeBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const hero = parseHero(req.body?.hero_image || req.body?.heroImage);
    if (hero.error) return res.status(400).json({ error: hero.error });
    if (!hero.hero && !recipe.heroImage?.url) return res.status(400).json({ error: 'Add a cover image.' });

    recipe.title = parsed.value.title;
    const baseSlug = slugify(parsed.value.title) || recipe.recipe_id.toLowerCase();
    let slug = baseSlug;
    let suffix = 1;
    while (await Recipe.exists({ slug, recipe_id: { $ne: recipe.recipe_id } })) {
      slug = `${baseSlug}-${suffix++}`;
    }
    recipe.slug = slug;
    recipe.description = parsed.value.description;
    if (hero.hero) recipe.heroImage = hero.hero;
    const nextBase = resolveStoredBase(parsed.value.base, parsed.value.title);
    recipe.metadata = {
      servings: Number(req.body?.servings) || recipe.metadata?.servings || 1,
      prepTime: Number(req.body?.prepTime) || recipe.metadata?.prepTime || 0,
      cookTime: req.body?.cookTime == null || req.body?.cookTime === ''
        ? (recipe.metadata?.cookTime ?? null)
        : Number(req.body.cookTime),
      difficulty: parsed.value.difficulty,
      base: nextBase,
      tags: nextTags(recipe.metadata?.tags, parsed.value.serves)
    };
    recipe.ingredients = parsed.value.ingredients;
    recipe.tools = parsed.value.tools;
    recipe.steps = parsed.value.steps;

    const postId = recipe.origin?.communityPostId || recipe.source?.communityPostId;
    const postUpdate = { base: nextBase };
    const rawLinked = req.body?.related_products ?? req.body?.relatedProducts ?? req.body?.linked_products;
    if (rawLinked !== undefined) {
      const linked = parseLinkedProducts(rawLinked).map(String);
      recipe.relatedProducts = linked;
      recipe.markModified('relatedProducts');
      postUpdate.linked_products = linked.map(Number).filter(Number.isInteger);
    }
    if (postId) {
      await Post.updateOne({ post_id: postId }, { $set: postUpdate });
    }

    recipe.updatedAt = new Date().toISOString();
    recipe.markModified('metadata');
    recipe.markModified('ingredients');
    recipe.markModified('tools');
    recipe.markModified('steps');
    await recipe.save();

    res.json(await presentPublicRecipe(recipe, req, userId));
  } catch (error) {
    console.error('Error updating own recipe:', error);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
}

async function deleteOwnRecipe(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe || isDeleted(recipe)) return res.status(404).json({ error: 'Recipe not found' });
    const userId = await requesterId(req);
    if (!ownerCanDelete(recipe, userId)) {
      return res.status(403).json({ error: 'You can only delete your own Recipes-page recipe.' });
    }

    await softDeleteRecipe(recipe, {
      reason: 'owner_removed',
      note: '',
      by: userId
    });

    res.json({ data: { recipe_id: recipe.recipe_id, deleted: true } });
  } catch (error) {
    console.error('Error deleting own recipe:', error);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
}

async function submitForReview(req, res) {
  try {
    const recipe = await Recipe.findOne({ recipe_id: req.params.recipeId });
    if (!recipe || isDeleted(recipe)) return res.status(404).json({ error: 'Recipe not found' });
    const userId = await requesterId(req);
    if (!ownerCanSubmitReview(recipe, userId)) {
      return res.status(403).json({ error: 'This recipe cannot be submitted for review.' });
    }

    recipe.moderation_status = 'resubmitted';
    recipe.review_round = (Number(recipe.review_round) || 0) + 1;
    recipe.resubmitted_at = new Date();
    recipe.updatedAt = new Date().toISOString();
    // Stay hidden on the public catalog until an admin restores it.
    recipe.published = false;
    recipe.hiddenByAdmin = true;
    await recipe.save();

    res.json(await presentPublicRecipe(recipe, req, userId));
  } catch (error) {
    console.error('Error submitting recipe for review:', error);
    res.status(500).json({ error: 'Failed to submit for review' });
  }
}

module.exports = {
  getAllRecipes,
  getRecipeBySlugOrId,
  createRecipe,
  updateOwnRecipe,
  deleteOwnRecipe,
  submitForReview,
  presentPublicRecipe,
  // re-export helpers used in tests / admin forms
  readBase,
  readServes
};
