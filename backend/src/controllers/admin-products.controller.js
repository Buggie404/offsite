const Product = require('../models/Product');
const { vnDateKey } = require('../services/pantry.logic');

function parseBatchDate(value) {
  if (value == null || value === '') return { date: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'batch_expiry_date must be YYYY-MM-DD' };
  }
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return { error: 'batch_expiry_date is invalid' };
  return { date };
}

function presentProduct(product) {
  return {
    product_id: product.product_id,
    name: product.name,
    category: product.category,
    batch_expiry_date: product.batch_expiry_date ? vnDateKey(product.batch_expiry_date) : null,
    batch_expiry_set_at: product.batch_expiry_set_at || null
  };
}

async function listProducts(req, res) {
  try {
    const products = await Product.find({ is_active: true })
      .select('product_id name category batch_expiry_date batch_expiry_set_at')
      .sort({ name: 1 })
      .lean();
    res.json({ data: products.map(presentProduct) });
  } catch (error) {
    console.error('Error listing products for batch expiry:', error);
    res.status(500).json({ error: 'Failed to retrieve products' });
  }
}

async function updateBatchExpiry(req, res) {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ error: 'Invalid product id' });
    }
    const parsed = parseBatchDate(req.body?.batch_expiry_date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const product = await Product.findOne({ product_id: productId });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const previous = presentProduct(product);
    const nextKey = parsed.date ? vnDateKey(parsed.date) : null;
    if (nextKey !== previous.batch_expiry_date) {
      product.batch_expiry_date = parsed.date;
      product.batch_expiry_set_at = parsed.date ? new Date() : null;
      product.updatedAt = new Date().toISOString();
      await req.writeActivityLog({
        actionType: 'product.batch-expiry',
        targetEntity: 'Products',
        targetId: String(product.product_id),
        oldValue: { batch_expiry_date: previous.batch_expiry_date },
        newValue: { batch_expiry_date: nextKey }
      });
      await product.save();
    }

    res.json({ data: presentProduct(product) });
  } catch (error) {
    console.error('Error updating batch expiry:', error);
    res.status(500).json({ error: 'Failed to update batch expiry' });
  }
}

module.exports = { listProducts, updateBatchExpiry };
