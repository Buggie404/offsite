const User = require('../models/User');
const Archetype = require('../models/RitualArchetype');
const axes = ['brightness', 'boldness', 'sweetness', 'skill', 'tempo'];

function snapshot(dna, archetype) {
  if (!dna || !archetype || !axes.every(axis => Number.isFinite(dna.taste_radar?.[axis]))) return null;
  return { archetype_id: dna.archetype_id, name: archetype.name,
    radar: Object.fromEntries(axes.map(axis => [axis, dna.taste_radar[axis]])) };
}

async function forUser(user) {
  if (!user.ritual_dna) return null;
  return snapshot(user.ritual_dna, await Archetype.findOne({ archetype_id: user.ritual_dna.archetype_id }).lean());
}

async function forLegacyPosts(posts) {
  const legacy = posts.filter(post => post.post_type === 'ritual_dna' && !post.ritual_preview);
  const previews = new Map();
  if (!legacy.length) return previews;
  const users = await User.find({ user_id: { $in: legacy.map(post => post.user_id) } }, 'user_id ritual_dna').lean();
  const archetypes = await Archetype.find({ archetype_id: { $in: users.map(user => user.ritual_dna?.archetype_id).filter(Boolean) } }).lean();
  for (const post of legacy) {
    const dna = users.find(user => user.user_id === post.user_id)?.ritual_dna;
    // Never substitute a newer profile for the historical card being shared.
    if (!dna || !(new Date(dna.updated_at) <= new Date(post.created_at))) continue;
    const preview = snapshot(dna, archetypes.find(type => type.archetype_id === dna.archetype_id));
    if (preview) previews.set(post.post_id, preview);
  }
  return previews;
}

module.exports = { forUser, forLegacyPosts };
