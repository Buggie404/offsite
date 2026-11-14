const { AXES } = require('./ritual-dna.config');

const EVIDENCE_TARGET = 50;
const MAX_BEHAVIOR_SHARE = .4;
const ARCHETYPE_MARGIN = 10;
const ARCHETYPE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function distance(radar, target) {
  return Math.sqrt(AXES.reduce((sum, axis) => sum + (radar[axis] - target[axis]) ** 2, 0));
}

function recalculate(dna, events, archetypes, now = new Date()) {
  const baseline = dna.quiz_baseline;
  const quizTime = new Date(dna.quiz_taken_at || 0).getTime();
  let active = events.filter(event => !event.reversed_at && (dna.quiz_mode === 'confirmation' || new Date(event.at).getTime() >= quizTime));
  if (dna.quiz_mode === 'confirmation') active = active.slice(-20).map(event => ({ ...event,
    weight: ({ order: 1, product_saved: .4, recipe_saved: .6 })[event.source] ?? event.weight }));
  const radar = {};
  for (const axis of AXES) {
    const signals = active.filter(event => event.target_profile?.[axis] != null);
    const weight = signals.reduce((sum, event) => sum + Number(event.weight || 0), 0);
    if (!weight) { radar[axis] = dna.quiz_mode === 'confirmation' ? Math.round(.6 * baseline[axis] + .4 * 50) : baseline[axis]; continue; }
    const average = signals.reduce((sum, event) => sum + event.target_profile[axis] * event.weight, 0) / weight;
    const share = dna.quiz_mode === 'confirmation' ? .4 : MAX_BEHAVIOR_SHARE * Math.min(weight / EVIDENCE_TARGET, 1);
    radar[axis] = Math.round(Math.max(0, Math.min(100, baseline[axis] * (1 - share) + average * share)));
  }

  const candidates = [...archetypes].sort((a, b) => distance(radar, a.taste_profile) - distance(radar, b.taste_profile)
    || a.archetype_id.localeCompare(b.archetype_id));
  const candidate = candidates[0];
  const current = archetypes.find(item => item.archetype_id === dna.archetype_id);
  const lastChanged = dna.last_archetype_change_at ? new Date(dna.last_archetype_change_at).getTime() : 0;
  const cooledDown = !lastChanged || now.getTime() - lastChanged >= ARCHETYPE_COOLDOWN_MS;
  const better = candidate && current && distance(radar, current.taste_profile) - distance(radar, candidate.taste_profile) >= ARCHETYPE_MARGIN;
  const changed = !!candidate && candidate.archetype_id !== dna.archetype_id && (!current || (cooledDown && better));
  return { radar, archetype: changed ? candidate : current || candidate, archetypeChanged: changed };
}

module.exports = { recalculate, distance, EVIDENCE_TARGET, MAX_BEHAVIOR_SHARE, ARCHETYPE_MARGIN, ARCHETYPE_COOLDOWN_MS };
