const mongoose = require('mongoose');

const AXES = ['brightness', 'boldness', 'sweetness', 'skill', 'tempo'];
const optionalAxis = { type: Number, min: 0, max: 100, default: null };

const radarSchema = new mongoose.Schema(
  Object.fromEntries(AXES.map(axis => [axis, { type: Number, required: true, min: 0, max: 100 }])),
  { _id: false, strict: 'throw' }
);

const partialRadarSchema = new mongoose.Schema(
  Object.fromEntries(AXES.map(axis => [axis, optionalAxis])),
  { _id: false, strict: 'throw' }
);

const deltaRadarSchema = new mongoose.Schema(
  Object.fromEntries(AXES.map(axis => [axis, { type: Number, min: -100, max: 100, default: null }])),
  { _id: false, strict: 'throw' }
);

const evolutionLogSchema = new mongoose.Schema({
  event_id: { type: String, required: true },
  at: { type: Date, required: true },
  source: { type: String, required: true },
  source_id: { type: String, default: null },
  rule_version: { type: String, required: true },
  radar_before: { type: radarSchema, default: null },
  target_profile_before: { type: partialRadarSchema, default: null },
  target_profile_after: { type: partialRadarSchema, default: null },
  delta: { type: deltaRadarSchema, required: true },
  radar_after: { type: radarSchema, required: true },
  archetype_before: { type: String, default: null },
  archetype_id: { type: String, required: true },
  reversed_at: { type: Date, default: null }
}, { _id: false });

const behaviorEventSchema = new mongoose.Schema({
  event_id: { type: String, required: true },
  at: { type: Date, required: true },
  source: { type: String, required: true },
  source_id: { type: String, required: true },
  // These are evidence weights, not points added to the radar.
  weight: { type: Number, required: true, min: 0, max: 10 },
  target_profile: { type: partialRadarSchema, required: true },
  rule_version: { type: String, required: true },
  reversed_at: { type: Date, default: null }
}, { _id: false });

const ritualDnaSchema = new mongoose.Schema({
  archetype_id: { type: String, required: true },
  archetype_profile_version: { type: Number, default: 1, min: 1 },
  taste_radar: { type: radarSchema, required: true },
  quiz_baseline: { type: radarSchema, required: true },
  quiz_version: { type: String, default: null },
  quiz_mode: { type: String, enum: ['full', 'confirmation', 'estimated'], default: 'full' },
  quiz_taken_at: { type: Date, default: null },
  evolution_logs: { type: [evolutionLogSchema], default: [] },
  behavior_events: { type: [behaviorEventSchema], default: [] },
  is_estimated: { type: Boolean, default: false },
  updated_at: { type: Date, required: true },
  last_archetype_change_at: { type: Date, default: null },
  drink_lean: { type: Number, min: 0, max: 100, default: null },
  lean_confirmed: { type: Boolean, default: null },
  equipment_level: { type: String, enum: ['none', 'basic', 'full', null], default: null },
  flavor_tags: { type: [String], default: [] },
  intensity_preference: { type: String, default: null },
  servings: { type: [String], default: [] },
  occasions: { type: [String], default: [] },
  quiz_answers: { type: [new mongoose.Schema({
    question_id: { type: String, required: true },
    option_ids: { type: [String], required: true }
  }, { _id: false })], default: [] }
}, { _id: false });

module.exports = { AXES, ritualDnaSchema };
