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
// After a failed delivery: the customer confirms a redelivery or cancels; a paid QR order adds the
// bank account its refund is paid out to (also after an automatic cancel).
router.post('/:id/redelivery/confirm', optionalAuthMiddleware, ordersController.confirmRedelivery);
router.post('/:id/redelivery/cancel', optionalAuthMiddleware, ordersController.cancelRedelivery);
router.post('/:id/refund-destination', optionalAuthMiddleware, ordersController.setRefundDestination);
router.delete('/:id', optionalAuthMiddleware, ordersController.deleteOrder);
router.get('/:id/status', optionalAuthMiddleware, ordersController.getOrderStatus);
router.get('/:id', authMiddleware, ordersController.getOrderById);
router.get('/', authMiddleware, ordersController.getOrderHistory);

module.exports = router;
