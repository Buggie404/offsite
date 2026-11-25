const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

const body = {
  title: 'Iced Oat Matcha', description: 'Creamy and cold', base: 'matcha', serves: ['cold'], difficulty: 'easy',
  ingredients: [{ name: 'matcha', quantity: 2, unit: 'g' }], tools: [{ name: 'whisk' }],
  steps: [{ title: 'Whisk', description: 'Whisk well' }],
  related_products: [10000], hero_image: { url: 'https://img.test/new.png', public_id: 'new' }
};

function setup(recipeFields) {
  const recipe = {
    recipe_id: 'R1', slug: 'old-slug', owner_user_id: 'USR1', heroImage: { url: 'https://img.test/old.png' },
    source: { communityPostId: 'POST1', communityPostTitle: 'Old' }, metadata: {}, ...recipeFields,
    markModified() {}, async save() { this.saved = true; }, toObject() { return { ...this }; }
  };
  const postUpdates = [];
  const api = load('../src/controllers/recipes.controller.js', {
    '../models/Recipe': { findOne: async () => recipe, exists: async () => false },
    '../models/Post': { updateOne: async (filter, update) => { postUpdates.push({ filter, update }); } },
    './cart.controller': { resolveUserIdString: async () => 'USR1' }
  });
  return { api, recipe, postUpdates };
}

test('the author edits the recipe behind a community recipe post and the post follows', async () => {
  const { api, recipe, postUpdates } = setup({ lifecycle: 'community_origin' });
  const res = response();
  await api.updateOwnRecipe({ params: { recipeId: 'R1' }, body, user: { user_id: 'x' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(recipe.title, 'Iced Oat Matcha');
  assert.equal(recipe.slug, 'old-slug', 'origin recipes keep their slug');
  assert.equal(recipe.source.communityPostTitle, 'Iced Oat Matcha');
  assert.ok(recipe.saved);
  const { filter, update } = postUpdates[0];
  assert.deepEqual(filter, { post_id: 'POST1' });
  assert.equal(update.$set.content, 'Creamy and cold');
  assert.deepEqual(update.$set.media, [{ url: 'https://img.test/new.png', public_id: 'new', type: 'image' }]);
  assert.deepEqual(update.$set.linked_products, [10000]);
});

test('someone else cannot edit a community recipe', async () => {
  const { api, recipe } = setup({ lifecycle: 'community_origin', owner_user_id: 'USR2' });
  const res = response();
  await api.updateOwnRecipe({ params: { recipeId: 'R1' }, body, user: { user_id: 'x' } }, res);
  assert.equal(res.statusCode, 403);
  assert.ok(!recipe.saved);
});

test('catalog recipe edits still rename the slug and leave the post caption alone', async () => {
  const { api, recipe, postUpdates } = setup({ lifecycle: 'catalog', origin: { communityPostId: 'POST1' } });
  const res = response();
  await api.updateOwnRecipe({ params: { recipeId: 'R1' }, body, user: { user_id: 'x' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(recipe.slug, 'iced-oat-matcha');
  assert.equal(postUpdates[0].update.$set.content, undefined);
});
