const express = require('express');
const router = express.Router();
const ordersController = require('../controllers/orders.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { optionalAuthMiddleware } = require('../middleware/optionalAuth.middleware');

router.post('/', optionalAuthMiddleware, ordersController.createOrder);
router.get('/:id', authMiddleware, ordersController.getOrderById);
router.get('/', authMiddleware, ordersController.getOrderHistory);

module.exports = router;
