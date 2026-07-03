const Post = require('../models/Post');
const User = require('../models/User');
const mongoose = require('mongoose');

// Get all posts (feed)
async function getAllPosts(req, res) {
  try {
    const { page = 1, limit = 10, post_type, recipe_id, user_id, sort } = req.query;

    const query = {};
    if (post_type) query.post_type = post_type;
    if (recipe_id) query.recipe_id = recipe_id;
    if (user_id) query.user_id = user_id;

    const skipCount = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const limitCount = parseInt(limit, 10);

    // sort=like_count → nhiều like nhất trước; mặc định mới nhất trước
    const sortOption = sort === 'like_count'
      ? { like_count: -1 }
      : { created_at: -1 };

    const posts = await Post.find(query)
      .sort(sortOption)
      .skip(skipCount)
      .limit(limitCount);

    const total = await Post.countDocuments(query);

    res.json({
      data: posts,
      total,
      page: parseInt(page, 10),
      limit: limitCount
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to retrieve posts' });
  }
}

// Get post by ID or post_id string
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

    res.json(post);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to retrieve post' });
  }
}

// Create a new post
async function createPost(req, res) {
  try {
    const { content, media = [], post_type = 'regular', recipe_id = null } = req.body;
    
    // Find the logged-in user
    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Generate sequential post_id starting from POST600001
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
      recipe_id,
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      save_count: 0
    });

    const savedPost = await newPost.save();
    res.status(201).json({
      message: 'Post created successfully',
      data: savedPost
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: error.message || 'Failed to create post' });
  }
}

// Update an existing post
async function updatePost(req, res) {
  try {
    const { id } = req.params;
    const { content, media, post_type, recipe_id } = req.body;

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

    // Authorization check
    const user = await User.findById(req.user.user_id);
    if (!user || post.user_id !== user.user_id) {
      return res.status(403).json({ error: 'You are not authorized to update this post' });
    }

    if (content !== undefined) post.content = content;
    if (media !== undefined) post.media = media;
    if (post_type !== undefined) post.post_type = post_type;
    if (recipe_id !== undefined) post.recipe_id = recipe_id;

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

// Delete a post
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

    // Authorization check
    const user = await User.findById(req.user.user_id);
    if (!user || post.user_id !== user.user_id) {
      return res.status(403).json({ error: 'You are not authorized to delete this post' });
    }

    await Post.deleteOne({ _id: post._id });
    
    // Clean up associated comments
    const Comment = require('../models/Comment');
    await Comment.deleteMany({ post_id: post.post_id });

    res.json({ message: 'Post and associated comments deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
}

// Like/Save or Unlike/Unsave a post
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

    const alreadyLiked = user.saved_posts.some(sp => sp.post_id === post.post_id);
    let message = '';

    if (alreadyLiked) {
      // Unlike
      user.saved_posts = user.saved_posts.filter(sp => sp.post_id !== post.post_id);
      post.like_count = Math.max(0, post.like_count - 1);
      message = 'Post unliked successfully';
    } else {
      // Like
      user.saved_posts.push({ post_id: post.post_id, saved_at: new Date() });
      post.like_count += 1;
      message = 'Post liked successfully';
    }

    await user.save();
    await post.save();

    res.json({
      message,
      like_count: post.like_count,
      liked: !alreadyLiked
    });
  } catch (error) {
    console.error('Error liking post:', error);
    res.status(500).json({ error: 'Failed to perform like action' });
  }
}

module.exports = {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  likePost
};
