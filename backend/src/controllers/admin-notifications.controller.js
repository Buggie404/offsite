// Admin header bell: "action required" notices, built from live data (nothing is stored).
// Each notice type is listed in NOTIFICATION_REGISTRY with the roles that receive it, following
// the permission table in the planning doc (Phân quyền):
//   - Orders / refunds / stock / Ritual Box goods issues → Admin CC + QLSP (Sales-Ops)
//   - Community reports, recipes, support chat, contact messages → Admin CC + CSKH (Services-Ops)
//   - Ritual Box payment policy (suspended) → Admin CC only
//   - Ritual Box not started → Admin CC + CSKH (CSKH only for customers in their Orders scope)
// A notice disappears by itself once the work is done (refund decided, chat claimed, ...).
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Subscription = require('../models/Subscription');
const Report = require('../models/Report');
const Recipe = require('../models/Recipe');
const ChatConversation = require('../models/ChatConversation');
const ContactMessage = require('../models/ContactMessage');
const User = require('../models/User');
const { supportOrderCustomerIds } = require('../services/support-order-scope.service');

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const QUEUE_WINDOW_MS = 90 * DAY_MS;        // same window as the Orders page "90 days" links
const PROCESSING_SLA_MS = 24 * HOUR_MS;     // processing → shipping within a day
const REFUND_SLA_MS = 24 * HOUR_MS;         // refund request answered within a day
const REPORT_SLA_MS = 24 * HOUR_MS;         // reports handled within 24h (Phạm vi report)
const CHAT_WAITING_ALERT_MS = 5 * MINUTE_MS; // unclaimed chat stands out after 5 minutes (Chat CSKH)
const CHAT_REPLY_ALERT_MS = 15 * MINUTE_MS;  // claimed chat, customer waiting for a reply
const PER_TYPE_LIMIT = 20;                  // keep the panel readable
const PANTRY_CATEGORIES = ['matcha', 'coffee']; // need a batch expiry date for My Pantry

const ALL = ['admin_cc', 'qlsp', 'cskh'];
const SALES = ['admin_cc', 'qlsp'];
const SERVICES = ['admin_cc', 'cskh'];
const SENIOR = ['admin_cc'];

// type → { category (panel tab), roles allowed to receive it }
const NOTIFICATION_REGISTRY = {
  refund_requested:    { category: 'orders',     roles: SALES },
  refund_payout:       { category: 'orders',     roles: SALES },
  processing_late:     { category: 'orders',     roles: SALES },
  ready_to_ship:       { category: 'orders',     roles: SALES },
  delivery_failed:     { category: 'orders',     roles: SALES },
  box_not_started:     { category: 'orders',     roles: SERVICES },
  box_payment_failed:  { category: 'ritual_box', roles: SALES },
  box_suspended:       { category: 'ritual_box', roles: SENIOR },
  box_out_of_stock:    { category: 'ritual_box', roles: SALES },
  stock_out:           { category: 'products',   roles: SALES },
  stock_low:           { category: 'products',   roles: SALES },
  expiry_missing:      { category: 'products',   roles: SALES },
  report_pending:      { category: 'community',  roles: SERVICES },
  recipe_resubmitted:  { category: 'community',  roles: SERVICES },
  chat_waiting:        { category: 'support',    roles: SERVICES },
  chat_needs_reply:    { category: 'support',    roles: SERVICES },
  contact_new:         { category: 'support',    roles: SERVICES }
};

const CATEGORY_ORDER = ['orders', 'ritual_box', 'products', 'community', 'support'];

function typesForRole(role) {
  return new Set(Object.keys(NOTIFICATION_REGISTRY).filter((type) => NOTIFICATION_REGISTRY[type].roles.includes(role)));
}

function categoriesForRole(role) {
  const types = typesForRole(role);
  return CATEGORY_ORDER.filter((category) =>
    [...types].some((type) => NOTIFICATION_REGISTRY[type].category === category));
}

function stamp(value) {
  if (typeof value === 'number') return value;
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function plural(count, word, suffix = 's') {
  return `${count} ${word}${count === 1 ? '' : suffix}`;
}

function ago(since, now) {
  const ms = Math.max(0, now - new Date(since).getTime());
  if (ms < HOUR_MS) return plural(Math.max(1, Math.floor(ms / MINUTE_MS)), 'minute');
  if (ms < DAY_MS) return plural(Math.floor(ms / HOUR_MS), 'hour');
  return plural(Math.floor(ms / DAY_MS), 'day');
}

function readable(value) {
  if (!value) return '';
  const text = String(value).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * id carries a version stamp so the same thing happening again (a new report on the same post,
 * a new customer message) shows up as unread again.
 */
function notice(type, key, version, fields) {
  return {
    id: `${type}:${key}:${stamp(version)}`,
    type,
    category: NOTIFICATION_REGISTRY[type].category,
    tone: 'info',
    overdue: false,
    query: null,
    ...fields,
    // null = an ongoing state with no event time (e.g. stock levels); the panel shows no time.
    created_at: fields.created_at ? new Date(fields.created_at).toISOString() : null
  };
}

/** When the order entered `status` (latest entry), falling back to when it was created. */
function statusSince(order, status) {
  const entry = [...(order.status_history || [])].reverse().find((row) => row.status === status);
  return entry?.changed_at || order.created_at;
}

function customerName(order) {
  return order.delivery_info?.recipient_name || 'Guest';
}

// ── Orders ─────────────────────────────────────────────────────────────────

async function orderNotices(types, now) {
  const recent = { $gte: new Date(now - QUEUE_WINDOW_MS) };
  const fields = 'order_id created_at status_history delivery_info.recipient_name pricing.total';
  const [refunds, payouts, processing, failed] = await Promise.all([
    types.has('refund_requested')
      ? Order.find({ order_status: 'pending_refund', created_at: recent }, `${fields} refund_request`).lean()
      : [],
    types.has('refund_payout')
      ? Order.find({ order_status: 'canceled', refund_status: 'pending_payout' }, `${fields} refund_destination canceled_at`).lean()
      : [],
    types.has('processing_late') || types.has('ready_to_ship')
      ? Order.find({ order_status: 'processing', created_at: recent }, fields).lean()
      : [],
    types.has('delivery_failed')
      ? Order.find({ order_status: 'delivery_failed', created_at: recent }, `${fields} redelivery delivery_failed_reason_code`).lean()
      : []
  ]);
  const items = [];

  for (const order of refunds) {
    const request = order.refund_request || {};
    const since = request.requested_at || order.created_at;
    const overdue = now - stamp(since) >= REFUND_SLA_MS;
    items.push(notice('refund_requested', order.order_id, since, {
      tone: overdue ? 'danger' : 'warning',
      overdue,
      title: `Refund request · #${order.order_id}`,
      message: `${customerName(order)} · ${readable(request.reason) || 'No reason given'} · $${(order.pricing?.total || 0).toFixed(2)}${overdue ? ` · waiting ${ago(since, now)}` : ''}`,
      created_at: since,
      link: `/admin/orders/${order.order_id}`
    }));
  }

  for (const order of payouts) {
    const since = order.canceled_at || order.created_at;
    const dest = order.refund_destination;
    items.push(notice('refund_payout', order.order_id, since, {
      tone: 'warning',
      overdue: now - stamp(since) >= REFUND_SLA_MS,
      title: `Refund to transfer · #${order.order_id}`,
      message: dest
        ? `Cancelled QR order · send $${(order.pricing?.total || 0).toFixed(2)} to ${dest.bank_name}, then mark it refunded`
        : "Cancelled QR order · waiting for the customer's bank account",
      created_at: since,
      link: `/admin/orders/${order.order_id}`
    }));
  }

  for (const order of processing) {
    const since = statusSince(order, 'processing');
    const late = now - stamp(since) >= PROCESSING_SLA_MS;
    if (late && types.has('processing_late')) {
      items.push(notice('processing_late', order.order_id, since, {
        tone: 'danger',
        overdue: true,
        title: `Processing over 24h · #${order.order_id}`,
        message: `${customerName(order)} · processing for ${ago(since, now)}, ship it today`,
        created_at: since,
        link: `/admin/orders/${order.order_id}`
      }));
    } else if (!late && types.has('ready_to_ship')) {
      items.push(notice('ready_to_ship', order.order_id, since, {
        tone: 'info',
        title: `Ready to ship · #${order.order_id}`,
        message: `${customerName(order)} · mark as Shipping`,
        created_at: since,
        link: `/admin/orders/${order.order_id}`
      }));
    }
  }

  // Same rule as the Sales-Ops dashboard: staff act once the customer confirmed a redelivery,
  // was reminded and still hasn't answered, or nothing is asked of the customer.
  for (const order of failed) {
    const r = order.redelivery;
    const staffTurn = !r || r.status === 'confirmed' || (r.status === 'awaiting_customer' && !!r.reminder_sent_at);
    if (!staffTurn) continue;
    const since = statusSince(order, 'delivery_failed');
    items.push(notice('delivery_failed', order.order_id, r?.confirmed_at || r?.reminder_sent_at || since, {
      tone: 'warning',
      title: `Delivery failed · #${order.order_id}`,
      message: r?.status === 'confirmed'
        ? `${customerName(order)} confirmed a redelivery · ship it again`
        : r?.status === 'awaiting_customer'
          ? `${customerName(order)} was reminded, no reply yet · ship again or cancel`
          : `${customerName(order)} · ${readable(order.delivery_failed_reason_code) || 'ship again or cancel'}`,
      created_at: since,
      link: `/admin/orders/${order.order_id}`
    }));
  }

  return items;
}

async function boxNotStartedNotices(user) {
  const filter = { subscription_start_failed: true };
  // CSKH only sees orders of customers in their Orders scope (chat assignments).
  const scope = await supportOrderCustomerIds(user);
  if (Array.isArray(scope)) {
    if (!scope.length) return [];
    filter.user_id = { $in: scope };
  }
  const orders = await Order.find(filter, 'order_id created_at subscription_start_failed_at delivery_info.recipient_name')
    .sort({ subscription_start_failed_at: 1 }).limit(PER_TYPE_LIMIT).lean();
  return orders.map((order) => {
    const since = order.subscription_start_failed_at || order.created_at;
    return notice('box_not_started', order.order_id, since, {
      tone: 'danger',
      title: `Ritual Box not started · #${order.order_id}`,
      message: `${customerName(order)} paid but the box couldn't start (no valid card) · contact the customer`,
      created_at: since,
      link: `/admin/orders/${order.order_id}`
    });
  });
}

// ── Ritual Box ─────────────────────────────────────────────────────────────

async function productsByRef(refs) {
  const unique = [...new Set(refs.map(String))];
  if (!unique.length) return new Map();
  const products = await Product.find({
    $or: [
      { _id: { $in: unique.filter((ref) => mongoose.isValidObjectId(ref)) } },
      { product_id: { $in: unique.map(Number).filter(Number.isFinite) } }
    ]
  }, 'product_id name variants').lean();
  const byRef = new Map();
  for (const product of products) {
    byRef.set(String(product._id), product);
    byRef.set(String(product.product_id), product);
  }
  return byRef;
}

async function ritualBoxNotices(types) {
  const fields = 'subscription_id product_id variant_id quantity next_charge_at last_failed_at next_retry_at suspended_at updated_at delivery_info.recipient_name';
  const [paymentFailed, suspended, outOfStock] = await Promise.all([
    types.has('box_payment_failed')
      ? Subscription.find({ status: 'payment_failed' }, fields).sort({ last_failed_at: 1 }).limit(PER_TYPE_LIMIT).lean()
      : [],
    types.has('box_suspended')
      ? Subscription.find({ status: 'suspended' }, fields).sort({ suspended_at: 1 }).limit(PER_TYPE_LIMIT).lean()
      : [],
    types.has('box_out_of_stock')
      ? Subscription.find({ status: 'active', last_failure_reason: 'out_of_stock' }, fields).sort({ next_charge_at: 1 }).limit(PER_TYPE_LIMIT).lean()
      : []
  ]);
  const products = await productsByRef([...paymentFailed, ...suspended, ...outOfStock].map((sub) => sub.product_id));
  const label = (sub) => {
    const product = products.get(String(sub.product_id));
    const variant = product?.variants?.find((item) => item.sku === sub.variant_id);
    if (!product) return sub.variant_id;
    return variant?.label ? `${product.name} · ${variant.label}` : product.name;
  };
  const who = (sub) => sub.delivery_info?.recipient_name || 'Customer';
  const items = [];

  for (const sub of paymentFailed) {
    const since = sub.last_failed_at || sub.updated_at;
    items.push(notice('box_payment_failed', sub.subscription_id, since, {
      tone: 'danger',
      title: `Payment failed · ${sub.subscription_id}`,
      message: `${who(sub)} · ${label(sub)} · card declined${sub.next_retry_at ? ', retrying automatically' : ''}`,
      created_at: since,
      link: `/admin/subscriptions/${sub.subscription_id}`
    }));
  }
  for (const sub of suspended) {
    const since = sub.suspended_at || sub.updated_at;
    items.push(notice('box_suspended', sub.subscription_id, since, {
      tone: 'danger',
      title: `Ritual Box suspended · ${sub.subscription_id}`,
      message: `${who(sub)} · ${label(sub)} · all payment retries failed`,
      created_at: since,
      link: `/admin/subscriptions/${sub.subscription_id}`
    }));
  }
  for (const sub of outOfStock) {
    items.push(notice('box_out_of_stock', sub.subscription_id, sub.next_charge_at, {
      tone: 'warning',
      title: `Charging soon, out of stock · ${sub.subscription_id}`,
      message: `${label(sub)} · ${sub.quantity} needed · restock, else a replacement or the cycle is skipped`,
      created_at: sub.updated_at || sub.next_charge_at,
      link: `/admin/subscriptions/${sub.subscription_id}`
    }));
  }
  return items;
}

// ── Products ───────────────────────────────────────────────────────────────

async function productNotices(types) {
  const items = [];
  if (types.has('stock_out') || types.has('stock_low')) {
    const products = await Product.find({ is_active: true }, 'product_id name variants').lean();
    const out = [];
    const low = [];
    for (const product of products) {
      const outVariants = [];
      const lowVariants = [];
      for (const variant of product.variants || []) {
        const stock = Number(variant.stock) || 0;
        const threshold = variant.low_stock_threshold ?? 10;
        if (stock <= 0) outVariants.push(variant);
        else if (stock <= threshold) lowVariants.push(variant);
      }
      const names = (list) => list.map((v) => v.label || v.sku).slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '');
      // Version = the stock levels, so a further drop shows up as unread again.
      const version = (list) => list.reduce((sum, v) => (sum * 31 + (Number(v.stock) || 0) + 1) % 1_000_000_007, 7);
      if (outVariants.length) out.push({ product, list: outVariants, names: names(outVariants), version: version(outVariants) });
      if (lowVariants.length) low.push({ product, list: lowVariants, names: names(lowVariants), version: version(lowVariants) });
    }
    if (types.has('stock_out')) {
      for (const row of out.slice(0, PER_TYPE_LIMIT)) {
        items.push(notice('stock_out', row.product.product_id, row.version, {
          tone: 'danger',
          title: `Out of stock · ${row.product.name}`,
          message: `${plural(row.list.length, 'variant')} at 0 · ${row.names}`,
          created_at: null,
          link: `/admin/products/${row.product.product_id}`
        }));
      }
    }
    if (types.has('stock_low')) {
      for (const row of low.slice(0, PER_TYPE_LIMIT)) {
        const min = Math.min(...row.list.map((v) => Number(v.stock) || 0));
        items.push(notice('stock_low', row.product.product_id, row.version, {
          tone: 'warning',
          title: `Low stock · ${row.product.name}`,
          message: `${row.names} · ${min} left`,
          created_at: null,
          link: `/admin/products/${row.product.product_id}`
        }));
      }
    }
  }
  if (types.has('expiry_missing')) {
    // Missing data, not an event: one summary notice (like the Sales-Ops dashboard row),
    // not one per product, so it never buries urgent work.
    const missing = await Product.find(
      { is_active: true, category: { $in: PANTRY_CATEGORIES }, batch_expiry_date: null },
      'product_id name category'
    ).sort({ name: 1 }).lean();
    if (missing.length) {
      const [first] = missing;
      const names = missing.slice(0, 3).map((product) => product.name).join(', ');
      // Version = newest product missing a date: it comes back as unread only when a new
      // product joins the list, not each time one gets fixed.
      const newest = Math.max(...missing.map((product) => Number(product.product_id) || 0));
      items.push(notice('expiry_missing', 'all', newest, {
        tone: 'neutral',
        title: missing.length === 1
          ? `Batch expiry missing · ${first.name}`
          : `${missing.length} products missing a batch expiry date`,
        message: missing.length === 1
          ? `My Pantry uses the ${first.category === 'matcha' ? 180 : 90}-day default until "Current batch expiry" is entered`
          : `${names}${missing.length > 3 ? ` +${missing.length - 3} more` : ''} · My Pantry uses 180 days (matcha) / 90 days (coffee) until "Current batch expiry" is entered`,
        created_at: null,
        // One product → straight to its field; several → the Products list filtered to them.
        link: missing.length === 1 ? `/admin/products/${first.product_id}` : '/admin/products',
        query: missing.length === 1 ? { focus: 'batch-expiry' } : { expiry: 'missing' }
      }));
    }
  }
  return items;
}

// ── Community ──────────────────────────────────────────────────────────────

const REPORT_LABELS = { spam: 'Spam', inappropriate: 'Inappropriate', off_topic: 'Off topic', misleading: 'Misleading', other: 'Other' };
const TARGET_LABELS = { post: 'Post', comment: 'Comment', account: 'Account' };

async function communityNotices(types, now) {
  const items = [];
  if (types.has('report_pending')) {
    // One card per reported target, like the Community reports queue.
    const groups = await Report.aggregate([
      { $match: { status: 'pending' } },
      { $sort: { created_at: 1 } },
      {
        $group: {
          _id: { type: '$target_type', post: '$post_id', comment: '$comment_id', account: '$reported_user_id' },
          first: { $min: '$created_at' },
          last: { $max: '$created_at' },
          count: { $sum: 1 },
          reasons: { $addToSet: '$reason' }
        }
      },
      { $sort: { first: 1 } },
      { $limit: PER_TYPE_LIMIT }
    ]);
    for (const group of groups) {
      const { type, post, comment, account } = group._id;
      const target = post || comment || account || 'unknown';
      const overdue = now - stamp(group.first) >= REPORT_SLA_MS;
      items.push(notice('report_pending', `${type}:${target}`, group.last, {
        tone: overdue ? 'danger' : 'warning',
        overdue,
        title: `${TARGET_LABELS[type] || 'Content'} reported${group.count > 1 ? ` ${group.count} times` : ''}`,
        message: `${group.reasons.map((reason) => REPORT_LABELS[reason] || readable(reason)).join(', ')}${overdue ? ` · over 24h, handle it now` : ` · waiting ${ago(group.first, now)}`}`,
        created_at: group.first,
        link: '/admin/community-reports'
      }));
    }
  }
  if (types.has('recipe_resubmitted')) {
    const recipes = await Recipe.find(
      { moderation_status: 'resubmitted', deletedAt: null },
      'recipe_id title resubmitted_at updatedAt review_round'
    ).sort({ resubmitted_at: 1 }).limit(PER_TYPE_LIMIT).lean();
    for (const recipe of recipes) {
      const since = recipe.resubmitted_at || recipe.updatedAt;
      items.push(notice('recipe_resubmitted', recipe.recipe_id, since, {
        tone: 'info',
        title: `Recipe resubmitted · "${recipe.title}"`,
        message: `The owner made the requested changes · review round ${(Number(recipe.review_round) || 0) + 1}`,
        created_at: since,
        link: '/admin/recipes',
        query: { search: recipe.title }
      }));
    }
  }
  return items;
}

// ── Support ────────────────────────────────────────────────────────────────

async function agentIds(user) {
  const identity = String(user.user_id || '');
  const staff = await User.findOne(/^[a-f0-9]{24}$/i.test(identity) ? { _id: identity } : { user_id: identity }, 'user_id').lean();
  return [...new Set([identity, staff?.user_id, staff ? String(staff._id) : null].filter(Boolean))];
}

async function supportNotices(types, user, now) {
  const ids = types.has('chat_needs_reply') ? await agentIds(user) : [];
  const [waiting, mine, contacts] = await Promise.all([
    types.has('chat_waiting')
      ? ChatConversation.find({ status: 'waiting' }, 'conversation_id customer_id waiting_since created_at handover_reason handoff_summary summary last_message_preview')
        .sort({ waiting_since: 1 }).limit(PER_TYPE_LIMIT).lean()
      : [],
    types.has('chat_needs_reply')
      ? ChatConversation.find({ status: 'open', agent_id: { $in: ids }, unread_agent: { $gt: 0 } }, 'conversation_id customer_id last_customer_message_at last_agent_message_at last_message_preview unread_agent')
        .sort({ last_customer_message_at: 1 }).limit(PER_TYPE_LIMIT).lean()
      : [],
    types.has('contact_new')
      ? ContactMessage.find({ status: 'new' }, 'contact_id full_name email subject message source created_at').sort({ created_at: 1 }).limit(PER_TYPE_LIMIT).lean()
      : []
  ]);
  const customers = await User.find({ user_id: { $in: [...waiting, ...mine].map((row) => row.customer_id) } }, 'user_id profile_name').lean();
  const nameOf = new Map(customers.map((row) => [row.user_id, row.profile_name]));
  const items = [];

  for (const chat of waiting) {
    const since = chat.waiting_since || chat.created_at;
    const overdue = now - stamp(since) >= CHAT_WAITING_ALERT_MS;
    const preview = chat.summary || chat.handoff_summary || chat.last_message_preview || '';
    items.push(notice('chat_waiting', chat.conversation_id, since, {
      tone: overdue ? 'danger' : 'warning',
      overdue,
      title: `${nameOf.get(chat.customer_id) || 'Guest'} is waiting for an agent`,
      message: [chat.handover_reason ? readable(chat.handover_reason) : null, `waiting ${ago(since, now)}`, preview ? preview.slice(0, 80) : null].filter(Boolean).join(' · '),
      created_at: since,
      link: '/admin/chat',
      query: { conversation: chat.conversation_id }
    }));
  }

  for (const chat of mine) {
    const since = chat.last_customer_message_at || now;
    const overdue = now - stamp(since) >= CHAT_REPLY_ALERT_MS;
    items.push(notice('chat_needs_reply', chat.conversation_id, since, {
      tone: overdue ? 'danger' : 'info',
      overdue,
      title: `New message from ${nameOf.get(chat.customer_id) || 'Guest'}`,
      message: `${chat.unread_agent > 1 ? `${chat.unread_agent} unread · ` : ''}${(chat.last_message_preview || '').slice(0, 80)}${overdue ? ' · no reply for 15 min' : ''}`,
      created_at: since,
      link: '/admin/chat',
      query: { conversation: chat.conversation_id }
    }));
  }

  for (const contact of contacts) {
    items.push(notice('contact_new', contact.contact_id, contact.created_at, {
      tone: 'info',
      title: `Contact message · ${contact.subject}`,
      message: `${contact.full_name || contact.email} · from the ${contact.source === 'chatbot' ? 'chatbot' : 'contact form'} · ${String(contact.message || '').slice(0, 80)}`,
      created_at: contact.created_at,
      link: '/admin/servicesops-dashboard',
      mailto: `mailto:${contact.email}?subject=${encodeURIComponent(`Re: ${contact.subject}`)}`
    }));
  }
  return items;
}

// ── Endpoint ───────────────────────────────────────────────────────────────

async function getNotifications(req, res) {
  try {
    const role = req.user.role;
    const types = typesForRole(role);
    const now = Date.now();
    const settle = (promise) => promise.catch((error) => {
      console.error('Admin notifications: one source failed', error);
      return [];
    });
    const groups = await Promise.all([
      settle(orderNotices(types, now)),
      types.has('box_not_started') ? settle(boxNotStartedNotices(req.user)) : [],
      settle(ritualBoxNotices(types)),
      settle(productNotices(types)),
      settle(communityNotices(types, now)),
      settle(supportNotices(types, req.user, now))
    ]);
    const data = groups.flat()
      // Never leak a type the role isn't registered for.
      .filter((item) => types.has(item.type))
      // Overdue first, then newest.
      .sort((a, b) => (b.overdue === true) - (a.overdue === true) || stamp(b.created_at) - stamp(a.created_at));

    const counts = Object.fromEntries(categoriesForRole(role).map((category) => [category, 0]));
    for (const item of data) counts[item.category] = (counts[item.category] || 0) + 1;

    res.json({
      data,
      categories: categoriesForRole(role),
      counts,
      updated_at: new Date(now).toISOString()
    });
  } catch (error) {
    console.error('Failed to load admin notifications:', error);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
}

module.exports = { getNotifications, NOTIFICATION_REGISTRY, typesForRole, categoriesForRole, ALL_ROLES: ALL };
