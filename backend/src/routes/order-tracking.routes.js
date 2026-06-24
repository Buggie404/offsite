const express = require('express');
const router = express.Router();
const orderTrackingController = require('../controllers/order-tracking.controller');

// GET /api/order-tracking?order_id=...&email=... or mobile=...
router.get('/', orderTrackingController.trackOrder);

module.exports = router;
