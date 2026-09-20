const Voucher = require('../models/Voucher');
const voucherService = require('../services/voucher.service');

async function getAllVouchers(req, res) {
  try {
    const vouchers = await Voucher.find({ is_active: true });
    res.json(vouchers);
  } catch (error) {
    console.error('Error fetching vouchers:', error);
    res.status(500).json({ error: 'Failed to retrieve vouchers' });
  }
}

async function getVoucherByCode(req, res) {
  try {
    const { code } = req.params;
    if (!code) {
      return res.status(400).json({ error: 'Voucher code is required' });
    }

    const subtotal = Number(req.query.subtotal) || 0;
    const shippingMethod = req.query.shipping_method || 'standard';

    const result = await voucherService.validateAndCalculateVoucher({
      code,
      subtotal,
      shippingMethod
    });

    if (!result.isValid) {
      const statusCode = result.voucher ? 400 : 404;
      return res.status(statusCode).json({ error: result.error });
    }

    res.json(result.voucher);
  } catch (error) {
    console.error('Error fetching voucher by code:', error);
    res.status(500).json({ error: 'Failed to retrieve voucher' });
  }
}

module.exports = {
  getAllVouchers,
  getVoucherByCode
};
