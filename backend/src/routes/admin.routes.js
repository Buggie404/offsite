const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const authController = require('../controllers/auth.controller');
const {
  authMiddleware,
  requireRole,
  ADMIN_ORDER_VIEW_ROLES,
  ADMIN_ORDER_MANAGE_ROLES
} = require('../middleware/auth.middleware');

router.post('/login', authController.adminLogin);

router.get('/orders', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminController.getAllOrders);
router.get('/orders/:id', authMiddleware, requireRole(...ADMIN_ORDER_VIEW_ROLES), adminController.getOrderById);
router.put('/orders/:id/status', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminController.updateOrderStatus);
router.post('/orders/:id/refund/approve', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminController.approveRefundRequest);
router.post('/orders/:id/refund/reject', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminController.rejectRefundRequest);
router.post('/orders/:id/notes', authMiddleware, requireRole(...ADMIN_ORDER_MANAGE_ROLES), adminController.addInternalNote);

// ── DEV ONLY: Fix admin roles in DB ────────────────────────────────────
// Gọi POST /api/admin/dev/fix-admin-roles để update role trong DB
// Xóa endpoint này sau khi chạy xong
if (process.env.NODE_ENV !== 'production') {
  const bcrypt = require('bcrypt');
  const { getCollections } = require('../config/db');

  router.post('/dev/fix-admin-roles', async (req, res) => {
    try {
      const { userCollection } = await getCollections();
      const results = [];

      // Map: email → đúng role thực tế
      const fixes = [
        { email: 'senioradmin@example.com', correctRole: 'admin_cc', password: 'SeniorAdmin123', profile_name: 'Senior Admin' },
        { email: 'salesops@example.com', correctRole: 'qlsp', password: 'SalesOps123', profile_name: 'Sales Ops' },
        { email: 'servicesops@example.com', correctRole: 'cskh', password: 'ServicesOps123', profile_name: 'Services Ops' }
      ];

      for (const fix of fixes) {
        const existing = await userCollection.findOne({ email: fix.email });
        if (existing) {
          // Update role
          await userCollection.updateOne(
            { email: fix.email },
            { $set: { role: fix.correctRole, updatedAt: new Date() } }
          );
          results.push({ email: fix.email, status: 'updated', oldRole: existing.role, newRole: fix.correctRole });
        } else {
          // Tạo mới nếu chưa có
          const password_hash = await bcrypt.hash(fix.password, 10);
          const lastUser = await userCollection.findOne({}, { sort: { user_id: -1 } });
          let nextNum = 1;
          if (lastUser?.user_id) {
            const match = lastUser.user_id.match(/USR(\d+)/);
            if (match) nextNum = parseInt(match[1], 10) + 1;
          }
          const user_id = `USR${String(nextNum).padStart(5, '0')}`;

          await userCollection.insertOne({
            user_id,
            email: fix.email,
            password_hash,
            profile_name: fix.profile_name,
            role: fix.correctRole,
            status: 'active',
            addresses: [],
            payment_methods: [],
            saved_products: [],
            saved_recipes: [],
            saved_posts: [],
            saved_blogs: [],
            createdAt: new Date(),
            updatedAt: new Date()
          });
          results.push({ email: fix.email, status: 'created', role: fix.correctRole });
        }
      }

      res.json({ message: 'Done', results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = router;
