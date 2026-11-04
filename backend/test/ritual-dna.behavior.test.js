const test = require('node:test');
const assert = require('node:assert/strict');
const { ARCHETYPES } = require('../src/services/ritual-dna.config');
const Release = require('../src/models/RitualArchetypeRelease');
const { productProfile, orderProfile, recipeProfile } = require('../src/services/ritual-dna.evidence');
const { recalculate } = require('../src/services/ritual-dna.evolution');
const { updateBehavior } = require('../src/services/ritual-dna.behavior');
const User = require('../src/models/User');
const RitualArchetype = require('../src/models/RitualArchetype');

const baseline = { brightness: 70, boldness: 20, sweetness: 30, skill: 60, tempo: 30 };
const dna = {
  quiz_baseline: baseline, taste_radar: baseline,
  archetype_id: 'ARC0001', quiz_taken_at: new Date('2026-10-01'),
  last_archetype_change_at: new Date('2026-10-01')
};

test('delivered order shifts only axes supported by product metadata', () => {
  const event = { at: new Date('2026-10-10'), weight: 6, target_profile: { brightness: 20, boldness: 80 } };
  const result = recalculate(dna, [event], ARCHETYPES, new Date('2026-10-10'));
  assert.equal(result.radar.brightness, 68);
  assert.equal(result.radar.boldness, 23);
  assert.equal(result.radar.sweetness, 30);
  assert.equal(result.radar.skill, 60);
  assert.equal(result.radar.tempo, 30);
});

test('reversed evidence and behavior before the latest quiz leave baseline unchanged', () => {
  const target_profile = { brightness: 10, boldness: 90 };
  const events = [
    { at: new Date('2026-09-30'), weight: 6, target_profile },
    { at: new Date('2026-10-10'), weight: 6, target_profile, reversed_at: new Date('2026-10-11') }
  ];
  assert.deepEqual(recalculate(dna, events, ARCHETYPES).radar, baseline);
});

test('weak interest evidence does not switch archetype during cooldown', () => {
  const event = { at: new Date('2026-10-02'), weight: 1, target_profile: { sweetness: 100 } };
  const result = recalculate(dna, [event], ARCHETYPES, new Date('2026-10-02'));
  assert.equal(result.archetype.archetype_id, 'ARC0001');
  assert.equal(result.archetypeChanged, false);
});

test('catalog mapping uses actual matcha, coffee and tool fields but ignores generic drinkware and empty bundles', () => {
  assert.deepEqual(productProfile({ category: 'matcha', matcha: { product_grade: 'ceremonial grade' } }), { brightness: 72, boldness: 30 });
  assert.deepEqual(productProfile({ category: 'coffee', coffee: { roast_level: 'dark roast', tasting_notes: ['chocolate'] } }), { brightness: 20, boldness: 85, sweetness: 65 });
  assert.deepEqual(productProfile({ category: 'tools', tools: { tool_type: 'dripper' } }), { skill: 85, tempo: 35 });
  assert.deepEqual(productProfile({ category: 'drinkware' }), {});
  assert.deepEqual(productProfile({ category: 'sets_bundles', sets_bundles: { composition: [] } }), {});
});

test('order quantity is capped and recipe skill/tempo derive from metadata', () => {
  const products = [
    { _id: 'a', product_id: 1, category: 'matcha', matcha: { product_grade: 'ceremonial grade' } },
    { _id: 'b', product_id: 2, category: 'matcha', matcha: { product_grade: 'barista grade' } }
  ];
  const order = { items: [{ product_id: '1', quantity: 20 }, { product_id: '2', quantity: 1 }] };
  assert.equal(orderProfile(order, products).brightness, 57);
  assert.deepEqual(recipeProfile({ metadata: { difficulty: 'MEDIUM', prepTime: 8 } }), { skill: 55, tempo: 65 });
});

test('one source event applies once, partial refund adjusts it, full refund reverses it once', async () => {
  const originalFindOne = User.findOne;
  const originalUpdateOne = User.updateOne;
  const originalFindArchetypes = RitualArchetype.find;
  const originalFindRelease = Release.findOne;
  let stored = { _id: 'user-test', ritual_dna: {
    ...structuredClone(dna), updated_at: new Date('2026-10-01'),
    behavior_events: [], evolution_logs: []
  } };
  User.findOne = () => ({ select: () => ({ lean: async () => structuredClone(stored) }) });
  User.updateOne = async (filter, update) => {
    if (filter['ritual_dna.updated_at'].getTime() !== stored.ritual_dna.updated_at.getTime()) return { modifiedCount: 0 };
    stored.ritual_dna = structuredClone(update.$set.ritual_dna);
    return { modifiedCount: 1 };
  };
  RitualArchetype.find = () => ({ lean: async () => ARCHETYPES });
  Release.findOne = () => ({ lean: async () => ({ version: 1, archetypes: ARCHETYPES.map(row => ({ ...row, is_active: true })) }) });
  try {
    const event = { at: new Date('2026-10-10'), source: 'order', source_id: 'OFS-1', weight: 6, target_profile: { brightness: 20, boldness: 80 } };
    assert.equal((await updateBehavior('USR1', 'order:OFS-1', event)).applied, true);
    assert.equal((await updateBehavior('USR1', 'order:OFS-1', event)).reason, 'already_recorded');
    assert.equal(stored.ritual_dna.behavior_events.length, 1);
    assert.equal(stored.ritual_dna.taste_radar.brightness, 68);
    assert.equal((await updateBehavior('USR1', 'order:OFS-1', null, { target_profile: { brightness: 60, boldness: 30 } })).applied, true);
    assert.equal(stored.ritual_dna.behavior_events[0].target_profile.brightness, 60);
    assert.equal(stored.ritual_dna.taste_radar.brightness, 70);
    assert.equal((await updateBehavior('USR1', 'order:OFS-1')).applied, true);
    assert.equal((await updateBehavior('USR1', 'order:OFS-1')).reason, 'not_active');
    assert.equal((await updateBehavior('USR1', 'order:OFS-1', event)).reason, 'already_recorded');
    assert.deepEqual(stored.ritual_dna.taste_radar, baseline);
    await new User({ user_id: 'SCHEMA_ONLY', profile_name: 'Schema check', ritual_dna: stored.ritual_dna }).validate();
  } finally {
    User.findOne = originalFindOne;
    User.updateOne = originalUpdateOne;
    RitualArchetype.find = originalFindArchetypes;
    Release.findOne = originalFindRelease;
  }
});
