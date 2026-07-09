const express = require('express');
const router = express.Router();
const postsController = require('../controllers/posts.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');

// Public routes (optionalAuthMiddleware: biết user nếu có đăng nhập, nhưng không bắt buộc)
router.get('/', optionalAuthMiddleware, postsController.getAllPosts);
router.get('/:id', optionalAuthMiddleware, postsController.getPostById);

// Protected routes
router.post('/', authMiddleware, postsController.createPost);
router.put('/:id', authMiddleware, postsController.updatePost);
router.delete('/:id', authMiddleware, postsController.deletePost);
router.post('/:id/like', authMiddleware, postsController.likePost);

module.exports = router;