const express = require('express');
const router = express.Router();
const aiChatController = require('../controllers/ai-chat.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');

// 0. Endpoint to fetch greeting and suggested questions from Dify
router.get('/init', aiChatController.getInitParameters);

// 1. Endpoint for Dify HTTP Request tool: Products catalog
router.get('/products-catalog', aiChatController.getProductsCatalog);

// 2. Guest order lookup: order code + phone or email, 3 per hour
router.get('/order-status', aiChatController.getOrderStatus);

// Signed-in shopper: five most recent orders, no extra details
router.get('/my-orders', authMiddleware, aiChatController.getMyOrders);

// Session lifecycle. Claim and list stay ahead of /sessions/:id.
router.post('/sessions/claim', optionalAuthMiddleware, aiChatController.claimSession);
router.post('/sessions', optionalAuthMiddleware, aiChatController.openSession);
router.get('/sessions', optionalAuthMiddleware, aiChatController.listSessions);
router.get('/sessions/:sessionId', optionalAuthMiddleware, aiChatController.getSession);
router.post('/sessions/:sessionId/resume', optionalAuthMiddleware, aiChatController.resumeSession);
router.delete('/sessions/:sessionId', optionalAuthMiddleware, aiChatController.deleteSession);
router.post('/sessions/:sessionId/messages/:messageId/order-card', optionalAuthMiddleware, aiChatController.saveOrderCard);

// 3. Endpoint for Angular Frontend Chat Drawer
router.post('/message', optionalAuthMiddleware, aiChatController.handleChatMessage);

// 4. Leave-a-message form shown when the assistant is unavailable
router.post('/leave-message', optionalAuthMiddleware, aiChatController.leaveMessage);

// 5. Customer asked to talk to CSKH from the drawer
router.post('/handover', optionalAuthMiddleware, aiChatController.requestHandover);

module.exports = router;
