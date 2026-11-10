const Post = require('../models/Post');
const User = require('../models/User');
const Recipe = require('../models/Recipe');
const PostReport = require('../models/PostReport');
const { rereportBlock, duplicateReportMessage, restoredAfterFrom } = require('../services/report-rereport.service');
const ModerationAction = require('../models/ModerationAction');
const Product = require('../models/Product');
const { getFollowingIds } = require('../services/follow.service');
const { syncCommunityRecipePublication } = require('../services/recipe-source');
const mongoose = require('mongoose');
const ritualPreview = require('../services/ritual-post-preview.service');

const MAX_LINKED_PRODUCTS = 5;
const RECIPE_BASES = new Set(['MATCHA', 'COFFEE', 'OTHERS']);

// Recipe posts may still store base as RECIPE; always prefer the recipe's Matcha/Coffee/Others.
async function loadRecipeBases(posts) {
  const ids = [...new Set(
    posts
      .filter((post) => post.post_type === 'recipe' && post.recipe_id)
      .map((post) => post.recipe_id)
  )];
  if (!ids.length) return new Map();
  const recipes = await Recipe.find({ recipe_id: { $in: ids } }, 'recipe_id metadata.base').lean();
  return new Map(
    recipes
      .map((recipe) => {
        const base = String(recipe.metadata?.base || '').toUpperCase();
        return RECIPE_BASES.has(base) ? [recipe.recipe_id, base] : null;
      })
      .filter(Boolean)
  );
}

// Resolve Post.linked_products (product_id numbers) into small cards for the UI.
async function loadProductCards(posts) {
  const ids = [...new Set(posts.flatMap(p => p.linked_products || []))];
  if (ids.length === 0) return new Map();

  const products = await Product.find(
    { product_id: { $in: ids }, is_active: true },
    'product_id name slug images'
  ).lean();

  return new Map(products.map(p => [p.product_id, {
    product_id: p.product_id,
    name: p.name,
    slug: p.slug,
    image_url: p.images?.[0]?.url || null
  }]));
}

function cardsForPost(post, cardMap) {
  return (post.linked_products || []).map(id => cardMap.get(id)).filter(Boolean);
}

// Accepts an array or a JSON string (the create form sends multipart fields).
function parseLinkedProducts(raw) {
  let list = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { list = JSON.parse(raw); } catch (e) { list = []; }
  }
  if (!Array.isArray(list)) return [];
  const ids = list.map(Number).filter(Number.isInteger);
  return [...new Set(ids)].slice(0, MAX_LINKED_PRODUCTS);
}

async function getAllPosts(req, res) {
  try {
    const { page = 1, limit = 10, post_type, recipe_id, user_id, sort, base, following } = req.query;

    const query = {};
    if (post_type) query.post_type = post_type;
    if (recipe_id) query.recipe_id = recipe_id;
    if (user_id) query.user_id = user_id;
    if (base) query.base = base;

    // Hide violating (hidden) posts and posts of suspended accounts from public feeds.
    // A user browsing their own posts still sees everything they wrote.
    const viewerId = await require('./profiles.controller').currentCommunityUserId(req);
    const isOwnFeed = !!viewerId && !!user_id && user_id === viewerId;
    if (!isOwnFeed) {
      query.status = { $ne: 'hidden' };
      const suspendedUsers = await User.find({ status: 'suspended' }, 'user_id').lean();
      const suspendedIds = suspendedUsers.map(u => u.user_id);
      if (suspendedIds.length > 0) {
        if (user_id) {
          if (suspendedIds.includes(user_id)) query.user_id = { $in: [] };
        } else {
          query.user_id = { $nin: suspendedIds };
        }
      }
    }

    // "Following" chip: only posts from accounts the signed-in user follows.
    if (following === 'true') {
      if (!req.user) return res.json({ data: [], total: 0, page: parseInt(page, 10), limit: parseInt(limit, 10) });
      const followedIds = await getFollowingIds(viewerId);
      query.$and = [...(query.$and || []), { user_id: { $in: followedIds } }];
    }

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitCount = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    const sortOption = sort === 'like_count'
      ? { like_count: -1, _id: -1 }
      : { created_at: -1, _id: -1 };

    const postsQuery = Post.find(query).sort(sortOption).skip((pageNumber - 1) * limitCount).limit(limitCount);
    const posts = await postsQuery;

    const total = await Post.countDocuments(query);

    let likedPostIds = new Set();
    let savedPostIds = new Set();
    if (req.user) {
      const user = await User.findById(req.user.user_id);
      if (user) {
        likedPostIds = new Set(user.liked_posts.map(p => p.post_id));
        savedPostIds = new Set(user.saved_posts.map(p => p.post_id));
      }
    }

    const productCards = await loadProductCards(posts);
    const recipeBaseById = await loadRecipeBases(posts);
    const legacyPreviews = await ritualPreview.forLegacyPosts(posts);

    const authors = await require('../services/community-author.service').hydrateAuthors(posts);
    const data = posts.map((p, index) => {
      const row = p.toObject();
      const recipeBase = recipeBaseById.get(p.recipe_id);
      // Community card shows Recipe + Matcha/Coffee/Others; recipe metadata wins.
      if (p.post_type === 'recipe' && recipeBase) {
        row.base = recipeBase;
      }
      return {
        ...row,
        ritual_preview: row.ritual_preview || legacyPreviews.get(p.post_id) || null,
        author: authors[index].author,
        liked: likedPostIds.has(p.post_id),
        saved: savedPostIds.has(p.post_id),
        products: cardsForPost(p, productCards)
      };
    });

    res.json({
      data,
      total,
      page: pageNumber,
      limit: limitCount
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to retrieve posts' });
  }
}

async function getPostById(req, res) {
  try {
    const { id } = req.params;
    let query = {};
    
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { post_id: id };
    }

    const post = await Post.findOne(query);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    let liked = false;
    let saved = false;
    if (req.user) {
      const user = await User.findById(req.user.user_id);
      if (user) {
        liked = user.liked_posts.some(p => p.post_id === post.post_id);
        saved = user.saved_posts.some(p => p.post_id === post.post_id);
      }
    }

    let recipeDetails = null;
    if (post.post_type === 'recipe' && post.recipe_id) {
      const origin = await Recipe.findOne({ recipe_id: post.recipe_id });
      if (origin) {
        const catalogId = post.catalog_recipe_id || null;
        const catalog = catalogId
          ? await Recipe.findOne({ recipe_id: catalogId, deletedAt: null })
          : await Recipe.findOne({
            'origin.communityRecipeId': post.recipe_id,
            lifecycle: 'catalog',
            deletedAt: null
          });
        recipeDetails = origin.toObject ? origin.toObject() : { ...origin };
        // CTA "View in recipes" points at the catalog fork when it is live.
        if (catalog && catalog.published !== false && !catalog.hiddenByAdmin && !catalog.deletedAt) {
          recipeDetails.published = true;
          recipeDetails.slug = catalog.slug;
          recipeDetails.catalog_recipe_id = catalog.recipe_id;
        } else {
          recipeDetails.published = false;
          if (catalog) {
            recipeDetails.catalog_recipe_id = catalog.recipe_id;
            recipeDetails.catalog_slug = catalog.slug;
            recipeDetails.catalog_hidden = Boolean(catalog.hiddenByAdmin);
          }
        }
      }
    }

    const isOwner = (await require('./profiles.controller').currentCommunityUserId(req)) === post.user_id;
    const isModerator = ['admin_cc', 'cskh'].includes(req.user?.role);
    if (post.status === 'hidden' && !isOwner && !isModerator) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const productCards = await loadProductCards([post]);
    const legacyPreviews = await ritualPreview.forLegacyPosts([post]);
    const payload = post.toObject();
    const recipeBase = String(recipeDetails?.metadata?.base || '').toUpperCase();
    if (post.post_type === 'recipe' && RECIPE_BASES.has(recipeBase)) {
      payload.base = recipeBase;
    }

    res.json({
      ...payload,
      ritual_preview: payload.ritual_preview || legacyPreviews.get(post.post_id) || null,
      author: (await require('../services/community-author.service').hydrateAuthors([post]))[0].author,
      liked,
      saved,
      recipe: recipeDetails,
      products: cardsForPost(post, productCards)
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to retrieve post' });
  }
}

function parseMediaField(rawMedia) {
  if (Array.isArray(rawMedia)) return rawMedia; 
  if (typeof rawMedia === 'string' && rawMedia.trim()) {
    try {
      const parsed = JSON.parse(rawMedia);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function createPost(req, res) {
  try {
    const { content, media: rawMedia, post_type = 'regular', recipe_id = null, base, linked_products } = req.body;
    const media = parseMediaField(rawMedia);
    const linkedProducts = parseLinkedProducts(linked_products);
    const aiProducts = parseLinkedProducts(req.body.ai_product_ids);
    if (aiProducts.length > 3 || aiProducts.some(id => !linkedProducts.includes(id))) return res.status(400).json({ error: 'At most 3 AI tags within 5 total products are allowed' });

    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const lastPost = await Post.findOne({}, {}, { sort: { post_id: -1 } });
    let nextNum = 600001;
    if (lastPost && lastPost.post_id) {
      const match = lastPost.post_id.match(/POST(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    const post_id = `POST${String(nextNum).padStart(6, '0')}`;

    const newPost = new Post({
      post_id,
      user_id: user.user_id,
      author: {
        username: user.community_name || user.profile_name || 'Anonymous',
        avatar_url: user.avatar_url || null
      },
      post_type,
      content,
      media,
      ritual_preview: post_type === 'ritual_dna' ? await ritualPreview.forUser(user) : null,
      recipe_id,
      base,
      linked_products: linkedProducts,
      ai_product_ids: aiProducts,
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      save_count: 0
    });

    const savedPost = await newPost.save();

    // Create notification for post created successfully
    try {
      const notificationService = require('../services/notification.service');
      await notificationService.createNotification({
        recipient_id: user.user_id,
        sender: {
          user_id: user.user_id,
          username: user.community_name || user.profile_name || 'Anonymous',
          avatar_url: user.avatar_url || null
        },
        type: 'POST_CREATED',
        post_id: savedPost.post_id
      });
    } catch (notifError) {
      console.error('Error creating post-creation notification:', notifError);
    }

    try {
      const loyaltyService = require('../services/loyalty.service');
      await loyaltyService.scheduleCommunityPointsForPost(user.user_id, savedPost);
    } catch (pointsErr) {
      console.error('Error scheduling community points:', pointsErr);
    }

    res.status(201).json({
      message: 'Post created successfully',
      data: savedPost
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: error.message || 'Failed to create post' });
  }
}

async function updatePost(req, res) {
  try {
    const { id } = req.params;
    const { content, media: rawMedia, post_type, recipe_id, base, linked_products } = req.body;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { post_id: id };
    }

    const post = await Post.findOne(query);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const user = await User.findById(req.user.user_id);
    if (!user || post.user_id !== user.user_id) {
      return res.status(403).json({ error: 'You are not authorized to update this post' });
    }

    if (content !== undefined) post.content = content;
    if (rawMedia !== undefined) post.media = parseMediaField(rawMedia);
    if (post_type !== undefined) post.post_type = post_type;
    if (recipe_id !== undefined) post.recipe_id = recipe_id;
    if (base !== undefined) post.base = base;
    if (linked_products !== undefined) post.linked_products = parseLinkedProducts(linked_products);
    if (req.body.ai_product_ids !== undefined) post.ai_product_ids = parseLinkedProducts(req.body.ai_product_ids);
    post.ai_product_ids = (post.ai_product_ids || []).filter(id => post.linked_products.includes(id));
    if (post.ai_product_ids.length > 3) return res.status(400).json({ error: 'At most 3 AI product tags are allowed' });

    const updatedPost = await post.save();
    res.json({
      message: 'Post updated successfully',
      data: updatedPost
    });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
}

async function deletePost(req, res) {
  try {
    const { id } = req.params;
    
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { post_id: id };
    }

    const post = await Post.findOne(query);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const user = await User.findById(req.user.user_id);
    if (!user || post.user_id !== user.user_id) {
      return res.status(403).json({ error: 'You are not authorized to delete this post' });
    }

    const session = await Post.db.startSession();
    try {
      await session.withTransaction(async () => {
        await Post.deleteOne({ _id: post._id }, { session });
        await require('../services/points.service').reverseCommunityPoints(post.post_id, session);
        const Comment = require('../models/Comment');
        await Comment.deleteMany({ post_id: post.post_id }, { session });
      });
    } finally { await session.endSession(); }

    res.json({ message: 'Post and associated comments deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
}

async function likePost(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { post_id: id };
    }

    const post = await Post.findOne(query);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    let message = '';

    const alreadyLiked = user.liked_posts.some(
      p => p.post_id === post.post_id
    );

    if (alreadyLiked) {
      user.liked_posts = user.liked_posts.filter(
        p => p.post_id !== post.post_id
      );
      post.like_count = Math.max(0, post.like_count - 1);
      message = 'Post unliked successfully';
    } else {
      user.liked_posts.push({
        post_id: post.post_id,
        liked_at: new Date()
      });
      post.like_count++;
      message = 'Post liked successfully';
    }

    await user.save();
    await post.save();
    if (post.recipe_id) await syncCommunityRecipePublication(post.recipe_id);

    if (!alreadyLiked && post.user_id !== user.user_id) {
      try {
        const notificationService = require('../services/notification.service');
        await notificationService.createNotification({
          recipient_id: post.user_id,
          sender: {
            user_id: user.user_id,
            username: user.community_name || user.profile_name || 'Anonymous',
            avatar_url: user.avatar_url || null
          },
          type: 'POST_LIKED',
          post_id: post.post_id
        });
      } catch (notifError) {
        console.error('Error creating post-like notification:', notifError);
      }
    }

    res.json({
      message,
      liked: !alreadyLiked,
      like_count: post.like_count
    });

  } catch (error) {
    console.error('Error liking post:', error);
    res.status(500).json({ error: 'Failed to perform like action' });
  }
}

async function savePost(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { post_id: id };
    }

    const post = await Post.findOne(query);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const alreadySaved = user.saved_posts.some(
      p => p.post_id === post.post_id
    );

    let message = '';

    if (alreadySaved) {
      user.saved_posts = user.saved_posts.filter(
        p => p.post_id !== post.post_id
      );
      post.save_count = Math.max(0, post.save_count - 1);
      message = 'Post unsaved successfully';
    } else {
      user.saved_posts.push({
        post_id: post.post_id,
        saved_at: new Date()
      });
      post.save_count++;
      message = 'Post saved successfully';
    }

    await user.save();
    await post.save();

    res.json({
      message,
      saved: !alreadySaved,
      save_count: post.save_count
    });

  } catch (error) {
    console.error('Error saving post:', error);
    res.status(500).json({ error: 'Failed to perform save action' });
  }
}

async function sharePost(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { post_id: id };
    }

    const post = await Post.findOne(query);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    post.share_count += 1;
    await post.save();

    res.json({
      message: 'Share recorded',
      share_count: post.share_count
    });
  } catch (error) {
    console.error('Error recording share:', error);
    res.status(500).json({ error: 'Failed to record share' });
  }
}

async function reportPost(req, res) {
  try {
    const { id } = req.params;
    const { reason, note = '' } = req.body || {};

    if (!PostReport.REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'Invalid report reason' });
    }

    if (reason === 'other' && !String(note).trim()) {
      return res.status(400).json({ error: 'A note is required when the reason is Other' });
    }

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { post_id: id };
    }

    const post = await Post.findOne(query);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const reporterId = await require('./profiles.controller').currentCommunityUserId(req);
    if (post.user_id === reporterId) {
      return res.status(400).json({ error: 'You cannot report your own post' });
    }

    const blocked = await rereportBlock({
      Model: PostReport, filter: { post_id: post.post_id, reporter_id: reporterId }, type: 'post',
      loadOwner: () => User.findOne({ user_id: post.user_id }, 'community_restriction').lean(),
      restoredAfter: restoredAfterFrom(ModerationAction, 'post', post.post_id)
    });
    if (blocked) return res.status(409).json({ error: blocked, code: 'ALREADY_REPORTED' });

    try {
      await PostReport.create({
        post_id: post.post_id,
        reporter_id: reporterId,
        reason,
        note: String(note).trim().slice(0, 500)
      });
    } catch (err) {
      // Two submits at the same moment: the open-report index lets only one through.
      if (err.code === 11000) {
        const error = await duplicateReportMessage({ Model: PostReport, filter: { post_id: post.post_id, reporter_id: reporterId }, type: 'post' });
        return res.status(409).json({ error, code: 'ALREADY_REPORTED' });
      }
      throw err;
    }

    res.status(201).json({ message: 'Report submitted' });
  } catch (error) {
    console.error('Error reporting post:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
}

module.exports = {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  likePost,
  savePost,
  sharePost,
  reportPost
};

