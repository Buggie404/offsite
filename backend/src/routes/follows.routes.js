const express = require('express');
const router = express.Router();
const followsController = require('../controllers/follows.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

router.get('/ids', authMiddleware, followsController.getFollowingIds);
router.post('/:userId', authMiddleware, followsController.toggleFollow);

module.exports = router;
