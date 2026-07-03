const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const savedItemsController = require('../controllers/saved-items.controller');
const { authMiddleware } = require('../middleware/auth.middleware');


router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refreshToken);
router.post('/forgot-password',  authController.forgotPassword);  
router.post('/reset-password',   authController.resetPassword);


// Profile & Password routes
router.get('/me', authMiddleware, authController.getProfile);
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.put('/change-password', authMiddleware, authController.changePassword);
router.get('/saved-items', authMiddleware, savedItemsController.getSavedItems);
router.put('/saved-products/:productId', authMiddleware, savedItemsController.toggleSavedProduct);
router.put('/saved-recipes/:recipeId', authMiddleware, savedItemsController.toggleSavedRecipe);

// Address and Payment Method routes
router.post('/addresses', authMiddleware, authController.addAddress);
router.put('/addresses/:id', authMiddleware, authController.updateAddress);
router.delete('/addresses/:id', authMiddleware, authController.deleteAddress);
router.post('/payment-methods', authMiddleware, authController.addPaymentMethod);
router.delete('/payment-methods/:id', authMiddleware, authController.deletePaymentMethod);

module.exports = router;
