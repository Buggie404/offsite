const jwt = require('jsonwebtoken');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const AiCallLog = require('../models/AiCallLog');
const sessionAccess = require('../services/ai-chat-session');

const SUPPORT_HOTLINE = process.env.SUPPORT_HOTLINE || '1900 0000';
const FAQ_URL = '/contact-us#faq';
const LLM_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_PRODUCT_CARDS = 3;
const LLM_ATTEMPT_STATUSES = ['success', 'error', 'timeout'];
const UNAVAILABLE_MESSAGE = 'Our assistant is unavailable right now. Leave a message and we will reply by email.';
const CLOSED_SUPPORT_MESSAGE = 'Our team is offline right now (8:00–20:00). Leave a message and we will reply by email.';
const PROVIDER_RETRY_MESSAGE = 'Our assistant is unavailable right now. Please try again in a moment.';
const PROVIDER_RETRY_LIMIT = 2;
const CATALOG_CACHE_MS = 30_000;

let catalogCache = { at: 0, products: [] };

let budgetWarnedOn = null;

// The shop header stays "logged in" for as long as a signed token sits in the
// browser, even after `exp`. Chat has to follow that same session. Dropping an
// expired token made Track my order show the guest form.
function shopperFromRequest(req) {
  if (req.user?.user_id) return String(req.user.user_id);

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const secret = process.env.JWT_SECRET || 'fallback-secret-key';
  try {
    const decoded = jwt.verify(token, secret);
    return decoded?.user_id ? String(decoded.user_id) : null;
  } catch (error) {
    if (error.name !== 'TokenExpiredError') return null;
    try {
      const decoded = jwt.verify(token, secret, { ignoreExpiration: true });
      return decoded?.user_id ? String(decoded.user_id) : null;
    } catch {
      return null;
    }
  }
}

function unavailableBody(status) {
  return {
    success: false,
    status,
    show_contact_form: true,
    hotline: SUPPORT_HOTLINE,
    faq_url: FAQ_URL,
    message: UNAVAILABLE_MESSAGE
  };
}

function isSupportOpenNow(date = new Date()) {
  const vnHours = (date.getUTCHours() + 7) % 24;
  return vnHours >= 8 && vnHours < 20;
}

function contactFormFields(message, closed = false) {
  return {
    show_contact_form: true,
    hotline: SUPPORT_HOTLINE,
    faq_url: FAQ_URL,
    message: message || (closed ? CLOSED_SUPPORT_MESSAGE : UNAVAILABLE_MESSAGE)
  };
}

function dropLiveHandoffCopy(text) {
  const { head, hasCloser } = splitTeamCloser(text);
  let next = hasCloser ? head : String(text || '');
  next = next
    .replace(/Tôi đang kết nối bạn với nhân viên CSKH của Offsite\.{0,3}/gi, '')
    .replace(/đang kết nối bạn với (?:nhân viên|đội ngũ|admin)[^.!\n]{0,80}[.!]*/gi, '')
    .trim();
  return next;
}

function takeUnavailableMarker(text) {
  const raw = String(text || '');
  const marker = 'UNAVAILABLE|CONTACT_FORM|LEAVE_MESSAGE|SUPPORT_CLOSE';
  const tagged = raw.match(new RegExp('<<\\s*(?:' + marker + ')(?:\\|([^>]*))?\\s*>>', 'i'));
  if (!tagged) return null;
  return {
    message: (tagged[1] || '').replace(/>>$/, '').trim(),
    text: raw.replace(new RegExp('<<\\s*(?:' + marker + ')(?:\\|[^>]*)?\\s*>>', 'gi'), '').trim()
  };
}

function providerErrorText(body) {
  if (!body || typeof body !== 'object') return '';
  return [
    body.code,
    body.message,
    body.error,
    body.event,
    body.data?.error,
    body.data?.status,
    body.metadata?.error
  ].filter(value => value != null && value !== '').map(value => String(value)).join(' ');
}

// Dify often wraps a model 429 as HTTP 400 completion_request_error, or as a
// 200 body whose answer is empty while the log says llm_error / out of tokens.
function isLlmAvailabilityError(status, body) {
  if (status === 429) return true;
  const detail = providerErrorText(body).toLowerCase();
  if (/429|rate[\s_-]?limit|quota|insufficient[_\s-]?quota|out of tokens?|resource_exhausted|llm_error|provider_quota/.test(detail)) {
    return true;
  }

  const answer = typeof body?.answer === 'string' ? body.answer.trim() : '';
  if (!answer) return false;
  const head = answer.slice(0, 500).toLowerCase();
  const looksLikeDump = /^(?:llm[_\s-]?error\b|error\s*:|[\[{])/.test(head);
  return looksLikeDump && /429|rate[\s_-]?limit|quota|out of tokens?|llm[_\s-]?error|resource_exhausted/.test(head);
}

function alreadyToldTeam(text) {
  return /I(?:'ll| will| am|'m)\s+connect(?:ing)? you with (?:our |the )?team/i.test(text)
    || /(?:have |'ve )?(?:sent|forwarded|passed) (?:your |the |this )?(?:message|request|case) to (?:the |our )?(?:team|admin)/i.test(text)
    || /that message was (?:sent|forwarded) to the team/i.test(text)
    || /đang kết nối bạn|đã (?:gửi|chuyển).{0,50}(?:admin|nhân viên|đội ngũ|team)/i.test(text);
}

function splitTeamCloser(text) {
  const raw = String(text || '').trim();
  const rider = '(?:They(?:\'ll| will) see our conversation,?\\s*so you (?:won(?:\'t|t)|will not) need to repeat yourself\\.?)?';
  const closer = 'I(?:\'m| am) connecting you with our team(?: right)? now\\.?\\s*' + rider;
  const embedded = raw.match(new RegExp('\\n+\\s*(' + closer + ')\\s*$', 'i'));
  if (embedded) return { head: raw.slice(0, embedded.index).trim(), hasCloser: true };
  if (new RegExp('^' + closer + '$', 'i').test(raw)) return { head: '', hasCloser: true };
  return { head: raw, hasCloser: false };
}

// Keep one connect line. Drop "I'm connecting you with our team…" only when
// this reply, or an earlier one, already said the message was passed on.
function dedupeTeamCloser(text, { priorAnnounced = false, willShowBanner = false } = {}) {
  const raw = String(text || '').trim();
  const { head, hasCloser } = splitTeamCloser(raw);
  if (!hasCloser) return raw;
  if (alreadyToldTeam(head) || (priorAnnounced && (head || willShowBanner))) return head;
  return raw;
}

async function readDifyBody(difyRes) {
  const raw = await difyRes.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 500) };
  }
}

async function replyForProviderIssue(res, { chatSession, userId, sessionId, clientIp, startTime, messageText, detail }) {
  if (chatSession) {
    if (chatSession.isNew) {
      sessionAccess.appendMessage(chatSession, {
        sender: 'user',
        text: String(messageText || '').trim()
      });
    }
    chatSession.consecutive_errors = (chatSession.consecutive_errors || 0) + 1;
    chatSession.last_activity_at = new Date();
    try {
      await chatSession.save();
    } catch (saveErr) {
      console.error('Failed to persist provider retry count:', saveErr);
    }
  }

  const exhausted = (chatSession?.consecutive_errors || 0) > PROVIDER_RETRY_LIMIT;
  await logConciergeCall({
    user_id: userId,
    session_id: sessionId,
    ip: clientIp,
    status: exhausted ? 'error' : 'rate_limited',
    latency_ms: Date.now() - startTime,
    input_summary: String(messageText || '').slice(0, 100),
    output_summary: String(detail || 'llm_error').slice(0, 100)
  });

  if (exhausted) {
    return res.status(503).json(unavailableBody('error'));
  }

  return res.status(429).json({
    success: false,
    status: 'temporarily_unavailable',
    show_contact_form: false,
    message: PROVIDER_RETRY_MESSAGE
  });
}

function usageScope({ isGuest, userId, sessionId, clientIp }) {
  if (!isGuest && userId) {
    return { user_id: userId };
  }

  const clauses = [];
  if (sessionId) clauses.push({ session_id: sessionId });
  if (clientIp) clauses.push({ ip: clientIp });
  if (clauses.length === 1) return clauses[0];
  if (clauses.length > 1) return { $or: clauses };
  return { ip: 'unknown' };
}

async function logConciergeCall(fields) {
  try {
    await AiCallLog.create({
      feature: 'concierge',
      model: process.env.LLM_MODEL || process.env.LLM_PROVIDER || 'dify-workflow',
      ...fields
    });
  } catch (error) {
    console.error('AiCallLog write failed:', error);
  }
}

const HANDOVER_REASONS = new Set(['user_request', 'refund', 'complaint', 'order_change', 'no_answer', 'llm_error']);
const MAX_HANDOVER_NOTES = 10;
const HANDOVER_NOTE_DEDUPE_MS = 3 * 60 * 1000;
const GUEST_ORDER_LOOKUP = 'guest_order_lookup';
const GUEST_LOOKUP_LIMIT = 3;
const ACCOUNT_ORDER_LIMIT = 5;
const HALTED_ORDER_STATUSES = new Set(['canceled', 'cancelled', 'refund', 'pending_refund', 'refund_rejected']);

function normalizeHandoverReason(reason) {
  const value = String(reason || '').trim().toLowerCase();
  if (HANDOVER_REASONS.has(value)) return value;
  if (value.includes('refund')) return 'refund';
  if (value.includes('complaint')) return 'complaint';
  if (value.includes('order')) return 'order_change';
  return 'user_request';
}

function phoneKey(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length > 9) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

function phonesMatch(stored, typed) {
  const left = phoneKey(stored);
  const right = phoneKey(typed);
  if (!left || !right || right.length < 8) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function normalizePhrase(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseAt(text, phrase) {
  if (!phrase || phrase.length < 4) return -1;
  const match = new RegExp(`(?:^|\\s)${escapeRegExp(phrase)}(?=\\s|$)`).exec(text);
  if (!match) return -1;
  return match.index + (match[0].charAt(0) === ' ' ? 1 : 0);
}

function variantForMention(product, text, endIndex) {
  const nearby = text.slice(Math.max(0, endIndex - 48), Math.min(text.length, endIndex + 32)).replace(/\s+/g, '');
  const variants = product.variants || [];
  const matched = variants.find(variant => {
    const label = normalizePhrase(variant.label).replace(/\s+/g, '');
    return label.length >= 2 && nearby.includes(label);
  });
  return matched || variants.find(variant => variant.is_default) || variants[0] || null;
}

function slimProduct(product, chosen) {
  const variants = (product.variants || []).map(variant => ({
    sku: variant.sku,
    label: variant.label || '',
    price: variant.price,
    stock: variant.stock,
    is_default: !!variant.is_default,
    images: variant.images || []
  }));
  return {
    _id: product._id ? String(product._id) : undefined,
    product_id: product.product_id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    images: product.images || [],
    variants,
    is_active: product.is_active !== false,
    selectedSku: chosen?.sku
  };
}

function toChatProductCard(product, { sku = null } = {}) {
  const variants = product.variants || [];
  const chosen = (sku && variants.find(variant => variant.sku === sku))
    || variants.find(variant => variant.is_default)
    || variants[0]
    || null;
  const imageUrl = chosen?.images?.[0]?.url || product.images?.[0]?.url || '';
  const inStock = variants.some(variant => (variant.stock || 0) > 0);
  const price = Number(chosen?.price || 0);
  return {
    id: product.product_id,
    name: product.name,
    price: `$${price.toFixed(2)}`,
    imageUrl,
    slug: product.slug,
    rawProduct: slimProduct(product, chosen),
    defaultSku: chosen?.sku,
    quantity: 1,
    inStock,
    actionText: inStock ? 'ADD' : 'SOLD OUT'
  };
}

function mentionsInText(catalog, rawText) {
  const text = normalizePhrase(rawText);
  if (!text) return [];

  const hits = [];
  for (const product of catalog) {
    const alias = normalizePhrase(product.name);
    const at = phraseAt(text, alias);
    if (at < 0) continue;
    const variant = variantForMention(product, text, at + alias.length);
    hits.push({
      product,
      start: at,
      end: at + alias.length,
      sku: variant?.sku
    });
  }

  hits.sort((left, right) => (right.end - right.start) - (left.end - left.start) || left.start - right.start);
  const kept = [];
  for (const hit of hits) {
    const covered = kept.some(other => hit.start >= other.start && hit.end <= other.end);
    if (!covered) kept.push(hit);
  }
  kept.sort((left, right) => left.start - right.start);
  return kept;
}

async function loadActiveCatalog() {
  if (catalogCache.products.length && Date.now() - catalogCache.at < CATALOG_CACHE_MS) {
    return catalogCache.products;
  }
  const products = await Product.find({ is_active: true })
    .select('product_id name slug category images variants is_active')
    .lean();
  catalogCache = { at: Date.now(), products };
  return products;
}

async function cardsForConversation(existingCards, userText, replyText) {
  const catalog = await loadActiveCatalog();
  const fromUser = mentionsInText(catalog, userText);
  const fromReply = mentionsInText(catalog, replyText);
  const cards = [];
  const seen = new Set();

  const pushCard = (card) => {
    if (!card || card.id == null || seen.has(card.id) || cards.length >= MAX_PRODUCT_CARDS) return;
    seen.add(card.id);
    cards.push(card);
  };

  const pushMention = (hit) => {
    pushCard(toChatProductCard(hit.product, { sku: hit.sku }));
  };

  // The shopper's own product names come first, then cards the model already
  // picked, then products named only in the reply.
  fromUser.forEach(pushMention);
  for (const card of existingCards || []) {
    const mention = fromUser.find(entry => entry.product.product_id === card.id)
      || fromReply.find(entry => entry.product.product_id === card.id);
    pushCard(mention
      ? toChatProductCard(mention.product, { sku: mention.sku || card.defaultSku })
      : { ...card, quantity: 1, actionText: card.inStock === false ? 'SOLD OUT' : 'ADD' });
  }
  fromReply.forEach(pushMention);

  return cards;
}

function handoverIntent(text) {
  if (/talk to (?:a )?(?:person|human|someone|agent)|speak to (?:a )?(?:person|human|agent)|real person|nhân viên|customer service|\bcskh\b/i.test(text)) {
    return 'user_request';
  }
  return null;
}

function sendPrepared(res, prepared) {
  if (!prepared) return false;
  if (prepared.http) {
    res.status(prepared.http).json(prepared.body);
    return true;
  }
  if (prepared.hold) {
    res.status(200).json({ success: true, decision: prepared.decision, reply: '' });
    return true;
  }
  return false;
}

function recordHandoverNote(chatSession, reason, summary) {
  const text = String(summary || '').trim().slice(0, 300) || 'Customer asked to talk to a person.';
  const now = new Date();
  const notes = chatSession.handover_notes || [];
  const last = notes.length ? notes[notes.length - 1] : null;
  const lastAt = last?.created_at ? new Date(last.created_at).getTime() : 0;
  // Same wording inside a few minutes is a repeat, not a new request.
  if (last && last.summary === text && now.getTime() - lastAt < HANDOVER_NOTE_DEDUPE_MS) {
    chatSession.last_activity_at = now;
    return null;
  }

  const note = {
    note_id: `${chatSession.session_id}_${now.getTime()}`,
    reason: normalizeHandoverReason(reason),
    summary: text,
    created_at: now
  };
  notes.push(note);
  chatSession.handover_notes = notes.slice(-MAX_HANDOVER_NOTES);
  chatSession.handover_reason = note.reason;
  chatSession.summary = text;
  chatSession.last_activity_at = now;
  return note;
}

async function notifyCskh(chatSession, note) {
  await require('../services/ai-chat-handover.service').handoverAiSession(chatSession);
  const agents = await User.find({ role: 'cskh', status: 'active' }).select('user_id').lean();
  const { emitChatHandover } = require('../services/socket.service');
  emitChatHandover(chatSession, agents.map(agent => agent.user_id), note);
}

async function markHandedOff(chatSession, reason, summary) {
  chatSession.status = 'waiting';
  chatSession.retain_for_support = true;
  const note = recordHandoverNote(chatSession, reason, chatSession.summary || summary);
  await chatSession.save();
  await notifyCskh(chatSession, note);
  return note;
}

async function warnAdminCcIfNeeded(count, limit) {
  const threshold = Math.ceil(limit * 0.8);
  if (count < threshold || count >= limit) return;

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (budgetWarnedOn === todayKey) return;
  budgetWarnedOn = todayKey;

  const percent = Math.round((count / limit) * 100);
  const payload = {
    count,
    limit,
    percent,
    message: `Concierge LLM usage is at ${percent}% of the daily limit (${count}/${limit}).`,
    created_at: new Date().toISOString()
  };

  try {
    const admins = await User.find({ role: 'admin_cc', status: 'active' }).select('user_id').lean();
    const { emitLlmBudgetWarning } = require('../services/socket.service');
    emitLlmBudgetWarning(admins.map(admin => admin.user_id), payload);
  } catch (error) {
    console.error('Admin CC budget warning failed:', error);
  }
}

/**
 * 0. GET /api/ai-chat/init
 * Fetch initial greeting and suggested questions directly from Dify App Parameters
 */
exports.getInitParameters = async (req, res) => {
  try {
    const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';
    const difyApiKey = process.env.DIFY_API_KEY;

    if (!difyApiKey) {
      return res.status(200).json({
        success: true,
        opening_statement: 'Hi! I am Offsite Concierge. How can I help you today?',
        suggested_questions: ['Recommend a matcha for me', 'Track my order', 'Return policy']
      });
    }

    const resp = await fetch(`${difyBaseUrl}/parameters`, {
      headers: { 'Authorization': `Bearer ${difyApiKey}` }
    });

    if (!resp.ok) {
      throw new Error(`Dify parameters status: ${resp.status}`);
    }

    const data = await resp.json();
    return res.status(200).json({
      success: true,
      opening_statement: data.opening_statement || 'Hi, I am the Offsite Assistant. Welcome to Offsite - your café, at home.',
      suggested_questions: data.suggested_questions || [
        'Recommend a matcha for me',
        'Help me choose brewing tools',
        'Track my order',
        'What is your return policy?'
      ]
    });
  } catch (error) {
    console.error('Error fetching Dify parameters:', error);
    return res.status(200).json({
      success: true,
      opening_statement: 'Hi, I am the Offsite Assistant. Welcome to Offsite - your café, at home.',
      suggested_questions: [
        'Recommend a matcha for me',
        'Help me choose brewing tools',
        'Track my order',
        'What is your return policy?'
      ]
    });
  }
};

/**
 * 1. GET /api/ai-chat/products-catalog
 * Endpoint for Dify HTTP Request tool to search active products.
 * Returns concise, token-efficient product specs for LLM.
 * Excludes sensitive cost/margin/internal data.
 */
exports.getProductsCatalog = async (req, res) => {
  try {
    const { query, category, limit } = req.query;

    const filter = { is_active: true };
    if (category) {
      filter.category = category;
    }

    if (query && typeof query === 'string' && query.trim()) {
      filter.$or = [
        { name: { $regex: query.trim(), $options: 'i' } },
        { product_tag: { $in: [new RegExp(query.trim(), 'i')] } },
        { 'matcha.product_grade': { $regex: query.trim(), $options: 'i' } },
        { 'coffee.roast_level': { $regex: query.trim(), $options: 'i' } }
      ];
    }

    let productQuery = Product.find(filter)
      .select('product_id name slug category description is_best_seller is_new_arrival rating_avg variants matcha coffee drinkware tools');

    if (limit && !isNaN(parseInt(limit, 10))) {
      productQuery = productQuery.limit(parseInt(limit, 10));
    }

    const products = await productQuery.lean();

    // Map into clean, token-efficient structure
    const results = products.map(p => {
      // Find lowest or default price
      const defaultVar = p.variants?.find(v => v.is_default) || p.variants?.[0];
      const minPrice = defaultVar ? defaultVar.price : 0;
      const totalStock = p.variants?.reduce((sum, v) => sum + (v.stock || 0), 0) || 0;

      let detail = {};
      if (p.category === 'matcha' && p.matcha) {
        detail = { grade: p.matcha.product_grade, origin: p.matcha.origin };
      } else if (p.category === 'coffee' && p.coffee) {
        detail = { roast: p.coffee.roast_level, notes: p.coffee.tasting_notes };
      }

      return {
        id: p.product_id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        price: `$${minPrice.toFixed(2)}`,
        in_stock: totalStock > 0,
        rating: p.rating_avg || null,
        description: p.description?.slice(0, 150) || '',
        ...detail
      };
    });

    return res.status(200).json({
      success: true,
      count: results.length,
      products: results
    });
  } catch (error) {
    console.error('Error fetching products catalog for Dify:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

function expectedDelivery(order) {
  if (HALTED_ORDER_STATUSES.has(order.order_status)) return null;
  if (order.order_status === 'delivered' && order.delivered_at) return order.delivered_at;
  const created = order.created_at ? new Date(order.created_at) : new Date();
  const days = order.shipping?.method === 'express' ? 1 : 3;
  const eta = new Date(created.getTime());
  eta.setDate(eta.getDate() + days);
  return eta;
}

// Status, expected date, product names, total, and province/city only.
function publicOrderView(order) {
  return {
    order_id: order.order_id,
    order_status: order.order_status,
    estimated_delivery: expectedDelivery(order),
    city: order.delivery_info?.city || '',
    items: (order.items || []).map(item => ({
      name: item.product_name,
      quantity: item.quantity
    })),
    total_amount: order.pricing?.total || 0,
    currency: order.pricing?.currency || 'USD'
  };
}

function accountOrdersReply(count) {
  if (!count) return "I couldn't find any orders on this account yet.";
  if (count === 1) return 'Here is your most recent order:';
  return `Here are your ${count} most recent orders:`;
}

async function recentOrdersForAccount(mongoUserId) {
  const user = await User.findById(mongoUserId).select('user_id').lean();
  if (!user?.user_id) return [];
  const orders = await Order.find({ user_id: user.user_id, is_guest: false })
    .sort({ created_at: -1 })
    .limit(ACCOUNT_ORDER_LIMIT)
    .lean();
  return orders.map(publicOrderView);
}

function isPolicyQuestion(text) {
  return /return policy|refund policy|payment methods|chính sách|chinh sach|how to return|how do i request a refund|what is your (?:return|refund|shipping|payment)/i.test(text);
}

function isOrderActionRequest(text) {
  return /thanh toán|thanh toan|payment failed|charged twice|double charg|paid but|duyệt hoàn|duyet hoan|hoàn tiền|hoan tien|approve (?:my |the )?refund|refund (?:request|status)|return (?:my |this )?order|đổi địa chỉ|doi dia chi|sai địa chỉ|sai dia chi|change (?:my |the )?(?:address|delivery)|wrong address|hủy|huy\b|sửa đơn|sua don|cancel|cancell?ation|edit (?:my )?order|modify (?:my )?order|change (?:my |the )?order|reschedule/i.test(text)
    && !isPolicyQuestion(text);
}

// Status check only. Cancel, refund, address, and payment stay with the assistant.
function isOrderTrackingRequest(text) {
  if (!text || isPolicyQuestion(text) || isOrderActionRequest(text)) return false;
  const plain = normalizePhrase(text);
  return /track(?:ing)?(?: my)? orders?|where(?: s| is| are) my (?:order|orders|package|delivery)|order status|status of (?:my |the )?order|check(?: on)? (?:my |the )?order|my recent orders|kiem tra don|tra cuu don|don hang cua (?:toi|minh)|don cua (?:toi|minh)|xem don/.test(plain);
}

function asksForOrderLookup(text) {
  return /order (?:id|code|number).{0,80}(?:email|e-mail|phone|mobile)|(?:email|e-mail|phone|mobile).{0,80}order (?:id|code|number)|enter (?:your |the )?order (?:id|code|number)|provide (?:your |the )?order (?:id|code|number)|mã đơn.{0,60}(?:email|số điện thoại|sdt|sđt)|(?:email|số điện thoại|sdt|sđt).{0,60}mã đơn/i.test(text);
}

function withoutLookupAsk(text) {
  return String(text || '')
    .split('\n')
    .map(line => line
      .split(/(?<=[.!?])\s+/)
      .filter(sentence => sentence.trim() && !asksForOrderLookup(sentence))
      .join(' ')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractLookupDetails(text) {
  const source = String(text || '');
  const codeMatch = source.match(/OFS-\d{4}-\d{5,}/i);
  const code = codeMatch ? codeMatch[0].toUpperCase() : '';
  const rest = codeMatch ? source.replace(codeMatch[0], ' ') : source;
  const email = rest.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) return { code, contact: email[0] };
  const phone = rest.match(/(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/);
  return { code, contact: phone ? phone[0].replace(/[^\d+]/g, '') : '' };
}

// True when the shopper is only asking for status, not mixing in another question.
function trackingIsTheWholeMessage(text) {
  if (!isOrderTrackingRequest(text)) return false;
  const details = extractLookupDetails(text);
  let rest = String(text || '');
  if (details.code) rest = rest.replace(new RegExp(escapeRegExp(details.code), 'ig'), ' ');
  if (details.contact) rest = rest.replace(new RegExp(escapeRegExp(details.contact), 'ig'), ' ');
  rest = normalizePhrase(rest);
  const fillers = [
    'what is your order status',
    'what is my order status',
    'what s your order status',
    'what s my order status',
    'where is my package',
    'where is my delivery',
    'where is my order',
    'where are my orders',
    'status of my order',
    'status of the order',
    'check on my order',
    'check the order',
    'check my order',
    'my recent orders',
    'track my orders',
    'track my order',
    'order tracking',
    'track orders',
    'track order',
    'order status',
    'kiem tra don hang',
    'kiem tra don',
    'tra cuu don hang',
    'tra cuu don',
    'don hang cua toi',
    'don hang cua minh',
    'don cua toi',
    'don cua minh',
    'xem don hang',
    'xem don',
    'my phone or email is',
    'phone or email is',
    'phone or email',
    'i would like to',
    'id like to',
    'could you',
    'can you',
    'help me',
    'show me',
    'let me',
    'email is',
    'phone is',
    'please'
  ];
  fillers.sort((left, right) => right.length - left.length);
  for (const phrase of fillers) {
    rest = rest.replace(new RegExp(escapeRegExp(phrase), 'g'), ' ');
  }
  const stop = new Set(['the', 'a', 'an', 'to', 'my', 'me', 'of', 'for', 'is', 'and', 'it', 'this', 'that']);
  return rest.split(' ').filter(word => word && !stop.has(word)).length === 0;
}

async function orderOnAccount(mongoUserId, orderCode) {
  const user = await User.findById(mongoUserId).select('user_id').lean();
  if (!user?.user_id || !orderCode) return null;
  const order = await Order.findOne({
    user_id: user.user_id,
    is_guest: false,
    order_id: { $regex: `^${escapeRegExp(orderCode)}$`, $options: 'i' }
  }).lean();
  return order ? publicOrderView(order) : null;
}

async function ordersForMember(mongoUserId, orderCode) {
  const recent = await recentOrdersForAccount(mongoUserId);
  if (!orderCode) {
    return { orders: recent, reply: accountOrdersReply(recent.length), matchedCode: false };
  }
  const wanted = orderCode.toUpperCase();
  const known = recent.find(order => String(order.order_id).toUpperCase() === wanted)
    || await orderOnAccount(mongoUserId, orderCode);
  if (known) {
    return { orders: [known], reply: 'Here is that order:', matchedCode: true };
  }
  const lead = recent.length
    ? `I couldn't find ${wanted} on this account. ${accountOrdersReply(recent.length)}`
    : `I couldn't find ${wanted} on this account.`;
  return { orders: recent, reply: lead, matchedCode: false };
}

async function tryGuestLookup(orderId, contact, clientIp) {
  const allowed = await guestLookupAllowed(clientIp);
  if (!allowed) {
    return {
      limited: true,
      message: 'You can look up 3 orders per hour. Please try again later.'
    };
  }

  const order = await Order.findOne({
    order_id: { $regex: `^${escapeRegExp(orderId)}$`, $options: 'i' }
  }).lean();
  if (!order) {
    return { message: 'No matching order found. Check the order code and the phone or email used at checkout.' };
  }

  const delivery = order.delivery_info || {};
  const cleanContact = contact.toLowerCase();
  const matchEmail = delivery.email && delivery.email.toLowerCase() === cleanContact;
  const matchPhone = phonesMatch(delivery.mobile, contact);
  if (!matchEmail && !matchPhone) {
    return { message: 'That phone or email does not match this order. Check both and try again.' };
  }
  return { order: publicOrderView(order) };
}

const GUEST_LOOKUP_PROMPT = 'Enter the order code and the phone or email used at checkout.';

/**
 * Identity decides the tracking UI. Members see account orders.
 * Guests look up one order, or get the form when the code or contact is missing.
 */
async function resolveOrderTracking({ isGuest, userId, messageText, clientIp }) {
  const details = extractLookupDetails(messageText);

  if (!isGuest && userId) {
    const account = await ordersForMember(userId, details.code);
    if (details.code && details.contact && !account.matchedCode) {
      const lookedUp = await tryGuestLookup(details.code, details.contact, clientIp);
      if (lookedUp.order) {
        return { reply: 'Here is that order:', orders: [lookedUp.order], showOrderForm: false };
      }
      if (lookedUp.limited) {
        return { reply: lookedUp.message, orders: account.orders, showOrderForm: false };
      }
      return {
        reply: `${lookedUp.message} ${account.reply}`.trim(),
        orders: account.orders,
        showOrderForm: false
      };
    }
    return { reply: account.reply, orders: account.orders, showOrderForm: false };
  }

  if (details.code && details.contact) {
    const lookedUp = await tryGuestLookup(details.code, details.contact, clientIp);
    if (lookedUp.limited) {
      return { reply: lookedUp.message, orders: [], showOrderForm: false };
    }
    if (lookedUp.order) {
      return { reply: 'Here is that order:', orders: [lookedUp.order], showOrderForm: false };
    }
    return { reply: lookedUp.message, orders: [], showOrderForm: true };
  }

  return { reply: GUEST_LOOKUP_PROMPT, orders: [], showOrderForm: true };
}

async function guestLookupAllowed(clientIp) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentLookups = await AiCallLog.countDocuments({
    feature: 'concierge',
    ip: clientIp || 'unknown',
    input_summary: GUEST_ORDER_LOOKUP,
    created_at: { $gte: oneHourAgo }
  });
  if (recentLookups >= GUEST_LOOKUP_LIMIT) return false;
  await logConciergeCall({
    ip: clientIp || 'unknown',
    status: 'order_lookup',
    input_summary: GUEST_ORDER_LOOKUP,
    output_summary: 'order_lookup'
  });
  return true;
}

/**
 * 2. GET /api/ai-chat/order-status
 * Guest lookup: order code plus the phone or email on that order.
 * Returns status, expected delivery, items, total, and city only.
 * Capped at 3 lookups per hour per IP.
 */
exports.getOrderStatus = async (req, res) => {
  try {
    const orderId = String(req.query.order_id || '').trim();
    const contact = String(req.query.contact || '').trim();

    if (!orderId) {
      return res.status(400).json({
        success: false,
        field: 'order_id',
        message: 'order_id is required'
      });
    }

    if (!contact) {
      return res.status(400).json({
        success: false,
        field: 'contact',
        message: 'Enter the phone or email used at checkout.'
      });
    }

    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const allowed = await guestLookupAllowed(clientIp);
    if (!allowed) {
      return res.status(429).json({
        success: false,
        message: 'You can look up 3 orders per hour. Please try again later.'
      });
    }

    const order = await Order.findOne({
      order_id: { $regex: `^${escapeRegExp(orderId)}$`, $options: 'i' }
    }).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        field: 'order_id',
        message: 'No matching order found.'
      });
    }

    const delivery = order.delivery_info || {};
    const cleanContact = contact.toLowerCase();
    const matchEmail = delivery.email && delivery.email.toLowerCase() === cleanContact;
    const matchPhone = phonesMatch(delivery.mobile, contact);

    if (!matchEmail && !matchPhone) {
      return res.status(401).json({
        success: false,
        field: 'contact',
        message: 'That phone or email does not match this order.'
      });
    }

    return res.status(200).json({
      success: true,
      order: publicOrderView(order)
    });
  } catch (error) {
    console.error('Error fetching order status for Dify:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/ai-chat/my-orders
 * Five most recent orders for the signed-in account. No code or contact required.
 */
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await recentOrdersForAccount(req.user.user_id);
    return res.status(200).json({
      success: true,
      reply: accountOrdersReply(orders.length),
      orders
    });
  } catch (error) {
    console.error('Error fetching account orders for chat:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * 3. POST /api/ai-chat/message
 * Handles messages sent from frontend Chat Drawer.
 * Applies Rate Limiting, PII scrubbing, 10s timeout, Dify dispatch, & Handover.
 */
exports.handleChatMessage = async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.connection?.remoteAddress || null;
  let userId = null;
  let sessionId = null;
  let messageText = '';

  try {
    const { message, session_id, conversation_id } = req.body;
    userId = shopperFromRequest(req);
    sessionId = typeof session_id === 'string' && session_id.trim() ? session_id.trim() : null;
    messageText = typeof message === 'string' ? message : '';
    const isGuest = !userId;

    if (!messageText.trim()) {
      return res.status(400).json({ success: false, status: 'invalid', message: 'Message cannot be empty.' });
    }

    if (messageText.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        status: 'invalid',
        message: 'Message exceeds the 500-character limit. Please shorten your question.'
      });
    }

    const prepared = await sessionAccess.prepareSession({
      sessionId,
      userId,
      clientIp,
      holdIdle: true
    });
    if (sendPrepared(res, prepared)) return;

    let chatSession = prepared.session;

    if (chatSession.support_conversation_id && ['waiting', 'in_progress'].includes(chatSession.status)) {
      const conversation = await require('../models/ChatConversation').findOne({ conversation_id: chatSession.support_conversation_id });
      if (conversation && conversation.status !== 'closed') {
        const { appendMessage } = require('../services/chat.service');
        const saved = await appendMessage(conversation, { sender_type: 'customer', sender_id: conversation.customer_id, content: messageText });
        if (saved) require('../services/socket.service').emitChatEvent('chat_message', saved.toObject(), conversation);
        const current = await sessionAccess.readSession({ sessionId: chatSession.session_id, userId });
        return res.json({ ...current.body, human_chat: true, handover: false });
      }
      chatSession.status = 'ai_active';
    }

    const requestedHandover = handoverIntent(messageText);
    if (requestedHandover) {
      sessionAccess.appendMessage(chatSession, {
        sender: 'user',
        text: messageText.trim()
      });

      if (!isSupportOpenNow()) {
        chatSession.last_activity_at = new Date();
        await chatSession.save();
        return res.status(200).json({
          success: true,
          decision: 'continue',
          reply: '',
          handover: false,
          ...contactFormFields('', true)
        });
      }

      sessionAccess.appendMessage(chatSession, {
        sender: 'system',
        text: 'Your conversation has been sent to our support team. You can continue messaging here.'
      });
      await markHandedOff(chatSession, requestedHandover, messageText.trim());
      return res.status(200).json({
        success: true,
        decision: 'continue',
        handover: true,
        handover_reason: chatSession.handover_reason,
        reply: ''
      });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const dailyLimit = parseInt(process.env.LLM_DAILY_LIMIT, 10) || 1000;
    const attemptFilter = {
      feature: 'concierge',
      status: { $in: LLM_ATTEMPT_STATUSES }
    };

    const todayCallsCount = await AiCallLog.countDocuments({
      ...attemptFilter,
      created_at: { $gte: startOfToday }
    });

    if (todayCallsCount >= dailyLimit) {
      await logConciergeCall({
        user_id: userId,
        session_id: sessionId,
        ip: clientIp,
        status: 'budget_exceeded',
        latency_ms: Date.now() - startTime,
        input_summary: messageText.slice(0, 100)
      });
      return res.status(503).json(unavailableBody('budget_exceeded'));
    }

    await warnAdminCcIfNeeded(todayCallsCount, dailyLimit);

    const scope = usageScope({ isGuest, userId, sessionId, clientIp });
    const maxPer10Min = isGuest ? 10 : 20;
    const maxPerDay = isGuest ? 30 : 100;

    const dayCalls = await AiCallLog.countDocuments({
      ...attemptFilter,
      ...scope,
      created_at: { $gte: startOfToday }
    });

    if (dayCalls >= maxPerDay) {
      await logConciergeCall({
        user_id: userId,
        session_id: sessionId,
        ip: clientIp,
        status: 'rate_limited',
        latency_ms: Date.now() - startTime,
        input_summary: messageText.slice(0, 100)
      });
      return res.status(429).json({
        success: false,
        status: 'daily_limit',
        show_contact_form: true,
        disable_composer: true,
        hotline: SUPPORT_HOTLINE,
        faq_url: FAQ_URL,
        message: `You have reached today's message limit (${maxPerDay}). Leave a message and we will reply by email.`
      });
    }

    const windowCalls = await AiCallLog.countDocuments({
      ...attemptFilter,
      ...scope,
      created_at: { $gte: tenMinutesAgo }
    });

    if (windowCalls >= maxPer10Min) {
      const oldestCall = await AiCallLog.findOne({
        ...attemptFilter,
        ...scope,
        created_at: { $gte: tenMinutesAgo }
      }).sort({ created_at: 1 });

      let waitSeconds = 60;
      if (oldestCall) {
        const expiresAt = oldestCall.created_at.getTime() + 10 * 60 * 1000;
        waitSeconds = Math.max(5, Math.ceil((expiresAt - Date.now()) / 1000));
      }

      await logConciergeCall({
        user_id: userId,
        session_id: sessionId,
        ip: clientIp,
        status: 'rate_limited',
        latency_ms: Date.now() - startTime,
        input_summary: messageText.slice(0, 100)
      });

      return res.status(429).json({
        success: false,
        status: 'rate_limited',
        show_contact_form: false,
        message: `You are sending messages too quickly. Please wait ${waitSeconds}s before trying again.`,
        wait_seconds: waitSeconds
      });
    }

    // A plain "track my order" is answered from the account or the guest form.
    // Dify stays on the thread when the shopper also asked something else.
    if (trackingIsTheWholeMessage(messageText)) {
      const resolved = await resolveOrderTracking({ isGuest, userId, messageText, clientIp });
      const userMessage = sessionAccess.appendMessage(chatSession, {
        sender: 'user',
        text: messageText.trim()
      });
      const assistantMessage = sessionAccess.appendMessage(chatSession, {
        sender: 'ai',
        text: resolved.reply,
        metadata: { orders: resolved.orders, showOrderForm: resolved.showOrderForm }
      });
      chatSession.consecutive_errors = 0;
      chatSession.last_activity_at = new Date();
      await chatSession.save();

      await AiCallLog.create({
        feature: 'concierge',
        user_id: userId,
        session_id: sessionId,
        ip: clientIp,
        model: 'order-lookup',
        latency_ms: Date.now() - startTime,
        status: 'success',
        input_summary: messageText.slice(0, 100),
        output_summary: resolved.reply.slice(0, 100)
      });

      return res.status(200).json({
        success: true,
        decision: 'continue',
        reply: resolved.reply,
        user_message_id: userMessage.message_id,
        assistant_message_id: assistantMessage.message_id,
        conversation_id: chatSession.dify_conversation_id || conversation_id || '',
        handover: false,
        handover_reason: null,
        products: [],
        orders: resolved.orders,
        orderCard: null,
        showOrderForm: resolved.showOrderForm
      });
    }

    // 5. Dify API Dispatch
    const difyBaseUrl = process.env.DIFY_API_BASE_URL || 'https://api.dify.ai/v1';
    const difyApiKey = process.env.DIFY_API_KEY;

    if (!difyApiKey) {
      // Mock fallback if Dify API key is not yet set in .env
      const mockReply = `Thanks for reaching out! Dify API key is not configured in backend .env. Please set DIFY_API_KEY to activate live AI responses.`;
      return res.status(200).json({
        success: true,
        reply: mockReply,
        is_mock: true
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    // Support hours are 08:00–20:00 VN time (UTC+7). Closed hours stay with the form.
    const isSupportOpen = isSupportOpenNow();

    const difyPayload = {
      inputs: {
        user_type: isGuest ? 'guest' : 'member',
        support_open: isSupportOpen ? 'true' : 'false'
      },
      query: message.trim(),
      response_mode: 'blocking',
      conversation_id: chatSession.dify_conversation_id || conversation_id || '',
      user: userId || session_id || 'guest_user'
    };

    let difyRes;
    try {
      difyRes = await fetch(`${difyBaseUrl}/chat-messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${difyApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(difyPayload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!difyRes.ok) {
      const difyError = await readDifyBody(difyRes);

      // Dify 429 / out-of-token / llm_error is usually temporary. Ask the shopper
      // to retry twice before falling back to the leave-a-message form.
      if (isLlmAvailabilityError(difyRes.status, difyError)) {
        return replyForProviderIssue(res, {
          chatSession,
          userId,
          sessionId,
          clientIp,
          startTime,
          messageText,
          detail: providerErrorText(difyError) || `dify_${difyRes.status}`
        });
      }

      throw new Error(`Dify API responded with ${difyRes.status}: ${providerErrorText(difyError).slice(0, 180)}`);
    }

    const difyData = await difyRes.json();
    const latencyMs = Date.now() - startTime;

    if (isLlmAvailabilityError(difyRes.status, difyData)) {
      return replyForProviderIssue(res, {
        chatSession,
        userId,
        sessionId,
        clientIp,
        startTime,
        messageText,
        detail: providerErrorText(difyData) || difyData.answer || 'llm_error'
      });
    }

    // Save conversation ID
    if (difyData.conversation_id) {
      chatSession.dify_conversation_id = difyData.conversation_id;
    }

    // Phân tích câu trả lời từ Dify (kiểm tra xem có yêu cầu Handover / Tool output)
    let aiAnswer = difyData.answer || '';
    // Strip reasoning thought block if model outputs <think>...</think>
    aiAnswer = aiAnswer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    if (!aiAnswer) {
      return replyForProviderIssue(res, {
        chatSession,
        userId,
        sessionId,
        clientIp,
        startTime,
        messageText,
        detail: 'empty_answer'
      });
    }
    let isHandover = false;
    let handoverReason = null;
    let summary = '';
    let productCards = [];
    let orderCard = null;
    let showOrderForm = false;
    let accountOrders = [];
    let showContactForm = false;
    let contactFormMessage = '';

    // Check if Dify returned JSON format for handover or embedded card
    try {
      if (aiAnswer.trim().startsWith('{') && aiAnswer.trim().endsWith('}')) {
        const parsed = JSON.parse(aiAnswer.trim());
        if (parsed.handover) {
          isHandover = true;
          handoverReason = parsed.handover_reason || 'user_request';
          summary = parsed.summary || '';
          aiAnswer = parsed.reply || 'Tôi đang kết nối bạn với nhân viên CSKH của Offsite...';
        }
        if (parsed.unavailable || parsed.showContactForm || parsed.show_contact_form) {
          showContactForm = true;
          if (parsed.message) contactFormMessage = String(parsed.message).trim();
          if (!parsed.handover) aiAnswer = typeof parsed.reply === 'string' ? parsed.reply : '';
        }
        if (Array.isArray(parsed.products)) productCards = parsed.products.slice(0, MAX_PRODUCT_CARDS);
        if (parsed.orderCard) orderCard = parsed.orderCard;
        if (parsed.showOrderForm) showOrderForm = true;
      }
    } catch (e) {
      // Answer is normal markdown text
    }

    // 1. Detect and parse HANDOFF marker (supports both <<HANDOFF|...>> and bare HANDOFF|...)
    const handoffMatch = aiAnswer.match(/(?:<<)?HANDOFF\|([^\|\n]+)\|([^>\n]+)(?:>>)?/i);
    if (handoffMatch) {
      isHandover = true;
      handoverReason = handoffMatch[1].trim();
      summary = handoffMatch[2].replace(/>>$/, '').trim();
      // Remove HANDOFF line completely
      aiAnswer = aiAnswer.replace(/(?:<<)?HANDOFF\|[^\n]+(?:>>)?/gi, '').trim();
    }

    const unavailableMarker = takeUnavailableMarker(aiAnswer);
    if (unavailableMarker) {
      showContactForm = true;
      if (unavailableMarker.message) contactFormMessage = unavailableMarker.message;
      aiAnswer = unavailableMarker.text;
    }

    // Outside 08:00–20:00 a handoff is a leave-a-message form, not a live transfer.
    if (!isSupportOpen && (isHandover || showContactForm)) {
      isHandover = false;
      showContactForm = true;
      contactFormMessage = contactFormMessage || CLOSED_SUPPORT_MESSAGE;
      aiAnswer = dropLiveHandoffCopy(aiAnswer);
    } else if (showContactForm && !isHandover) {
      aiAnswer = dropLiveHandoffCopy(aiAnswer);
    } else if (isHandover) {
      showContactForm = false;
    }

    // 2. Check if Dify returned product tag format <<PRODUCTS|10014,10016>>
    const productTagMatch = aiAnswer.match(/<<PRODUCTS\|([\d,\s]+)>>/i);
    if (productTagMatch) {
      const rawIds = productTagMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)).slice(0, MAX_PRODUCT_CARDS);
      // Remove the raw tag from user visible answer
      aiAnswer = aiAnswer.replace(/<<PRODUCTS\|[\d,\s]+>>/gi, '').trim();

      if (rawIds.length > 0) {
        const matchedProducts = await Product.find({ product_id: { $in: rawIds }, is_active: true }).lean();
        productCards = rawIds
          .map(id => matchedProducts.find(product => product.product_id === id))
          .filter(Boolean)
          .slice(0, MAX_PRODUCT_CARDS)
          .map(product => toChatProductCard(product));
      }
    }

    // Names the shopper or the assistant used are enough. If that name is an
    // active product, attach the card with Add even when the model omitted the tag.
    try {
      productCards = await cardsForConversation(productCards, messageText, aiAnswer);
    } catch (catalogErr) {
      console.error('Product card lookup failed:', catalogErr);
    }

    // 3. Detect order lookup info in answer ONLY if it's actual order tracking response, NOT general return policy
    const isReturnPolicyQuestion = /return policy|chính sách đổi trả|how to return|how do i request a refund/i.test(message) || /policy/i.test(message);
    const orderCodeMatch = aiAnswer.match(/(OFS-\d{4}-\d{5})/i);
    if (!isReturnPolicyQuestion && orderCodeMatch && /order.*(?:currently shipping|on its way|has been delivered|is processing)/i.test(aiAnswer)) {
      const matchedCode = orderCodeMatch[1].replace('#', '');
      let statusStr = 'SHIPPING';
      let progress = 65;
      if (/delivered/i.test(aiAnswer)) {
        statusStr = 'DELIVERED';
        progress = 100;
      } else if (/processing/i.test(aiAnswer)) {
        statusStr = 'PROCESSING';
        progress = 35;
      }

      orderCard = {
        code: `#${matchedCode}`,
        orderId: matchedCode,
        status: statusStr,
        progressPercent: progress
      };
    }

    // 4. Tracking UI follows the signed-in account, not the Dify script.
    // Members get account orders. Guests get a lookup, or the form.
    // Other questions keep the assistant's answer, with that UI attached.
    const userWantsTracking = isOrderTrackingRequest(messageText);
    const botWantsLookup = asksForOrderLookup(aiAnswer)
      && !isOrderActionRequest(messageText)
      && !isPolicyQuestion(messageText);
    if (!isHandover && !showContactForm && (userWantsTracking || botWantsLookup || showOrderForm)) {
      const resolved = await resolveOrderTracking({ isGuest, userId, messageText, clientIp });
      showOrderForm = resolved.showOrderForm;
      accountOrders = resolved.orders;
      orderCard = null;
      if (showOrderForm) {
        aiAnswer = asksForOrderLookup(aiAnswer) ? aiAnswer : `${aiAnswer}\n\n${resolved.reply}`.trim();
      } else {
        aiAnswer = withoutLookupAsk(aiAnswer) || resolved.reply;
      }
    }

    if (productCards.length > MAX_PRODUCT_CARDS) {
      productCards = productCards.slice(0, MAX_PRODUCT_CARDS);
    }

    // 5. Clean citation markers like (Source: Returns and Refunds) or (Source: Order lookup)
    aiAnswer = aiAnswer.replace(/\(Source:\s*[^)]+\)/gi, '').trim();
    // Clean any remaining raw <<...>> markers
    aiAnswer = aiAnswer.replace(/<<[^>]+>>/g, '').trim();
    // One connect notice is enough. Drop the extra "I'm connecting you…" line
    // when this reply, or an earlier one, already said it was sent to the team.
    const priorAnnounced = alreadyToldTeam(
      (chatSession.messages || []).map(entry => entry.text).join('\n')
    ) || !!chatSession.handover_reason;
    aiAnswer = dedupeTeamCloser(aiAnswer, { priorAnnounced, willShowBanner: isHandover });
    summary = dedupeTeamCloser(summary, { priorAnnounced, willShowBanner: isHandover });

    if (!aiAnswer && !isHandover && !showContactForm && !productCards.length && !orderCard && !showOrderForm && !accountOrders.length) {
      return replyForProviderIssue(res, {
        chatSession,
        userId,
        sessionId,
        clientIp,
        startTime,
        messageText,
        detail: 'empty_answer'
      });
    }

    // Lưu tin nhắn vào session
    const userMessage = sessionAccess.appendMessage(chatSession, {
      sender: 'user',
      text: message.trim()
    });

    let assistantMessage = null;
    if (aiAnswer || productCards.length || orderCard || showOrderForm || accountOrders.length) {
      assistantMessage = sessionAccess.appendMessage(chatSession, {
        sender: 'ai',
        text: aiAnswer,
        metadata: { products: productCards, orderCard, orders: accountOrders, showOrderForm, showContactForm }
      });
    }

    let handoverNote = null;
    if (isHandover) {
      chatSession.status = 'waiting';
      chatSession.retain_for_support = true;
      handoverNote = recordHandoverNote(chatSession, handoverReason, summary || messageText);
    }

    chatSession.consecutive_errors = 0;
    chatSession.last_activity_at = new Date();
    await chatSession.save();

    // Notify Support / Admin Dashboard via Realtime Socket.IO
    if (isHandover) {
      await notifyCskh(chatSession, handoverNote);
    }

    // Log AI Call
    await AiCallLog.create({
      feature: 'concierge',
      user_id: userId,
      session_id: session_id,
      ip: clientIp,
      model: process.env.LLM_MODEL || 'dify-workflow',
      prompt_tokens: difyData.metadata?.usage?.prompt_tokens || 0,
      completion_tokens: difyData.metadata?.usage?.completion_tokens || 0,
      total_tokens: difyData.metadata?.usage?.total_tokens || 0,
      latency_ms: latencyMs,
      status: 'success',
      input_summary: message.slice(0, 100),
      output_summary: aiAnswer.slice(0, 100)
    });

    return res.status(200).json({
      success: true,
      decision: 'continue',
      reply: aiAnswer,
      user_message_id: userMessage.message_id,
      assistant_message_id: assistantMessage ? assistantMessage.message_id : null,
      conversation_id: difyData.conversation_id,
      handover: isHandover,
      handover_reason: isHandover ? handoverReason : null,
      products: productCards,
      orders: accountOrders,
      orderCard,
      showOrderForm,
      ...(showContactForm ? contactFormFields(contactFormMessage, !isSupportOpen) : {})
    });
  } catch (err) {
    console.error('Error handling chat message:', err);
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';

    await logConciergeCall({
      user_id: userId,
      session_id: sessionId,
      ip: clientIp,
      status: isTimeout ? 'timeout' : 'error',
      latency_ms: Date.now() - startTime,
      input_summary: messageText.slice(0, 100)
    });

    if (isTimeout) {
      return res.status(504).json({
        success: false,
        status: 'temporarily_unavailable',
        show_contact_form: false,
        message: PROVIDER_RETRY_MESSAGE
      });
    }

    return res.status(500).json(unavailableBody('error'));
  }
};

/**
 * POST /api/ai-chat/leave-message
 * Persists the fallback form and hands the thread to support.
 */
exports.leaveMessage = async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    const text = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    const sessionId = typeof req.body.session_id === 'string' && req.body.session_id.trim()
      ? req.body.session_id.trim()
      : null;
    const userId = callerId(req);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        field: 'email',
        message: 'Enter a valid email address.'
      });
    }

    if (!text) {
      return res.status(400).json({
        success: false,
        field: 'message',
        message: 'Message is required.'
      });
    }

    if (text.length > 1000) {
      return res.status(400).json({
        success: false,
        field: 'message',
        message: 'Message exceeds the 1000-character limit.'
      });
    }

    const prepared = await sessionAccess.prepareSession({
      sessionId,
      userId,
      clientIp: req.ip || req.connection?.remoteAddress || null,
      holdIdle: false
    });
    if (sendPrepared(res, prepared)) return;
    const chatSession = prepared.session;

    sessionAccess.appendMessage(chatSession, {
      sender: 'user',
      text: `Leave a message (${email}): ${text}`
    });
    chatSession.status = 'waiting';
    chatSession.retain_for_support = true;
    const note = recordHandoverNote(chatSession, 'user_request', `Customer left a message at ${email}`);
    await chatSession.save();

    await notifyCskh(chatSession, note);

    return res.status(200).json({
      success: true,
      message: 'Your message has been received. We will reply by email.'
    });
  } catch (error) {
    console.error('Error saving concierge leave-message:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not send your message. Please try again.'
    });
  }
};

/**
 * POST /api/ai-chat/handover
 * Moves the open thread to CSKH without leaving the drawer.
 */
exports.requestHandover = async (req, res) => {
  try {
    const sessionId = typeof req.body.session_id === 'string' && req.body.session_id.trim()
      ? req.body.session_id.trim()
      : null;
    const userId = callerId(req);
    const note = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    const reason = normalizeHandoverReason(req.body.reason || handoverIntent(note) || 'user_request');

    const prepared = await sessionAccess.prepareSession({
      sessionId,
      userId,
      clientIp: req.ip || req.connection?.remoteAddress || null,
      holdIdle: true
    });
    if (sendPrepared(res, prepared)) return;
    const chatSession = prepared.session;

    if (!isSupportOpenNow()) {
      if (note) {
        sessionAccess.appendMessage(chatSession, {
          sender: 'user',
          text: note
        });
        chatSession.last_activity_at = new Date();
        await chatSession.save();
      }

      return res.status(200).json({
        success: true,
        decision: 'continue',
        handover: false,
        ...contactFormFields('', true)
      });
    }

    if (note) {
      sessionAccess.appendMessage(chatSession, {
        sender: 'user',
        text: note
      });
    } else {
      sessionAccess.appendMessage(chatSession, {
        sender: 'system',
        text: 'Customer asked to talk to a person.'
      });
    }

    await markHandedOff(chatSession, reason, note || 'Customer asked to talk to a person.');

    return res.status(200).json({
      success: true,
      decision: 'continue',
      handover: true,
      handover_reason: chatSession.handover_reason || reason
    });
  } catch (error) {
    console.error('Error handing concierge chat to CSKH:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not connect you to the team. Please try again.'
    });
  }
};

function callerId(req) {
  return shopperFromRequest(req);
}

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || null;
}

exports.getSession = async (req, res) => {
  try {
    const result = await sessionAccess.readSession({
      sessionId: req.params.sessionId,
      userId: callerId(req)
    });
    if (result.http) return res.status(result.http).json(result.body);
    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Error reading concierge session:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.openSession = async (req, res) => {
  try {
    const userId = callerId(req);
    const previousId = typeof req.body.session_id === 'string' ? req.body.session_id.trim() : '';
    const closeReason = typeof req.body.close_reason === 'string' ? req.body.close_reason : 'new_chat';
    const closed = await sessionAccess.closeOwned({
      sessionId: previousId,
      userId,
      closeReason
    });
    if (closed.http) return res.status(closed.http).json(closed.body);

    const wantsNotice = req.body.opening_notice === true || req.body.opening_notice === 'rotated';
    const opened = await sessionAccess.openFreshSession({
      userId,
      clientIp: clientIp(req),
      withRotateNotice: wantsNotice && closeReason === 'rotate',
      rotatable: !!(closed.session && closed.closed)
    });
    return res.status(200).json({ success: true, decision: 'continue', ...opened });
  } catch (error) {
    console.error('Error opening concierge session:', error);
    return res.status(500).json({ success: false, message: 'Could not start a new chat.' });
  }
};

exports.resumeSession = async (req, res) => {
  try {
    const result = await sessionAccess.resumeSession({
      sessionId: req.params.sessionId,
      userId: callerId(req)
    });
    if (result.http) return res.status(result.http).json(result.body);
    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Error resuming concierge session:', error);
    return res.status(500).json({ success: false, message: 'Could not continue this chat.' });
  }
};

exports.claimSession = async (req, res) => {
  try {
    const sessionId = typeof req.body.session_id === 'string' ? req.body.session_id.trim() : '';
    const result = await sessionAccess.claimSession({ sessionId, userId: callerId(req) });
    if (result.http) return res.status(result.http).json(result.body);
    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Error claiming concierge session:', error);
    return res.status(500).json({ success: false, message: 'Could not keep this chat.' });
  }
};

exports.listSessions = async (req, res) => {
  try {
    const result = await sessionAccess.listSessions({
      userId: callerId(req),
      limit: req.query.limit,
      cursor: req.query.cursor
    });
    if (result.http) return res.status(result.http).json(result.body);
    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Error listing concierge sessions:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteSession = async (req, res) => {
  try {
    const result = await sessionAccess.deleteSession({
      sessionId: req.params.sessionId,
      userId: callerId(req)
    });
    if (result.http) return res.status(result.http).json(result.body);
    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Error deleting concierge session:', error);
    return res.status(500).json({ success: false, message: 'Could not delete this chat.' });
  }
};

exports.saveOrderCard = async (req, res) => {
  try {
    const result = await sessionAccess.saveOrderCard({
      sessionId: req.params.sessionId,
      messageId: req.params.messageId,
      userId: callerId(req),
      orderCard: req.body.orderCard,
      text: req.body.text
    });
    if (result.http) return res.status(result.http).json(result.body);
    return res.status(200).json(result.body);
  } catch (error) {
    console.error('Error saving concierge order card:', error);
    return res.status(500).json({ success: false, message: 'Could not save that order.' });
  }
};
