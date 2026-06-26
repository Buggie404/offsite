const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const authController = require('../controllers/auth.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

router.post('/login', authController.adminLogin);

router.get('/orders', authMiddleware, requireRole('admin'), adminController.getAllOrders);
router.put('/orders/:id/status', authMiddleware, requireRole('admin'), adminController.updateOrderStatus);

module.exports = router;
