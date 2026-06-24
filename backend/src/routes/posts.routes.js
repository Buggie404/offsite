const express = require('express');
const router = express.Router();
const postsController = require('../controllers/posts.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

// Public routes
router.get('/', postsController.getAllPosts);
router.get('/:id', postsController.getPostById);

// Protected routes
router.post('/', authMiddleware, postsController.createPost);
router.put('/:id', authMiddleware, postsController.updatePost);
router.delete('/:id', authMiddleware, postsController.deletePost);
router.post('/:id/like', authMiddleware, postsController.likePost);

module.exports = router;
