const Voucher = require('../models/Voucher');

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

    const voucher = await Voucher.findOne({ 
      code: code.toUpperCase(),
      is_active: true 
    });

    if (!voucher) {
      return res.status(404).json({ error: 'Voucher not found or inactive' });
    }

    // Optional check: validity dates
    const now = new Date().toISOString();
    if (voucher.valid_from && now < voucher.valid_from) {
      return res.status(400).json({ error: 'Voucher is not active yet' });
    }
    if (voucher.valid_to && now > voucher.valid_to) {
      return res.status(400).json({ error: 'Voucher has expired' });
    }
    if (voucher.usage_limit && voucher.used_count >= voucher.usage_limit) {
      return res.status(400).json({ error: 'Voucher usage limit reached' });
    }

    res.json(voucher);
  } catch (error) {
    console.error('Error fetching voucher by code:', error);
    res.status(500).json({ error: 'Failed to retrieve voucher' });
  }
}

module.exports = {
  getAllVouchers,
  getVoucherByCode
};
