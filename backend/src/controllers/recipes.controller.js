const Recipe = require('../models/Recipe');
const Post = require('../models/Post');
const User = require('../models/User');
const mongoose = require('mongoose');

async function getAllRecipes(req, res) {
  try {
    const filter = { published: true };

    if (req.query.difficulty) {
      filter['metadata.difficulty'] = req.query.difficulty.toUpperCase();
    }
    
    if (req.query.tag) {
      filter['metadata.tags'] = req.query.tag.toUpperCase();
    }

    if (req.query.source_type) {
      filter['source.type'] = req.query.source_type;
    }

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 0, 0), 100);
    const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
    const sort = req.query.sort === 'saves'
      ? { saves: -1, recipe_id: 1 }
      : {};

    let query = Recipe.find(filter).sort(sort).skip(skip);
    if (limit > 0) query = query.limit(limit);

    const recipes = await query;
    res.json(recipes);
  } catch (error) {
    console.error('Error fetching recipes:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes' });
  }
}

async function getRecipeBySlugOrId(req, res) {
  try {
    const { slugOrId } = req.params;
    if (!slugOrId) {
      return res.status(400).json({ error: 'Recipe identifier is required' });
    }

    let query = {};
    if (mongoose.Types.ObjectId.isValid(slugOrId) && /^[0-9a-fA-F]{24}$/.test(slugOrId)) {
      query = { _id: slugOrId };
    } else if (slugOrId.startsWith('RCP')) {
      query = { recipe_id: slugOrId };
    } else {
      query = { slug: slugOrId };
    }

    const recipe = await Recipe.findOne(query);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.json(recipe);
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

// Create a new recipe
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
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const heroImage = parseJSONField(rawHeroImage, null);
    if (!heroImage || !heroImage.url || !heroImage.public_id) {
      return res.status(400).json({ error: 'Hero image is required' });
    }

    const metadata = parseJSONField(rawMetadata, {});
    const ingredients = parseJSONField(rawIngredients, []);
    const tools = parseJSONField(rawTools, []);
    const steps = parseJSONField(rawSteps, []);
    const relatedProducts = parseJSONField(rawRelatedProducts, []);

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'At least one ingredient is required' });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'At least one step is required' });
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
        tags: Array.isArray(metadata.tags) ? metadata.tags : []
      },
      ingredients,
      tools,
      steps,
      relatedProducts: Array.isArray(relatedProducts) ? relatedProducts : [],
      source: {
        type: 'community',
        author: user.community_name || user.profile_name || 'Anonymous',
        communityPostId: null,
        communityPostTitle: null,
        creatorName: user.community_name || user.profile_name || 'Anonymous',
        creatorAvatar: user.avatar_url || null
      },
      saves: 0,
      published: false, // 🛑 ẨN KHỎI TRANG RECIPES CHÍNH (Chờ đủ 30 saves/likes)
      createdAt: now,
      updatedAt: now
    });

    const savedRecipe = await newRecipe.save();

    // 🚀 TỰ ĐỘNG TẠO POST BÊN COMMUNITY 🚀
    const lastPost = await Post.findOne({}, {}, { sort: { post_id: -1 } });
    let nextNumPost = 600001;
    if (lastPost && lastPost.post_id) {
      const match = lastPost.post_id.match(/POST(\d+)/);
      if (match) {
        nextNumPost = parseInt(match[1], 10) + 1;
      }
    }
    const post_id = `POST${String(nextNumPost).padStart(6, '0')}`;
    const isCoffee = title.toUpperCase().includes('COFFEE');
    const baseVal = isCoffee ? 'COFFEE' : 'MATCHA';

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
      base: baseVal,
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      save_count: 0
    });
    
    await newPost.save();

    // 🚀 TRẢ VỀ THÊM post_id CHO FRONTEND CHUYỂN HƯỚNG 🚀
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

module.exports = {
  getAllRecipes,
  getRecipeBySlugOrId,
  createRecipe
};

