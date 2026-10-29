const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const adminSubscriptionsController = require('../controllers/admin-subscriptions.controller');
const adminProductsController = require('../controllers/admin-products.controller');
const authController = require('../controllers/auth.controller');
const adminCommunityController = require('../controllers/admin-community.controller');
const adminDashboardController = require('../controllers/admin-dashboard.controller');
const contactMessagesController = require('../controllers/contact-messages.controller');
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
// Marking a delivery failed or cancelling a failed delivery requires a reason.
router.put('/orders/:id/status', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog({ requireReasonWhen: adminController.statusChangeRequiresReason }), adminController.updateOrderStatus);
router.post('/orders/:id/refund/approve', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.approveRefundRequest);
router.post('/orders/:id/refund/reject', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog({ requireReason: true }), adminController.rejectRefundRequest);
router.post('/orders/:id/out-of-stock', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.markItemsOutOfStock);
router.post('/orders/:id/notes', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.addInternalNote);

router.get('/products', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminProductsController.listProducts);
router.patch('/products/:productId/batch-expiry', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminProductsController.updateBatchExpiry);

// Subscriptions (QLSP, Admin CC): list, detail, pause / reactivate / frequency / cancel / internal note.
// Ritual Box: CSKH can view (and keep notes); what each role may do is enforced per action
// in admin-subscription.service (ROLE_RULES).
router.get('/subscriptions', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminSubscriptionsController.getSubscriptions);
router.get('/subscriptions/:id', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminSubscriptionsController.getSubscription);
router.post('/subscriptions/:id/:action', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminActivityLog({ requireReasonForActions: ['pause', 'skip', 'cancel'] }), adminSubscriptionsController.runAction);

// Community moderation (Admin CC, CSKH): reported / hidden posts.
router.get('/community/reports', authMiddleware, requireRole('admin_cc', 'cskh'), adminCommunityController.listReportedPosts);
router.post('/community/posts/:postId/hide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.hide);
router.post('/community/posts/:postId/unhide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.unhide);
router.post('/community/posts/:postId/dismiss', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.dismissReports);
router.get('/community/comment-reports', authMiddleware, requireRole('admin_cc', 'cskh'), adminCommunityController.listReportedComments);
router.post('/community/comments/:commentId/hide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.hideComment);
router.post('/community/comments/:commentId/unhide', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminCommunityController.unhideComment);

// Contact Us inbox (Admin CC, CSKH): messages from the Contact page and the chatbot fallback form.
router.get('/contact-messages', authMiddleware, requireRole('admin_cc', 'cskh'), contactMessagesController.listContactMessages);
router.get('/contact-messages/:contactId', authMiddleware, requireRole('admin_cc', 'cskh'), contactMessagesController.getContactMessage);
router.patch('/contact-messages/:contactId', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), contactMessagesController.updateContactMessage);

module.exports = router;
