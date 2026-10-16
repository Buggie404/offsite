const { Schema, model } = require('mongoose');

const AdminActivitySchema = new Schema({
  admin_id: { type: String, required: true }, // reference to Users.user_id
  role: { type: String, required: true },
  action: { type: String, required: true }, // e.g., 'GET /admin/orders'
  method: { type: String, required: true },
  ip: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = model('AdminActivity', AdminActivitySchema);
