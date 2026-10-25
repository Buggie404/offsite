const adminSubscriptionService = require('../services/admin-subscription.service');
const { SubscriptionActionError } = require('../services/subscription.service');

const FILTERS = ['all', 'active', 'needs_action', 'paused', 'cancelled'];
// Staff can't charge a card or change the schedule directly: no 'reactivate' / 'frequency'.
const ACTIONS = ['pause', 'skip', 'unpause', 'propose', 'withdraw_proposal', 'cancel', 'note'];

// action_type follows the shared entity.action convention (e.g. subscription.cancel).
const ACTIVITY_TYPES = Object.fromEntries(ACTIONS.map(a => [a, `subscription.${a}`]));

function sendError(res, error, fallback) {
  if (error instanceof SubscriptionActionError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

// Only the fields an admin changes — keeps ActivityLogs readable.
function activitySnapshot(sub) {
  return {
    status: sub.status,
    frequency_days: sub.frequency_days,
    next_charge_at: sub.next_charge_at,
    pause_option: sub.pause_option,
    resume_at: sub.resume_at,
    cancel_reason: sub.cancel_reason,
    replacement_offer: sub.replacement_offer,
    admin_proposal: sub.admin_proposal || null,
    skipped_deliveries: (sub.skipped_deliveries || []).length,
    internal_note: sub.internal_note?.text ?? ''
  };
}

// GET /api/admin/subscriptions
async function getSubscriptions(req, res) {
  try {
    const filter = FILTERS.includes(req.query.status) ? req.query.status : 'all';
    const result = await adminSubscriptionService.listSubscriptions({ filter, search: req.query.search });
    res.json(result);
  } catch (error) {
    sendError(res, error, 'Failed to load subscriptions.');
  }
}

// GET /api/admin/subscriptions/:id
async function getSubscription(req, res) {
  try {
    const data = await adminSubscriptionService.getSubscriptionDetail(req.params.id, req.user.role);
    res.json({ data });
  } catch (error) {
    sendError(res, error, 'Failed to load subscription.');
  }
}

// POST /api/admin/subscriptions/:id/:action
async function runAction(req, res) {
  const { id, action } = req.params;
  if (!ACTIONS.includes(action)) return res.status(404).json({ error: 'Unknown action.' });
  try {
    const { before, after } = await adminSubscriptionService.applyAdminAction(
      id, action, req.body || {}, String(req.user.user_id), req.user.role
    );
    const ticketId = typeof req.body?.ticket_id === 'string' ? req.body.ticket_id.trim().slice(0, 100) : '';
    await req.writeActivityLog({
      actionType: ACTIVITY_TYPES[action],
      targetEntity: 'Subscriptions',
      targetId: id,
      oldValue: activitySnapshot(before),
      newValue: { ...activitySnapshot(after), ticket_id: ticketId || null }
    });
    const data = await adminSubscriptionService.getSubscriptionDetail(id, req.user.role);
    res.json({ data });
  } catch (error) {
    sendError(res, error, 'Failed to update subscription.');
  }
}

module.exports = { getSubscriptions, getSubscription, runAction };
