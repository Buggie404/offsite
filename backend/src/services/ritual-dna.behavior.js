const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Recipe = require('../models/Recipe');
const RitualArchetype = require('../models/RitualArchetype');
const { activeArchetypes } = require('./ritual-dna.archetype-release');
const { AXES } = require('./ritual-dna.config');
const { RULE_VERSION, productProfile, recipeProfile, orderProfile } = require('./ritual-dna.evidence');
const { recalculate } = require('./ritual-dna.evolution');
const EVENT_WEIGHTS = Object.freeze({ order: 6, product_saved: 1, recipe_saved: 2 });
const SAVE_DAILY_CAP = 3;

const hasSignal = profile => AXES.some(axis => profile?.[axis] != null);
const vnDay = date => new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

function productQuery(ids) {
  const raw = [...new Set(ids.map(String))];
  const objectIds = raw.filter(id => /^[a-f\d]{24}$/i.test(id)).map(id => new mongoose.Types.ObjectId(id));
  const numericIds = raw.filter(id => /^\d+$/.test(id)).map(Number);
  const or = [];
  if (objectIds.length) or.push({ _id: { $in: objectIds } });
  if (numericIds.length) or.push({ product_id: { $in: numericIds } });
  return or.length ? { $or: or } : null;
}

async function productsFor(ids) {
  const query = productQuery(ids);
  return query ? Product.find(query).select('_id product_id name category matcha coffee tools').lean() : [];
}

async function updateBehavior(userId, eventId, event = null, replacement = null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const user = await User.findOne({ user_id: userId, 'ritual_dna.quiz_taken_at': { $ne: null } })
      .select('ritual_dna').lean();
    if (!user?.ritual_dna?.quiz_baseline) return { applied: false, reason: 'no_quiz' };
    const dna = user.ritual_dna;
    const events = [...(dna.behavior_events || [])];
    const existing = events.find(row => row.event_id === eventId);
    const targetBefore = existing?.target_profile ? { ...existing.target_profile } : null;
    const now = new Date(Math.max(Date.now(), new Date(dna.updated_at).getTime() + 1));

    if (replacement) {
      if (!existing || existing.reversed_at) return { applied: false, reason: 'not_active' };
      if (!hasSignal(replacement.target_profile)) return { applied: false, reason: 'no_signal' };
      existing.target_profile = replacement.target_profile;
    } else if (event) {
      if (existing) return { applied: false, reason: 'already_recorded' };
      if (!hasSignal(event.target_profile)) return { applied: false, reason: 'no_signal' };
      if (new Date(event.at).getTime() < new Date(dna.quiz_taken_at).getTime()) return { applied: false, reason: 'before_quiz' };
      if (event.source === 'product_saved' || event.source === 'recipe_saved') {
        const count = events.filter(row => row.source === event.source && vnDay(row.at) === vnDay(event.at)).length;
        if (count >= SAVE_DAILY_CAP) return { applied: false, reason: 'daily_cap' };
      }
      events.push({ ...event, event_id: eventId, rule_version: RULE_VERSION, reversed_at: null });
    } else {
      if (!existing || existing.reversed_at) return { applied: false, reason: 'not_active' };
      existing.reversed_at = now;
    }

    const archetypes = await activeArchetypes();
    if (!archetypes.length) return { applied: false, reason: 'no_archetypes' };
    const next = recalculate(dna, events, archetypes, now);
    const delta = Object.fromEntries(AXES.map(axis => [axis, next.radar[axis] - dna.taste_radar[axis]]));
    const updated = {
      ...dna, behavior_events: events, taste_radar: next.radar,
      archetype_id: next.archetype?.archetype_id || dna.archetype_id,
      archetype_profile_version: next.archetypeChanged ? next.archetype.profile_version : dna.archetype_profile_version,
      last_archetype_change_at: next.archetypeChanged ? now : dna.last_archetype_change_at,
      updated_at: now,
      evolution_logs: [...(dna.evolution_logs || []), {
        event_id: event ? `apply:${eventId}` : `refund:${eventId}:${now.getTime()}`, at: now,
        source: event ? event.source : (replacement || existing.source === 'order' ? 'order_refund'
          : existing.source === 'product_saved' ? 'product_unsaved'
          : existing.source === 'recipe_saved' ? 'recipe_unsaved' : existing.source),
        source_id: event?.source_id || existing.source_id,
        rule_version: RULE_VERSION, radar_before: dna.taste_radar,
        target_profile_before: targetBefore,
        target_profile_after: event ? event.target_profile : replacement?.target_profile || null,
        delta, radar_after: next.radar, archetype_before: dna.archetype_id,
        archetype_id: next.archetype?.archetype_id || dna.archetype_id
      }]
    };
    const result = await User.updateOne(
      { _id: user._id, 'ritual_dna.updated_at': dna.updated_at },
      { $set: { ritual_dna: updated } }, { runValidators: true }
    );
    if (result.modifiedCount === 1) return { applied: true, radar: next.radar, archetypeChanged: next.archetypeChanged };
  }
  throw new Error(`Ritual DNA update conflict for ${eventId}`);
}

async function orderDelivered(order) {
  if (!order?.user_id || order.order_status !== 'delivered' || !order.order_id) return { applied: false };
  const products = await productsFor((order.items || []).map(item => item.product_id));
  return updateBehavior(order.user_id, `order:${order.order_id}`, {
    at: order.delivered_at || new Date(), source: 'order', source_id: order.order_id,
    weight: EVENT_WEIGHTS.order, target_profile: orderProfile(order, products)
  });
}

async function orderRefunded(order, refundItems = null) {
  if (!order?.user_id || order.order_status !== 'refund' || !order.order_id) return { applied: false };
  const eventId = `order:${order.order_id}`;
  if (!Array.isArray(refundItems) || !refundItems.length) return updateBehavior(order.user_id, eventId);
  const remaining = (order.items || []).map(item => {
    const refunded = refundItems.filter(line => String(line.product_id) === String(item.product_id)
      && String(line.variant_id) === String(item.variant_id))
      .reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    return { ...item, quantity: Math.max(0, Number(item.quantity || 0) - refunded) };
  }).filter(item => item.quantity > 0);
  if (!remaining.length) return updateBehavior(order.user_id, eventId);
  const products = await productsFor(remaining.map(item => item.product_id));
  const target = orderProfile({ items: remaining }, products);
  return hasSignal(target)
    ? updateBehavior(order.user_id, eventId, null, { target_profile: target })
    : updateBehavior(order.user_id, eventId);
}

async function savedProduct(userId, productId, saved) {
  const id = String(productId);
  const eventId = `product_saved:${id}`;
  if (!saved) return updateBehavior(userId, eventId);
  const products = await productsFor([id]);
  return updateBehavior(userId, eventId, {
    at: new Date(), source: 'product_saved', source_id: id,
    weight: EVENT_WEIGHTS.product_saved, target_profile: productProfile(products[0])
  });
}

async function savedRecipe(userId, recipeId, saved) {
  const id = String(recipeId);
  const eventId = `recipe_saved:${id}`;
  if (!saved) return updateBehavior(userId, eventId);
  const recipe = await Recipe.findOne({ recipe_id: id, published: true }).lean();
  if (!recipe) return { applied: false, reason: 'recipe_missing' };
  const products = await productsFor(recipe.relatedProducts || []);
  return updateBehavior(userId, eventId, {
    at: new Date(), source: 'recipe_saved', source_id: id,
    weight: EVENT_WEIGHTS.recipe_saved, target_profile: recipeProfile(recipe, products)
  });
}

module.exports = { orderDelivered, orderRefunded, savedProduct, savedRecipe, updateBehavior, EVENT_WEIGHTS, SAVE_DAILY_CAP };
