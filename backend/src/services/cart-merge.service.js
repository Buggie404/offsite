const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

// Resolve a guest cart line to its current Product + variant in the DB.
// productId matches Cart.product_id (Product._id string). Falls back to the
// numeric product_id field when the frontend sent that instead of _id.
async function resolveProductVariant(productId, sku, bundle) {
  if (productId == null || !sku) return null;

  if (String(productId).startsWith('kit_bundle_') || (bundle && bundle.bundleKey)) {
    const b = bundle || {};
    const mockProduct = {
      _id: productId,
      product_id: 999902,
      name: b.title || 'Kit Bundle',
      slug: productId,
      category: 'sets_bundles',
      variant_type: 'none',
      images: [
        {
          url: b.displayImage || '',
          public_id: productId,
          sort_order: 0
        }
      ],
      variants: [
        {
          sku: sku,
          label: b.purchaseType || 'one_time',
          price: b.discountedTotal || 0,
          stock: 9999, // default virtual stock
          is_default: true,
          images: [
            {
              url: b.displayImage || '',
              public_id: productId,
              sort_order: 0
            }
          ]
        }
      ],
      review_count: 0,
      is_active: true
    };
    const mockVariant = mockProduct.variants[0];
    return { product: mockProduct, variant: mockVariant };
  }

  let product = null;
  if (mongoose.Types.ObjectId.isValid(String(productId))) {
    product = await Product.findById(String(productId));
  }
  if (!product && /^\d+$/.test(String(productId))) {
    product = await Product.findOne({ product_id: Number(productId) });
  }
  if (!product) return null;

  const variant = (product.variants || []).find(v => v.sku === sku);
  if (!variant) return null;

  return { product, variant };
}

// Sequential cart_id like the seed (CRT00000, CRT00001, ...).
async function nextCartId() {
  const last = await Cart.findOne({}).sort({ cart_id: -1 }).select('cart_id').lean();
  let n = 0;
  if (last && last.cart_id) {
    const m = String(last.cart_id).match(/CRT(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `CRT${String(n).padStart(5, '0')}`;
}

// Cap to stock only when the variant is purchasable. Out-of-stock items
// (stock <= 0) keep their quantity and simply render as out of stock.
function capQuantity(qty, stock) {
  if (stock > 0) return Math.min(qty, stock);
  return qty;
}

// Return the merged cart in the frontend CartItem shape so the client can
// overwrite its localStorage cart directly.
async function enrichCart(cart) {
  const items = [];
  for (const it of cart.items) {
    const resolved = await resolveProductVariant(it.product_id, it.variant_id, it.bundle);
    if (!resolved) continue; // product/variant no longer exists -> drop
    items.push({
      product: resolved.product,
      variantSku: it.variant_id,
      quantity: it.quantity,
      selected: it.is_selected,
      bundle: it.bundle || undefined
    });
  }
  return { cart_id: cart.cart_id, items };
}

/**
 * Merge a guest cart (localStorage payload) into a logged-in user's DB cart.
 * One-way only (guest -> user). Activated only when the guest cart has items.
 *
 * @param {string} userId  App user_id string (e.g. "USR00002") — how carts are keyed.
 * @param {Array<{product_id:string|number, variantSku:string, quantity:number}>} guestItems
 * @returns {Promise<{cart_id:string, items:Array}|null>} merged cart, or null when no merge happened.
 */
async function mergeGuestCartIntoUser(userId, guestItems) {
  if (!userId) return null;

  const incoming = Array.isArray(guestItems) ? guestItems : [];
  const cart = await Cart.findOne({ user_id: userId });

  // Rule: only merge when the guest cart actually has items. With no guest
  // items there is nothing to merge — just return the user's own DB cart so
  // the client can still hydrate it on login.
  if (incoming.length === 0) {
    return cart ? enrichCart(cart) : { cart_id: null, items: [] };
  }

  // Working copy of the user's current items (empty when user cart is empty/absent).
  const working = cart ? cart.items.map(i => i.toObject()) : [];

  for (const g of incoming) {
    const resolved = await resolveProductVariant(g.product_id, g.variantSku, g.bundle);
    if (!resolved) continue; // deleted product/variant -> skip

    const { product, variant } = resolved;
    const pid = product._id.toString();
    const sku = variant.sku;
    const stock = variant.stock ?? 0;
    const addQty = Math.max(1, Number(g.quantity) || 1);

    const idx = working.findIndex(w => w.product_id === pid && w.variant_id === sku);
    if (idx > -1) {
      // Same product + same variant -> cộng dồn (cap to stock).
      working[idx].quantity = capQuantity(working[idx].quantity + addQty, stock);
      working[idx].price_at_add = variant.price; // latest price
      working[idx].is_selected = true;
      if (g.bundle) {
        working[idx].bundle = g.bundle;
      }
    } else {
      // Different product, or same product but different variant -> new line.
      working.push({
        product_id: pid,
        variant_id: sku,
        quantity: capQuantity(addQty, stock),
        price_at_add: variant.price,
        is_selected: true,
        bundle: g.bundle || null,
        added_at: new Date()
      });
    }
  }

  let saved;
  if (!cart) {
    // User cart empty/absent -> ownership transfer: create the user cart.
    saved = new Cart({
      cart_id: await nextCartId(),
      user_id: userId,
      session_id: null,
      items: working,
      expires_at: null
    });
  } else {
    cart.items = working;
    cart.expires_at = null;
    saved = cart;
  }
  await saved.save();

  return enrichCart(saved);
}

// Return the logged-in user's current DB cart (enriched), or empty.
async function getUserCart(userId) {
  if (!userId) return null;
  const cart = await Cart.findOne({ user_id: userId });
  return cart ? enrichCart(cart) : { cart_id: null, items: [] };
}

/**
 * Overwrite the logged-in user's DB cart with the given items. This is the
 * live-sync path: while logged in, every cart mutation (add / edit variant /
 * change quantity / remove) replaces the server cart so it stays authoritative
 * across logout -> login. Validates each line against the current product
 * (skips deleted products, caps to stock, refreshes price).
 *
 * @param {string} userId
 * @param {Array<{product_id, variantSku, quantity, selected?}>} items
 */
async function replaceUserCart(userId, items) {
  if (!userId) return null;
  const incoming = Array.isArray(items) ? items : [];

  const byKey = new Map(); // dedupe by product+variant, last wins
  for (const g of incoming) {
    const resolved = await resolveProductVariant(g.product_id, g.variantSku, g.bundle);
    if (!resolved) continue; // deleted product/variant -> drop

    const { product, variant } = resolved;
    const stock = variant.stock ?? 0;
    byKey.set(`${product._id}::${variant.sku}`, {
      product_id: product._id.toString(),
      variant_id: variant.sku,
      quantity: capQuantity(Math.max(1, Number(g.quantity) || 1), stock),
      price_at_add: variant.price,
      is_selected: g.selected !== undefined ? !!g.selected : true,
      bundle: g.bundle || null,
      added_at: new Date()
    });
  }
  const finalItems = [...byKey.values()];

  let cart = await Cart.findOne({ user_id: userId });
  if (!cart) {
    cart = new Cart({
      cart_id: await nextCartId(),
      user_id: userId,
      session_id: null,
      items: finalItems,
      expires_at: null
    });
  } else {
    cart.items = finalItems;
    cart.expires_at = null;
  }
  await cart.save();

  return enrichCart(cart);
}

module.exports = {
  mergeGuestCartIntoUser,
  getUserCart,
  replaceUserCart,
  resolveProductVariant
};
