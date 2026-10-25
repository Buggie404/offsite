const Order = require('../models/Order');

// Kế thừa đơn khách vãng lai: when a guest registers with the email / phone they used at
// checkout (Orders.delivery_info) and verifies it by OTP, their guest orders move to the
// new account so Order history shows them. Only the verified contact is matched — an
// unverified phone typed at sign-up must not claim someone else's orders.

// Older checkouts stored this placeholder when the customer left email blank.
const PLACEHOLDER_EMAIL = 'guest@example.com';

// Local Vietnamese form: digits only, +84 / 84 → 0.
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findGuestOrders({ email, phone }) {
  const or = [];
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && normalizedEmail !== PLACEHOLDER_EMAIL) {
    or.push({ 'delivery_info.email': { $regex: `^\\s*${escapeRegex(normalizedEmail)}\\s*$`, $options: 'i' } });
  }
  const localPhone = phone ? normalizePhone(phone) : '';
  if (localPhone.length >= 9) {
    // Stored mobiles may carry spaces, dots or +84: match the last 9 digits with any separators,
    // then compare the normalized number exactly below.
    const tail = localPhone.slice(-9).split('').join('\\D*');
    or.push({ 'delivery_info.mobile': { $regex: `${tail}\\D*$` } });
  }
  if (!or.length) return [];

  const candidates = await Order.find({ is_guest: true, user_id: null, $or: or })
    .select('order_id delivery_info.email delivery_info.mobile').lean();
  return candidates.filter(o =>
    (normalizedEmail && String(o.delivery_info?.email || '').trim().toLowerCase() === normalizedEmail)
    || (localPhone && normalizePhone(o.delivery_info?.mobile) === localPhone)
  );
}

// Returns the order_ids moved to the account.
async function linkGuestOrders(userId, { email = null, phone = null } = {}) {
  const orders = await findGuestOrders({ email, phone });
  if (!orders.length) return [];
  const orderIds = orders.map(o => o.order_id);
  await Order.updateMany(
    { order_id: { $in: orderIds }, is_guest: true, user_id: null },
    {
      $set: {
        is_guest: false,
        user_id: userId,
        session_id: null,
        linked_from_guest_at: new Date()
      }
    }
  );
  return orderIds;
}

module.exports = { linkGuestOrders, normalizePhone };
