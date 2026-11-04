const test = require('node:test');
const assert = require('node:assert/strict');
const Product = require('../src/models/Product');
const Recipe = require('../src/models/Recipe');
const AiCallLog = require('../src/models/AiCallLog');
const { productCandidate, validatedRecommendations, askGroq, recommendationsFor, recommendationsForProduct } = require('../src/services/ritual-dna.recommendations');

const dna = { taste_radar: { brightness: 50, boldness: 50, sweetness: 50, skill: 50, tempo: 50 } };

test('only active, stocked products can become candidates', () => {
  const product = { product_id: 1, name: 'Matcha', slug: 'matcha', category: 'matcha', is_active: true,
    variants: [{ stock: 0, price: 20 }, { stock: 2, price: 30 }], matcha: { product_grade: 'ceremonial' } };
  assert.equal(productCandidate(product, dna).price, 30);
  assert.equal(productCandidate({ ...product, variants: [{ stock: 0, price: 20 }] }, dna), null);
  assert.equal(productCandidate({ ...product, is_active: false }, dna), null);
});

test('rejects invented and duplicate AI IDs, then fills from verified candidates', () => {
  const products = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
  const result = validatedRecommendations({ products: [
    { id: 'fake', reason: 'invented' }, { id: '2', reason: 'chosen' }, { id: '2', reason: 'duplicate' }
  ], recipes: [] }, products, []);
  assert.deepEqual(result.products.map(item => item.id), ['2', '1']);
  assert.equal(result.products[0].reason, 'chosen');
});

test('public fit uses taste distance and survives AI selection without exposing ranking score', () => {
  const product = { product_id: 44, name: 'Matcha', category: 'matcha', is_active: true,
    variants: [{ stock: 2, price: 20 }], matcha: { product_grade: 'ceremonial' } };
  const candidate = productCandidate(product, { ...dna, lean_confirmed: true, drink_lean: 100 });
  const values = Object.entries(candidate.profile).filter(([, value]) => Number.isFinite(value));
  const expected = Math.round(100 - values.reduce((sum, [axis, value]) => sum + Math.abs(dna.taste_radar[axis] - value), 0) / values.length);
  assert.equal(candidate.fit_percent, expected);
  const selected = validatedRecommendations({ products: [{ id: '44', fit_percent: 100 }] }, [candidate], []).products[0];
  assert.equal(selected.fit_percent, expected);
  assert.equal(selected.score, undefined);
});

test('recommendation query retains active status so real products reach the card', async () => {
  const originalProductFind = Product.find;
  const originalRecipeFind = Recipe.find;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = '';
  try {
    Product.find = () => ({ select: fields => ({ limit: () => ({ lean: async () => {
      const row = { product_id: 99, name: 'Test matcha', slug: 'test-matcha', category: 'matcha',
        is_active: true, variants: [{ stock: 3, price: 12 }], matcha: { product_grade: 'barista' } };
      return [Object.fromEntries(Object.entries(row).filter(([key]) => fields.split(' ').includes(key)))];
    } }) }) });
    Recipe.find = () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) });
    const result = await recommendationsFor({ user_id: 'test-projection', ritual_dna: {
      taste_radar: dna.taste_radar, quiz_taken_at: new Date(), updated_at: new Date(), behavior_events: []
    } });
    assert.deepEqual(result.products.map(item => item.id), ['99']);
  } finally {
    Product.find = originalProductFind;
    Recipe.find = originalRecipeFind;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test('product detail candidates stay in the viewed category and exclude the viewed item and sold-out products', async () => {
  const originalFind = Product.find;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = '';
  try {
    Product.find = query => {
      assert.equal(query.category, 'coffee');
      assert.deepEqual(query.product_id, { $ne: 10 });
      return { select: fields => ({ limit: () => ({ lean: async () => {
        const rows = [
          { product_id: 11, name: 'Light', slug: 'light', category: 'coffee', is_active: true, variants: [{ stock: 2, price: 12 }], coffee: { roast_level: 'light roast' } },
          { product_id: 12, name: 'Sold out', slug: 'sold-out', category: 'coffee', is_active: true, variants: [{ stock: 0, price: 12 }] },
          { product_id: 13, name: 'No taste metadata', slug: 'no-profile', category: 'coffee', is_active: true, variants: [{ stock: 2, price: 12 }] }
        ];
        return rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => fields.split(' ').includes(key))));
      } }) }) };
    };
    const result = await recommendationsForProduct({ user_id: 'test-context', ritual_dna: {
      taste_radar: dna.taste_radar, quiz_taken_at: new Date(), updated_at: new Date(), behavior_events: []
    } }, { product_id: 10, name: 'Dark', category: 'coffee', coffee: { roast_level: 'dark roast' } });
    assert.deepEqual(result.products.map(item => item.id), ['11']);
    assert.equal(result.source, 'rules');
  } finally {
    Product.find = originalFind;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test('Groq request sends compact DNA and candidate IDs without account identity', async () => {
  const old = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-only-key';
  try {
    const result = await askGroq({ ...dna, archetype_id: 'zen', servings: [] }, [],
      [{ id: '1', name: 'Matcha', category: 'matcha', profile: {} }], [], async (url, request) => {
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        const body = JSON.parse(request.body);
        assert.equal(body.model, 'openai/gpt-oss-120b');
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(JSON.parse(body.messages[1].content).products[0].id, '1');
        assert.equal(body.messages[1].content.includes('user_id'), false);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"products":[{"id":"1","reason":"Fits your taste"}],"recipes":[]}' } }] }) };
      });
    assert.equal(result.products[0].id, '1');
  } finally {
    if (old === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = old;
  }
});

test('product detail AI receives the viewed product as context, never as a candidate', async () => {
  const old = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-only-key';
  try {
    await askGroq({ ...dna, archetype_id: 'daily_fuel' }, [],
      [{ id: '11', name: 'Light coffee', category: 'coffee', profile: { brightness: 82, boldness: 25 } }], [],
      async (_url, request) => {
        const body = JSON.parse(request.body);
        const input = JSON.parse(body.messages[1].content);
        assert.equal(input.viewing_product.name, 'Dark coffee');
        assert.deepEqual(input.products.map(item => item.id), ['11']);
        assert.match(body.messages[0].content, /You may also like/);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"products":[{"id":"11","reason":"Another roast to explore"}],"recipes":[]}' } }] }) };
      }, { product_id: 10, name: 'Dark coffee', category: 'coffee', coffee: { roast_level: 'dark roast' } });
  } finally {
    if (old === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = old;
  }
});

test('Groq success writes Ritual DNA usage log without chatbot-only fields or raw prompts', async () => {
  const old = process.env.GROQ_API_KEY;
  const originalCreate = AiCallLog.create;
  process.env.GROQ_API_KEY = 'test-only-key';
  let logged;
  AiCallLog.create = async value => { logged = value; };
  try {
    await askGroq(dna, [], [{ id: '11', name: 'Coffee', category: 'coffee', profile: {} }], [],
      async () => ({ ok: true, json: async () => ({
        usage: { prompt_tokens: 750, completion_tokens: 320, total_tokens: 1070 },
        choices: [{ message: { content: '{"products":[{"id":"11","reason":"Fits"},{"id":"999","reason":"Invalid"}],"recipes":[]}' } }]
      }) }), { product_id: 10, name: 'Viewed', category: 'coffee' }, { userId: 'USR0001' });
    assert.equal(logged.feature, 'ritual_dna');
    assert.equal(logged.user_id, 'USR0001');
    assert.equal(logged.session_id, null);
    assert.equal(logged.ip, null);
    assert.equal(logged.input_summary, null);
    assert.equal(logged.output_summary, null);
    assert.equal(logged.cost_usd, null);
    assert.equal(logged.total_tokens, 1070);
    assert.equal(logged.status, 'success');
    assert.equal(logged.ritual_dna.surface, 'product_detail');
    assert.equal(logged.ritual_dna.viewed_product_id, 10);
    assert.deepEqual(logged.ritual_dna.selected_product_ids, ['11']);
  } finally {
    AiCallLog.create = originalCreate;
    if (old === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = old;
  }
});

test('Groq rate limit is logged without token counts and log failure does not change fallback', async () => {
  const old = process.env.GROQ_API_KEY;
  const originalCreate = AiCallLog.create;
  process.env.GROQ_API_KEY = 'test-only-key';
  let logged;
  AiCallLog.create = async value => { logged = value; };
  try {
    await assert.rejects(askGroq(dna, [], [], [], async () => ({ ok: false, status: 429 }),
      null, { userId: 'USR0001' }), /429/);
    assert.equal(logged.status, 'rate_limited');
    assert.equal(logged.total_tokens, null);
    assert.equal(logged.ritual_dna.surface, 'account');

    AiCallLog.create = async () => { throw new Error('DB unavailable'); };
    const oldWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await askGroq(dna, [], [], [], async () => ({ ok: true, json: async () => ({
        choices: [{ message: { content: '{"products":[],"recipes":[]}' } }]
      }) }), null, { userId: 'USR0001' });
      assert.deepEqual(result.products, []);
    } finally { console.warn = oldWarn; }
  } finally {
    AiCallLog.create = originalCreate;
    if (old === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = old;
  }
});

test('non-Ritual AI log gets a null Ritual DNA field', () => {
  const log = new AiCallLog({ feature: 'concierge' });
  assert.equal(log.ritual_dna, null);
  assert.equal(log.validateSync(), undefined);
  const ritualLog = new AiCallLog({ feature: 'ritual_dna', user_id: 'USR0001',
    prompt_tokens: 750, completion_tokens: 320, total_tokens: 1070,
    ritual_dna: { surface: 'account', prompt_version: 'ritual-recommendations-v1' } });
  assert.equal(ritualLog.validateSync(), undefined);
});


test('homepage returns the top 20 by visible fit without category caps or AI reordering', async () => {
  const originalProductFind = Product.find;
  const originalRecipeFind = Recipe.find;
  const originalFetch = global.fetch;
  const originalCreate = AiCallLog.create;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-only-key';
  const rows = Array.from({ length: 26 }, (_, i) => ({
    product_id: i + 1, name: `Coffee ${i}`, slug: `coffee-${i}`, category: 'coffee',
    is_active: true, variants: [{ stock: 3, price: 12 }],
    coffee: { roast_level: i % 2 ? 'light roast' : 'dark roast' }
  }));
  rows.push({ ...rows[0], product_id: 100, variants: [{ stock: 0, price: 12 }] });
  try {
    Product.find = () => ({ select: () => ({ limit: () => ({ lean: async () => rows }) }) });
    Recipe.find = () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) });
    AiCallLog.create = async () => {};
    global.fetch = async (_url, request) => {
      const input = JSON.parse(JSON.parse(request.body).messages[1].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        products: [...input.products].reverse().map(item => ({ id: item.id, reason: 'AI reversed' })), recipes: []
      }) } }] }) };
    };
    const user = { user_id: 'test-home-20', ritual_dna: {
      taste_radar: { brightness: 80, boldness: 25, sweetness: 50, skill: 50, tempo: 50 },
      quiz_taken_at: new Date(), updated_at: new Date(), behavior_events: []
    } };
    const result = await recommendationsFor(user, { surface: 'home' });
    const expected = rows.map(row => productCandidate(row, user.ritual_dna)).filter(Boolean)
      .sort((a, b) => b.fit_percent - a.fit_percent || b.score - a.score || a.id.localeCompare(b.id)).slice(0, 20);
    assert.equal(result.products.length, 20);
    assert.equal(new Set(result.products.map(item => item.id)).size, 20);
    assert.deepEqual(result.products.map(item => item.id), expected.map(item => item.id));
    assert.ok(result.products.every((item, i, all) => i === 0 || all[i - 1].fit_percent >= item.fit_percent));
    // The account request must not reuse the homepage's 20-item cache entry.
    const account = await recommendationsFor(user);
    assert.equal(account.products.length, 4);
  } finally {
    Product.find = originalProductFind;
    Recipe.find = originalRecipeFind;
    global.fetch = originalFetch;
    AiCallLog.create = originalCreate;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});
