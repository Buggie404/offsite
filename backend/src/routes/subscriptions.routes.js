const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const subscriptionsController = require('../controllers/subscriptions.controller');

// Logged-in user's Ritual Box (Subscribe & Save subscriptions + delivery history).
router.get('/', authMiddleware, subscriptionsController.getMySubscriptions);

// Start the Ritual Box of a paid order whose box couldn't start at checkout (card removed).
router.post('/start-from-order/:orderId', authMiddleware, subscriptionsController.startSubscriptionsFromOrder);

// Skip / pause / resume / change frequency / change card / use replacement / cancel.
router.patch('/:id', authMiddleware, subscriptionsController.updateSubscription);

module.exports = router;
