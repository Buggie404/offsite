const express = require('express');
const router = express.Router();
const contactMessagesController = require('../controllers/contact-messages.controller');
const { optionalAuthMiddleware } = require('../middleware/auth.middleware');

// Guests can send too; a signed-in sender is linked through user_id.
router.post('/', optionalAuthMiddleware, contactMessagesController.createContactMessage);

module.exports = router;
