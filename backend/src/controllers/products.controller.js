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

    let query = Product.find(filter).sort(sort);
    if (limit > 0) query = query.limit(limit);

    const products = await query;
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to retrieve products' });
  }
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid product ID format' });
    }

    const product = await Product.findById(id);
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
