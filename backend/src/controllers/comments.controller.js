const Comment = require('../models/Comment');
const Post = require('../models/Post');
const User = require('../models/User');
const mongoose = require('mongoose');

// Helper to resolve postId parameter to post_id string
async function resolvePostIdString(postId) {
  if (mongoose.Types.ObjectId.isValid(postId) && /^[0-9a-fA-F]{24}$/.test(postId)) {
    const post = await Post.findById(postId);
    return post ? post.post_id : null;
  }
  return postId;
}

// Get comments for a post
async function getCommentsByPostId(req, res) {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const parent_id = req.query.parent_id;

    const post_id = await resolvePostIdString(postId);
    if (!post_id) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const query = { post_id };

    if (parent_id === 'null') {
      query.parent_id = null; // chỉ lấy comment gốc
    } else if (parent_id) {
      query.parent_id = parent_id; // chỉ lấy reply của 1 comment cụ thể
    }
    // parent_id undefined (không truyền param) => giữ nguyên query chỉ có post_id, trả về tất cả

    const skipCount = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const limitCount = parseInt(limit, 10);

    const comments = await Comment.find(query)
      .sort({ created_at: 1 }) // Chronological order
      .skip(skipCount)
      .limit(limitCount);

    const total = await Comment.countDocuments(query);

    res.json({
      data: comments,
      total,
      page: parseInt(page, 10),
      limit: limitCount
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to retrieve comments' });
  }
}

async function resolveParentCommentId(post_id, rawParentId) {
  if (!rawParentId) return null;

  let parentQuery;
  if (mongoose.Types.ObjectId.isValid(rawParentId) && /^[0-9a-fA-F]{24}$/.test(rawParentId)) {
    parentQuery = { _id: rawParentId, post_id };
  } else {
    parentQuery = { comment_id: rawParentId, post_id };
  }

  const parentComment = await Comment.findOne(parentQuery);
  if (!parentComment) {
    const err = new Error('Parent comment not found');
    err.code = 'PARENT_NOT_FOUND';
    throw err;
  }

  const canonicalParentId = parentComment.parent_id || parentComment.comment_id;
  return canonicalParentId;
}

// Create a comment
async function createComment(req, res) {
  try {
    const { postId } = req.params;
    const { content, parent_id: rawParentId = null, reply_to_username = null } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    // Resolve post
    let queryPost = {};
    if (mongoose.Types.ObjectId.isValid(postId) && /^[0-9a-fA-F]{24}$/.test(postId)) {
      queryPost = { _id: postId };
    } else {
      queryPost = { post_id: postId };
    }
    const post = await Post.findOne(queryPost);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Find the logged-in user
    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Resolve parent_id to the canonical comment_id (or reject if invalid)
    let parent_id;
    try {
      parent_id = await resolveParentCommentId(post.post_id, rawParentId);
    } catch (err) {
      if (err.code === 'PARENT_NOT_FOUND') {
        return res.status(400).json({ error: 'Parent comment not found for this post' });
      }
      throw err;
    }

    // Generate sequential comment_id starting from CMT700001
    const lastComment = await Comment.findOne({}, {}, { sort: { comment_id: -1 } });
    let nextNum = 700001;
    if (lastComment && lastComment.comment_id) {
      const match = lastComment.comment_id.match(/CMT(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    const comment_id = `CMT${String(nextNum).padStart(6, '0')}`;

    // Determine if the current user is the author of the post
    const is_post_author = (user.user_id === post.user_id);

    const newComment = new Comment({
      comment_id,
      post_id: post.post_id,
      parent_id,
      user_id: user.user_id,
      author: {
        username: user.community_name || user.profile_name || 'Anonymous',
        avatar_url: user.avatar_url || '',
        is_post_author
      },
      content,
      reply_to_username,
      like_count: 0,
      reply_count: 0
    });

    const savedComment = await newComment.save();

    // Increment comment count on the post
    post.comment_count += 1;
    await post.save();

    // Increment reply count on parent comment if applicable
    if (parent_id) {
      await Comment.updateOne(
        { comment_id: parent_id },
        { $inc: { reply_count: 1 } }
      );
    }

    // Create notification
    try {
      const notificationService = require('../services/notification.service');
      if (!parent_id) {
        // Case 1: comment on a post
        if (post.user_id !== user.user_id) {
          await notificationService.createNotification({
            recipient_id: post.user_id,
            sender: {
              user_id: user.user_id,
              username: user.community_name || user.profile_name || 'Anonymous',
              avatar_url: user.avatar_url || null
            },
            type: 'POST_COMMENTED',
            post_id: post.post_id,
            comment_id: savedComment.comment_id,
            comment_content: savedComment.content
          });
        }
      } else {
        // Case 2: reply to another comment
        const parentComment = await Comment.findOne({ comment_id: parent_id });
        if (parentComment && parentComment.user_id !== user.user_id) {
          await notificationService.createNotification({
            recipient_id: parentComment.user_id,
            sender: {
              user_id: user.user_id,
              username: user.community_name || user.profile_name || 'Anonymous',
              avatar_url: user.avatar_url || null
            },
            type: 'COMMENT_REPLIED',
            post_id: post.post_id,
            comment_id: savedComment.comment_id,
            comment_content: savedComment.content
          });
        }
      }
    } catch (notifError) {
      console.error('Error creating comment-related notification:', notifError);
    }

    res.status(201).json({
      message: 'Comment added successfully',
      data: savedComment
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: error.message || 'Failed to create comment' });
  }
}

// Delete a comment
async function deleteComment(req, res) {
  try {
    const { id } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { comment_id: id };
    }

    const comment = await Comment.findOne(query);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Authorization check
    const user = await User.findById(req.user.user_id);
    if (!user || comment.user_id !== user.user_id) {
      return res.status(403).json({ error: 'You are not authorized to delete this comment' });
    }

    await Comment.deleteOne({ _id: comment._id });

    // Decrement comment count on post
    await Post.updateOne(
      { post_id: comment.post_id },
      { $inc: { comment_count: -1 } }
    );

    // Decrement reply count on parent comment if applicable
    if (comment.parent_id) {
      await Comment.updateOne(
        { comment_id: comment.parent_id },
        { $inc: { reply_count: -1 } }
      );
    }

    // Also delete any replies to this comment
    if (!comment.parent_id) {
      // If it is a top-level comment, get count of replies to delete
      const repliesCount = await Comment.countDocuments({ parent_id: comment.comment_id });
      if (repliesCount > 0) {
        await Comment.deleteMany({ parent_id: comment.comment_id });
        // Decrement post comment_count by number of deleted replies
        await Post.updateOne(
          { post_id: comment.post_id },
          { $inc: { comment_count: -repliesCount } }
        );
      }
    }

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
}

// Like/Unlike a comment
async function likeComment(req, res) {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'like' or 'unlike'

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      query = { _id: id };
    } else {
      query = { comment_id: id };
    }

    const comment = await Comment.findOne(query);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (action === 'unlike') {
      comment.like_count = Math.max(0, comment.like_count - 1);
    } else {
      comment.like_count += 1;
    }

    await comment.save();

    // Create notification if liked
    if (action !== 'unlike') {
      try {
        const user = await User.findById(req.user.user_id);
        if (user && comment.user_id !== user.user_id) {
          const notificationService = require('../services/notification.service');
          await notificationService.createNotification({
            recipient_id: comment.user_id,
            sender: {
              user_id: user.user_id,
              username: user.community_name || user.profile_name || 'Anonymous',
              avatar_url: user.avatar_url || null
            },
            type: 'COMMENT_LIKED',
            post_id: comment.post_id,
            comment_id: comment.comment_id,
            comment_content: comment.content
          });
        }
      } catch (notifError) {
        console.error('Error creating comment-like notification:', notifError);
      }
    }

    res.json({
      message: action === 'unlike' ? 'Comment unliked' : 'Comment liked',
      like_count: comment.like_count
    });
  } catch (error) {
    console.error('Error liking comment:', error);
    res.status(500).json({ error: 'Failed to like comment' });
  }
}

module.exports = {
  getCommentsByPostId,
  createComment,
  deleteComment,
  likeComment
};