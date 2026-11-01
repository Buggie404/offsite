const express = require('express');
const router = express.Router();
const commentsController = require('../controllers/comments.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { requireCommunityAccess } = require('../middleware/community-restriction.middleware');
const { requireReportQuota } = require('../middleware/report-limit.middleware');

// Public routes
router.get('/post/:postId', commentsController.getCommentsByPostId);

// Protected routes
router.post('/post/:postId', authMiddleware, requireCommunityAccess('write'), commentsController.createComment);
router.delete('/:id', authMiddleware, commentsController.deleteComment);
router.post('/:id/like', authMiddleware, requireCommunityAccess('interact'), commentsController.likeComment);
router.post('/:id/report', authMiddleware, requireCommunityAccess('interact'), requireReportQuota, commentsController.reportComment);

module.exports = router;
