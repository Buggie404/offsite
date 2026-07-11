const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refreshToken);
router.post('/forgot-password',  authController.forgotPassword);  
router.post('/reset-password',   authController.resetPassword);
router.post('/verify-registration-otp', authController.verifyRegistrationOtp);
router.post('/resend-registration-otp', authController.resendRegistrationOtp);

// Profile & Password routes
router.get('/me', authMiddleware, authController.getProfile);
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.put('/change-password', authMiddleware, authController.changePassword);
router.post('/send-profile-otp', authMiddleware, authController.sendProfileOtp);
router.post('/verify-profile-otp', authMiddleware, authController.verifyProfileOtp);

// Address and Payment Method routes
router.post('/addresses', authMiddleware, authController.addAddress);
router.put('/addresses/:id', authMiddleware, authController.updateAddress);
router.delete('/addresses/:id', authMiddleware, authController.deleteAddress);
router.post('/payment-methods', authMiddleware, authController.addPaymentMethod);
router.delete('/payment-methods/:id', authMiddleware, authController.deletePaymentMethod);

// Saved Items routes
router.get('/saved-items', authMiddleware, authController.getSavedItems);
router.post('/saved-products', authMiddleware, authController.toggleSavedProduct);
router.post('/saved-recipes', authMiddleware, authController.toggleSavedRecipe);
router.post('/saved-blogs', authMiddleware, authController.toggleSavedBlog);
router.post('/saved-posts', authMiddleware, authController.toggleSavedPost);
router.post('/saved-items-batch-delete', authMiddleware, authController.deleteSavedItemsBatch);

module.exports = router;