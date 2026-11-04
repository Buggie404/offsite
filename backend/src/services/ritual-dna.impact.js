const { AXES } = require('./ritual-dna.config');
const { distance } = require('./ritual-dna.evolution');

function nearestArchetype(radar, archetypes) {
  return archetypes.reduce((closest, row) => {
    if (!closest) return row;
    const difference = distance(radar, row.taste_profile) - distance(radar, closest.taste_profile);
    return difference < 0 || (difference === 0 && row.archetype_id < closest.archetype_id) ? row : closest;
  }, null);
}

async function simulateSignatureImpact(profiles, current, proposed, selectedId) {
  const fromCounts = new Map();
  let totalProfiles = 0;
  let changedNearest = 0;
  let towardSelected = 0;

  for await (const profile of profiles) {
    const radar = profile.ritual_dna?.taste_radar;
    if (!radar || AXES.some(axis => !Number.isFinite(radar[axis]))) continue;
    const before = nearestArchetype(radar, current);
    const after = nearestArchetype(radar, proposed);
    if (!before || !after) continue;
    totalProfiles++;
    if (before.archetype_id === after.archetype_id) continue;
    changedNearest++;
    if (after.archetype_id === selectedId) {
      towardSelected++;
      fromCounts.set(before.archetype_id, (fromCounts.get(before.archetype_id) || 0) + 1);
    }
  }

  const mostCommonOrigin = [...fromCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return { total_profiles: totalProfiles, changed_nearest: changedNearest, toward_selected: towardSelected,
    most_common_origin_id: mostCommonOrigin?.[0] || null, most_common_origin_count: mostCommonOrigin?.[1] || 0 };
}

module.exports = { nearestArchetype, simulateSignatureImpact };
