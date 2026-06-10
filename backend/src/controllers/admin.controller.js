// Admin controller placeholders
async function getAllOrders(req, res) {
  res.json({ message: 'Admin all orders list placeholder' });
}

async function updateOrderStatus(req, res) {
  res.json({ message: 'Admin update order status placeholder' });
}

module.exports = {
  getAllOrders,
  updateOrderStatus
};
