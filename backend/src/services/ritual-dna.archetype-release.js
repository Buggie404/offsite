const Release = require('../models/RitualArchetypeRelease');
const RitualArchetype = require('../models/RitualArchetype');
const { AXES } = require('./ritual-dna.config');

const fields = row => ({ archetype_id: row.archetype_id, name: row.name, tagline: row.tagline || '',
  description: row.description, badge_icon: row.badge_icon || '', taste_profile: row.taste_profile,
  is_active: row.is_active !== false });

function validate(rows) {
  if (!Array.isArray(rows) || rows.length !== 4) return 'A release must contain exactly four archetypes.';
  const ids = new Set();
  const names = new Set();
  for (const row of rows) {
    if (!row || !/^ARC\d{4}$/.test(row.archetype_id) || ids.has(row.archetype_id)) return 'Archetype IDs must be unique and valid.';
    ids.add(row.archetype_id);
    const name = String(row.name || '').trim();
    if (!name || names.has(name.toLowerCase()) || !String(row.description || '').trim()) return 'Each archetype needs a unique name and description.';
    names.add(name.toLowerCase());
    if (typeof row.is_active !== 'boolean') return 'Each archetype needs a valid status.';
    if (AXES.some(axis => !Number.isInteger(row.taste_profile?.[axis]) || row.taste_profile[axis] < 0 || row.taste_profile[axis] > 100)) return 'Signature values must be integers from 0 to 100.';
  }
  if (rows.some(row => !row.is_active)) return 'All four archetypes must be active for the current quiz.';
  return null;
}

async function activeArchetypes() {
  const active = await Release.findOne({ status: 'active' }).lean();
  return active ? active.archetypes.filter(row => row.is_active).map(row => ({ ...row, profile_version: active.version }))
    : RitualArchetype.find({ is_active: true }).lean();
}

async function archetypeForProfile(id, version) {
  const release = await Release.findOne({ version: version || 1, status: { $in: ['active', 'archived'] } }).lean();
  const row = release?.archetypes.find(item => item.archetype_id === id);
  return row ? { ...row, profile_version: release.version } : RitualArchetype.findOne({ archetype_id: id }).lean();
}

async function bootstrap() {
  const existing = await Release.findOne({ status: 'active' }).lean();
  if (existing) return existing;
  const legacy = await RitualArchetype.find().sort({ archetype_id: 1 }).lean();
  const error = validate(legacy.map(fields));
  if (error) throw new Error(`Cannot import current archetypes: ${error}`);
  try { return await Release.create({ version: 1, status: 'active', archetypes: legacy.map(fields), published_at: new Date() }); }
  catch (err) {
    if (err.code === 11000) return Release.findOne({ status: 'active' }).lean();
    throw err;
  }
}

module.exports = { activeArchetypes, archetypeForProfile, bootstrap, validate, fields };
