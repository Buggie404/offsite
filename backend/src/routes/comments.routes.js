const express = require('express');
const router = express.Router();
const commentsController = require('../controllers/comments.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

// Public routes
router.get('/post/:postId', commentsController.getCommentsByPostId);

// Protected routes
router.post('/post/:postId', authMiddleware, commentsController.createComment);
router.delete('/:id', authMiddleware, commentsController.deleteComment);
router.post('/:id/like', authMiddleware, commentsController.likeComment);

module.exports = router;
