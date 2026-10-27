const express = require('express');
const router = express.Router();
const followsController = require('../controllers/follows.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');

router.get('/ids', authMiddleware, followsController.getFollowingIds);
router.get('/:userId/:type', optionalAuthMiddleware, followsController.getFollowList);
router.post('/:userId', authMiddleware, followsController.toggleFollow);

module.exports = router;
