const express = require('express');
const router = express.Router();
const multer = require('multer');
const postsController = require('../controllers/posts.controller');
const postProducts = require('../controllers/post-products.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');


const upload = multer();

// Public routes (optionalAuthMiddleware: biết user nếu có đăng nhập, nhưng không bắt buộc)
router.get('/product-search', postProducts.searchProducts); // phải đứng trước '/:id'
router.get('/', optionalAuthMiddleware, postsController.getAllPosts);
router.get('/:id', optionalAuthMiddleware, postsController.getPostById);

// Protected routes
router.post('/product-suggestions', authMiddleware, postProducts.suggestProducts);
router.post('/', authMiddleware, upload.none(), postsController.createPost);
router.put('/:id', authMiddleware, upload.none(), postsController.updatePost);
router.delete('/:id', authMiddleware, postsController.deletePost);
router.post('/:id/like', authMiddleware, postsController.likePost);
router.post('/:id/save', authMiddleware, postsController.savePost);
router.post('/:id/share', authMiddleware, postsController.sharePost); // NEW: wires up sharePost so share_count actually increments
router.post('/:id/report', authMiddleware, postsController.reportPost);

module.exports = router;