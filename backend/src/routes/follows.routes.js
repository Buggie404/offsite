const express = require('express');
const router = express.Router();
const followsController = require('../controllers/follows.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');

// Fixed paths first so they are not captured by /:userId
router.get('/ids', authMiddleware, followsController.getFollowingIds);
router.get('/following', authMiddleware, followsController.getMyFollowing);

router.get('/:userId/status', authMiddleware, followsController.getFollowStatus);
router.get('/:userId/following', optionalAuthMiddleware, followsController.getUserFollowing);
router.get('/:userId/followers', optionalAuthMiddleware, followsController.getUserFollowers);

router.put('/:userId', authMiddleware, followsController.followUser);
router.delete('/:userId', authMiddleware, followsController.unfollowUser);
router.post('/:userId', authMiddleware, followsController.toggleFollow);

module.exports = router;
