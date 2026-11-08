const Recipe = require('../models/Recipe');

// The homepage rail used to take the 10 most-saved published recipes.
// The first time featured is introduced, that same set is marked featured
// so the homepage does not change until an admin edits the list.
const HOMEPAGE_FEATURED_LIMIT = 10;

let featuredMigrated = false;

async function ensureFeaturedRecipes() {
  if (featuredMigrated) return false;
  const legacy = await Recipe.exists({ featured: { $exists: false } });
  if (!legacy) {
    featuredMigrated = true;
    return false;
  }

  const current = await Recipe.find({ published: true })
    .sort({ saves: -1, recipe_id: 1 })
    .limit(HOMEPAGE_FEATURED_LIMIT)
    .select('_id');
  const ids = current.map((recipe) => recipe._id);
  if (ids.length) {
    await Recipe.updateMany({ _id: { $in: ids } }, { $set: { featured: true } });
  }
  await Recipe.updateMany({ featured: { $exists: false } }, { $set: { featured: false } });
  featuredMigrated = true;
  return true;
}

module.exports = { ensureFeaturedRecipes, HOMEPAGE_FEATURED_LIMIT };
