const Product = require('../models/Product');

// Order lines store product_id as the Product _id string (same as Carts);
// older records use the numeric product_id.
function productMatch(productId) {
  const id = String(productId ?? '');
  if (/^[0-9a-f]{24}$/i.test(id)) return { _id: id };
  if (/^\d+$/.test(id)) return { product_id: Number(id) };
  return null;
}

async function findProduct(productId) {
  const match = productMatch(productId);
  return match ? Product.findOne(match).lean() : null;
}

// One entry per product + variant, so a variant bought both alone and inside a bundle
// is checked and reserved against its stock once, with the summed quantity.
function groupLines(items) {
  const groups = new Map();
  for (const item of items || []) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const key = `${item.product_id}::${item.variant_id}`;
    const group = groups.get(key);
    if (group) group.quantity += qty;
    else groups.set(key, { product_id: String(item.product_id), variant_id: item.variant_id, quantity: qty });
  }
  return [...groups.values()];
}

// Atomically takes each line's quantity off variants[].stock. All-or-nothing: when one
// line lacks stock the lines already taken are put back and that line is returned.
// $elemMatch keeps the sku and stock conditions on the same variant.
async function reserveItems(items, session = null) {
  const reserved = [];
  for (const line of groupLines(items)) {
    const match = productMatch(line.product_id);
    const result = match && await Product.updateOne(
      { ...match, variants: { $elemMatch: { sku: line.variant_id, stock: { $gte: line.quantity } } } },
      { $inc: { 'variants.$.stock': -line.quantity } },
      { session }
    );
    if (!result || result.modifiedCount !== 1) {
      await releaseItems(reserved, session);
      return { ok: false, failed: line };
    }
    reserved.push(line);
  }
  return { ok: true };
}

// Puts quantities back on variants[].stock (cancelled, discarded or refunded orders).
// Never throws: a line that can't be restocked is logged and the rest still go back.
async function releaseItems(items, session = null) {
  for (const line of groupLines(items)) {
    const match = productMatch(line.product_id);
    if (!match) continue;
    try {
      await Product.updateOne(
        { ...match, 'variants.sku': line.variant_id },
        { $inc: { 'variants.$.stock': line.quantity } },
        { session }
      );
    } catch (err) {
      console.error(`Error restocking ${line.product_id}/${line.variant_id}:`, err);
    }
  }
}

module.exports = {
  findProduct,
  groupLines,
  reserveItems,
  releaseItems
};
