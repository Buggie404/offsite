const { ObjectId } = require('mongodb');
const { getCollections } = require('../config/db');
const {
  mergeGuestCartIntoUser,
  getUserCart,
  replaceUserCart
} = require('../services/cart-merge.service');

// The JWT carries user_id = Mongo _id, but carts are keyed by the app user_id
// string (e.g. "USR00002"). Resolve the latter from the authenticated user.
async function resolveUserIdString(reqUser) {
  if (!reqUser) return null;
  const { userCollection } = await getCollections();

  let query = null;
  if (reqUser.user_id && ObjectId.isValid(String(reqUser.user_id))) {
    query = { _id: new ObjectId(String(reqUser.user_id)) };
  } else if (reqUser.email) {
    query = { email: reqUser.email };
  }
  if (!query) return null;

  const user = await userCollection.findOne(query);
  return user ? user.user_id : null;
}

// POST /api/cart/merge  (authenticated)
// Body: { items: [{ product_id, variantSku, quantity }] }  (guest localStorage cart)
// Used by the OAuth flow, which can't carry the cart through the redirect callback.
async function mergeCart(req, res) {
  try {
    const userIdStr = await resolveUserIdString(req.user);
    if (!userIdStr) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }

    const guestItems = req.body.items || req.body.guestCart || [];
    const merged = await mergeGuestCartIntoUser(userIdStr, guestItems);

    return res.json({ merged: !!merged, cart: merged });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// GET /api/cart  (authenticated) — the logged-in user's current DB cart.
async function getCart(req, res) {
  try {
    const userIdStr = await resolveUserIdString(req.user);
    if (!userIdStr) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    const cart = await getUserCart(userIdStr);
    return res.json({ cart });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// PUT /api/cart  (authenticated) — live-sync: overwrite the user's DB cart.
// Body: { items: [{ product_id, variantSku, quantity, selected }] }
async function replaceCart(req, res) {
  try {
    const userIdStr = await resolveUserIdString(req.user);
    if (!userIdStr) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    const items = req.body.items || [];
    const cart = await replaceUserCart(userIdStr, items);
    return res.json({ cart });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = { mergeCart, getCart, replaceCart };
