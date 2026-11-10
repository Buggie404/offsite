const CACHE_MS = 30_000;

let cached = null;
let pending = null;

function variantPrice(product) {
  if (product && product._quizPrice != null) return product._quizPrice;
  const variants = product?.variants || [];
  const priced = variants.find((variant) => variant.is_default) || variants[0];
  const price = priced ? Number(priced.price) || 0 : 0;
  if (product) product._quizPrice = price;
  return price;
}

function inStockVariant(product) {
  const variants = (product?.variants || []).filter((variant) => (variant.stock ?? 0) > 0);
  return variants.find((variant) => variant.is_default) || variants[0] || null;
}

function inStock(product) {
  if (product && product._quizStocked != null) return product._quizStocked;
  const stocked = !!inStockVariant(product);
  if (product) product._quizStocked = stocked;
  return stocked;
}

function attributeText(product) {
  if (product && product._quizAttr != null) return product._quizAttr;
  const text = [
    product?.name,
    product?.matcha?.product_grade,
    product?.coffee?.roast_level,
    product?.tools?.tool_type,
    product?.tools?.tool_category,
    product?.drinkware?.ware_type,
    product?.drinkware?.product_size
  ].filter(Boolean).join(' ').toLowerCase();
  if (product) product._quizAttr = text;
  return text;
}

function prepareProduct(product) {
  attributeText(product);
  variantPrice(product);
  inStock(product);
  return product;
}

function indexProducts(docs) {
  const products = (docs || []).map(prepareProduct);
  const byCategory = new Map();
  for (const product of products) {
    const key = product.category || '';
    const group = byCategory.get(key);
    if (group) group.push(product);
    else byCategory.set(key, [product]);
  }
  return { products, byCategory };
}

function productsForSlot(products, slot) {
  if (products && products.byCategory) {
    if (!slot?.category) return products.products;
    return products.byCategory.get(slot.category) || [];
  }
  return Array.isArray(products) ? products : [];
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
  const pool = productsForSlot(products, slot);
  const matches = [];
  for (let index = 0; index < pool.length; index += 1) {
    if (slotMatches(pool[index], slot)) matches.push(pool[index]);
  }
  const stocked = matches.filter(inStock);
  const priced = stocked.length ? stocked : matches;
  let min = 0;
  let max = 0;
  for (let index = 0; index < priced.length; index += 1) {
    const price = variantPrice(priced[index]);
    if (price <= 0) continue;
    if (!min || price < min) min = price;
    if (price > max) max = price;
  }
  return {
    ...slot,
    match_count: matches.length,
    stock_count: stocked.length,
    min_price: min,
    max_price: max,
    pick: bestInStock(matches)
  };
}

function stockLabel(slots) {
  const list = slots || [];
  const heroEmpty = list.some((slot) => slot.hero && Number(slot.stock_count) === 0);
  if (heroEmpty) return { code: 'hero_oos', label: 'Hero range OOS' };
  const empty = list.some((slot) => Number(slot.stock_count) === 0);
  if (empty) return { code: 'slot_oos', label: 'Range empty' };
  const low = list.filter((slot) => {
    const stock = Number(slot.stock_count) || 0;
    return stock > 0 && stock < 3;
  }).length;
  if (low) return { code: 'range_low', label: low === 1 ? '1 range low' : `${low} range low` };
  return { code: 'ok', label: 'OK' };
}

async function loadProductCatalog(ProductModel) {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.catalog;
  if (pending) return pending;
  pending = ProductModel.find({ is_active: { $ne: false } })
    .select('product_id name slug category product_tag is_active quiz_eligible images variants matcha coffee tools drinkware total_sold_quantity rating_avg')
    .lean()
    .then((docs) => {
      const catalog = indexProducts(docs);
      cached = { at: Date.now(), catalog };
      pending = null;
      return catalog;
    })
    .catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}

module.exports = {
  CACHE_MS,
  variantPrice,
  inStockVariant,
  inStock,
  attributeText,
  indexProducts,
  productsForSlot,
  slotMatches,
  bestInStock,
  annotateSlot,
  stockLabel,
  loadProductCatalog
};
