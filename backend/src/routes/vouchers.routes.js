const express = require('express');
const router = express.Router();
const vouchersController = require('../controllers/vouchers.controller');

router.get('/', vouchersController.getAllVouchers);
router.get('/:code', vouchersController.getVoucherByCode);

module.exports = router;
