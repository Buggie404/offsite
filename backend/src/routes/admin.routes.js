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
const adminVouchersController = require('../controllers/admin-vouchers.controller');
const adminModerationController = require('../controllers/admin-moderation.controller');
const adminRitualDnaController = require('../controllers/admin-ritual-dna.controller');
const {
  authMiddleware,
  requireRole,
  ADMIN_ORDER_VIEW_ROLES,
  ADMIN_ORDER_MANAGE_ROLES
} = require('../middleware/auth.middleware');
const { adminActivityLog } = require('../middleware/adminActivityLog.middleware');
const adminStarterQuizController = require('../controllers/admin-starter-quiz.controller');
const adminRecipesController = require('../controllers/admin-recipes.controller');

router.post('/login', authController.adminLogin);
// Staff set their own password here (first sign-in with a temporary password, or any time later).
router.put('/change-password', authMiddleware, requireRole('admin_cc', 'cskh', 'qlsp'), authController.changePassword);

// Staff (Admin CC only): create, change role, disable / enable, reset password.
router.get('/staff', authMiddleware, requireRole('admin_cc'), adminStaffController.listStaff);
router.get('/staff/check-email', authMiddleware, requireRole('admin_cc'), adminStaffController.checkStaffEmail);
router.post('/staff', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.createStaff);
router.get('/staff/:userId/open-work', authMiddleware, requireRole('admin_cc'), adminStaffController.getStaffOpenWork);
router.patch('/staff/:userId/role', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.changeStaffRole);
router.patch('/staff/:userId/status', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.setStaffStatus);
router.post('/staff/:userId/reset-password', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStaffController.resetStaffPassword);

// Customers (Admin CC, QLSP): list, profile, internal notes. Unlock accounts locked earlier: Admin CC only.
// Customer accounts cannot be locked by any admin.
// Points / tier and orders are shown read-only.
const CUSTOMER_ROLES = ['admin_cc', 'qlsp', 'cskh'];
router.get('/customers', authMiddleware, requireRole(...CUSTOMER_ROLES), adminCustomersController.listCustomers);
router.get('/customers/:userId', authMiddleware, requireRole(...CUSTOMER_ROLES), adminCustomersController.getCustomer);
router.get('/customers/:userId/orders', authMiddleware, requireRole(...CUSTOMER_ROLES), adminCustomersController.listCustomerOrders);
router.post('/customers/:userId/notes', authMiddleware, requireRole(...CUSTOMER_ROLES), adminActivityLog(), adminCustomersController.addCustomerNote);
router.patch('/customers/:userId/status', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminCustomersController.setCustomerStatus);

// Vouchers: Admin CC and QLSP can view, create, edit and stop.
// CSKH can view and can create a complaint voucher only (a reason is required). Edit and stop return 403.
const VOUCHER_VIEW_ROLES = ['admin_cc', 'qlsp', 'cskh'];
const VOUCHER_MANAGE_ROLES = ['admin_cc', 'qlsp'];
const complaintNeedsReason = (req) => req.user?.role === 'cskh' || req.body?.purpose === 'complaint';
router.get('/vouchers', authMiddleware, requireRole(...VOUCHER_VIEW_ROLES), adminVouchersController.listVouchers);
router.get('/vouchers/customers', authMiddleware, requireRole(...VOUCHER_VIEW_ROLES), adminVouchersController.searchCustomers);
router.get('/vouchers/:id/performance', authMiddleware, requireRole(...VOUCHER_VIEW_ROLES), adminVouchersController.voucherPerformance);
router.post('/vouchers', authMiddleware, requireRole(...VOUCHER_VIEW_ROLES), adminActivityLog({ requireReasonWhen: complaintNeedsReason }), adminVouchersController.createVoucher);
router.patch('/vouchers/:id/stop', authMiddleware, requireRole(...VOUCHER_MANAGE_ROLES), adminActivityLog(), adminVouchersController.stopVoucher);
router.patch('/vouchers/:id', authMiddleware, requireRole(...VOUCHER_MANAGE_ROLES), adminActivityLog(), adminVouchersController.updateVoucher);

// Activity log (Admin CC only, read-only): filter by role, action, time; CSV export.
router.get('/activity-logs', authMiddleware, requireRole('admin_cc'), adminActivityLogController.listActivityLogs);
router.get('/activity-logs/export', authMiddleware, requireRole('admin_cc'), adminActivityLogController.exportActivityLogs);
router.get('/dashboard', authMiddleware, requireRole('admin_cc'), adminDashboardController.getDashboard);
router.get('/sales-dashboard', authMiddleware, requireRole('admin_cc', 'qlsp'), adminDashboardController.getSalesDashboard);
router.get('/services-dashboard', authMiddleware, requireRole('admin_cc', 'cskh'), adminDashboardController.getServicesDashboard);
router.get('/ritual-dna/overview', authMiddleware, requireRole('admin_cc'), adminRitualDnaController.overview);
router.post('/ritual-dna/archetype-releases', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.createDraft);
router.put('/ritual-dna/archetype-releases/:version', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.saveDraft);
router.post('/ritual-dna/archetype-releases/:version/impact', authMiddleware, requireRole('admin_cc'), adminRitualDnaController.signatureImpact);
router.delete('/ritual-dna/archetype-releases/:version', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.deleteDraft);
router.post('/ritual-dna/archetype-releases/:version/:action', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.changeStatus);
router.post('/ritual-dna/quiz-releases', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.createQuizDraft);
router.put('/ritual-dna/quiz-releases/:version', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.saveQuizDraft);
router.delete('/ritual-dna/quiz-releases/:version', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.deleteQuizDraft);
router.post('/ritual-dna/quiz-releases/:version/simulate', authMiddleware, requireRole('admin_cc'), adminRitualDnaController.simulateQuiz);
router.post('/ritual-dna/quiz-releases/:version/:action', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminRitualDnaController.changeQuizStatus);
router.get('/ritual-dna/customers', authMiddleware, requireRole('admin_cc'), adminRitualDnaController.customers);
router.get('/ritual-dna/customers/:userId', authMiddleware, requireRole('admin_cc'), adminRitualDnaController.customerDetail);

router.get('/orders', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminController.getAllOrders);
router.get('/orders/:id', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminController.getOrderById);
// Marking a delivery failed or cancelling a failed delivery requires a reason.
router.put('/orders/:id/status', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog({ requireReasonWhen: adminController.statusChangeRequiresReason }), adminController.updateOrderStatus);
router.post('/orders/:id/refund/approve', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.approveRefundRequest);
router.post('/orders/:id/refund/reject', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog({ requireReason: true }), adminController.rejectRefundRequest);
router.post('/orders/:id/out-of-stock', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.markItemsOutOfStock);
router.get('/orders/:id/out-of-stock/replacements', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminController.listOutOfStockReplacements);
router.post('/orders/:id/out-of-stock/resolve', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.resolveOutOfStockLine);
router.post('/orders/:id/notes', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminController.addInternalNote);

router.get('/products', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminProductsController.listProducts);
router.patch('/products/:productId/batch-expiry', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminActivityLog(), adminProductsController.updateBatchExpiry);

// Subscriptions (QLSP, Admin CC): list, detail, pause / reactivate / frequency / cancel / internal note.
// Ritual Box: CSKH can view (and keep notes); what each role may do is enforced per action
// in admin-subscription.service (ROLE_RULES).
router.get('/subscriptions', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminSubscriptionsController.getSubscriptions);
router.get('/subscriptions/:id', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminSubscriptionsController.getSubscription);
router.post('/subscriptions/:id/:action', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminActivityLog({ requireReasonForActions: ['pause', 'skip', 'cancel'] }), adminSubscriptionsController.runAction);

// Recipes (Admin CC, CSKH — same roles as the Recipes nav item). QLSP has no access.
router.get('/recipes', authMiddleware, requireRole('admin_cc', 'cskh'), adminRecipesController.listRecipes);
router.get('/recipes/linkable-products', authMiddleware, requireRole('admin_cc', 'cskh'), adminRecipesController.searchLinkableProducts);
router.post('/recipes', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminRecipesController.createOffsiteRecipe);
router.get('/recipes/:recipeId', authMiddleware, requireRole('admin_cc', 'cskh'), adminRecipesController.getRecipe);
router.put('/recipes/:recipeId', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminRecipesController.updateRecipe);
router.patch('/recipes/:recipeId/visibility', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminRecipesController.setVisibility);
router.post('/recipes/:recipeId/request-changes', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminRecipesController.requestMoreChanges);
router.post('/recipes/:recipeId/final-reject', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminRecipesController.finalReject);
router.delete('/recipes/:recipeId', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminRecipesController.deleteRecipe);
router.patch('/recipes/:recipeId', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminRecipesController.updateFeatured);

// Community reports queue (Admin CC, CSKH; QLSP has no access): posts, comments and accounts with
// pending reports; hide / restore / warn / suspend 3 or 7 days / dismiss with a message to the author.
router.get('/community/queue', authMiddleware, requireRole('admin_cc', 'cskh'), adminModerationController.listQueue);
router.get('/community/handled', authMiddleware, requireRole('admin_cc', 'cskh'), adminModerationController.listHandled);
router.post('/community/moderate', authMiddleware, requireRole('admin_cc', 'cskh'), adminActivityLog(), adminModerationController.moderate);

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

router.get('/starter-quiz', authMiddleware, requireRole('admin_cc'), adminStarterQuizController.getConfig);
router.get('/starter-quiz/metrics', authMiddleware, requireRole('admin_cc'), adminStarterQuizController.getKitMetrics);
router.patch('/starter-quiz/settings', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStarterQuizController.updateSettings);
router.post('/starter-quiz/questions', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStarterQuizController.createQuestion);
router.put('/starter-quiz/questions/reorder', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStarterQuizController.reorderQuestions);
router.patch('/starter-quiz/questions/:questionId', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStarterQuizController.updateQuestion);
router.delete('/starter-quiz/questions/:questionId', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStarterQuizController.deleteQuestion);
router.post('/starter-quiz/kits/preview', authMiddleware, requireRole('admin_cc'), adminStarterQuizController.previewKit);
router.post('/starter-quiz/kits/test', authMiddleware, requireRole('admin_cc'), adminStarterQuizController.testRules);
router.post('/starter-quiz/kits', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStarterQuizController.createKit);
router.patch('/starter-quiz/kits/:kitId', authMiddleware, requireRole('admin_cc'), adminActivityLog(), adminStarterQuizController.updateKit);

module.exports = router;
