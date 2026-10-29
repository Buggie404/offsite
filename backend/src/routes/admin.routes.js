const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const adminSubscriptionsController = require('../controllers/admin-subscriptions.controller');
const adminProductsController = require('../controllers/admin-products.controller');
const authController = require('../controllers/auth.controller');
const adminCommunityController = require('../controllers/admin-community.controller');
const adminDashboardController = require('../controllers/admin-dashboard.controller');
const contactMessagesController = require('../controllers/contact-messages.controller');
const adminStaffController = require('../controllers/admin-staff.controller');
const adminActivityLogController = require('../controllers/admin-activity-log.controller');
const adminCustomersController = require('../controllers/admin-customers.controller');
const adminModerationController = require('../controllers/admin-moderation.controller');
const {
  authMiddleware,
  requireRole,
  ADMIN_ORDER_VIEW_ROLES,
  ADMIN_ORDER_MANAGE_ROLES
} = require('../middleware/auth.middleware');
const { adminActivityLog } = require('../middleware/adminActivityLog.middleware');

router.post('/login', authController.adminLogin);
// Staff set their own password here (first sign-in with a temporary password, or any time later).
router.put('/change-password', authMiddleware, requireRole('admin_cc', 'cskh', 'qlsp'), authController.changePassword);

// Staff (Admin CC only): create, change role, disable / enable, reset password.
router.get('/staff', authMiddleware, requireRole('admin_cc'), adminStaffController.listStaff);
router.post('/staff', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.createStaff);
router.get('/staff/:userId/open-work', authMiddleware, requireRole('admin_cc'), adminStaffController.getStaffOpenWork);
router.patch('/staff/:userId/role', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.changeStaffRole);
router.patch('/staff/:userId/status', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.setStaffStatus);
router.post('/staff/:userId/reset-password', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.resetStaffPassword);

// Customers (Admin CC, QLSP): list, profile, lock / unlock (reason required), internal notes.
// Points / tier and orders are shown read-only.
const CUSTOMER_ROLES = ['admin_cc', 'qlsp'];
router.get('/customers', authMiddleware, requireRole(...CUSTOMER_ROLES), adminCustomersController.listCustomers);
router.get('/customers/:userId', authMiddleware, requireRole(...CUSTOMER_ROLES), adminCustomersController.getCustomer);
router.post('/customers/:userId/notes', authMiddleware, requireRole(...CUSTOMER_ROLES), adminActivityLog(), adminCustomersController.addCustomerNote);
router.patch('/customers/:userId/status', authMiddleware, requireRole(...CUSTOMER_ROLES), adminActivityLog(), adminCustomersController.setCustomerStatus);

// Activity log (Admin CC only, read-only): filter by who, role, action, time; CSV export.
router.get('/activity-logs', authMiddleware, requireRole('admin_cc'), adminActivityLogController.listActivityLogs);
router.get('/activity-logs/export', authMiddleware, requireRole('admin_cc'), adminActivityLogController.exportActivityLogs);
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

// Community reports queue (Admin CC, CSKH; QLSP has no access): posts, comments and accounts with
// pending reports; hide / restore / warn / lock / dismiss with a message to the author.
router.get('/community/queue', authMiddleware, requireRole('admin_cc', 'cskh'), adminModerationController.listQueue);
router.get('/community/handled', authMiddleware, requireRole('admin_cc', 'cskh'), adminModerationController.listHandled);
router.post('/community/moderate', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminModerationController.moderate);

// Community moderation (Admin CC, CSKH): reported / hidden posts.
router.get('/community/reports', authMiddleware, requireRole('admin_cc', 'cskh'), adminCommunityController.listReportedPosts);
router.post('/community/users/:id/warn', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog({ requireReason: true }), adminCommunityController.warnUser);
router.post('/community/users/:id/suspend', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog({ requireReason: true }), adminCommunityController.suspendUser);
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
