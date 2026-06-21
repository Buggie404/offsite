const express = require('express');
const router = express.Router();
const recipesController = require('../controllers/recipes.controller');

router.get('/', recipesController.getAllRecipes);
router.get('/:slugOrId', recipesController.getRecipeBySlugOrId);

module.exports = router;
