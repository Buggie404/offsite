const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const cartController = require('../controllers/cart.controller');

// Logged-in user's current DB cart.
router.get('/', authMiddleware, cartController.getCart);

// Live-sync: overwrite the logged-in user's DB cart (add/edit/remove).
router.put('/', authMiddleware, cartController.replaceCart);

// Merge a guest cart into the logged-in user's cart (guest -> user, one way).
router.post('/merge', authMiddleware, cartController.mergeCart);

module.exports = router;
