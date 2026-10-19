const express = require('express');
const { authMiddleware } = require('../middleware/auth.middleware');
const loyaltyController = require('../controllers/loyalty.controller');

const router = express.Router();

router.get('/dashboard', authMiddleware, loyaltyController.getDashboard);
router.post('/redeem', authMiddleware, loyaltyController.redeemReward);
router.post('/quiz-complete', authMiddleware, loyaltyController.completeQuiz);

module.exports = router;
