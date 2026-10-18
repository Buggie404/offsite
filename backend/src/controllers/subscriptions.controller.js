const { resolveUserIdString } = require('./cart.controller');
const { getRitualBox, applyAction, SubscriptionActionError } = require('../services/subscription.service');

// GET /api/subscriptions  (authenticated) — Ritual Box: subscriptions + delivery history.
async function getMySubscriptions(req, res) {
  try {
    const userIdStr = await resolveUserIdString(req.user);
    if (!userIdStr) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    return res.json(await getRitualBox(userIdStr));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// PATCH /api/subscriptions/:id  (authenticated)
// Body: { action: 'skip' | 'pause' | 'resume' | 'frequency' | 'payment_method' | 'use_replacement' | 'cancel', ...payload }
async function updateSubscription(req, res) {
  try {
    const userIdStr = await resolveUserIdString(req.user);
    if (!userIdStr) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    const { action, ...payload } = req.body || {};
    return res.json(await applyAction(userIdStr, req.params.id, action, payload));
  } catch (error) {
    if (error instanceof SubscriptionActionError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: error.message });
  }
}

module.exports = { getMySubscriptions, updateSubscription };
