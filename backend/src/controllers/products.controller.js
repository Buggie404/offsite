const Product = require('../models/Product');
const mongoose = require('mongoose');

async function getAllProducts(req, res) {
  try {
    const filter = { is_active: true };
    
    if (req.query.category) {
      filter.category = req.query.category;
    }
    if (req.query.pricing_tier) {
      filter['matcha.pricing_tier'] = req.query.pricing_tier;
    }
    
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 0, 0), 100);
    const sort = req.query.sort === 'total_sold_quantity'
      ? { total_sold_quantity: -1, product_id: 1 }
      : {};

    const products = await Product.find(filter).sort(sort);
    const availabilitySorted = products.sort((a, b) =>
      Number(isProductOutOfStock(a)) - Number(isProductOutOfStock(b))
    );

    res.json(limit > 0 ? availabilitySorted.slice(0, limit) : availabilitySorted);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to retrieve products' });
  }
}

function isProductOutOfStock(product) {
  return product.variants.length === 0
    || product.variants.every(variant => (variant.stock ?? 0) <= 0);
}

async function getProductCategoryCounts(req, res) {
  try {
    const groupedCounts = await Product.aggregate([
      { $match: { is_active: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    const categoryCounts = {
      matcha: 0,
      coffee: 0,
      tools: 0,
      drinkware: 0,
      sets_bundles: 0
    };

    groupedCounts.forEach(({ _id, count }) => {
      if (Object.prototype.hasOwnProperty.call(categoryCounts, _id)) {
        categoryCounts[_id] = count;
      }
    });

    res.json(categoryCounts);
  } catch (error) {
    console.error('Error fetching product category counts:', error);
    res.status(500).json({ error: 'Failed to retrieve product category counts' });
  }
}

async function getProductById(req, res) {
  try {
    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: id }
      : {
          $or: [
            { slug: id },
            ...(Number.isFinite(Number(id)) ? [{ product_id: Number(id) }] : [])
          ]
        };

    const product = await Product.findOne(query);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    console.error('Error fetching product by ID:', error);
    res.status(500).json({ error: 'Failed to retrieve product' });
  }
}

module.exports = {
  getAllProducts,
  getProductCategoryCounts,
  getProductById
};
