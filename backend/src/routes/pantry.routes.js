const express = require('express');
const { authMiddleware } = require('../middleware/auth.middleware');
const pantry = require('../controllers/pantry.controller');

const router = express.Router();

router.use(authMiddleware);
router.get('/', pantry.showPantry);
router.post('/items', pantry.addManualItem);
router.patch('/items/:id', pantry.updateItem);
router.post('/brew-starts', pantry.startBrew);
router.post('/recipes/hide', pantry.hideRecipes);
router.get('/recipes/:recipeId/coverage', pantry.showRecipeCoverage);
router.post('/recipes/:recipeId/done', pantry.doneRecipe);

module.exports = router;
