const Subscription = require('../models/Subscription');
const Order = require('../models/Order');
const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');
const notificationService = require('./notification.service');
const {
  SubscriptionActionError,
  FREQUENCIES,
  PAUSE_OPTIONS,
  CLOSED_STATUSES,
  findProduct,
  pickImage,
  cardBrand,
  findReplacement,
  applyDueTransitions,
  orderHistoryStatus,
  shapePendingChanges
} = require('./subscription.service');

// Admin side of Ritual Box (screen 1.6.1 Subscriptions). Rules: "Project Planning & Prep 2" —
// QLSP và Admin CC xem danh sách, đổi tần suất, huỷ (cancelled_by_admin, bắt buộc lý do),
// kích hoạt lại; mọi hành động ghi ActivityLogs (controller).

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);
const round2 = n => Math.round(n * 100) / 100;

const NEEDS_ACTION_STATUSES = ['payment_failed', 'suspended'];

// ─── Permissions (Ritual Box admin plan) ──────────────────────────
// Staff act directly only when it protects the customer (no extra charge, reversible).
// Anything that changes what or when the customer is charged is a PROPOSAL the
// customer accepts in Ritual Box. Acting on the customer's request needs a ticket id.
//   QLSP     – merchandising: out of stock, discontinued products.
//   Admin CC – customer requests (with ticket) and payment / policy cases.
//   CSKH     – read only + internal notes.
// Nobody on staff can charge a customer's card.
const PROPOSAL_TTL_DAYS = 3;
const NOTICE_HOURS = 48;
const CUSTOMER_REQUEST = 'Customer asked us';

const ROLE_RULES = {
  qlsp: {
    actions: ['pause', 'skip', 'unpause', 'cancel', 'note'],
    pause_reasons: ['Item out of stock'],
    skip_reasons: ['Item out of stock'],
    cancel_reasons: ['Product discontinued']
  },
  admin_cc: {
    actions: ['pause', 'skip', 'unpause', 'cancel', 'propose', 'withdraw_proposal', 'note'],
    pause_reasons: [CUSTOMER_REQUEST],
    skip_reasons: [CUSTOMER_REQUEST],
    cancel_reasons: [CUSTOMER_REQUEST, 'Repeated payment failure', 'Policy violation']
  },
  cskh: {
    actions: ['note'],
    pause_reasons: [],
    skip_reasons: [],
    cancel_reasons: []
  }
};

function rulesFor(role) {
  return ROLE_RULES[role] || { actions: [], pause_reasons: [], skip_reasons: [], cancel_reasons: [] };
}

/** What this staff member may do on this box — drives the admin drawer. */
function permissionsFor(role, sub) {
  const rules = rulesFor(role);
  const closed = CLOSED_STATUSES.includes(sub.status);
  const failed = NEEDS_ACTION_STATUSES.includes(sub.status);
  const can = action => rules.actions.includes(action) && (!closed || action === 'note');
  return {
    role,
    pause: can('pause') && sub.status === 'active',
    skip: can('skip') && sub.status === 'active',
    unpause: can('unpause') && sub.status === 'paused' && sub.paused_by === 'admin',
    cancel: can('cancel') && !closed,
    propose_frequency: can('propose') && sub.status === 'active' && !sub.admin_proposal,
    propose_resume: can('propose') && sub.status === 'paused' && sub.paused_by !== 'admin' && !sub.admin_proposal,
    withdraw_proposal: can('withdraw_proposal') && !!sub.admin_proposal,
    note: rules.actions.includes('note'),
    pause_reasons: rules.pause_reasons,
    skip_reasons: rules.skip_reasons,
    // "Repeated payment failure" only once the box is suspended.
    cancel_reasons: rules.cancel_reasons.filter(r => r !== 'Repeated payment failure' || sub.status === 'suspended'),
    ticket_required_for: [CUSTOMER_REQUEST],
    failed
  };
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function productLabel(product, variant) {
  return [product?.name || 'Unavailable product', variant?.label].filter(Boolean).join(' ');
}

// Out of stock only matters while deliveries are still coming.
function isOutOfStock(sub, variant) {
  return ['active', 'paused'].includes(sub.status) && (!variant || (variant.stock ?? 0) <= 0);
}

function needsAction(row) {
  return row.out_of_stock && row.status === 'active' || NEEDS_ACTION_STATUSES.includes(row.status);
}

async function loadCustomers(userIds) {
  const users = await User.find({ user_id: { $in: [...new Set(userIds)] } })
    .select('user_id profile_name email payment_methods').lean();
  return new Map(users.map(u => [u.user_id, u]));
}

async function shapeRow(sub, user) {
  const product = await findProduct(sub.product_id);
  const variant = (product?.variants || []).find(v => v.sku === sub.variant_id) || null;
  const name = user?.profile_name || sub.delivery_info?.recipient_name || sub.user_id;
  return {
    subscription_id: sub.subscription_id,
    customer: { user_id: sub.user_id, name, initials: initialsOf(name), email: user?.email || null },
    product_name: product?.name || 'Unavailable product',
    variant_label: variant?.label || '',
    box: productLabel(product, variant),
    image: pickImage(product, variant),
    quantity: sub.quantity,
    frequency_days: sub.frequency_days,
    // Paused / cancelled boxes have no upcoming delivery.
    next_charge_at: ['active', 'payment_failed'].includes(sub.status) ? sub.next_charge_at : null,
    status: sub.status,
    out_of_stock: isOutOfStock(sub, variant),
    price: round2(sub.pricing_snapshot.subscribe_price * sub.quantity),
    created_at: sub.created_at
  };
}

function matchesSearch(row, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const compactId = q.replace(/-/g, '');
  return row.subscription_id.toLowerCase().includes(compactId)
    || row.customer.name.toLowerCase().includes(q)
    || (row.customer.email || '').toLowerCase().includes(q)
    || row.box.toLowerCase().includes(q);
}

function matchesFilter(row, filter) {
  switch (filter) {
    case 'active': return row.status === 'active';
    case 'needs_action': return needsAction(row);
    case 'paused': return row.status === 'paused';
    case 'cancelled': return CLOSED_STATUSES.includes(row.status);
    default: return true;
  }
}

async function listSubscriptions({ filter = 'all', search = '' } = {}) {
  const now = new Date();
  const docs = await Subscription.find({}).sort({ created_at: -1 });
  for (const doc of docs) await applyDueTransitions(doc, now);

  const customers = await loadCustomers(docs.map(d => d.user_id));
  const rows = await Promise.all(docs.map(d => shapeRow(d.toObject(), customers.get(d.user_id))));

  const stats = {
    active: rows.filter(r => r.status === 'active').length,
    affected_by_stock: rows.filter(r => r.out_of_stock && r.status === 'active').length,
    paused: rows.filter(r => r.status === 'paused').length,
    needs_action: rows.filter(needsAction).length
  };

  const query = String(search || '').trim();
  return {
    data: rows.filter(r => matchesFilter(r, filter) && matchesSearch(r, query)),
    stats
  };
}

async function getSubscriptionDetail(subscriptionId, role = null) {
  const sub = await Subscription.findOne({ subscription_id: subscriptionId });
  if (!sub) throw new SubscriptionActionError('Subscription not found.', 404);
  await applyDueTransitions(sub, new Date());

  const plain = sub.toObject();
  const user = (await loadCustomers([plain.user_id])).get(plain.user_id);
  const row = await shapeRow(plain, user);

  const product = await findProduct(plain.product_id);
  const variant = (product?.variants || []).find(v => v.sku === plain.variant_id) || null;
  const cardDoc = (user?.payment_methods || []).find(pm => String(pm._id) === String(plain.payment_method_id));
  const digits = String(cardDoc?.card_number || '').replace(/\D/g, '');

  const orders = await Order.find({ subscription_id: plain.subscription_id })
    .sort({ created_at: -1 }).limit(20).lean();
  // The checkout order that started the box is the first delivery.
  const sourceOrder = plain.source_order_id
    ? await Order.findOne({ order_id: plain.source_order_id }).lean()
    : null;
  const allOrders = [...orders, ...(sourceOrder ? [sourceOrder] : [])];
  const deliveries = allOrders.map(o => ({
    date: o.created_at,
    order_id: o.order_id,
    result: orderHistoryStatus(o)
  }));

  let replacement = null;
  if (plain.replacement_offer) {
    const rp = await findProduct(plain.replacement_offer.product_id);
    const rv = (rp?.variants || []).find(v => v.sku === plain.replacement_offer.variant_id);
    if (rp && rv) {
      replacement = {
        product_id: plain.replacement_offer.product_id,
        variant_id: rv.sku,
        name: rp.name,
        variant_label: rv.label || '',
        image: pickImage(rp, rv),
        price: rv.price,
        offered: true
      };
    }
  }
  if (!replacement && row.out_of_stock) {
    replacement = await findReplacement(product, variant || { price: plain.pricing_snapshot.original_price });
  }

  return {
    ...row,
    pricing: {
      original_price: plain.pricing_snapshot.original_price,
      subscribe_price: plain.pricing_snapshot.subscribe_price,
      discount_percent: plain.pricing_snapshot.discount_percent
    },
    card: cardDoc ? { brand: cardBrand(cardDoc), last4: digits.slice(-4) } : null,
    pause_option: plain.pause_option,
    resume_at: plain.resume_at,
    upcoming_delivery_at: plain.next_charge_at,
    // The delivery after the upcoming one — for "from the following delivery" / "after the next delivery".
    following_delivery_at: addDays(plain.next_charge_at, plain.frequency_days),
    pending_changes: shapePendingChanges(plain),
    failed_attempts: plain.failed_attempts || 0,
    last_failure_reason: plain.last_failure_reason,
    cancelled_at: plain.cancelled_at,
    cancel_reason: plain.cancel_reason,
    replacement,
    deliveries,
    // Orders already charged keep shipping after a cancel.
    open_order_ids: allOrders
      .filter(o => ['pending', 'processing', 'shipping'].includes(o.order_status))
      .map(o => o.order_id),
    messages: [...(plain.admin_messages || [])].reverse(),
    paused_by: plain.paused_by || null,
    admin_proposal: plain.admin_proposal
      ? {
          type: plain.admin_proposal.type,
          frequency_days: plain.admin_proposal.frequency_days || null,
          reason: plain.admin_proposal.reason || null,
          message: plain.admin_proposal.message || '',
          ticket_id: plain.admin_proposal.ticket_id || null,
          proposed_at: plain.admin_proposal.proposed_at,
          expires_at: plain.admin_proposal.expires_at
        }
      : null,
    permissions: permissionsFor(role, plain),
    internal_note: plain.internal_note?.text || '',
    internal_note_updated_at: plain.internal_note?.updated_at || null
  };
}

async function notifyCustomer(sub, type, message) {
  await notificationService.notifySubscription(sub, type, message);
}

function cleanText(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Runs one admin action; returns { before, after } plain snapshots for the activity log.
async function applyAdminAction(subscriptionId, action, payload, adminId, role) {
  const sub = await Subscription.findOne({ subscription_id: subscriptionId });
  if (!sub) throw new SubscriptionActionError('Subscription not found.', 404);
  const now = new Date();
  await applyDueTransitions(sub, now);
  const before = sub.toObject();
  if (!sub.pending_changes) sub.pending_changes = {};

  const rules = rulesFor(role);
  if (!rules.actions.includes(action)) {
    throw new SubscriptionActionError('Your role can’t do this on a Ritual Box.', 403);
  }
  if (CLOSED_STATUSES.includes(sub.status) && action !== 'note') {
    throw new SubscriptionActionError('This subscription has been cancelled.');
  }

  const message = cleanText(payload.message);
  const ticketId = cleanText(payload.ticket_id, 100) || null;
  // The ticket is the customer's support chat — it must exist and belong to this box's owner.
  if (ticketId && !(await ChatConversation.exists({ conversation_id: ticketId, customer_id: sub.user_id }))) {
    throw new SubscriptionActionError('Ticket not found in this customer’s support chats.');
  }
  const requireReason = (allowed, reason, label) => {
    if (!allowed.includes(reason)) throw new SubscriptionActionError(`Choose a reason to ${label}.`);
    // Acting on the customer's behalf needs the support ticket as proof of the request.
    if (reason === CUSTOMER_REQUEST && !ticketId) {
      throw new SubscriptionActionError('Add the support ticket id of the customer’s request.');
    }
  };
  const log = (logAction, reason = null) =>
    sub.admin_messages.push({ action: logAction, reason, message, ticket_id: ticketId, sent_by: adminId, sent_at: now });

  switch (action) {
    // Protective: stops charges right away; the customer is told and can resume it themselves.
    case 'pause': {
      if (sub.status !== 'active') throw new SubscriptionActionError('Only active subscriptions can be paused.');
      const reason = cleanText(payload.reason, 200);
      requireReason(rules.pause_reasons, reason, 'pause');
      const option = payload.pause_option || 'until_reactivated';
      if (!(option in PAUSE_OPTIONS)) throw new SubscriptionActionError('Choose how long to pause.');
      const affects = payload.affects || 'next';
      if (!['next', 'following'].includes(affects)) throw new SubscriptionActionError('Choose which delivery to pause from.');

      if (affects === 'following') {
        if (payload.offer_replacement) {
          throw new SubscriptionActionError('A replacement can only be offered when pausing the next delivery.');
        }
        sub.pending_changes.pause_option = option;
        sub.pending_changes.pause_by = 'admin';
        sub.pending_changes.cancel = null;
      } else {
        sub.status = 'paused';
        sub.pause_option = option;
        sub.resume_at = PAUSE_OPTIONS[option] ? addDays(now, PAUSE_OPTIONS[option]) : null;
        sub.paused_by = 'admin';
        sub.pending_changes = {};
        sub.replacement_offer = null;
        if (payload.offer_replacement) {
          // QLSP may offer a similar product; it only takes effect if the customer accepts it.
          const product = await findProduct(sub.product_id);
          const variant = (product?.variants || []).find(v => v.sku === sub.variant_id);
          const replacement = await findReplacement(product, variant || { price: sub.pricing_snapshot.original_price });
          if (!replacement) throw new SubscriptionActionError('No replacement is available right now.');
          sub.replacement_offer = {
            product_id: replacement.product_id,
            variant_id: replacement.variant_id,
            offered_at: now,
            offered_by: adminId
          };
        }
      }
      sub.admin_proposal = null;
      log('pause', reason);
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_PAUSED', message);
      break;
    }

    // Protective: skips the upcoming delivery without charging. Staff skips are not limited and
    // don't count toward the customer's 2-consecutive-skips limit (consecutive_skips is untouched).
    case 'skip': {
      if (sub.status !== 'active') throw new SubscriptionActionError('Only active subscriptions have a delivery to skip.');
      const reason = cleanText(payload.reason, 200);
      requireReason(rules.skip_reasons, reason, 'skip this delivery');
      sub.skipped_deliveries.push(sub.next_charge_at);
      sub.next_charge_at = addDays(sub.next_charge_at, sub.frequency_days);
      log('skip', reason);
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_SKIPPED', message || reason);
      break;
    }

    // Lift a pause staff placed. Never charges now: the next charge stays on the old date,
    // and is at least 48h after the customer is told.
    case 'unpause': {
      if (sub.status !== 'paused') throw new SubscriptionActionError('Only paused subscriptions can be resumed.');
      if (sub.paused_by !== 'admin') {
        throw new SubscriptionActionError('The customer paused this box. Send them a proposal to resume instead.');
      }
      const earliest = new Date(now.getTime() + NOTICE_HOURS * 60 * 60 * 1000);
      sub.status = 'active';
      if (!sub.next_charge_at || sub.next_charge_at < earliest) sub.next_charge_at = earliest;
      sub.replacement_offer = null;
      log('unpause');
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_RESUMED', message);
      break;
    }

    // Changes to the schedule are proposals: the customer accepts or declines in Ritual Box.
    case 'propose': {
      if (sub.admin_proposal) throw new SubscriptionActionError('Withdraw the open proposal first.');
      const type = payload.type;
      const proposal = {
        type,
        reason: cleanText(payload.reason, 200) || null,
        message,
        ticket_id: ticketId,
        proposed_by: adminId,
        proposed_at: now,
        expires_at: addDays(now, PROPOSAL_TTL_DAYS)
      };
      if (type === 'frequency') {
        if (sub.status !== 'active') throw new SubscriptionActionError('Only active subscriptions can change frequency.');
        const days = Number(payload.frequency_days);
        if (!FREQUENCIES.includes(days)) throw new SubscriptionActionError('Invalid frequency.');
        if (days === sub.frequency_days) throw new SubscriptionActionError('The box already ships at this frequency.');
        proposal.frequency_days = days;
      } else if (type === 'resume') {
        if (sub.status !== 'paused') throw new SubscriptionActionError('Only paused subscriptions can be resumed.');
        if (sub.paused_by === 'admin') throw new SubscriptionActionError('Staff paused this box — resume it directly.');
      } else {
        throw new SubscriptionActionError('Unknown proposal.');
      }
      sub.admin_proposal = proposal;
      log('propose', type);
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_PROPOSAL', message);
      break;
    }

    case 'withdraw_proposal': {
      if (!sub.admin_proposal) throw new SubscriptionActionError('There is no open proposal.');
      const type = sub.admin_proposal.type;
      sub.admin_proposal = null;
      log('withdraw_proposal', type);
      await sub.save();
      // The banner disappears from Ritual Box, so tell the customer why.
      await notifyCustomer(sub, 'SUBSCRIPTION_PROPOSAL_WITHDRAWN', message);
      break;
    }

    // Cancel: effective now (no further charges) or after the next delivery; orders already charged still ship.
    case 'cancel': {
      const reason = cleanText(payload.reason, 200);
      requireReason(permissionsFor(role, sub).cancel_reasons, reason, 'cancel');
      if (reason === 'Policy violation' && !message) {
        throw new SubscriptionActionError('Explain the policy violation in the message to the customer.');
      }
      const effective = payload.effective || 'now';
      if (!['now', 'after_next'].includes(effective)) throw new SubscriptionActionError('Choose when the cancellation takes effect.');

      if (effective === 'after_next') {
        if (sub.status !== 'active') {
          throw new SubscriptionActionError('Only active subscriptions have a next delivery to wait for.');
        }
        sub.pending_changes.cancel = { reason, by: adminId };
        sub.pending_changes.pause_option = null;
      } else {
        sub.status = 'cancelled_by_admin';
        sub.cancel_reason = reason;
        sub.cancelled_by = adminId;
        sub.pending_changes = {};
        sub.replacement_offer = null;
      }
      sub.admin_proposal = null;
      log('cancel', reason);
      await sub.save();
      await notifyCustomer(sub, 'SUBSCRIPTION_CANCELLED', message || reason);
      break;
    }

    case 'note': {
      sub.internal_note = { text: cleanText(payload.note, 2000), updated_by: adminId, updated_at: now };
      await sub.save();
      break;
    }

    default:
      throw new SubscriptionActionError('Unknown action.');
  }

  return { before, after: sub.toObject() };
}

module.exports = {
  listSubscriptions,
  getSubscriptionDetail,
  applyAdminAction,
  ROLE_RULES,
  permissionsFor
};
