const express = require('express');
const router = express.Router();
const chat = require('../controllers/chat.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// Service-to-service (Dify chatbot) – protected by x-chat-secret, not JWT.
router.post('/handoff', chat.handoffFromBot);

// Customer
router.get('/me', authMiddleware, chat.getMyConversation);
router.post('/start', authMiddleware, chat.startConversation);

// Shared (access is checked per conversation)
router.get('/conversations/:id/messages', authMiddleware, chat.getMessages);

// Agents
router.get('/conversations', authMiddleware, requireRole('cskh', 'admin_cc'), chat.listConversations);
router.patch('/conversations/:id/claim', authMiddleware, requireRole('cskh', 'admin_cc'), chat.claimConversation);
router.patch('/conversations/:id/close', authMiddleware, chat.closeConversation);

module.exports = router;
