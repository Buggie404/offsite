const Recipe = require('../models/Recipe');
const mongoose = require('mongoose');

async function getAllRecipes(req, res) {
  try {
    const filter = { published: true };

    if (req.query.difficulty) {
      filter['metadata.difficulty'] = req.query.difficulty.toUpperCase();
    }
    
    if (req.query.tag) {
      filter['metadata.tags'] = req.query.tag.toUpperCase();
    }

    if (req.query.source_type) {
      filter['source.type'] = req.query.source_type;
    }

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 0, 0), 100);
    const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
    const sort = req.query.sort === 'saves'
      ? { saves: -1, recipe_id: 1 }
      : {};

    let query = Recipe.find(filter).sort(sort).skip(skip);
    if (limit > 0) query = query.limit(limit);

    const recipes = await query;
    res.json(recipes);
  } catch (error) {
    console.error('Error fetching recipes:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes' });
  }
}

async function getRecipeBySlugOrId(req, res) {
  try {
    const { slugOrId } = req.params;
    if (!slugOrId) {
      return res.status(400).json({ error: 'Recipe identifier is required' });
    }

    let query = {};
    if (mongoose.Types.ObjectId.isValid(slugOrId) && /^[0-9a-fA-F]{24}$/.test(slugOrId)) {
      query = { _id: slugOrId };
    } else if (slugOrId.startsWith('RCP')) {
      query = { recipe_id: slugOrId };
    } else {
      query = { slug: slugOrId };
    }

    const recipe = await Recipe.findOne(query);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.json(recipe);
  } catch (error) {
    console.error('Error fetching recipe:', error);
    res.status(500).json({ error: 'Failed to retrieve recipe' });
  }
}

module.exports = {
  getAllRecipes,
  getRecipeBySlugOrId
};
