const assert = require('assert');
const { stockLabel } = require('../src/services/starter-quiz.slots');

assert.deepStrictEqual(
  stockLabel([{ hero: true, stock_count: 2 }, { hero: false, stock_count: 8 }]),
  { code: 'range_low', label: '1 range low' }
);
assert.deepStrictEqual(
  stockLabel([{ hero: true, stock_count: 0 }, { hero: false, stock_count: 1 }]),
  { code: 'hero_oos', label: 'Hero range OOS' }
);
assert.deepStrictEqual(
  stockLabel([{ hero: true, stock_count: 4 }, { hero: false, stock_count: 0 }]),
  { code: 'slot_oos', label: 'Range empty' }
);
assert.deepStrictEqual(
  stockLabel([{ hero: false, stock_count: 0 }]),
  { code: 'slot_oos', label: 'Range empty' }
);
assert.deepStrictEqual(
  stockLabel([{ hero: true, stock_count: 2 }, { hero: false, stock_count: 0 }]),
  { code: 'slot_oos', label: 'Range empty' }
);
assert.strictEqual(stockLabel([{ hero: true, stock_count: 3 }, { hero: false, stock_count: 9 }]).code, 'ok');
console.log('slot stock labels ok');
