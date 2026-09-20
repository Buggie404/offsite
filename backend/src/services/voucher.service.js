const Voucher = require('../models/Voucher');

/**
 * Validates a voucher code against validity dates, usage limits, minimum order amount, and shipping method.
 * Returns an object with { isValid, voucher, discountAmount, error }.
 */
async function validateAndCalculateVoucher({ code, subtotal = 0, shippingMethod = 'standard' }) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    return { isValid: false, voucher: null, discountAmount: 0, error: 'Mã giảm giá không hợp lệ.' };
  }

  const codeUpper = code.trim().toUpperCase();
  const voucher = await Voucher.findOne({ code: codeUpper, is_active: true });

  if (!voucher) {
    return { 
      isValid: false, 
      voucher: null, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" không tồn tại hoặc đã bị ngưng áp dụng.` 
    };
  }

  const now = new Date().toISOString();
  if (voucher.valid_from && now < voucher.valid_from) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" chưa đến thời gian áp dụng.` 
    };
  }
  if (voucher.valid_to && now > voucher.valid_to) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" đã hết hạn.` 
    };
  }
  if (voucher.usage_limit != null && voucher.used_count >= voucher.usage_limit) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Mã giảm giá "${codeUpper}" đã hết lượt sử dụng.` 
    };
  }

  const numSubtotal = Number(subtotal) || 0;
  if (voucher.min_order_amount && numSubtotal < voucher.min_order_amount) {
    return { 
      isValid: false, 
      voucher, 
      discountAmount: 0, 
      error: `Đơn hàng chưa đạt giá trị tối thiểu ($${voucher.min_order_amount}) để áp dụng mã "${codeUpper}".` 
    };
  }

  const shippingCost = shippingMethod === 'express' ? 15 : 0;
  let discountAmount = 0;

  if (voucher.voucher_type === 'discount') {
    if (voucher.discount_type === 'percentage') {
      discountAmount = numSubtotal * (voucher.discount_value / 100);
    } else if (voucher.discount_type === 'fixed') {
      discountAmount = voucher.discount_value;
    }
  } else if (voucher.voucher_type === 'shipping') {
    if (shippingMethod !== 'express') {
      return { 
        isValid: false, 
        voucher, 
        discountAmount: 0, 
        error: `Mã giảm giá vận chuyển "${codeUpper}" chỉ áp dụng cho phương thức Giao hàng Hỏa tốc.` 
      };
    }
    if (voucher.discount_type === 'percentage') {
      discountAmount = shippingCost * (voucher.discount_value / 100);
    } else if (voucher.discount_type === 'fixed') {
      discountAmount = Math.min(voucher.discount_value, shippingCost);
    }
  }

  if (voucher.max_discount_value != null && discountAmount > voucher.max_discount_value) {
    discountAmount = voucher.max_discount_value;
  }
  discountAmount = Math.round(discountAmount * 100) / 100;

  return {
    isValid: true,
    voucher,
    discountAmount,
    error: null
  };
}

/**
 * Atomically increments the used_count of a voucher by 1.
 * Supports passing a Mongoose session for transaction safety.
 */
async function incrementVoucherUsage(voucherId, session = null) {
  const options = session ? { session } : {};
  const updateResult = await Voucher.updateOne(
    {
      _id: voucherId,
      is_active: true,
      $or: [
        { usage_limit: null },
        { $expr: { $lt: ['$used_count', '$usage_limit'] } }
      ]
    },
    { $inc: { used_count: 1 } },
    options
  );

  return updateResult.modifiedCount > 0;
}

module.exports = {
  validateAndCalculateVoucher,
  incrementVoucherUsage
};
