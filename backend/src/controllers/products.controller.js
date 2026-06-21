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
    
    const products = await Product.find(filter);
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to retrieve products' });
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
  getProductById
};
