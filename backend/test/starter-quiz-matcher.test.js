const assert = require('assert');
const { matchStarterKit } = require('../src/services/starter-quiz.matcher');

function product(fields) {
  const price = fields.price;
  delete fields.price;
  return {
    is_active: true,
    quiz_eligible: true,
    product_tag: [],
    images: [{ url: `/img/${fields.product_id}.jpg`, sort_order: 0 }],
    variants: [{ sku: `SKU-${fields.product_id}`, label: 'Default', price, stock: 8, is_default: true, images: [] }],
    total_sold_quantity: 0,
    rating_avg: 0,
    ...fields
  };
}

const catalog = [
  product({ product_id: 1, name: 'Ceremonial B', category: 'matcha', price: 10, total_sold_quantity: 5, matcha: { product_grade: 'ceremonial' } }),
  product({ product_id: 2, name: 'Ceremonial A', category: 'matcha', price: 40, total_sold_quantity: 1, matcha: { product_grade: 'ceremonial' } }),
  product({ product_id: 3, name: 'Premium C', category: 'matcha', price: 24, matcha: { product_grade: 'premium' } }),
  product({ product_id: 4, name: 'Barista D', category: 'matcha', price: 17, matcha: { product_grade: 'barista' } }),
  product({ product_id: 5, name: 'Related Tea', category: 'matcha', price: 4, matcha: { product_grade: 'ceremonial' }, product_tag: ['related tea'] }),
  product({ product_id: 6, name: 'Hidden Matcha', category: 'matcha', price: 3, quiz_eligible: false, matcha: { product_grade: 'ceremonial' } }),
  product({ product_id: 7, name: 'Chasen', category: 'tools', price: 25, product_tag: ['tea-tools'], tools: { tool_type: 'chasen' } }),
  product({ product_id: 8, name: 'Chawan', category: 'tools', price: 30, product_tag: ['tea-tools'], tools: { tool_type: 'chawan' } }),
  product({ product_id: 9, name: 'Kettle', category: 'tools', price: 15, product_tag: ['tea-tools'], tools: { tool_type: 'kettle' } }),
  product({ product_id: 10, name: 'Sweet Coffee', category: 'coffee', price: 25, coffee: { roast_level: 'medium roast', process_type: 'washed', tasting_notes: ['chocolate', 'caramel'] } }),
  product({ product_id: 11, name: 'Decaf', category: 'coffee', price: 5, coffee: { roast_level: 'medium roast', process_type: 'decaf', tasting_notes: ['chocolate'] } }),
  product({ product_id: 12, name: 'Dark Coffee', category: 'coffee', price: 22, coffee: { roast_level: 'dark roast', process_type: 'natural', tasting_notes: [] } }),
  product({ product_id: 13, name: 'French Press', category: 'tools', price: 55, product_tag: ['coffee-tools'], tools: { tool_type: 'brewer' } }),
  product({ product_id: 14, name: 'V60 Dripper', category: 'tools', price: 20, product_tag: ['coffee-tools'], tools: { tool_type: 'dripper' } }),
  product({ product_id: 15, name: 'Chemex Lid', category: 'tools', price: 8, product_tag: ['coffee-tools'], tools: { tool_type: 'brewer' }, variants: [{ sku: '12012', price: 8, stock: 4, is_default: true }] }),
  product({ product_id: 16, name: '12oz Mug', category: 'drinkware', price: 23, drinkware: { ware_type: 'mugs', product_size: '12 oz' } }),
  product({ product_id: 17, name: 'Bottle', category: 'drinkware', price: 18, drinkware: { ware_type: 'bottles', product_size: '16 oz' } }),
  product({ product_id: 18, name: 'Light Coffee', category: 'coffee', price: 28, coffee: { roast_level: 'light roast', process_type: 'washed', tasting_notes: ['citrus'] } })
];

function ids(result) {
  return result.kit.items.map((item) => item.productId);
}

const matchaBundle = matchStarterKit(
  { q1: 'E3', q2: 'M', q3: 'light', q4: 'hot', q5: 'mid' },
  catalog
);
assert.strictEqual(matchaBundle.error, undefined);
assert.strictEqual(matchaBundle.kit.archetypeId, 'matcha_bundle');
assert.strictEqual(matchaBundle.kit.kitType, 'bundle');
assert.strictEqual(matchaBundle.kit.categoryFilter, 'matcha');
assert.deepStrictEqual(ids(matchaBundle), [1, 2, 3]);
assert.ok(!ids(matchaBundle).includes(5));
assert.ok(!ids(matchaBundle).includes(6));

const coffeeKit = matchStarterKit(
  { q1: 'E1', q2: 'C', q3: 'sweet', q4: 'milk', q5: 'any' },
  catalog
);
assert.strictEqual(coffeeKit.kit.kitType, 'coffee_kit');
assert.strictEqual(coffeeKit.kit.packSize, 3);
assert.deepStrictEqual(ids(coffeeKit), [10, 13, 16]);
assert.ok(!ids(coffeeKit).includes(11));
assert.ok(!ids(coffeeKit).includes(15));

const pair = matchStarterKit(
  { q1: 'E2', q2: 'B', q2b: 'LM', q3: 'sweet', q4: 'hot', q5: 'low' },
  catalog
);
assert.strictEqual(pair.kit.archetypeId, 'matcha_kit_2');
assert.deepStrictEqual(ids(pair).slice(0, 2), [3, 7]);
assert.strictEqual(pair.kit.items.some((item) => item.slotKey === 'drinkware'), false);

const noTools = catalog.filter((item) => item.category !== 'tools' || !item.product_tag.includes('tea-tools'));
const fallback = matchStarterKit(
  { q1: 'E2', q2: 'M', q3: 'balanced', q4: 'hot', q5: 'mid' },
  noTools
);
assert.strictEqual(fallback.kit.kitType, 'bundle');
assert.ok(fallback.kit.notes.some((note) => note.includes('Tools are temporarily out of stock')));

const pricey = [
  product({ product_id: 21, name: 'Pricey A', category: 'matcha', price: 80, matcha: { product_grade: 'ceremonial' } }),
  product({ product_id: 22, name: 'Pricey B', category: 'matcha', price: 90, matcha: { product_grade: 'premium' } }),
  product({ product_id: 23, name: 'Pricey C', category: 'matcha', price: 70, matcha: { product_grade: 'barista' } })
];
const over = matchStarterKit(
  { q1: 'E3', q2: 'M', q3: 'balanced', q4: 'hot', q5: 'low' },
  pricey
);
assert.strictEqual(over.kit.packSize, 2);
assert.ok(over.kit.notes.some((note) => note.startsWith('Over budget by')));

const missingLean = matchStarterKit(
  { q1: 'E3', q2: 'B', q3: 'light', q4: 'iced', q5: 'high' },
  catalog
);
assert.ok(missingLean.error);

const mixed = matchStarterKit(
  { q1: 'E3', q2: 'B', q2b: 'LM', q3: 'light', q4: 'iced', q5: 'high' },
  catalog
);
assert.strictEqual(mixed.kit.archetypeId, 'mixed_bundle');
assert.strictEqual(mixed.kit.packSize, 3);
assert.strictEqual(mixed.kit.items.filter((item) => item.product.category === 'matcha').length, 2);
assert.strictEqual(mixed.kit.items.filter((item) => item.product.category === 'coffee').length, 1);

console.log('starter quiz matcher ok');
