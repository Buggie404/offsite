const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// Run with: node --test test/voucher-scope.test.js
// The service is loaded with a stub Voucher / Order model, so no database is needed.
function loadService(voucherDoc, redemptions = 0) {
  const servicePath = path.resolve(__dirname, '../src/services/voucher.service.js');
  const stubs = {
    '../models/Voucher': { findOne: async () => voucherDoc },
    '../models/Order': { countDocuments: async () => redemptions }
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (parent?.filename === servicePath && Object.hasOwn(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[servicePath];
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

const AYAKO = { product_id: 'p-ayako', category: 'matcha', subtotal: 17, purchase_type: 'one_time', product_active: true };
const CHASEN = { product_id: 'p-chasen', category: 'tools', subtotal: 25, purchase_type: 'one_time', product_active: true };
const RITUAL_BOX = { product_id: 'p-box', category: 'matcha', subtotal: 30, purchase_type: 'subscription', product_active: true };
const QUIZ_KIT = { product_id: 'p-kit', category: 'matcha', subtotal: 20, purchase_type: 'one_time', from_quiz_bundle: true, product_active: true };

function voucher(overrides = {}) {
  return {
    _id: 'v1',
    code: 'MATCHA15',
    voucher_type: 'discount',
    discount_type: 'percentage',
    discount_value: 15,
    is_active: true,
    usage_limit: null,
    used_count: 0,
    min_order_amount: 0,
    max_discount_value: null,
    valid_from: '2020-01-01',
    valid_to: '2099-12-31',
    applies_to: 'category',
    applicable_categories: ['matcha'],
    ...overrides
  };
}

test('spec example: matcha 15% only discounts Ayako', async () => {
  const service = loadService(voucher());
  const result = await service.validateAndCalculateVoucher({ code: 'matcha15', lines: [AYAKO, CHASEN] });
  assert.equal(result.isValid, true);
  assert.equal(result.eligibleSubtotal, 17);
  assert.equal(result.discountAmount, 2.55);
  assert.deepEqual(result.lines.map((line) => line.eligible), [true, false]);
  assert.equal(17 + 25 - result.discountAmount, 39.45);
});

test('cart with only out-of-scope items is rejected', async () => {
  const service = loadService(voucher());
  const result = await service.validateAndCalculateVoucher({ code: 'MATCHA15', lines: [CHASEN] });
  assert.equal(result.isValid, false);
  assert.equal(result.code, 'NO_ELIGIBLE_ITEMS');
  assert.equal(result.error, "This code doesn't apply to any item in your cart.");
});

test('Ritual Box and Starter Quiz kit lines are excluded even for a whole-order voucher', () => {
  const service = loadService(null);
  const { eligibleSubtotal, lines } = service.getEligibleItems(voucher({ applies_to: 'all', applicable_categories: null }), [AYAKO, RITUAL_BOX, QUIZ_KIT]);
  assert.equal(eligibleSubtotal, 17);
  assert.deepEqual(lines.map((line) => line.reason), [null, 'ritual_box', 'starter_kit']);
});

test('min order and max discount use the eligible subtotal', async () => {
  const short = loadService(voucher({ min_order_amount: 20 }));
  const below = await short.validateAndCalculateVoucher({ code: 'MATCHA15', lines: [AYAKO, CHASEN] });
  assert.equal(below.isValid, false);
  assert.equal(below.code, 'MIN_ORDER');
  assert.equal(below.missing, 3);

  const capped = loadService(voucher({ discount_value: 50, max_discount_value: 5 }));
  const result = await capped.validateAndCalculateVoucher({ code: 'MATCHA15', lines: [AYAKO, CHASEN] });
  assert.equal(result.discountAmount, 5);
});

test('fixed discount never exceeds the eligible subtotal', async () => {
  const service = loadService(voucher({ discount_type: 'fixed', discount_value: 30 }));
  const result = await service.validateAndCalculateVoucher({ code: 'MATCHA15', lines: [AYAKO, CHASEN] });
  assert.equal(result.discountAmount, 17);
});

test('a hidden product stays in the scope list but is no longer discounted', async () => {
  const service = loadService(voucher({ applies_to: 'product', applicable_categories: null, applicable_product_ids: ['p-ayako', 'p-chasen'] }));
  const result = await service.validateAndCalculateVoucher({
    code: 'MATCHA15',
    lines: [{ ...AYAKO, product_active: false }, CHASEN]
  });
  assert.equal(result.eligibleSubtotal, 25);
  assert.deepEqual(result.lines.map((line) => line.reason), ['unavailable', null]);
});

test('payload: category scope needs a category, product scope caps at 50, shipping is whole order', () => {
  const service = loadService(null);
  const base = { code: 'NOV', voucher_type: 'discount', discount_type: 'percentage', discount_value: 10, valid_from: '2026-11-15', valid_to: '2026-11-30' };
  assert.equal(service.validateVoucherPayload({ ...base, applies_to: 'category', applicable_categories: [] }).field, 'applicable_categories');
  const many = Array.from({ length: 51 }, (_, i) => `id${i}`);
  assert.equal(service.validateVoucherPayload({ ...base, applies_to: 'product', applicable_product_ids: many }).field, 'applicable_product_ids');
  assert.equal(service.validateVoucherPayload({ ...base, voucher_type: 'shipping', applies_to: 'category', applicable_categories: ['matcha'] }).field, 'applies_to');
  assert.equal(service.validateVoucherPayload({ ...base, applies_to: 'category', applicable_categories: ['matcha'] }, { purpose: 'complaint' }).field, 'applies_to');
  const ok = service.validateVoucherPayload({ ...base, applies_to: 'category', applicable_categories: ['Matcha', 'coffee'] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.applicable_categories, ['matcha', 'coffee']);
});

test('points to redeem: 0 / empty means none, capped by the next tier threshold', () => {
  const service = loadService(null);
  const base = { code: 'PTS', voucher_type: 'discount', discount_type: 'fixed', discount_value: 5, valid_from: '2026-11-15', valid_to: '2026-11-30' };
  assert.equal(service.validateVoucherPayload({ ...base, points_cost: 0 }).value.points_cost, null);
  assert.equal(service.validateVoucherPayload({ ...base, points_cost: '' }).value.points_cost, null);
  assert.equal(service.validateVoucherPayload({ ...base, points_cost: 500 }).value.points_cost, 500);
  assert.equal(service.validateVoucherPayload({ ...base, points_cost: 2001 }).field, 'points_cost');
  assert.equal(service.validateVoucherPayload({ ...base, target_tier: 'seed', points_cost: 151 }, { purpose: 'loyalty_redeem' }).field, 'points_cost');
  assert.equal(service.validateVoucherPayload({ ...base, target_tier: 'leaf', points_cost: 400 }, { purpose: 'loyalty_redeem' }).ok, true);
  assert.equal(service.validateVoucherPayload({ ...base, target_tier: 'bloom', points_cost: 1001 }, { purpose: 'loyalty_redeem' }).field, 'points_cost');
  assert.equal(service.validateVoucherPayload({ ...base, target_tier: 'zen', points_cost: 2000 }, { purpose: 'loyalty_redeem' }).ok, true);
  assert.equal(service.validateVoucherPayload({ ...base, points_cost: 100 }, { purpose: 'complaint' }).field, 'points_cost');
  assert.equal(service.validateVoucherPayload({ ...base, points_cost: 1.5 }).field, 'points_cost');
});

test('a voucher that costs points cannot be used at checkout until redeemed', async () => {
  const template = loadService(voucher({ points_cost: 500, assigned_user_id: null }));
  const refused = await template.validateAndCalculateVoucher({ code: 'MATCHA15', lines: [AYAKO] });
  assert.equal(refused.isValid, false);
  assert.equal(refused.code, 'REDEEM_REQUIRED');

  const copy = loadService(voucher({ points_cost: null, assigned_user_id: 'USR1' }));
  const ok = await copy.validateAndCalculateVoucher({ code: 'MATCHA15', userId: 'USR1', lines: [AYAKO] });
  assert.equal(ok.isValid, true);
});

test('payload: scope is locked after the first use', () => {
  const service = loadService(null);
  const existing = voucher({ applies_to: 'category', applicable_categories: ['matcha'] });
  const result = service.validateVoucherPayload(
    { code: 'MATCHA15', voucher_type: 'discount', discount_type: 'percentage', discount_value: 15, valid_from: '2026-11-15', valid_to: '2026-12-31', applies_to: 'all' },
    { usedCount: 3, existing }
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.applies_to, 'category');
  assert.deepEqual(result.value.applicable_categories, ['matcha']);
  assert.equal(result.value.valid_to, '2026-12-31');
});
