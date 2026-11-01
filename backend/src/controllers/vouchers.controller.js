const Voucher = require('../models/Voucher');
const User = require('../models/User');
const voucherService = require('../services/voucher.service');

const PUBLIC_VOUCHER = {
  $or: [
    { assigned_user_id: null },
    { assigned_user_id: { $exists: false } },
    { assigned_user_id: '' }
  ]
};

async function resolveShopper(reqUser) {
  if (!reqUser?.user_id) return null;
  const id = String(reqUser.user_id);
  const query = /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { user_id: id };
  return User.findOne(query, 'user_id membership_tier').lean();
}

function tierClause(tier) {
  const open = [{ target_tier: null }, { target_tier: { $exists: false } }, { target_tier: '' }];
  if (!tier) return { $or: open };
  return { $or: [...open, { target_tier: String(tier).toLowerCase() }] };
}

async function getAllVouchers(req, res) {
  try {
    const shopper = await resolveShopper(req.user);
    const vouchers = await Voucher.find({
      is_active: true,
      $and: [PUBLIC_VOUCHER, tierClause(shopper?.membership_tier)]
    });
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
    const shopper = await resolveShopper(req.user);

    const result = await voucherService.validateAndCalculateVoucher({
      code,
      subtotal,
      shippingMethod,
      userId: shopper?.user_id || null,
      userTier: shopper?.membership_tier || null
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
