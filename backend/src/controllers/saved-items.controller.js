const User = require('../models/User');
const Product = require('../models/Product');
const Recipe = require('../models/Recipe');

async function getSavedItems(req, res) {
  try {
    const user = await User.findById(req.user.user_id)
      .select('saved_products saved_recipes')
      .lean();

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      saved_products: user.saved_products || [],
      saved_recipes: user.saved_recipes || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function toggleSavedProduct(req, res) {
  try {
    const productId = String(req.params.productId);
    const product = await Product.findOne({ product_id: Number(productId), is_active: true })
      .select('product_id')
      .lean();

    if (!product) return res.status(404).json({ error: 'Product not found' });

    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const wasSaved = user.saved_products.some(item => item.product_id === productId);
    if (wasSaved) {
      user.saved_products = user.saved_products.filter(item => item.product_id !== productId);
    } else {
      user.saved_products.push({ product_id: productId, saved_at: new Date() });
    }

    await user.save();
    res.json({ saved: !wasSaved, product_id: productId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function toggleSavedRecipe(req, res) {
  try {
    const recipeId = String(req.params.recipeId);
    const recipe = await Recipe.findOne({ recipe_id: recipeId, published: true })
      .select('recipe_id saves');

    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const wasSaved = user.saved_recipes.some(item => item.recipe_id === recipeId);
    if (wasSaved) {
      user.saved_recipes = user.saved_recipes.filter(item => item.recipe_id !== recipeId);
    } else {
      user.saved_recipes.push({ recipe_id: recipeId, saved_at: new Date() });
    }

    await user.save();

    const increment = wasSaved ? -1 : 1;
    const updatedRecipe = await Recipe.findOneAndUpdate(
      { recipe_id: recipeId },
      [{ $set: { saves: { $max: [0, { $add: [{ $ifNull: ['$saves', 0] }, increment] }] } } }],
      { new: true }
    ).select('saves');

    res.json({
      saved: !wasSaved,
      recipe_id: recipeId,
      saves: updatedRecipe?.saves || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getSavedItems, toggleSavedProduct, toggleSavedRecipe };
