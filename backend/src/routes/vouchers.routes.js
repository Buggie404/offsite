const express = require('express');
const router = express.Router();
const vouchersController = require('../controllers/vouchers.controller');
const { optionalAuthMiddleware } = require('../middleware/auth.middleware');

router.get('/', optionalAuthMiddleware, vouchersController.getAllVouchers);
router.post('/quote', optionalAuthMiddleware, vouchersController.quoteVoucher);
router.get('/:code', optionalAuthMiddleware, vouchersController.getVoucherByCode);

module.exports = router;
