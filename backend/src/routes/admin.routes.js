const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const adminSubscriptionsController = require('../controllers/admin-subscriptions.controller');
const authController = require('../controllers/auth.controller');
const adminCommunityController = require('../controllers/admin-community.controller');
const adminDashboardController = require('../controllers/admin-dashboard.controller');
const {
  authMiddleware,
  requireRole,
  ADMIN_ORDER_VIEW_ROLES,
  ADMIN_ORDER_MANAGE_ROLES
} = require('../middleware/auth.middleware');
const { adminActivityLog } = require('../middleware/adminActivityLog.middleware');

router.post('/login', authController.adminLogin);

router.get('/activity-logs', authMiddleware, requireRole('admin_cc'), adminController.getActivityLogs);
router.get('/dashboard', authMiddleware, requireRole('admin_cc'), adminDashboardController.getDashboard);
router.get('/sales-dashboard', authMiddleware, requireRole('admin_cc', 'qlsp'), adminDashboardController.getSalesDashboard);
router.get('/services-dashboard', authMiddleware, requireRole('admin_cc', 'cskh'), adminDashboardController.getServicesDashboard);

router.get('/orders', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminController.getAllOrders);
router.get('/orders/:id', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminController.getOrderById);
router.put('/orders/:id/status', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.updateOrderStatus);
router.post('/orders/:id/refund/approve', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.approveRefundRequest);
router.post('/orders/:id/refund/reject', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog({ requireReason: true }), adminController.rejectRefundRequest);
router.post('/orders/:id/notes', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.addInternalNote);

// Subscriptions (QLSP, Admin CC): list, detail, pause / reactivate / frequency / cancel / internal note.
router.get('/subscriptions', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminSubscriptionsController.getSubscriptions);
router.get('/subscriptions/:id', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminSubscriptionsController.getSubscription);
router.post('/subscriptions/:id/:action', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog({ requireReasonForActions: ['pause', 'cancel'] }), adminSubscriptionsController.runAction);

// Community moderation (Admin CC, CSKH): reported / hidden posts.
router.get('/community/reports', authMiddleware, requireRole('admin_cc', 'cskh'), adminCommunityController.listReportedPosts);
router.post('/community/posts/:postId/hide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.hide);
router.post('/community/posts/:postId/unhide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.unhide);
router.post('/community/posts/:postId/dismiss', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.dismissReports);
router.get('/community/comment-reports', authMiddleware, requireRole('admin_cc', 'cskh'), adminCommunityController.listReportedComments);
router.post('/community/comments/:commentId/hide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.hideComment);
router.post('/community/comments/:commentId/unhide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.unhideComment);

module.exports = router;
