const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateSignatureImpact } = require('../src/services/ritual-dna.impact');

const radar = brightness => ({ brightness, boldness: 50, sweetness: 50, skill: 50, tempo: 50 });
const archetype = (archetype_id, brightness) => ({ archetype_id, taste_profile: radar(brightness) });

test('impact simulation counts changed nearest matches without treating them as reassigned profiles', async () => {
  const current = [archetype('ARC0001', 20), archetype('ARC0002', 80)];
  const proposed = [archetype('ARC0001', 60), archetype('ARC0002', 80)];
  const profiles = [10, 45, 70, 90].map(value => ({ ritual_dna: { taste_radar: radar(value) } }));

  const impact = await simulateSignatureImpact(profiles, current, proposed, 'ARC0001');
  assert.deepEqual(impact, {
    total_profiles: 4, changed_nearest: 1, toward_selected: 1,
    most_common_origin_id: 'ARC0002', most_common_origin_count: 1
  });
});

test('impact simulation excludes profiles with incomplete radars', async () => {
  const rows = [archetype('ARC0001', 20), archetype('ARC0002', 80)];
  const impact = await simulateSignatureImpact([
    { ritual_dna: { taste_radar: radar(50) } },
    { ritual_dna: { taste_radar: { brightness: 50 } } }
  ], rows, rows, 'ARC0001');
  assert.equal(impact.total_profiles, 1);
  assert.equal(impact.changed_nearest, 0);
});
