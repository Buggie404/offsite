const express = require('express');
const router = express.Router();
const ordersController = require('../controllers/orders.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { optionalAuthMiddleware } = require('../middleware/optionalAuth.middleware');

router.post('/', optionalAuthMiddleware, ordersController.createOrder);
router.put('/:id/confirm', optionalAuthMiddleware, ordersController.confirmOrder);
router.put('/:id/cancel', optionalAuthMiddleware, ordersController.cancelPendingOrder);
router.put('/:id/fail-payment', optionalAuthMiddleware, ordersController.failPayment);
router.put('/:id/confirm-payment', optionalAuthMiddleware, ordersController.confirmPayment);
router.put('/:id/retry-payment', optionalAuthMiddleware, ordersController.retryPayment);
router.put('/:id/change-payment-method', optionalAuthMiddleware, ordersController.changePaymentMethod);
router.put('/:id/receive', optionalAuthMiddleware, ordersController.receiveOrder);
router.post('/:id/refund', optionalAuthMiddleware, ordersController.requestRefund);
router.delete('/:id', optionalAuthMiddleware, ordersController.deleteOrder);
router.get('/:id/status', optionalAuthMiddleware, ordersController.getOrderStatus);
router.get('/:id', authMiddleware, ordersController.getOrderById);
router.get('/', authMiddleware, ordersController.getOrderHistory);

module.exports = router;
