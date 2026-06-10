// Products controller placeholders
async function getAllProducts(req, res) {
  res.json({ message: 'Products list placeholder' });
}

async function getProductById(req, res) {
  res.json({ message: 'Product detail placeholder' });
}

module.exports = {
  getAllProducts,
  getProductById
};
