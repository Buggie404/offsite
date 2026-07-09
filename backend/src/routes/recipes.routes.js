const express = require('express');
const router = express.Router();
const multer = require('multer');
const recipesController = require('../controllers/recipes.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

const upload = multer();

router.get('/', recipesController.getAllRecipes);
router.get('/:slugOrId', recipesController.getRecipeBySlugOrId);

router.post('/', authMiddleware, upload.none(), recipesController.createRecipe);

module.exports = router;
