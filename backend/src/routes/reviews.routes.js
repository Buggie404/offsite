const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviews.controller');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/auth');

// Helper middleware to allow guest requests
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer [token]"
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
}

router.get('/product/:productId', reviewsController.getProductReviews);
router.post('/', optionalAuth, reviewsController.createReview);

module.exports = router;
