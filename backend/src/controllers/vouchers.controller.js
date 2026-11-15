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
      // Vouchers that cost points are redeemed in Rewards first, so checkout never suggests them.
      $and: [PUBLIC_VOUCHER, tierClause(shopper?.membership_tier), { $or: [{ points_cost: null }, { points_cost: { $lte: 0 } }, { points_cost: { $exists: false } }] }]
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

// Cart and checkout price a voucher here; the client only shows the result.
// Body: { code, items: [{ product_id, variant_id, quantity, unit_price | subtotal, purchase_type, from_quiz_bundle }], shipping_method }
async function quoteVoucher(req, res) {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Voucher code is required' });
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
    const shopper = await resolveShopper(req.user);
    const lines = await voucherService.describeCartLines(items);
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const result = await voucherService.validateAndCalculateVoucher({
      code,
      subtotal,
      shippingMethod: req.body?.shipping_method || 'standard',
      userId: shopper?.user_id || null,
      userTier: shopper?.membership_tier || null,
      lines
    });
    const quoteLines = (result.lines || []).map((line) => ({
      key: line.key,
      product_id: line.product_id,
      variant_id: line.variant_id,
      eligible: line.eligible,
      reason: line.reason
    }));
    if (!result.isValid) {
      return res.status(result.voucher ? 400 : 404).json({
        error: result.error,
        code: result.code || null,
        missing: result.missing ?? null,
        eligible_subtotal: result.eligibleSubtotal ?? null,
        lines: quoteLines
      });
    }
    const voucher = result.voucher.toObject ? result.voucher.toObject() : result.voucher;
    res.json({
      voucher,
      discount_amount: result.discountAmount,
      eligible_subtotal: result.eligibleSubtotal,
      applies_to: voucher.applies_to || 'all',
      lines: quoteLines
    });
  } catch (error) {
    console.error('Error quoting voucher:', error);
    res.status(500).json({ error: 'Failed to check voucher' });
  }
}

module.exports = {
  quoteVoucher,
  getAllVouchers,
  getVoucherByCode
};
