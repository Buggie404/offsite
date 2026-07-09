const express = require('express');
const router = express.Router();
const multer = require('multer');
const postsController = require('../controllers/posts.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');


const upload = multer();

// Public routes (optionalAuthMiddleware: biết user nếu có đăng nhập, nhưng không bắt buộc)
router.get('/', optionalAuthMiddleware, postsController.getAllPosts);
router.get('/:id', optionalAuthMiddleware, postsController.getPostById);

// Protected routes
router.post('/', authMiddleware, upload.none(), postsController.createPost);
router.put('/:id', authMiddleware, upload.none(), postsController.updatePost);
router.delete('/:id', authMiddleware, postsController.deletePost);
router.post('/:id/like', authMiddleware, postsController.likePost);
router.post('/:id/save', authMiddleware, postsController.savePost);

module.exports = router;