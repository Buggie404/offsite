const express = require('express');
const router = express.Router();
const multer = require('multer');
const postsController = require('../controllers/posts.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');

// upload.none(): request là multipart/form-data nhưng không có file thật nào
// (ảnh/video đã upload thẳng lên Cloudinary từ frontend, backend chỉ nhận URL qua field "media")
// -> cần multer để Express parse được các field text (content, base, media...) vào req.body
const upload = multer();

// Public routes (optionalAuthMiddleware: biết user nếu có đăng nhập, nhưng không bắt buộc)
router.get('/', optionalAuthMiddleware, postsController.getAllPosts);
router.get('/:id', optionalAuthMiddleware, postsController.getPostById);

// Protected routes
router.post('/', authMiddleware, upload.none(), postsController.createPost);
router.put('/:id', authMiddleware, upload.none(), postsController.updatePost);
router.delete('/:id', authMiddleware, postsController.deletePost);
router.post('/:id/like', authMiddleware, postsController.likePost);

module.exports = router;