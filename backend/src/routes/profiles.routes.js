const express = require('express');
const router = express.Router();
const { getPublicProfile } = require('../controllers/profiles.controller');
const { optionalAuthMiddleware } = require('../middleware/auth.middleware');

router.get('/:userId', optionalAuthMiddleware, getPublicProfile);

module.exports = router;
