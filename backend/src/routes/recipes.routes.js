const express = require('express');
const router = express.Router();
const multer = require('multer');
const recipesController = require('../controllers/recipes.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth.middleware');
const { requireCommunityAccess } = require('../middleware/community-restriction.middleware');

const upload = multer();

router.get('/', recipesController.getAllRecipes);
router.get('/:slugOrId', optionalAuthMiddleware, recipesController.getRecipeBySlugOrId);

router.post('/', authMiddleware, requireCommunityAccess('write'), upload.none(), recipesController.createRecipe);
router.put('/:recipeId', authMiddleware, requireCommunityAccess('write'), upload.none(), recipesController.updateOwnRecipe);
router.delete('/:recipeId', authMiddleware, requireCommunityAccess('write'), recipesController.deleteOwnRecipe);
router.post('/:recipeId/submit-for-review', authMiddleware, requireCommunityAccess('write'), recipesController.submitForReview);

module.exports = router;
