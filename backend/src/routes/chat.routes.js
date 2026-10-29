const express = require('express');
const router = express.Router();
const chat = require('../controllers/chat.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// Service-to-service (Dify chatbot) – protected by x-chat-secret, not JWT.
router.post('/handoff', chat.handoffFromBot);

router.use(authMiddleware, async (req, res, next) => {
  try {
    req.user = { ...req.user, user_id: await require('../services/chat.service').resolveChatUserId(req.user.user_id) };
    next();
  } catch (error) { res.status(500).json({ error: 'Failed to load chat identity' }); }
});

// Customer
router.get('/me', chat.getMyConversation);
router.post('/start', chat.startConversation);

// Shared (access is checked per conversation)
router.get('/conversations/:id/messages', chat.getMessages);

// Agents
router.get('/conversations', requireRole('cskh', 'admin_cc'), chat.listConversations);
router.patch('/conversations/:id/claim', requireRole('cskh', 'admin_cc'), chat.claimConversation);
router.patch('/conversations/:id/close', chat.closeConversation);

module.exports = router;
