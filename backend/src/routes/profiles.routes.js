const express = require('express');
const router = express.Router();
const { getPublicProfile, reportAccount } = require('../controllers/profiles.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');

router.get('/:userId', optionalAuthMiddleware, getPublicProfile);
router.post('/:userId/report', authMiddleware, reportAccount);

module.exports = router;
