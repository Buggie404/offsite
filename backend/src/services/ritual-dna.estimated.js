const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { AXES } = require('./ritual-dna.config');
const { orderProfile, combineProfiles } = require('./ritual-dna.evidence');

function nearest(radar, archetypes) {
  const distance = type => AXES.reduce((sum, axis) => sum + (radar[axis] - type.taste_profile[axis]) ** 2, 0);
  return [...archetypes].sort((a, b) => distance(a) - distance(b) || a.archetype_id.localeCompare(b.archetype_id))[0];
}

function buildEstimate(orders, products, archetypes) {
  if (orders.length < 3 || !archetypes.length) return null;
  const recent = orders.slice(0, 20);
  const events = [...recent].reverse().map(order => ({ event_id: `order:${order.order_id}`, at: order.delivered_at || order.created_at,
    source: 'order', source_id: order.order_id, weight: 1, target_profile: orderProfile(order, products), rule_version: 'estimated-1' }));
  const observed = combineProfiles(events.map(event => ({ profile: event.target_profile, weight: 1 })));
  const radar = Object.fromEntries(AXES.map(axis => [axis, observed[axis] ?? 50]));
  const archetype = nearest(radar, archetypes);
  const byId = new Map(products.flatMap(product => [[String(product._id), product], [String(product.product_id), product]]));
  let matcha = 0, coffee = 0;
  for (const order of recent) {
    const categories = new Set(order.items.filter(item => !item.out_of_stock).map(item => byId.get(String(item.product_id))?.category));
    if (categories.has('matcha')) matcha++;
    if (categories.has('coffee')) coffee++;
  }
  const now = new Date();
  return { archetype_id: archetype.archetype_id, archetype_profile_version: archetype.profile_version || 1,
    taste_radar: radar, quiz_baseline: radar, quiz_taken_at: null, quiz_version: null, quiz_mode: 'estimated',
    is_estimated: true, updated_at: now, last_archetype_change_at: now, behavior_events: events,
    drink_lean: matcha + coffee ? Math.round(100 * matcha / (matcha + coffee)) : 50,
    lean_confirmed: false, equipment_level: observed.skill == null ? null : observed.skill >= 80 ? 'full' : 'basic',
    intensity_preference: observed.boldness == null ? null : observed.boldness >= 75 ? 'very_bold' : observed.boldness >= 60 ? 'bold' : observed.boldness >= 35 ? 'balanced' : 'light',
    flavor_tags: [], servings: [], occasions: [], evolution_logs: [], quiz_answers: [] };
}

async function estimateFor(user, archetypes) {
  if (user.ritual_dna?.quiz_taken_at) return null;
  const orders = await Order.find({ user_id: user.user_id, order_status: 'delivered' }).sort({ delivered_at: -1, created_at: -1 }).limit(20).lean();
  if (orders.length < 3) return null;
  const ids = [...new Set(orders.flatMap(order => order.items.map(item => String(item.product_id))))];
  const queries = [];
  const numeric = ids.filter(id => /^\d+$/.test(id)).map(Number);
  const objects = ids.filter(id => /^[a-f\d]{24}$/i.test(id)).map(id => new mongoose.Types.ObjectId(id));
  if (numeric.length) queries.push({ product_id: { $in: numeric } });
  if (objects.length) queries.push({ _id: { $in: objects } });
  const products = queries.length ? await Product.find({ $or: queries }).lean() : [];
  return buildEstimate(orders, products, archetypes);
}

module.exports = { estimateFor, buildEstimate, nearest };
