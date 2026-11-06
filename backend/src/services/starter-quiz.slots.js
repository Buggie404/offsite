function variantPrice(product) {
  const variants = product?.variants || [];
  const priced = variants.find((variant) => variant.is_default) || variants[0];
  return priced ? Number(priced.price) || 0 : 0;
}

function inStockVariant(product) {
  const variants = (product?.variants || []).filter((variant) => (variant.stock ?? 0) > 0);
  return variants.find((variant) => variant.is_default) || variants[0] || null;
}

function inStock(product) {
  return !!inStockVariant(product);
}

function attributeText(product) {
  return [
    product.name,
    product.matcha?.product_grade,
    product.coffee?.roast_level,
    product.tools?.tool_type,
    product.tools?.tool_category,
    product.drinkware?.ware_type,
    product.drinkware?.product_size
  ].filter(Boolean).join(' ').toLowerCase();
}

function slotMatches(product, slot) {
  if (!product || product.is_active === false || product.quiz_eligible === false) return false;
  if (slot.category && product.category !== slot.category) return false;
  const attribute = String(slot.attribute || '').trim().toLowerCase();
  if (attribute && !attribute.startsWith('any')) {
    const wanted = attribute.replace(/^type:\s*/, '').trim();
    if (wanted && !attributeText(product).includes(wanted)) return false;
  }
  const constraint = String(slot.constraint || '');
  const priceCap = constraint.match(/price\s*[≤<]=?\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (priceCap && variantPrice(product) > Number(priceCap[1])) return false;
  const sizeCap = constraint.match(/size\s*[≤<]=?\s*(\d+(?:\.\d+)?)\s*g/i);
  if (sizeCap) {
    const size = attributeText(product).match(/(\d+(?:\.\d+)?)\s*g/);
    if (size && Number(size[1]) > Number(sizeCap[1])) return false;
  }
  return true;
}

function bestInStock(products) {
  return [...products].filter(inStock).sort((a, b) => {
    const sold = (b.total_sold_quantity || 0) - (a.total_sold_quantity || 0);
    if (sold) return sold;
    return variantPrice(a) - variantPrice(b);
  })[0] || null;
}

function annotateSlot(slot, products) {
  const matches = products.filter((product) => slotMatches(product, slot));
  const stocked = matches.filter(inStock);
  const prices = (stocked.length ? stocked : matches).map(variantPrice).filter((price) => price > 0);
  return {
    ...slot,
    match_count: matches.length,
    stock_count: stocked.length,
    min_price: prices.length ? Math.min(...prices) : 0,
    max_price: prices.length ? Math.max(...prices) : 0,
    pick: bestInStock(matches)
  };
}

module.exports = {
  variantPrice,
  inStockVariant,
  inStock,
  slotMatches,
  bestInStock,
  annotateSlot
};
