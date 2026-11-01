const express = require('express');
const router = express.Router();
const { getPublicProfile, reportAccount } = require('../controllers/profiles.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');
const { requireCommunityAccess } = require('../middleware/community-restriction.middleware');
const { requireReportQuota } = require('../middleware/report-limit.middleware');

router.get('/:userId', optionalAuthMiddleware, getPublicProfile);
router.post('/:userId/report', authMiddleware, requireCommunityAccess('interact'), requireReportQuota, reportAccount);

module.exports = router;
