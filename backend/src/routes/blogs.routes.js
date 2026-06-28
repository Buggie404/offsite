const express = require('express');
const router = express.Router();
const blogsController = require('../controllers/blogs.controller');

router.get('/', blogsController.getAllBlogs);
router.get('/:slug', blogsController.getBlogBySlug);

module.exports = router;
