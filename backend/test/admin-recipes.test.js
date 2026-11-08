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
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function query(rows) {
  const chain = {
    sort() { return chain; },
    limit() { return chain; },
    select() { return chain; },
    lean: async () => rows,
    then(resolve, reject) { return Promise.resolve(rows).then(resolve, reject); }
  };
  return chain;
}

test('ensureFeaturedRecipes marks the current homepage set once', async () => {
  const calls = [];
  const homepage = [{ _id: 'a' }, { _id: 'b' }];
  const service = load('../src/services/recipe-featured.js', {
    '../models/Recipe': {
      exists: async () => true,
      find: () => query(homepage),
      updateMany: async (filter, update) => { calls.push({ filter, update }); }
    }
  });

  const seeded = await service.ensureFeaturedRecipes();
  assert.equal(seeded, true);
  assert.deepEqual(calls[0], { filter: { _id: { $in: ['a', 'b'] } }, update: { $set: { featured: true } } });
  assert.deepEqual(calls[1].update, { $set: { featured: false } });
  assert.deepEqual(calls[1].filter, { featured: { $exists: false } });
});

test('ensureFeaturedRecipes leaves an already migrated collection alone', async () => {
  let finds = 0;
  const service = load('../src/services/recipe-featured.js', {
    '../models/Recipe': {
      exists: async () => null,
      find: () => { finds += 1; return query([]); }
    }
  });
  assert.equal(await service.ensureFeaturedRecipes(), false);
  assert.equal(finds, 0);
});

test('brand recipes leave the author line blank and use a small thumbnail', () => {
  const api = load('../src/controllers/admin-recipes.controller.js', {
    '../models/Recipe': {},
    '../models/Post': {},
    '../services/recipe-featured': { ensureFeaturedRecipes: async () => false, HOMEPAGE_FEATURED_LIMIT: 10 }
  });
  const row = api.presentRecipe({
    recipe_id: 'RCP200001',
    title: 'Matcha Latte',
    slug: 'matcha-latte',
    published: true,
    featured: false,
    source: { type: 'Offsite Official', author: 'Offsite Official' },
    relatedProducts: [],
    heroImage: { url: 'https://res.cloudinary.com/hbhhv9rz9/image/upload/f_auto,c_limit,w_3840,q_auto/2025/latte.jpg' },
    updatedAt: '2026-09-28T00:00:00.000Z'
  });

  assert.equal(row.source, 'offsite');
  assert.equal(row.author_line, '');
  assert.equal(
    row.image_url,
    'https://res.cloudinary.com/hbhhv9rz9/image/upload/c_fill,g_auto,w_128,h_128,f_auto,q_auto/2025/latte.jpg'
  );
});

test('updateFeatured rejects a hidden recipe and logs a real change', async () => {
  const logs = [];
  const hidden = {
    recipe_id: 'RCP00001',
    title: 'Hidden cup',
    slug: 'hidden-cup',
    published: false,
    featured: false,
    source: { type: 'offsite', author: 'Offsite team' },
    relatedProducts: [],
    heroImage: { url: 'https://cdn.example/hidden.jpg' },
    updatedAt: '2026-09-28T00:00:00.000Z',
    async save() { this.saved = true; }
  };
  const published = {
    ...hidden,
    recipe_id: 'RCP00002',
    title: 'V60 Morning Pour-over',
    published: true,
    featured: false,
    relatedProducts: ['1', '2', ''],
    source: { type: 'community', creatorName: '@linh.cafe' },
    async save() { this.saved = true; this.featured = true; }
  };
  const api = load('../src/controllers/admin-recipes.controller.js', {
    '../models/Recipe': {
      findOne: async (query) => (query.recipe_id === 'RCP00002' ? published : hidden),
      find: () => query([]),
      updateOne: async () => {}
    },
    '../services/recipe-featured': { ensureFeaturedRecipes: async () => false, HOMEPAGE_FEATURED_LIMIT: 10 },
    '../services/recipe-source': {
      sourceKind: (recipe) => String(recipe.source?.type || '').toLowerCase() === 'community' ? 'community' : 'offsite',
      authorLine: (recipe, communityUsername) => {
        if (String(recipe.source?.type || '').toLowerCase() !== 'community') return '';
        const name = communityUsername || recipe.source?.creatorName || recipe.source?.author;
        return name ? String(name).replace(/^@/, '') : '';
      },
      likeCountByRecipe: async () => ({ likes: new Map(), names: new Map() })
    }
  });

  const denied = response();
  await api.updateFeatured({ params: { recipeId: 'RCP00001' }, body: { featured: true } }, denied);
  assert.equal(denied.statusCode, 400);

  const saved = response();
  await api.updateFeatured({
    params: { recipeId: 'RCP00002' },
    body: { featured: true },
    writeActivityLog: async (entry) => { logs.push(entry); }
  }, saved);
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.data.featured, true);
  assert.equal(saved.body.data.source, 'community');
  assert.equal(saved.body.data.linked, 'not_allowed');
  assert.equal(saved.body.data.author_line, 'linh.cafe');
  assert.equal(logs[0].actionType, 'recipe.feature');
  assert.deepEqual(logs[0].oldValue, { featured: false });
});

test('placeholder catalog recipes stay Offsite and community recipes need 30 likes', () => {
  const source = require('../src/services/recipe-source');
  const placeholder = {
    source: {
      type: 'COMMUNITY',
      communityPostId: 'COMMUNITY_POST_ID_PLACEHOLDER_02',
      communityPostTitle: 'Cherry on Top Latte — Spring Signature'
    }
  };
  const community = { source: { type: 'community', creatorName: '@linh.cafe', author: 'linh.cafe' } };

  assert.equal(source.sourceKind(placeholder), 'offsite');
  assert.equal(source.authorLine(placeholder), '');
  assert.equal(source.visibleInAdmin(placeholder, 0), true);
  assert.equal(source.sourceKind(community), 'community');
  assert.equal(source.authorLine(community), 'linh.cafe');
  assert.equal(source.visibleInAdmin(community, 29), false);
  assert.equal(source.visibleInAdmin(community, 30), true);

  const strayAuthor = { source: { type: 'offsite', author: 'Some other name', creatorName: 'Some other name' } };
  assert.equal(source.sourceKind(strayAuthor), 'offsite');
  assert.equal(source.authorLine(strayAuthor), '');
});

test('catalog prep removes matcha, coffee, and others from serve tags', async () => {
  const updates = [];
  const source = load('../src/services/recipe-source.js', {
    '../models/Recipe': {
      updateMany: async (filter, update) => { updates.push({ filter, update }); },
      find: () => query([]),
      findOne: async () => null
    },
    '../models/Post': { find: () => query([]) }
  });

  await source.prepareRecipeCatalog();
  const strip = updates.find((call) => call.update.$pull);
  assert.ok(strip);
  assert.deepEqual(strip.filter['metadata.tags'].$in, [
    'MATCHA', 'COFFEE', 'OTHERS', 'matcha', 'coffee', 'others',
    'COCKTAIL', 'cocktail', 'ICED', 'iced'
  ]);
  const bases = updates.filter((call) => call.update.$set && call.update.$set['metadata.base']);
  assert.deepEqual(bases.map((call) => call.update.$set['metadata.base']), ['MATCHA', 'COFFEE', 'OTHERS']);
});

test('syncCommunityRecipePublication forks a catalog copy at 30 likes', async () => {
  const created = [];
  const postUpdates = [];
  const slugOwner = new Map([['community-latte', 'RCP01000']]);
  const rememberSlug = (recipeId, slug) => {
    for (const [key, owner] of [...slugOwner.entries()]) {
      if (owner === recipeId) slugOwner.delete(key);
    }
    if (slug) slugOwner.set(slug, recipeId);
  };
  const origin = {
    recipe_id: 'RCP01000',
    title: 'Community Latte',
    slug: 'community-latte',
    description: 'A soft pour',
    heroImage: { url: 'https://cdn.example/a.jpg', public_id: 'a' },
    metadata: { servings: 1, prepTime: 5, cookTime: null, difficulty: 'EASY', base: 'MATCHA', tags: ['HOT'] },
    ingredients: [{ name: 'Matcha', quantity: 2, unit: 'g' }],
    tools: [{ name: 'Whisk' }],
    steps: [{ order: 1, title: 'Whisk', description: 'Froth it' }],
    source: { type: 'community', creatorName: 'bao', author: 'bao', communityPostId: 'PST1' },
    lifecycle: 'community_origin',
    published: false,
    featured: false,
    hiddenByAdmin: false,
    async save() {
      this.saved = true;
      rememberSlug(this.recipe_id, this.slug);
      return this;
    }
  };
  class FakeRecipe {
    constructor(doc) {
      Object.assign(this, doc);
      created.push(this);
      rememberSlug(doc.recipe_id, doc.slug);
    }
    async save() {
      this.saved = true;
      rememberSlug(this.recipe_id, this.slug);
      return this;
    }
  }
  FakeRecipe.findOne = (filter = {}, _projection, options = {}) => {
    const run = async () => {
      if (options?.sort) return { recipe_id: 'RCP00999' };
      if (filter['origin.communityRecipeId']) return null;
      if (filter.recipe_id === 'RCP01000') return origin;
      return null;
    };
    const chain = {
      select() { return chain; },
      lean: async () => run(),
      then(resolve, reject) { return run().then(resolve, reject); }
    };
    return chain;
  };
  FakeRecipe.exists = async (filter = {}) => {
    if (!filter.slug) return false;
    const owner = slugOwner.get(filter.slug);
    if (!owner) return false;
    if (filter.recipe_id?.$ne && owner === filter.recipe_id.$ne) return false;
    return true;
  };
  FakeRecipe.updateOne = async () => ({});
  const source = load('../src/services/recipe-source.js', {
    '../models/Recipe': FakeRecipe,
    '../models/Post': {
      find: () => query([{
        post_id: 'PST1',
        user_id: 'USR1',
        recipe_id: 'RCP01000',
        like_count: 30,
        author: { username: 'bao', avatar_url: null }
      }]),
      updateOne: async (filter, update) => { postUpdates.push({ filter, update }); }
    },
    '../models/User': {
      findOne: () => ({ lean: async () => null })
    }
  });

  await source.syncCommunityRecipePublication('RCP01000');
  assert.equal(created.length, 1);
  assert.equal(created[0].lifecycle, 'catalog');
  assert.equal(created[0].published, true);
  assert.equal(created[0].owner_user_id, 'USR1');
  assert.equal(created[0].origin.communityRecipeId, 'RCP01000');
  assert.equal(created[0].slug, 'community-latte');
  assert.equal(origin.slug, 'community-latte-origin');
  assert.equal(origin.lifecycle, 'community_origin');
  assert.equal(origin.published, false);
  assert.equal(postUpdates[0].update.$set.catalog_recipe_id, created[0].recipe_id);
});

test('admin hide stays hidden after a community recipe reaches 30 likes', async () => {
  const updates = [];
  const source = load('../src/services/recipe-source.js', {
    '../models/Recipe': {
      updateMany: async (filter, update) => { updates.push({ filter, update }); },
      findOne: async () => null
    },
    '../models/Post': {
      find: () => query([{ recipe_id: 'RCP1', like_count: 40, post_id: 'PST1', user_id: 'USR1' }])
    }
  });

  await source.syncCommunityCatalogPublication();
  assert.ok(updates.some((call) => call.filter.hiddenByAdmin === true));
  const hideSync = updates.find((call) => call.filter.hiddenByAdmin === true);
  assert.equal(hideSync.update.$set.published, false);
  assert.equal(hideSync.update.$set.featured, false);

  const kept = {
    recipe_id: 'RCP1',
    published: true,
    featured: true,
    hiddenByAdmin: true,
    lifecycle: 'catalog',
    source: { type: 'community', creatorName: 'bao' },
    saved: false,
    async save() { this.saved = true; }
  };
  const guarded = load('../src/services/recipe-source.js', {
    '../models/Recipe': { findOne: async () => kept },
    '../models/Post': { find: () => query([{ recipe_id: 'RCP1', like_count: 40 }]) }
  });
  await guarded.syncCommunityRecipePublication('RCP1');
  assert.equal(kept.saved, true);
  assert.equal(kept.published, false);
  assert.equal(kept.featured, false);
});

function recipeApi(extra = {}) {
  return load('../src/controllers/admin-recipes.controller.js', {
    '../models/Recipe': extra.Recipe,
    '../models/Post': extra.Post || { find: () => query([]) },
    '../services/recipe-featured': { ensureFeaturedRecipes: async () => false, HOMEPAGE_FEATURED_LIMIT: 10 },
    '../services/notification.service': {
      createNotification: extra.createNotification || (async () => ({}))
    },
    '../services/post-moderation.service': {
      hidePost: extra.hidePost || (async (postId) => ({ post_id: postId, status: 'hidden' })),
      unhidePost: extra.unhidePost || (async (postId) => ({ post_id: postId, status: 'visible' }))
    },
    '../services/recipe-moderation': {
      MAX_REVIEW_ROUNDS: 3,
      isDeleted: (recipe) => Boolean(recipe?.deletedAt),
      applyHideFields: (recipe, { reason, note, by, status = 'hidden' }) => {
        recipe.published = false;
        recipe.featured = false;
        recipe.hiddenByAdmin = true;
        recipe.moderation_status = status;
        recipe.hidden_reason = reason;
        recipe.hidden_note = note || '';
        recipe.adminNote = note || reason || '';
        recipe.hidden_by = by;
        recipe.hidden_at = new Date();
        recipe.updatedAt = new Date().toISOString();
      },
      clearHideFields: (recipe, { by } = {}) => {
        recipe.published = true;
        recipe.hiddenByAdmin = false;
        recipe.moderation_status = 'visible';
        recipe.hidden_reason = null;
        recipe.hidden_note = '';
        recipe.adminNote = '';
        recipe.hidden_by = null;
        recipe.hidden_at = null;
        recipe.review_round = 0;
        recipe.restored_by = by || null;
        recipe.restored_at = by ? new Date() : null;
        recipe.updatedAt = new Date().toISOString();
      },
      softDeleteRecipe: extra.softDeleteRecipe || (async (recipe, { reason, note, by }) => {
        recipe.published = false;
        recipe.featured = false;
        recipe.deletedAt = new Date();
        recipe.deleted_reason = reason || null;
        recipe.deleted_note = note || '';
        recipe.deleted_by = by || null;
        recipe.updatedAt = new Date().toISOString();
        await recipe.save();
        return { saverIds: [] };
      })
    },
    '../services/recipe-source': {
      sourceKind: (recipe) => String(recipe.source?.type || '').toLowerCase() === 'community' ? 'community' : 'offsite',
      authorLine: (recipe, communityUsername) => {
        if (String(recipe.source?.type || '').toLowerCase() !== 'community') return '';
        const name = communityUsername || recipe.source?.creatorName || recipe.source?.author;
        return name ? String(name).replace(/^@/, '') : '';
      },
      likeCountByRecipe: async () => ({ likes: new Map(), names: new Map([['RCP9', 'bao.brews']]) }),
      visibleInAdmin: () => true,
      prepareRecipeCatalog: async () => {}
    }
  });
}

function recipeDoc(overrides = {}) {
  return {
    recipe_id: 'RCP9',
    title: 'Sunday Iced Oat Matcha',
    slug: 'sunday-iced-oat-matcha',
    published: true,
    featured: true,
    hiddenByAdmin: false,
    moderation_status: 'visible',
    review_round: 0,
    adminNote: '',
    lifecycle: 'catalog',
    owner_user_id: 'USR1',
    source: { type: 'community', creatorName: 'bao.brews' },
    relatedProducts: [],
    heroImage: { url: 'https://cdn.example/oat.jpg' },
    updatedAt: '2026-09-28T00:00:00.000Z',
    saved: false,
    async save() { this.saved = true; },
    ...overrides
  };
}

test('setVisibility hides an Offsite recipe with a reason', async () => {
  const logs = [];
  const recipe = recipeDoc({
    source: { type: 'offsite', author: 'Offsite' }
  });
  const api = recipeApi({
    Recipe: { findOne: async () => recipe }
  });
  const res = response();
  await api.setVisibility({
    params: { recipeId: 'RCP9' },
    body: { published: false, reason: 'being_updated', note: 'Re-shoot photos for autumn' },
    user: { user_id: 'ADM1' },
    writeActivityLog: async (entry) => { logs.push(entry); }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(recipe.saved, true);
  assert.equal(recipe.published, false);
  assert.equal(recipe.featured, false);
  assert.equal(recipe.hiddenByAdmin, true);
  assert.equal(recipe.hidden_reason, 'being_updated');
  assert.equal(recipe.hidden_note, 'Re-shoot photos for autumn');
  assert.equal(recipe.hidden_by, 'ADM1');
  assert.equal(res.body.data.published, false);
  assert.equal(logs[0].actionType, 'recipe.hide');
  assert.equal(logs[0].reason, 'being_updated');
});

test('setVisibility rejects an Offsite-only hide reason on Community recipes', async () => {
  const recipe = recipeDoc();
  const api = recipeApi({
    Recipe: { findOne: async () => recipe },
    Post: {
      find: () => query([{
        post_id: 'PST1',
        user_id: 'USR1',
        like_count: 40,
        status: 'visible',
        author: { username: 'bao.brews' }
      }])
    }
  });
  const res = response();
  await api.setVisibility({
    params: { recipeId: 'RCP9' },
    body: { published: false, reason: 'seasonal' },
    user: { user_id: 'ADM1' },
    writeActivityLog: async () => {}
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(recipe.published, true);
});

test('setVisibility hides a Community recipe and notifies the owner without touching the post', async () => {
  const logs = [];
  const notices = [];
  const hidden = [];
  const recipe = recipeDoc();
  const api = recipeApi({
    Recipe: { findOne: async () => recipe },
    Post: {
      find: () => query([{
        post_id: 'PST1',
        user_id: 'USR1',
        like_count: 40,
        status: 'visible',
        author: { username: 'bao.brews' }
      }])
    },
    createNotification: async (payload) => { notices.push(payload); },
    hidePost: async (postId) => { hidden.push(postId); return { post_id: postId, status: 'hidden' }; }
  });
  const res = response();
  await api.setVisibility({
    params: { recipeId: 'RCP9' },
    body: { published: false, reason: 'spam' },
    user: { user_id: 'ADM1' },
    writeActivityLog: async (entry) => { logs.push(entry); }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(recipe.published, false);
  assert.equal(recipe.hiddenByAdmin, true);
  assert.equal(recipe.hidden_reason, 'spam');
  assert.deepEqual(hidden, []);
  assert.equal(notices[0].recipient_id, 'USR1');
  assert.equal(notices[0].post_id, null);
  assert.equal(notices[0].type, 'RECIPE_MODERATION');
  assert.equal(notices[0].recipe_slug, 'sunday-iced-oat-matcha');
  assert.match(notices[0].message, /Spam or advertising/);
  assert.equal(logs[0].actionType, 'recipe.hide');
  assert.equal(res.body.data.author_line, 'bao.brews');
});

test('setVisibility with low_quality keeps the Community post visible', async () => {
  const hidden = [];
  const notices = [];
  const recipe = recipeDoc();
  const api = recipeApi({
    Recipe: { findOne: async () => recipe },
    Post: {
      find: () => query([{
        post_id: 'PST1',
        user_id: 'USR1',
        like_count: 40,
        status: 'visible',
        author: { username: 'bao.brews' }
      }])
    },
    createNotification: async (payload) => { notices.push(payload); },
    hidePost: async (postId) => { hidden.push(postId); return { post_id: postId, status: 'hidden' }; }
  });
  const res = response();
  await api.setVisibility({
    params: { recipeId: 'RCP9' },
    body: {
      published: false,
      reason: 'low_quality',
      note: 'Step 2 is missing the water amount'
    },
    user: { user_id: 'ADM1' },
    writeActivityLog: async () => {}
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(recipe.hidden_reason, 'low_quality');
  assert.deepEqual(hidden, []);
  assert.match(notices[0].message, /Needs fixing/);
});

test('recipe detail matching links an ingredient to the closest catalog name', () => {
  const api = recipeApi();
  const products = [
    { product_id: 1, name: 'Oat Milk Barista 1L', variants: [{ sku: 'OAT-1', stock: 4 }] },
    { product_id: 2, name: 'Ceremonial Uji Matcha', variants: [{ sku: 'MAT-1', stock: 2 }] },
    { product_id: 3, name: 'Bamboo Chasen 100-prong', variants: [{ sku: 'CHA-1', stock: 0 }] }
  ];
  assert.ok(api.matchScore('oat milk', 'Oat Milk Barista 1L') > 0);
  assert.ok(api.matchScore('ceremonial matcha', 'Ceremonial Uji Matcha') > 0);
  assert.equal(api.matchScore('ice cubes', 'Oat Milk Barista 1L'), 0);
  assert.equal(api.matchScore('Ice', { name: 'Iced Coffee Blend', category: 'coffee' }), 0);
  assert.ok(api.matchScore('2 shots of espresso', { name: 'House Espresso', category: 'coffee' }) >
    api.matchScore('2 shots of espresso', { name: 'Iced Coffee Blend', category: 'coffee' }));
  assert.equal(api.matchScore('2 shots of espresso', { name: 'Ceremonial Uji Matcha', category: 'matcha' }), 0);
  assert.equal(api.matchScore('oat milk', { name: 'Almond Milk', category: 'drinkware' }), 0);
  assert.ok(api.matchScore('oatmilk', 'Oat Milk Barista 1L') > api.matchScore('oat milk', 'Almond Milk'));
  assert.ok(api.matchScore('paper filters', 'V60 Paper Filter') > 0);
  assert.ok(api.matchScore('bamboo whisk', { name: '100-prong Chasen', category: 'tools', tools: { tool_type: 'chasen' } }) > 0);
  assert.ok(api.matchScore('ceremonial grade matcha powder', { name: 'Uji Ceremonial', category: 'matcha', matcha: { product_grade: 'ceremonial' } }) >
    api.matchScore('ceremonial grade matcha powder', { name: 'House Espresso', category: 'coffee' }));
  assert.equal(api.matchScore('Hot water (170°F) for whisking', { name: 'Chasen Matcha Whisk', category: 'tools', tools: { tool_type: 'chasen' } }), 0);
  assert.equal(api.matchScore('Sweetener of choice', { name: 'House Matcha', category: 'matcha' }), 0);
  assert.ok(api.matchScore('Bamboo Whisk (Chasen)', { name: 'Chasen Matcha Whisk', category: 'tools', tools: { tool_type: 'chasen' } }) >
    api.matchScore('Bamboo Whisk (Chasen)', { name: 'Craft Matcha and Whisk Set', category: 'sets_bundles', product_tag: ['matcha'] }));
  assert.ok(api.matchScore('oat barista milk', { name: 'Oat Milk Barista 1L', category: 'drinkware' }) > 0);
  assert.ok(api.matchScore('vanilla syrup', { name: 'House Vanilla Syrup' }) > 0);
  assert.ok(api.matchScore('paper filter', { name: 'V60 Paper Filters', category: 'tools', tools: { tool_type: 'filter' } }) > 0);
  assert.equal(api.matchScore('Cold brew concentrate', {
    name: 'Blue Bottle Coffee Dripper',
    category: 'tools',
    tools: { tool_type: 'dripper' }
  }), 0);
  assert.equal(api.matchScore('Cherry soda', {
    name: 'La Golondrina',
    category: 'coffee',
    coffee: { tasting_notes: ['milk chocolate', 'cherry', 'nutty'] }
  }), 0);
  assert.equal(api.matchScore('Cherry syrup', {
    name: 'Los Sueños Decaf',
    category: 'coffee',
    coffee: { tasting_notes: ['cherry', 'black tea', 'caramel'] }
  }), 0);
  assert.equal(api.matchScore('Juice of 1/2 lime', {
    name: 'Night Light Decaf',
    category: 'coffee',
    coffee: { tasting_notes: ['crème brûlée', 'vanilla', 'key lime'] }
  }), 0);
  assert.equal(api.matchScore('Fresh cherries or mint for garnish', {
    name: 'Nueva Llusta',
    category: 'coffee',
    coffee: { tasting_notes: ['cherry', 'vanilla', 'hazelnut'] }
  }), 0);
  assert.ok(api.matchScore('Cherry syrup', { name: 'House Cherry Syrup' }) > 0);
  const suggestions = api.suggestionsFor(['Ceremonial matcha', 'Oat milk', 'Ice', '2 shots of espresso'], [
    ...products,
    { product_id: 4, name: 'Iced Coffee Blend', category: 'coffee', variants: [{ sku: 'ICE-1', stock: 3 }] },
    { product_id: 5, name: 'House Espresso', category: 'coffee', variants: [{ sku: 'ESP-1', stock: 5 }] }
  ], ['2']);
  assert.equal(suggestions[0].matched_hint, 'Ceremonial matcha');
  assert.equal(suggestions[0].product_id, '2');
  assert.equal(suggestions[1].name, 'Oat Milk Barista 1L');
  assert.equal(suggestions[1].in_stock, true);
  assert.equal(suggestions.find((item) => item.matched_hint === 'Ice'), undefined);
  assert.equal(suggestions.find((item) => item.matched_hint === '2 shots of espresso').product_id, '5');

  const recipe = {
    title: 'Iced Oat Matcha Latte',
    metadata: { tags: ['COLD', 'MATCHA'], difficulty: 'EASY' }
  };
  assert.equal(api.readBase(recipe), 'matcha');
  assert.deepEqual(api.readServes(recipe), ['cold']);
  assert.deepEqual(api.readServes({ title: 'Nightcap', metadata: { tags: ['DESSERT', 'COCKTAIL', 'HOT'] } }), ['hot', 'dessert']);
  assert.equal(api.readBase({ title: 'Uji Latte', metadata: { base: 'MATCHA', tags: [] } }), 'matcha');
  assert.equal(api.readBase({ title: 'Morning coffee', metadata: { base: 'OTHERS', tags: ['HOT'] } }), 'others');
  assert.equal(api.readBase({ title: 'Hojicha Latte', metadata: { tags: ['HOT', 'OTHERS'] } }), 'others');
  assert.equal(api.readBase({ title: 'Uji Latte', metadata: { tags: ['MATCHA'] } }), 'others');
  assert.equal(api.readBase({ title: 'House blend', metadata: { tags: [] } }), 'others');
  assert.equal(api.readBase({ title: 'Morning coffee', metadata: { tags: ['HOT'] } }), 'coffee');
  assert.deepEqual(api.nextTags(['COLD', 'MATCHA', 'SEASONAL'], ['dessert', 'hot']), ['HOT', 'DESSERT', 'SEASONAL']);

  assert.deepEqual(api.parseQuantity('1/2'), { quantity: '1/2' });
  assert.deepEqual(api.parseQuantity('6-8'), { quantity: '6-8' });
  assert.deepEqual(api.parseQuantity('1 1/2'), { quantity: '1 1/2' });
  assert.deepEqual(api.parseQuantity('2.5'), { quantity: 2.5 });
  assert.equal(api.parseQuantity('abc').error, 'Use amounts like 2, 1/2, 1 1/2, or 6-8.');

  const parsed = api.parseRecipeBody({
    title: 'Iced Oat Matcha Latte',
    description: 'Creamy and ready in 5 minutes.',
    base: 'matcha',
    serve: 'iced',
    difficulty: 'easy',
    ingredients: [
      { name: 'Oat milk', quantity: 150, unit: 'ml' },
      { name: 'Ice cubes', quantity: '6-8', unit: 'piece' },
      { name: 'Honey', quantity: '1/2', unit: 'tsp' },
      { name: '  ' }
    ],
    tools: [{ name: 'Tall glass', quantity: 1 }],
    steps: [{ text: 'Fill the glass.' }],
    featured: false,
    related_products: ['1', '1']
  });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.base, 'MATCHA');
  assert.equal(parsed.value.ingredients.length, 3);
  assert.equal(parsed.value.ingredients[1].quantity, '6-8');
  assert.equal(parsed.value.ingredients[2].quantity, '1/2');
  assert.equal(parsed.value.difficulty, 'EASY');
  assert.equal(parsed.value.servings, 1);
  assert.equal(parsed.value.prepTime, 0);
  assert.deepEqual(parsed.value.serves, ['cold']);
  assert.equal(parsed.value.published, true);
  assert.equal(parsed.value.steps[0].title, 'Fill the glass.');
  assert.equal(parsed.value.steps[0].timerSeconds, null);
  const timedMeta = api.parseRecipeBody({
    title: 'Iced Oat Matcha Latte',
    base: 'matcha',
    serve: 'cold',
    difficulty: 'easy',
    servings: 2,
    prepTime: 5,
    ingredients: [{ name: 'Oat milk', quantity: 150, unit: 'ml' }],
    tools: [{ name: 'Tall glass' }],
    steps: [{ title: 'Pour', description: 'Add milk.' }],
    featured: false,
    related_products: []
  });
  assert.equal(timedMeta.value.servings, 2);
  assert.equal(timedMeta.value.prepTime, 5);
  assert.equal(
    api.parseRecipeBody({
      title: 'Iced Oat Matcha Latte',
      base: 'matcha',
      serve: 'cold',
      difficulty: 'easy',
      servings: 0,
      ingredients: [{ name: 'Oat milk', quantity: 150, unit: 'ml' }],
      tools: [{ name: 'Tall glass' }],
      steps: [{ title: 'Pour', description: 'Add milk.' }],
      featured: false,
      related_products: []
    }).error,
    'Servings must be a whole number from 1 to 99.'
  );
  const timed = api.parseRecipeBody({
    title: 'Iced Oat Matcha Latte',
    base: 'matcha',
    serve: 'cold',
    difficulty: 'easy',
    ingredients: [{ name: 'Oat milk', quantity: 150, unit: 'ml' }],
    tools: [{ name: 'Tall glass' }],
    steps: [{ title: 'Steep', description: 'Let it sit.', timer_seconds: 90 }],
    featured: false,
    related_products: []
  });
  assert.equal(timed.value.steps[0].title, 'Steep');
  assert.equal(timed.value.steps[0].description, 'Let it sit.');
  assert.equal(timed.value.steps[0].timerSeconds, 90);
  assert.deepEqual(parsed.value.relatedIds, ['1']);
  assert.equal(api.parseRecipeBody({ ...parsed.value, title: '' }).error, 'Add a title (140 characters or fewer).');
  assert.equal(api.parseRecipeBody({ ...parsed.value, base: 'cocktail' }).error, 'Choose a base.');
  assert.equal(api.parseRecipeBody({ ...parsed.value, serves: ['cocktail'] }).error, 'Choose how it is served.');
});

test('deleteRecipe soft-deletes an Offsite recipe with a reason', async () => {
  const logs = [];
  const offsite = recipeDoc({
    source: { type: 'offsite', author: 'Offsite' },
    lifecycle: 'offsite',
    owner_user_id: null,
    recipe_id: 'RCP1'
  });
  const api = recipeApi({
    Recipe: { findOne: async () => offsite }
  });

  const removed = response();
  await api.deleteRecipe({
    params: { recipeId: 'RCP1' },
    body: { reason: 'created_in_error' },
    user: { user_id: 'ADM1' },
    writeActivityLog: async (entry) => { logs.push(entry); }
  }, removed);
  assert.equal(removed.statusCode, 200);
  assert.ok(offsite.deletedAt);
  assert.equal(offsite.deleted_reason, 'created_in_error');
  assert.equal(offsite.published, false);
  assert.equal(logs[0].actionType, 'recipe.delete');
  assert.equal(logs[0].reason, 'created_in_error');
  assert.equal(logs[0].newValue.soft_deleted, true);
});

test('deleteRecipe soft-deletes a Community recipe, notifies the owner, and leaves the post alone', async () => {
  const logs = [];
  const notices = [];
  const hidden = [];
  const community = recipeDoc();
  const api = recipeApi({
    Recipe: { findOne: async () => community },
    Post: {
      find: () => query([{
        post_id: 'PST1',
        user_id: 'USR1',
        like_count: 40,
        status: 'visible',
        author: { username: 'bao.brews' }
      }])
    },
    createNotification: async (payload) => { notices.push(payload); },
    hidePost: async (postId) => { hidden.push(postId); return { post_id: postId, status: 'hidden' }; }
  });

  const removed = response();
  await api.deleteRecipe({
    params: { recipeId: 'RCP9' },
    body: { reason: 'copyright' },
    user: { user_id: 'ADM1' },
    writeActivityLog: async (entry) => { logs.push(entry); }
  }, removed);
  assert.equal(removed.statusCode, 200);
  assert.ok(community.deletedAt);
  assert.deepEqual(hidden, []);
  assert.equal(notices[0].recipient_id, 'USR1');
  assert.equal(notices[0].type, 'RECIPE_MODERATION');
  assert.equal(notices[0].post_id, null);
  assert.equal(notices[0].recipe_slug, null);
  assert.match(notices[0].message, /copyright/i);
  assert.equal(logs[0].reason, 'copyright');
});

test('deleteRecipe requires a note when reason is other', async () => {
  const softDeletes = [];
  const api = recipeApi({
    Recipe: {
      findOne: async () => recipeDoc({
        source: { type: 'offsite', author: 'Offsite' },
        lifecycle: 'offsite',
        recipe_id: 'RCP1'
      })
    },
    softDeleteRecipe: async (...args) => { softDeletes.push(args); return { saverIds: [] }; }
  });
  const res = response();
  await api.deleteRecipe({
    params: { recipeId: 'RCP1' },
    body: { reason: 'other' },
    user: { user_id: 'ADM1' },
    writeActivityLog: async () => {}
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(softDeletes.length, 0);
});

test('updateFeatured replaces the homepage recipe the admin chooses', async () => {
  const updates = [];
  const logs = [];
  const recipe = recipeDoc({
    recipe_id: 'RCPNEW',
    title: 'New pour-over',
    featured: false,
    source: { type: 'offsite', author: 'Offsite' },
    async save() { this.saved = true; }
  });
  const slots = Array.from({ length: 10 }, (_, index) => ({
    recipe_id: `SLOT${index}`,
    title: `Slot ${index}`,
    heroImage: { url: 'https://cdn.example/slot.jpg' }
  }));
  const api = recipeApi({
    Recipe: {
      findOne: async () => recipe,
      find: () => query(slots),
      updateOne: async (filter, update) => { updates.push({ filter, update }); }
    }
  });

  const missing = response();
  await api.updateFeatured({
    params: { recipeId: 'RCPNEW' },
    body: { featured: true },
    writeActivityLog: async () => {}
  }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(recipe.featured, false);

  const saved = response();
  await api.updateFeatured({
    params: { recipeId: 'RCPNEW' },
    body: { featured: true, replace_recipe_id: 'SLOT3' },
    writeActivityLog: async (entry) => { logs.push(entry); }
  }, saved);
  assert.equal(saved.statusCode, 200);
  assert.equal(recipe.featured, true);
  assert.equal(updates[0].filter.recipe_id, 'SLOT3');
  assert.equal(updates[0].update.$set.featured, false);
  assert.equal(logs[0].newValue.replaced, 'SLOT3');
});
