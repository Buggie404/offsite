// Demo data for the Web 2 presentations: one set of customers, each set up for one story.
//
//   cd backend && node scripts/seed-demo.js           # remove the old demo set, then create it again
//   cd backend && node scripts/seed-demo.js --clear   # remove the demo set only
//   ... --presenter USR00012   # put the admin ↔ customer cases on another real account (default USR00005)
//   ... --no-presenter         # keep every case on the demo customers
//
// - Presenter: the cases where staff and the customer act on each other (redelivery answer,
//   Ritual Box proposals / replacement / pause ticket / refund, complaint voucher, a reported post)
//   go on the presenter's REAL account. Only what this script created there is removed again
//   (ids kept in Counters/demo_seed_state), plus what staff did live on those records, and the
//   account's community warning / restriction fields are put back as they were. The account itself,
//   its own orders, boxes, posts and points are never touched.
// - Every demo customer has an email demo.<name>@example.com and the password below. Everything
//   is found again through those accounts (orders, boxes, posts, reports, chats, points...), so
//   --clear also removes what was done with them live during a demo.
// - Staff accounts are NOT created: log in with the existing Admin CC / CSKH / QLSP accounts.
// - Orders are inserted directly (no order hooks). Orders seeded in a "stock held" state take
//   their stock off the product, and --clear puts back whatever is still held, so product stock
//   ends where it started.
// - Times are relative to now: run it again right before each demo (redelivery deadlines,
//   proposals and retries are 1-3 days out).
// - Refuses to run when NODE_ENV=production or the database name contains "prod".
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Subscription = require('../src/models/Subscription');
const RefundRequest = require('../src/models/RefundRequest');
const Voucher = require('../src/models/Voucher');
const Referral = require('../src/models/Referral');
const PointTransaction = require('../src/models/PointTransaction');
const Post = require('../src/models/Post');
const Comment = require('../src/models/Comment');
const Report = require('../src/models/Report');
const ModerationAction = require('../src/models/ModerationAction');
const Notification = require('../src/models/Notification');
const ChatConversation = require('../src/models/ChatConversation');
const ChatMessage = require('../src/models/ChatMessage');
require('../src/models/PostReport');
require('../src/models/CommentReport');
require('../src/models/AccountReport');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const PASSWORD = 'Demo@1234';
const EMAIL_RE = /^demo\.[a-z]+@example\.com$/;
const VOUCHER_PREFIX = 'DEMO';
const STATE_ID = 'demo_seed_state';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date();
const at = (days, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * HOUR);
const ymd = (date) => date.toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const HELD = ['processing', 'shipping', 'delivery_failed'];
const argValue = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const PRESENTER_ID = process.argv.includes('--no-presenter') ? null : (argValue('--presenter') || 'USR00005');
// Presenter fields live demo actions can change (moderation; Ritual DNA on delivered / refunded demo orders).
const RESTORED_FIELDS = ['community_warnings', 'community_restriction', 'report_warned_at', 'ritual_dna'];

const db = () => mongoose.connection.db;

// ─── Demo cast ─────────────────────────────────────────────────────
// key → profile. Phones are unique per user; Nga's orders ship to Hà's phone (referral phone match).
const CAST = {
  an:    { name: 'Nguyễn Văn An',   tier: 'Leaf',  phone: '0909100001', story: 'Giao thất bại: khách đã xác nhận địa chỉ mới (đơn Ritual Box), lỗi GHN' },
  binh:  { name: 'Trần Thị Bình',   tier: 'Seed',  phone: '0909100002', story: 'Giao thất bại: lỗi phía Offsite, hoàn tiền QR chờ chuyển khoản' },
  chi:   { name: 'Lê Minh Chi',     tier: 'Zen',   phone: '0909100003', story: 'Người báo cáo / bài viết bình thường trong cộng đồng' },
  dung:  { name: 'Phạm Quốc Dũng',  tier: 'Leaf',  phone: '0909100004', story: 'Ritual Box bị treo (suspended), đơn không khởi tạo được hộp' },
  giang: { name: 'Võ Hoàng Giang',  tier: 'Bloom', phone: '0909100005', story: 'Ritual Box bị admin huỷ (ngừng kinh doanh)' },
  ha:    { name: 'Đỗ Thu Hà',       tier: 'Bloom', phone: '0909100006', story: 'Người giới thiệu (referral) có 4 bạn ở 4 trạng thái' },
  khoa:  { name: 'Bùi Đăng Khoa',   tier: 'Seed',  phone: '0909100007', story: 'Được giới thiệu, đơn đầu đang giao (demo live: Đã nhận hàng)' },
  lan:   { name: 'Hồ Ngọc Lan',     tier: 'Seed',  phone: '0909100008', story: 'Được giới thiệu, đơn đầu đã giao, điểm đang chờ' },
  minh:  { name: 'Đặng Quang Minh', tier: 'Leaf',  phone: '0909100009', story: 'Được giới thiệu, thưởng đã cộng' },
  nga:   { name: 'Lý Thanh Nga',    tier: 'Seed',  phone: '0909100010', story: 'Được giới thiệu nhưng không hợp lệ (trùng SĐT người giới thiệu)' },
  phong: { name: 'Mai Thanh Phong', tier: 'Seed',  phone: '0909100011', story: 'Vi phạm lần đầu: bài spam + bình luận sai sự thật' },
  quan:  { name: 'Châu Minh Quân',  tier: 'Seed',  phone: '0909100012', story: 'Vi phạm lần 2 (đã bị cảnh cáo 1 lần)' },
  son:   { name: 'Trịnh Văn Sơn',   tier: 'Seed',  phone: '0909100013', story: 'Bài xúc phạm (mức nặng)' },
  tu:    { name: 'Kiều Anh Tú',     tier: 'Seed',  phone: '0909100014', story: 'Tài khoản bị báo cáo (bio quảng cáo)' },
  vy:    { name: 'Tạ Khánh Vy',     tier: 'Seed',  phone: '0909100015', story: 'Đang bị hạn chế cộng đồng 3 ngày (phía người dùng)' },
  xuan:  { name: 'Lâm Thị Xuân',    tier: 'Seed',  phone: '0909100016', story: 'Báo cáo bừa: 4 báo cáo bị bác liên tiếp + 1 đang chờ' }
};
const emailOf = (key) => `demo.${key}@example.com`;

// ─── Helpers ───────────────────────────────────────────────────────

async function nextNumber(collection, field, prefix, digits, start) {
  const [latest] = await db().collection(collection)
    .find({ [field]: new RegExp(`^${prefix}\\d{${digits}}$`) }, { projection: { [field]: 1 } })
    .sort({ [field]: -1 }).limit(1).toArray();
  return latest ? parseInt(latest[field].slice(prefix.length), 10) + 1 : start;
}

function sequence(prefix, digits, first) {
  let n = first;
  return () => `${prefix}${String(n++).padStart(digits, '0')}`;
}

// Validates through the model (defaults, enums) and returns a plain document to insert as is.
// PointTransactions.ref_type defaults to null but its enum has no null, so that path is skipped.
const SKIP_VALIDATION = { PointTransaction: ['ref_type'] };
function plain(Model, doc) {
  const instance = new Model(doc);
  const error = instance.validateSync(undefined, { pathsToSkip: SKIP_VALIDATION[Model.modelName] || [] });
  if (error) throw new Error(`${Model.modelName}: ${error.message}`);
  return instance.toObject({ depopulate: true });
}

async function insert(Model, docs) {
  if (!docs.length) return;
  await Model.collection.insertMany(docs.map((d) => plain(Model, d)));
}

function guardDatabase() {
  const uri = process.env.MONGODB_URI || '';
  if (!uri) throw new Error('MONGODB_URI is not set (backend/.env).');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run with NODE_ENV=production.');
  const dbName = mongoose.connection.db.databaseName;
  if (/prod/i.test(dbName)) throw new Error(`Refusing to run on database "${dbName}".`);
  return dbName;
}

// ─── Clear ─────────────────────────────────────────────────────────

async function clear() {
  const users = await User.find({ email: EMAIL_RE }, 'user_id _id').lean();
  const ids = users.map((u) => u.user_id);
  const mongoIds = users.map((u) => String(u._id));
  const state = await db().collection('Counters').findOne({ _id: STATE_ID });
  const seededAll = new Set(state?.orders || []);
  const seededHeld = new Set(state?.held_orders || []);

  // Stock: put back what demo orders still hold — seeded "held" orders, plus orders placed live
  // during the demo (they took stock at checkout). Cancelled orders already gave theirs back.
  const orders = await Order.find({ user_id: { $in: ids } }).lean();
  let restored = 0;
  for (const order of orders) {
    const tookStock = seededHeld.has(order.order_id) || (!seededAll.has(order.order_id) && order.stock_reserved);
    if (!tookStock || order.stock_released) continue;
    for (const item of order.items) {
      await Product.updateOne({ _id: item.product_id, 'variants.sku': item.variant_id },
        { $inc: { 'variants.$.stock': item.quantity, 'variants.$.inventory_revision': 1 } });
      restored += item.quantity;
    }
  }
  const subs = await Subscription.find({ user_id: { $in: ids } }).lean();
  for (const sub of subs) {
    if (!sub.reserved_for) continue;
    for (const item of sub.reserved_items || []) {
      await Product.updateOne({ _id: item.product_id, 'variants.sku': item.variant_id },
        { $inc: { 'variants.$.stock': item.quantity, 'variants.$.inventory_revision': 1 } });
      restored += item.quantity;
    }
  }

  const orderIds = orders.map((o) => o.order_id);
  const posts = await Post.find({ user_id: { $in: ids } }, 'post_id').lean();
  const postIds = posts.map((p) => p.post_id);
  const comments = await Comment.find({ $or: [{ user_id: { $in: ids } }, { post_id: { $in: postIds } }] }, 'comment_id').lean();
  const commentIds = comments.map((c) => c.comment_id);
  const chats = await ChatConversation.find({ customer_id: { $in: [...ids, ...mongoIds] } }, 'conversation_id').lean();
  const chatIds = chats.map((c) => c.conversation_id);

  const del = async (name, filter) => (await db().collection(name).deleteMany(filter)).deletedCount;
  const summary = {
    orders: await del('Orders', { user_id: { $in: ids } }),
    refund_requests: await del('RefundRequests', { $or: [{ user_id: { $in: ids } }, { order_id: { $in: orderIds } }] }),
    subscriptions: await del('Subscriptions', { user_id: { $in: ids } }),
    vouchers: await del('Vouchers', { $or: [
      { code: new RegExp(`^${VOUCHER_PREFIX}`) }, { assigned_user_id: { $in: ids } }, { related_ref: { $in: [...orderIds, ...chatIds] } }
    ] }),
    referrals: await del('Referrals', { $or: [{ referrer_id: { $in: ids } }, { referee_id: { $in: ids } }] }),
    point_transactions: await del('PointTransactions', { user_id: { $in: ids } }),
    reports: await del('Reports', { $or: [
      { reporter_id: { $in: ids } }, { post_id: { $in: postIds } }, { comment_id: { $in: commentIds } }, { reported_user_id: { $in: ids } }
    ] }),
    moderation_actions: await del('ModerationActions', { owner_id: { $in: ids } }),
    comments: await del('Comments', { comment_id: { $in: commentIds } }),
    posts: await del('Posts', { post_id: { $in: postIds } }),
    notifications: await del('Notifications', { recipient_id: { $in: ids } }),
    chat_messages: await del('ChatMessages', { conversation_id: { $in: chatIds } }),
    chats: await del('ChatConversations', { conversation_id: { $in: chatIds } }),
    carts: await del('Carts', { user_id: { $in: ids } }),
    pantry: await del('PantryItems', { user_id: { $in: ids } }),
    reviews: await del('Reviews', { user_id: { $in: ids } }),
    follows: await del('Follows', { $or: [{ follower_id: { $in: ids } }, { following_id: { $in: ids } }] }),
    quiz_results: await del('QuizResults', { user_id: { $in: ids } }),
    users: await del('Users', { user_id: { $in: ids } })
  };
  const presenterSummary = state?.presenter ? await clearPresenter(state.presenter, seededHeld) : null;
  await db().collection('Counters').deleteOne({ _id: STATE_ID });
  if (presenterSummary) console.log(presenterSummary);
  const removed = Object.entries(summary).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`Cleared demo data: ${removed || 'nothing to remove'}${restored ? `; ${restored} units back in stock` : ''}`);
}

// Removes only what the last seed created on the presenter's real account (and what staff or the
// presenter did live on those records), then puts the account's restored fields back.
async function clearPresenter(p, seededHeld) {
  const subIds = p.subscriptions || [];
  const orders = await Order.find({ user_id: p.user_id, $or: [{ order_id: { $in: p.orders || [] } }, { subscription_id: { $in: subIds } }] }).lean();
  const orderIds = orders.map((o) => o.order_id);
  let restored = 0;
  for (const order of orders) {
    // Seeded "held" orders, and orders the charge job made for a demo box (they reserved stock).
    const tookStock = seededHeld.has(order.order_id) || (!(p.orders || []).includes(order.order_id) && order.stock_reserved);
    if (!tookStock || order.stock_released) continue;
    for (const item of order.items) {
      await Product.updateOne({ _id: item.product_id, 'variants.sku': item.variant_id },
        { $inc: { 'variants.$.stock': item.quantity, 'variants.$.inventory_revision': 1 } });
      restored += item.quantity;
    }
  }
  for (const sub of await Subscription.find({ user_id: p.user_id, subscription_id: { $in: subIds } }).lean()) {
    if (!sub.reserved_for) continue;
    for (const item of sub.reserved_items || []) {
      await Product.updateOne({ _id: item.product_id, 'variants.sku': item.variant_id },
        { $inc: { 'variants.$.stock': item.quantity, 'variants.$.inventory_revision': 1 } });
      restored += item.quantity;
    }
  }
  const postIds = p.posts || [];
  const commentIds = (await Comment.find({ post_id: { $in: postIds } }, 'comment_id').lean()).map((c) => c.comment_id);
  const chatIds = p.chats || [];
  const targets = [...orderIds, ...postIds, ...subIds];
  const del = async (name, filter) => (await db().collection(name).deleteMany(filter)).deletedCount;
  const summary = {
    orders: await del('Orders', { user_id: p.user_id, order_id: { $in: orderIds } }),
    refund_requests: await del('RefundRequests', { order_id: { $in: orderIds } }),
    subscriptions: await del('Subscriptions', { user_id: p.user_id, subscription_id: { $in: subIds } }),
    reports: await del('Reports', { $or: [{ post_id: { $in: postIds } }, { comment_id: { $in: commentIds } }] }),
    moderation_actions: await del('ModerationActions', { target_id: { $in: [...postIds, ...commentIds] } }),
    comments: await del('Comments', { comment_id: { $in: commentIds } }),
    posts: await del('Posts', { user_id: p.user_id, post_id: { $in: postIds } }),
    vouchers: await del('Vouchers', { related_ref: { $in: [...orderIds, ...chatIds] } }),
    point_transactions: await del('PointTransactions', { user_id: p.user_id, ref_id: { $in: [...orderIds, ...postIds] } }),
    pantry: await del('PantryItems', { user_id: p.user_id, order_id: { $in: orderIds } }),
    notifications: await del('Notifications', { recipient_id: p.user_id, $or: [
      { order_id: { $in: orderIds } }, { post_id: { $in: [...orderIds, ...postIds] } }, { subscription_id: { $in: subIds } }, { target_id: { $in: targets } }
    ] }),
    chat_messages: await del('ChatMessages', { conversation_id: { $in: chatIds } }),
    chats: await del('ChatConversations', { conversation_id: { $in: chatIds } })
  };
  if (p.snapshot) await db().collection('Users').updateOne({ user_id: p.user_id }, { $set: p.snapshot });
  const removed = Object.entries(summary).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ');
  return `Cleared presenter ${p.user_id}: ${removed || 'nothing'}; account fields restored${restored ? `; ${restored} units back in stock` : ''}`;
}

// ─── Seed ──────────────────────────────────────────────────────────

async function loadProducts() {
  const skus = {
    heza: 'COF010', cusco: 'COF004', agaro: 'COF001', wilmer: 'COF031',
    tsuyu: 'MAT001', ogura: 'MAT005', house: 'MAT002', ichikoOut: 'MAT022', ichiko: 'MAT021', yuki: 'MAT031',
    holder: 'TOM006', aeropress: 'TOC008'
  };
  const out = {};
  for (const [key, sku] of Object.entries(skus)) {
    const product = await Product.findOne({ 'variants.sku': sku, category: { $in: ['coffee', 'matcha', 'tools'] } }).lean();
    if (!product) throw new Error(`Product with SKU ${sku} not found — update the SKU list in seed-demo.js.`);
    const variant = product.variants.find((v) => v.sku === sku);
    const image = product.images?.[0] || {};
    out[key] = {
      product, variant, sku,
      id: String(product._id),
      price: variant.price,
      discount: product.subscribe_discount_percent ?? 10,
      image: { url: image.url || '', public_id: image.public_id || 'demo' }
    };
  }
  return out;
}

async function seed() {
  const P = await loadProducts();
  const staffOf = async (role, email) => (await User.findOne({ email }).lean())
    || (await User.findOne({ role }).sort({ user_id: 1 }).lean());
  const staff = {
    cc: await staffOf('admin_cc', 'mai.anh@offsite.vn'),
    cskh: await staffOf('cskh', 'quynh.duyen@offsite.vn'),
    qlsp: await staffOf('qlsp', 'thuy.vy@offsite.vn')
  };
  for (const [k, s] of Object.entries(staff)) if (!s) throw new Error(`No ${k} staff account found.`);
  const sid = (s) => String(s._id);

  // ── Users ──
  const { nextUserId } = require('../src/services/user-id.service');
  const hash = await bcrypt.hash(PASSWORD, 10);
  const U = {};
  const userDocs = [];
  for (const [key, c] of Object.entries(CAST)) {
    const user_id = await nextUserId();
    const _id = new mongoose.Types.ObjectId();
    const card = { _id: new mongoose.Types.ObjectId(), card_type: 'credit', card_number: '4111111111111111',
      cardholder_name: c.name.toUpperCase(), expire_date: '12/29', cvc: '123', is_default: true };
    U[key] = { _id, user_id, name: c.name, email: emailOf(key), phone: c.phone, card, community: `demo_${key}` };
    userDocs.push({
      _id, user_id, email: emailOf(key), phone: c.phone, password_hash: hash,
      profile_name: c.name, community_name: `demo_${key}`, role: 'customer', membership_tier: c.tier,
      points: 0, created_at: at(-60), last_login_at: at(-1),
      addresses: [{ recipient_name: c.name, phone: c.phone, city: 'Ho Chi Minh', detail_address: '12 Nguyễn Huệ, Phường Bến Nghé, Quận 1', is_default: true, label: 'home' }],
      payment_methods: ['an', 'chi', 'dung', 'giang'].includes(key) ? [card] : []
    });
  }
  // Story-specific profile fields.
  const byKey = Object.fromEntries(userDocs.map((d, i) => [Object.keys(CAST)[i], d]));
  byKey.ha.referral_code = 'HA_DEMO2026';
  byKey.ha.points = 140;
  byKey.chi.points = 860;
  for (const k of ['khoa', 'lan', 'minh', 'nga']) byKey[k].referred_by = U.ha.user_id;
  byKey.tu.bio = 'Kiếm 5 triệu/ngày tại nhà 💸 inbox mình nhận link khoá học';
  byKey.quan.community_warnings = [{ reason: 'This is a warning: your post was reported because it looks like spam or advertising. Please review our community guidelines.', admin_id: sid(staff.cskh), level: 1, created_at: at(-14) }];
  byKey.vy.community_warnings = [
    { reason: 'This is a warning: your comment was reported because it is off topic for the community.', admin_id: sid(staff.cskh), level: 1, created_at: at(-20) },
    { reason: 'Your post was reported because it contains misleading claims. You cannot post or comment for 3 days.', admin_id: sid(staff.cc), level: 2, created_at: at(-1) }
  ];
  byKey.vy.community_restriction = { level: 2, until: at(2), reason: byKey.vy.community_warnings[1].reason, admin_id: sid(staff.cc), created_at: at(-1) };
  for (const doc of userDocs) {
    const { created_at: joined, ...fields } = doc;
    const plainDoc = plain(User, fields);
    plainDoc.createdAt = joined; // Users uses createdAt / updatedAt
    plainDoc.updatedAt = at(-1);
    // Sparse unique indexes only skip a field that is missing, not one set to null.
    for (const key of ['referral_code', 'email', 'phone', 'community_name']) if (plainDoc[key] == null) delete plainDoc[key];
    await User.collection.insertOne(plainDoc);
  }

  // Presenter: the real account that plays the customer in admin ↔ customer cases ("me").
  // Without one (--no-presenter) Chi plays that part.
  let presenterSnapshot = null;
  if (PRESENTER_ID) {
    const real = await User.findOne({ user_id: PRESENTER_ID }).lean();
    if (!real) throw new Error(`Presenter ${PRESENTER_ID} not found (use --presenter <user_id> or --no-presenter).`);
    if (real.role !== 'customer') throw new Error(`Presenter ${PRESENTER_ID} is staff (${real.role}); pick a customer account.`);
    const card = (real.payment_methods || []).find((pm) => pm.is_default) || (real.payment_methods || [])[0];
    if (!card) throw new Error(`Presenter ${PRESENTER_ID} has no saved card: add one in Account › Payment methods first (Ritual Boxes need it).`);
    const phone = real.phone || real.addresses?.[0]?.phone || '0900000000';
    U.me = { _id: real._id, user_id: real.user_id, name: real.profile_name, email: real.email, phone,
      card: { _id: card._id, cardholder_name: card.cardholder_name, last4: String(card.card_number || '').slice(-4) || '0000' },
      community: real.community_name || real.profile_name, presenter: true };
    presenterSnapshot = Object.fromEntries(RESTORED_FIELDS.map((f) => [f, real[f] ?? null]));
  } else {
    U.me = U.chi;
  }

  // ── Orders ──
  const nextOrderId = sequence(`OFS-${NOW.getFullYear()}-`, 5, await nextNumber('Orders', 'order_id', `OFS-${NOW.getFullYear()}-`, 5, 1));
  const orders = [];
  const held = [];
  const line = (p, qty = 1, sub = null) => {
    const unit = sub ? round2(p.price * (1 - p.discount / 100)) : p.price;
    return {
      product_id: p.id, variant_id: p.sku, product_name: p.product.name, variant_name: p.variant.label || 'Default',
      image: p.image, unit_price: unit, quantity: qty, subtotal: round2(unit * qty),
      purchase_type: sub ? 'subscription' : 'one_time', subscription_frequency_days: sub
    };
  };
  const payments = {
    cod: { method: 'cod' },
    qr: { method: 'qr' },
    bank: { method: 'bank_transfer' },
    card: (u) => ({ method: 'card', card_info: { brand: 'Visa', last4: u.card.last4 || '1111', cardholder_name: u.card.cardholder_name } })
  };
  // history: [[status, daysAgo(negative), by, note], ...]
  function order(userKey, items, opts) {
    const u = U[userKey];
    const subtotal = round2(items.reduce((s, i) => s + i.subtotal, 0));
    const shippingCost = opts.express ? 15 : 0;
    const discount = opts.coupon?.discount_amount || 0;
    const history = opts.history.map(([status, when, by, note]) => ({ status, changed_at: when, changed_by: by, note }));
    const doc = {
      order_id: nextOrderId(), user_id: u.user_id, is_guest: false, items,
      delivery_info: { recipient_name: u.name, mobile: opts.mobile || u.phone, email: u.email, city: 'Ho Chi Minh',
        address: opts.address || '12 Nguyễn Huệ, Phường Bến Nghé, Quận 1', note: opts.note || '' },
      shipping: { method: opts.express ? 'express' : 'standard', cost: shippingCost,
        tracking_number: history.some((h) => h.status === 'shipping') ? `GHN${crypto.randomInt(10000000, 99999999)}` : null, carrier: 'GHN' },
      payment: typeof opts.pay === 'function' ? opts.pay(u) : opts.pay,
      pricing: { subtotal, shipping_cost: shippingCost, discount_amount: discount, total: round2(subtotal + shippingCost - discount), currency: 'USD' },
      coupon: opts.coupon || null,
      order_status: history.at(-1).status,
      payment_status: opts.paid ? (history.at(-1).status === 'canceled' ? 'refunded' : 'paid') : 'pending',
      status_history: history,
      stock_reserved: true,
      stock_released: history.at(-1).status === 'canceled',
      delivered_at: history.find((h) => h.status === 'delivered')?.changed_at || null,
      canceled_at: history.find((h) => h.status === 'canceled')?.changed_at || null,
      created_at: history[0].changed_at,
      updated_at: history.at(-1).changed_at,
      ...opts.extra
    };
    if (doc.payment.method === 'cod' && doc.order_status === 'delivered') doc.payment_status = 'paid';
    orders.push(doc);
    if (HELD.includes(doc.order_status)) held.push(doc);
    return doc;
  }
  const placed = (d, pay) => pay === 'cod'
    ? [['pending', at(d), 'system', 'Order created'], ['processing', at(d, 1), sid(staff.cskh), 'Status updated by admin']]
    : [['processing', at(d), 'system', 'Payment received']];
  const shipped = (d) => ['shipping', at(d), sid(staff.cskh), 'Handed to GHN'];
  const delivered = (d, by = 'user') => ['delivered', at(d), by, by === 'user' ? 'Order received by user' : 'Status updated by admin'];
  const failed = (d, note) => ['delivery_failed', at(d), sid(staff.cskh), note];
  const awaiting = (requestedDaysAgo, confirmHours = 24) => ({
    status: 'awaiting_customer', requested_at: at(requestedDaysAgo), expires_at: new Date(at(requestedDaysAgo).getTime() + confirmHours * HOUR),
    reminder_sent_at: null, confirmed_at: null, contact_phone: null, shipping_address: null, note: ''
  });

  // ── Subscriptions (ids first: some orders belong to boxes) ──
  const nextSubId = sequence('SUB', 4, await nextNumber('Subscriptions', 'subscription_id', 'SUB', 4, 1));
  const subs = [];
  function box(userKey, p, frequency, status, extra = {}) {
    const u = U[userKey];
    const doc = {
      subscription_id: nextSubId(), user_id: u.user_id, product_id: p.id, variant_id: p.sku, quantity: 1,
      frequency_days: frequency, next_charge_at: at(10), status,
      pricing_snapshot: { original_price: p.price, subscribe_price: round2(p.price * (1 - p.discount / 100)), discount_percent: p.discount },
      payment_method_id: String(u.card._id),
      delivery_info: { recipient_name: u.name, mobile: u.phone, email: u.email, city: 'Ho Chi Minh', address: '12 Nguyễn Huệ, Phường Bến Nghé, Quận 1', note: '' },
      shipping_method: 'standard', created_at: at(-45), updated_at: at(-1),
      ...extra
    };
    subs.push(doc);
    return doc;
  }
  const subOrder = (s, cycle, p) => ({ subscription_id: s.subscription_id, subscription_cycle: cycle,
    subscription_payment_method_id: cycle === 1 ? s.payment_method_id : null });

  // 1) Failed deliveries — customer side (the customer must confirm a redelivery or cancel).
  const anBox = box('an', P.agaro, 14, 'active', { next_charge_at: at(9), created_at: at(-20), last_charged_at: at(-5) });
  order('an', [line(P.agaro, 1, 14)], { pay: payments.card, paid: true, history: [
    ...placed(-20, 'card'), shipped(-18), delivered(-16)], extra: subOrder(anBox, 1) });
  const anA1 = order('me', [line(P.heza), line(P.holder)], { pay: payments.cod, history: [
    ...placed(-4, 'cod'), shipped(-3), failed(0, 'Shipper gọi 3 lần không liên lạc được khách')], extra: {
    delivery_failed_reason_code: 'customer_unreachable', delivery_failed_reason: 'Shipper gọi 3 lần không liên lạc được khách',
    delivery_attempts: 1, redelivery: awaiting(-2 / 24) } });
  const anA2 = order('an', [line(P.agaro, 1, 14)], { pay: payments.card, paid: true, address: '45 Lê Lợi (sai số nhà)', history: [
    ['processing', at(-5), 'system', `Subscription ${anBox.subscription_id} charged (cycle 2)`], shipped(-4),
    failed(-1, 'Địa chỉ không tồn tại số nhà, shipper không tìm được')], extra: {
    ...subOrder(anBox, 2), delivery_failed_reason_code: 'wrong_address', delivery_failed_reason: 'Địa chỉ không tồn tại số nhà, shipper không tìm được',
    delivery_attempts: 1,
    redelivery: { ...awaiting(-1), status: 'confirmed', confirmed_at: at(0, -3), contact_phone: U.an.phone,
      shipping_address: { recipient_name: U.an.name, mobile: U.an.phone, email: U.an.email, city: 'Ho Chi Minh', address: '45A Lê Lợi, Phường Bến Thành, Quận 1', note: 'Gọi trước khi giao' },
      note: 'Mình ghi nhầm số nhà, giao lại giúp mình nhé' } } });
  const anShipping = order('me', [line(P.cusco)], { pay: payments.cod, express: true, history: [...placed(-2, 'cod'), shipped(-1)] });

  // 2) Failed deliveries — Offsite / carrier side (code: carrier_issue, staff ship again directly).
  const anCarrier = order('an', [line(P.cusco, 2)], { pay: payments.bank, paid: true, history: [
    ...placed(-5, 'bank'), shipped(-4), failed(0, 'GHN: xe giao hàng gặp sự cố, kiện hàng được trả về kho')], extra: {
    delivery_failed_reason_code: 'carrier_issue', delivery_failed_reason: 'GHN: xe giao hàng gặp sự cố, kiện hàng được trả về kho', delivery_attempts: 1 } });
  const binhOffsite = order('binh', [line(P.house)], { pay: payments.card, paid: true, history: [
    ...placed(-6, 'card'), shipped(-5), failed(-1, 'Lỗi phía Offsite: kho dán nhầm vận đơn, hàng bị chuyển hoàn')], extra: {
    delivery_failed_reason_code: 'carrier_issue', delivery_failed_reason: 'Lỗi phía Offsite: kho dán nhầm vận đơn, hàng bị chuyển hoàn', delivery_attempts: 1 } });

  // 3) No redelivery left (1st delivery + 2 redeliveries all failed): staff can only cancel → QR refund.
  const binhExhausted = order('me', [line(P.ogura)], { pay: payments.qr, paid: true, history: [
    ...placed(-12, 'qr'), shipped(-11), failed(-10, 'Khách không nghe máy'), shipped(-8), failed(-7, 'Khách hẹn lại nhưng vắng nhà'),
    shipped(-3), failed(-1, 'Khách từ chối nhận hàng')], extra: {
    delivery_failed_reason_code: 'refused', delivery_failed_reason: 'Khách từ chối nhận hàng', delivery_attempts: 3, redelivery: null } });

  // 4) Customer never answered → cancelled by the system, paid by QR → refund waiting for staff payout.
  const binhPayout = order('binh', [line(P.aeropress), line(P.agaro)], { pay: payments.qr, paid: true, history: [
    ...placed(-9, 'qr'), shipped(-8), failed(-6, 'Không liên lạc được khách'), ['canceled', at(-5), 'system', 'Customer did not respond after the failed delivery']], extra: {
    delivery_failed_reason_code: 'customer_unreachable', delivery_failed_reason: 'Không liên lạc được khách', delivery_attempts: 1,
    redelivery: { ...awaiting(-6), status: 'expired' }, refund_status: 'pending_payout',
    refund_destination: { bank_name: 'Vietcombank', account_number: '0071000123456', account_holder: 'TRAN THI BINH' } } });

  // 5) Ritual Box — Chi: regular customer, box #4 arrived damaged → refund request waiting for staff.
  const chiCoffee = box('me', P.heza, 14, 'active', { next_charge_at: at(9), created_at: at(-46), last_charged_at: at(-5) });
  const chiMatcha = box('me', P.tsuyu, 30, 'active', { next_charge_at: at(12), created_at: at(-18), last_charged_at: at(-18) });
  order('me', [line(P.heza, 1, 14), line(P.holder)], { pay: payments.card, paid: true, history: [...placed(-46, 'card'), shipped(-45), delivered(-43)], extra: subOrder(chiCoffee, 1) });
  for (const [cycle, d] of [[2, -32], [3, -18]]) {
    order('me', [line(P.heza, 1, 14)], { pay: payments.card, paid: true, history: [
      ['processing', at(d), 'system', `Subscription ${chiCoffee.subscription_id} charged (cycle ${cycle})`], shipped(d + 1), delivered(d + 3)], extra: subOrder(chiCoffee, cycle) });
  }
  order('me', [line(P.tsuyu, 1, 30)], { pay: payments.card, paid: true, history: [...placed(-18, 'card'), shipped(-17), delivered(-15)], extra: subOrder(chiMatcha, 1) });
  const chiDamaged = order('me', [line(P.heza, 1, 14)], { pay: payments.card, paid: true, history: [
    ['processing', at(-5), 'system', `Subscription ${chiCoffee.subscription_id} charged (cycle 4)`], shipped(-4), delivered(-2),
    ['pending_refund', at(-1), U.me.user_id, 'Refund requested by customer']], extra: {
    ...subOrder(chiCoffee, 4),
    refund_request: { type: 'return_refund', reason: 'Damaged item', description: 'Túi cà phê bị rách, hạt đổ ra ngoài hộp', evidence: [P.heza.image.url],
      items: [{ product_id: P.heza.id, variant_id: P.heza.sku, quantity: 1, reason: 'Damaged item' }], requested_at: at(-1), requested_by: U.me.user_id, status: 'pending' } } });

  // 6) Ritual Box — Dũng: payment problems (needs action) + paid checkout whose box could not start.
  box('me', P.cusco, 14, 'payment_failed', { next_charge_at: at(-2), failed_attempts: 2, last_failure_reason: 'Card declined (insufficient funds)',
    last_failed_at: at(-1), next_retry_at: at(1, 16), created_at: at(-40), last_charged_at: at(-16) });
  box('dung', P.ogura, 30, 'suspended', { next_charge_at: at(-9), failed_attempts: 3, last_failure_reason: 'Card expired',
    last_failed_at: at(-6), suspended_at: at(-6), created_at: at(-70), last_charged_at: at(-39) });
  order('dung', [line(P.tsuyu, 1, 14)], { pay: payments.card, paid: true, history: placed(-1, 'card'), extra: {
    subscription_start_failed: true, subscription_start_failed_at: at(-1), internal_notes: 'Thẻ đã bị xoá khỏi tài khoản ngay sau khi thanh toán' } });

  // 7) Ritual Box — Giang: stock problems and staff proposals.
  box('me', P.wilmer, 14, 'active', { next_charge_at: at(8), created_at: at(-30), last_charged_at: at(-6) }); // out of stock now
  box('me', P.ichikoOut, 30, 'paused', { next_charge_at: at(20), pause_option: 'until_reactivated', paused_at: at(-2), paused_by: 'admin',
    created_at: at(-60), last_charged_at: at(-32),
    admin_messages: [{ action: 'pause', reason: 'Item out of stock', message: 'Ichiko 40g đang tạm hết hàng, Offsite tạm dừng hộp và đề xuất món thay thế.', sent_by: sid(staff.qlsp), sent_at: at(-2) }],
    replacement_offer: { product_id: P.yuki.id, variant_id: P.yuki.sku, offered_at: at(-2), offered_by: sid(staff.qlsp) } });
  box('me', P.ogura, 14, 'paused', { next_charge_at: at(14), pause_option: 'until_reactivated', paused_at: at(-12), paused_by: 'customer',
    created_at: at(-50), last_charged_at: at(-26),
    admin_proposal: { type: 'resume', reason: 'Win-back', message: 'Ogura vừa về lô mới, bạn có muốn bật lại hộp không?', proposed_by: sid(staff.cc), proposed_at: at(-1), expires_at: at(2) },
    admin_messages: [{ action: 'propose', reason: 'Win-back', message: 'Ogura vừa về lô mới, bạn có muốn bật lại hộp không?', sent_by: sid(staff.cc), sent_at: at(-1) }] });
  box('giang', P.house, 30, 'cancelled_by_admin', { next_charge_at: at(-15), cancelled_at: at(-20), cancel_reason: 'Product discontinued', cancelled_by: sid(staff.qlsp),
    created_at: at(-90), last_charged_at: at(-50),
    admin_messages: [{ action: 'cancel', reason: 'Product discontinued', message: 'Phiên bản House Matcha cũ đã ngừng kinh doanh.', sent_by: sid(staff.qlsp), sent_at: at(-20) }] });

  // 8) Referral: Hà referred 4 friends.
  const khoaFirst = order('khoa', [line(P.tsuyu)], { pay: payments.cod, history: [...placed(-3, 'cod'), shipped(-1)] });
  const lanFirst = order('lan', [line(P.heza)], { pay: payments.cod, history: [...placed(-5, 'cod'), shipped(-3), delivered(-1)] });
  const minhFirst = order('minh', [line(P.ogura)], { pay: payments.card, paid: true, history: [...placed(-35, 'card'), shipped(-34), delivered(-32)],
    extra: { payment: { method: 'card', card_info: { brand: 'Visa', last4: '4242', cardholder_name: 'DANG QUANG MINH' } } } });
  const ngaFirst = order('nga', [line(P.cusco)], { pay: payments.cod, mobile: U.ha.phone, history: [...placed(-12, 'cod'), shipped(-11), delivered(-10)] });
  const minhSecond = order('minh', [line(P.heza)], { pay: payments.cod, history: [...placed(-10, 'cod'), shipped(-9), delivered(-8)],
    coupon: { code: `WELCOME5_${U.minh.user_id.slice(3)}`, discount_type: 'fixed', discount_value: 5, discount_amount: 5, applies_to: 'all', eligible_subtotal: P.heza.price } });

  // Orders for the complaint voucher and the community users (so they look like real customers).
  for (const k of ['phong', 'quan', 'son', 'tu', 'vy', 'xuan']) {
    order(k, [line(P.agaro)], { pay: payments.cod, history: [...placed(-25, 'cod'), shipped(-24), delivered(-22)] });
  }

  // Track ids BEFORE writing, so a run that fails half way is still cleared next time.
  await db().collection('Counters').updateOne({ _id: STATE_ID },
    { $set: { orders: orders.map((o) => o.order_id), held_orders: held.map((o) => o.order_id), seeded_at: NOW } }, { upsert: true });
  const presenterState = PRESENTER_ID ? {
    user_id: U.me.user_id, mongo_id: String(U.me._id), snapshot: presenterSnapshot,
    orders: orders.filter((o) => o.user_id === U.me.user_id).map((o) => o.order_id),
    subscriptions: subs.filter((s) => s.user_id === U.me.user_id).map((s) => s.subscription_id),
    posts: [], chats: ['CHAT-DEMOPAUSE1', 'CHAT-DEMOCMP01']
  } : null;
  if (presenterState) await db().collection('Counters').updateOne({ _id: STATE_ID }, { $set: { presenter: presenterState } });

  await insert(Subscription, subs);
  for (const o of orders) await Order.collection.insertOne(plain(Order, o));
  for (const o of held) {
    for (const item of o.items) {
      await Product.updateOne({ _id: item.product_id, 'variants.sku': item.variant_id },
        { $inc: { 'variants.$.stock': -item.quantity, 'variants.$.inventory_revision': 1 } });
    }
  }

  // Refund request document for Chi's damaged box (the staff screen reads this collection).
  const rrNext = await nextNumber('RefundRequests', 'refund_request_id', 'RR', 6, 500001);
  await insert(RefundRequest, [{
    refund_request_id: `RR${rrNext}`, order_id: chiDamaged.order_id, user_id: U.me.user_id, reason: 'Damaged item',
    payment: chiDamaged.payment, description: chiDamaged.refund_request.description, evidence: [P.heza.image.url],
    refund_item: [{ ...chiDamaged.items[0], image: P.heza.image }], status: 'pending',
    status_history: [{ status: 'pending', changed_at: at(-1), changed_by: U.me.user_id, note: 'Refund request submitted by customer' }],
    created_at: at(-1), updated_at: at(-1)
  }]);

  // ── Support chats (ticket ids staff cite when acting on a customer's request) ──
  const chats = [
    { id: 'CHAT-DEMOPAUSE1', user: 'me', outcome: 'forwarded', messages: [
      ['customer', 'Chào shop, tháng sau mình đi công tác 1 tháng, cho mình tạm dừng hộp matcha Tsuyu nhé.'],
      ['agent', 'Dạ em đã ghi nhận, em chuyển yêu cầu tạm dừng hộp matcha cho Senior Admin xử lý ạ.']] },
    { id: 'CHAT-DEMOCMP01', user: 'me', outcome: 'forwarded', order: binhExhausted, messages: [
      ['customer', `Đơn ${binhExhausted.order_id} của mình giao 3 lần đều không thành công, mình hơi thất vọng.`],
      ['agent', 'Dạ em rất xin lỗi chị, em ghi nhận khiếu nại và sẽ gửi chị một voucher xin lỗi ạ.']] },
    { id: 'CHAT-DEMOBINH01', user: 'binh', outcome: 'forwarded', order: binhPayout, messages: [
      ['customer', 'Đơn của mình bị huỷ mà chưa thấy hoàn tiền, mình đã chuyển khoản QR rồi.'],
      ['agent', 'Dạ em xin lỗi vì sự bất tiện, em đã chuyển bộ phận hoàn tiền và tặng chị một voucher xin lỗi ạ.']] }
  ];
  for (const c of chats) {
    const u = U[c.user];
    await insert(ChatConversation, [{
      conversation_id: c.id, customer_id: String(u._id), agent_id: sid(staff.cskh), status: 'closed', claimed_at: at(-2),
      waiting_since: at(-2), closed_at: at(-2, 1), closed_by_name: staff.cskh.profile_name, close_outcome: c.outcome, close_reason: 'resolved',
      last_customer_message_at: at(-2), last_agent_message_at: at(-2, 1), last_message_preview: c.messages.at(-1)[1], last_message_at: at(-2, 1),
      context_order_id: c.order?.order_id || null, created_at: at(-2), updatedAt: at(-2, 1)
    }]);
    await insert(ChatMessage, c.messages.map(([type, content], i) => ({
      conversation_id: c.id, sender_type: type, sender_id: type === 'customer' ? u.user_id : sid(staff.cskh), content, created_at: at(-2, i * 0.5)
    })));
  }

  // ── Vouchers ──
  const v = (code, fields) => ({
    code, voucher_type: 'discount', discount_type: 'percentage', discount_value: 10, is_active: true, usage_limit: 200, used_count: 0,
    min_order_amount: 0, valid_from: ymd(at(-5)), valid_to: ymd(at(30)), createdAt: at(-6).toISOString(), created_by: staff.cc.user_id,
    purpose: 'campaign', usage_limit_per_user: 1, applies_to: 'all', ...fields
  });
  await insert(Voucher, [
    v('DEMOWINTER15', { title: 'Winter Ritual 15%', subtitle: 'Toàn bộ cửa hàng', discount_value: 15, max_discount_value: 20, used_count: 37 }),
    v('DEMOBLOOM20', { title: 'Bloom member 20%', subtitle: 'Chỉ hạng Bloom', discount_value: 20, max_discount_value: 15, target_tier: 'bloom', used_count: 4 }),
    v('DEMOMATCHA10', { title: '$10 off matcha', discount_type: 'fixed', discount_value: 10, min_order_amount: 40, applies_to: 'category', applicable_categories: ['matcha'], used_count: 12 }),
    v('DEMOFREESHIP', { title: 'Free express shipping', voucher_type: 'shipping', discount_type: 'percentage', discount_value: 100, used_count: 58, usage_limit: 500 }),
    v('DEMONOEL', { title: 'Noel 2026 (scheduled)', discount_value: 12, valid_from: ymd(at(25)), valid_to: ymd(at(40)) }),
    v('DEMOHALLOWEEN', { title: 'Halloween (expired)', discount_value: 13, valid_from: ymd(at(-40)), valid_to: ymd(at(-25)), createdAt: at(-45).toISOString(), used_count: 81 }),
    v('DEMOFLASH50', { title: 'Flash sale (used up)', discount_value: 25, usage_limit: 50, used_count: 50 }),
    v('DEMOSTOPPED', { title: 'Stopped campaign', is_active: false, used_count: 9 }),
    v('DEMOREDEEM300', { title: '$8 off for 300 points', purpose: 'loyalty_redeem', discount_type: 'fixed', discount_value: 8, points_cost: 300, usage_limit: null }),
    v('CMP-DEMO1', { title: 'Sorry voucher', purpose: 'complaint', discount_type: 'fixed', discount_value: 5, usage_limit: 1, assigned_user_id: U.binh.user_id,
      related_ref: binhPayout.order_id, created_by: staff.cskh.user_id, valid_to: ymd(at(25)) }),
    // Referral welcome vouchers: Lan's is new (first order just delivered), Minh used his.
    v(`WELCOME5_${U.lan.user_id.slice(3)}`, { purpose: 'referral', discount_type: 'fixed', discount_value: 5, max_discount_value: 5, usage_limit: 1, assigned_user_id: U.lan.user_id, created_by: null, valid_from: ymd(at(-1)), valid_to: ymd(at(179)) }),
    v(`WELCOME5_${U.minh.user_id.slice(3)}`, { purpose: 'referral', discount_type: 'fixed', discount_value: 5, max_discount_value: 5, usage_limit: 1, used_count: 1, assigned_user_id: U.minh.user_id, created_by: null, valid_from: ymd(at(-32)), valid_to: ymd(at(148)) })
  ]);
  await User.updateOne({ user_id: U.lan.user_id }, { $set: { welcome_voucher_code: `WELCOME5_${U.lan.user_id.slice(3)}` } });
  await User.updateOne({ user_id: U.minh.user_id }, { $set: { welcome_voucher_code: `WELCOME5_${U.minh.user_id.slice(3)}` } });

  // ── Referrals + points ──
  const refNext = sequence('REF', 6, await nextNumber('Referrals', 'referral_id', 'REF', 6, 1));
  const ref = (key, created, fields) => ({ referral_id: refNext(), referrer_id: U.ha.user_id, referee_id: U[key].user_id, referral_code: 'HA_DEMO2026',
    referee_display: U[key].name.split(' ').at(-1), created_at: created, updated_at: created, ...fields });
  await insert(Referral, [
    ref('khoa', at(-4), { order_reward_status: 'pending' }),
    ref('lan', at(-7), { order_reward_status: 'awaiting_post', first_order_id: lanFirst.order_id, order_reward_due_at: at(2), welcome_voucher_code: `WELCOME5_${U.lan.user_id.slice(3)}` }),
    ref('minh', at(-40), { order_reward_status: 'posted', first_order_id: minhFirst.order_id, welcome_voucher_code: `WELCOME5_${U.minh.user_id.slice(3)}` }),
    ref('nga', at(-14), { order_reward_status: 'ineligible', ineligible_reason: 'phone_match', first_order_id: ngaFirst.order_id })
  ]);
  const ptxNext = sequence('PTX', 6, await nextNumber('PointTransactions', 'transaction_id', 'PTX', 6, 1));
  // ref_type's enum has no null: leave it out when there is nothing to point at.
  const ptx = (userKey, type, amount, status, refType, refId, created) => ({ transaction_id: ptxNext(), user_id: U[userKey].user_id, type, amount, status,
    ...(refType ? { ref_type: refType, ref_id: refId } : {}), posted_at: status === 'posted' ? created : null, created_at: created, updated_at: created });
  await insert(PointTransaction, [
    ptx('ha', 'adjust', 60, 'posted', null, null, at(-50)),
    ...['khoa', 'lan', 'minh', 'nga'].map((k, i) => ptx('ha', 'referral_register', 20, 'posted', 'referral', U[k].user_id, [at(-4), at(-7), at(-40), at(-14)][i])),
    ptx('ha', 'referral_order', 20, 'posted', 'order', minhFirst.order_id, at(-29)),
    ptx('ha', 'referral_order', 20, 'pending', 'order', lanFirst.order_id, at(-1)),
    ptx('chi', 'purchase', 860, 'posted', 'order', null, at(-30))
  ]);
  void minhSecond; void khoaFirst; void anA1; void anShipping; void anCarrier; void binhOffsite; void binhExhausted;

  // ── Community ──
  const postNext = sequence('POST', 6, await nextNumber('Posts', 'post_id', 'POST', 6, 600001));
  const cmtNext = sequence('CMT', 6, await nextNumber('Comments', 'comment_id', 'CMT', 6, 700001));
  const post = (key, content, base, created, extra = {}) => ({
    post_id: postNext(), user_id: U[key].user_id, author: { username: U[key].community, avatar_url: null }, content, base,
    media: extra.image ? [{ url: extra.image, public_id: 'demo', type: 'image' }] : [], created_at: created, updatedAt: created, ...extra.fields
  });
  const harmlessChi = post('chi', 'Sáng nay thử pha Heza bằng V60, tỉ lệ 1:15 ra vị rất cân bằng ☕', 'COFFEE', at(-9), { image: P.heza.image.url });
  const harmlessHa = post('ha', 'Góc pha matcha cuối tuần của mình 🍵', 'MATCHA', at(-8), { image: P.tsuyu.image.url });
  const harmlessMinh = post('minh', 'Ai có công thức cold brew ngon chỉ mình với', 'COFFEE', at(-6));
  const spam = post('phong', 'INBOX NGAY để mua matcha giá sỉ rẻ nhất thị trường!!! Zalo 0912xxxxxx, freeship toàn quốc 🔥🔥🔥', 'MATCHA', at(-1, -5));
  const offTopic = post('quan', 'Có ai pass lại 2 vé concert tối thứ 7 không, mình mua giá gốc', 'OTHERS', at(-1, -2));
  const rude = post('son', 'Mấy người pha cà phê kiểu này đúng là không biết gì, đừng đăng nữa cho đỡ chướng mắt', 'COFFEE', at(0, -6));
  const lanPost = post('lan', 'Lần đầu thử whisk matcha bằng chasen, bọt mịn hơn mình nghĩ! 😍', 'MATCHA', at(-2), { image: P.ogura.image.url });
  const vyHidden = post('vy', 'Uống matcha này 1 tuần giảm 5kg, cam kết 100%', 'MATCHA', at(-2), {
    fields: { status: 'hidden', hidden_reason: 'manual', hidden_at: at(-1), hidden_by: sid(staff.cc) } });
  // Presenter's post: reported as off topic, a first offence → staff warn live, the presenter sees it.
  const mePost = post('me', 'Pass lại máy xay cà phê cũ còn mới 90%, giá rẻ, ai cần inbox mình nhé', 'OTHERS', at(-1, -4));
  const allPosts = [harmlessChi, harmlessHa, harmlessMinh, spam, offTopic, rude, lanPost, vyHidden, mePost];
  if (presenterState) await db().collection('Counters').updateOne({ _id: STATE_ID }, { $set: { 'presenter.posts': [mePost.post_id] } });
  await insert(Post, allPosts);
  const misleadingComment = { comment_id: cmtNext(), post_id: lanPost.post_id, user_id: U.phong.user_id,
    author: { username: U.phong.community, avatar_url: '' }, content: 'Matcha này hàng fake đó, mua ở shop mình mới là hàng chuẩn Nhật', created_at: at(-1), updated_at: at(-1) };
  const okComment = { comment_id: cmtNext(), post_id: harmlessChi.post_id, user_id: U.lan.user_id,
    author: { username: U.lan.community, avatar_url: '' }, content: 'Tỉ lệ này mình thử rồi, ngon thật!', created_at: at(-8), updated_at: at(-8) };
  await insert(Comment, [misleadingComment, okComment]);
  await db().collection('Posts').updateOne({ post_id: lanPost.post_id }, { $set: { comment_count: 1 } });
  await db().collection('Posts').updateOne({ post_id: harmlessChi.post_id }, { $set: { comment_count: 1 } });

  const rep = (type, target, reporter, reason, note, created, status = 'pending') => ({
    target_type: type, reporter_id: U[reporter].user_id, reason, note, status, created_at: created, updated_at: status === 'pending' ? created : at(-3 + Math.random()),
    ...(type === 'post' ? { post_id: target.post_id } : type === 'comment' ? { comment_id: target.comment_id, post_id: target.post_id } : { reported_user_id: target.user_id })
  });
  const reports = [
    rep('post', spam, 'chi', 'spam', 'Quảng cáo bán hàng', at(0, -20)),
    rep('post', spam, 'ha', 'spam', '', at(0, -18)),
    rep('post', spam, 'lan', 'spam', 'Spam số điện thoại', at(0, -10)),
    rep('post', offTopic, 'an', 'off_topic', 'Không liên quan cà phê/trà', at(0, -15)),
    rep('post', offTopic, 'minh', 'off_topic', '', at(0, -12)),
    rep('post', rude, 'chi', 'inappropriate', 'Xúc phạm người khác', at(0, -5)),
    rep('post', rude, 'binh', 'inappropriate', '', at(0, -4)),
    rep('comment', misleadingComment, 'lan', 'misleading', 'Nói sai sự thật về sản phẩm', at(0, -9)),
    rep('comment', misleadingComment, 'ha', 'misleading', '', at(0, -8)),
    rep('account', U.tu, 'minh', 'spam', 'Bio quảng cáo kiếm tiền online', at(-1)),
    rep('account', U.tu, 'chi', 'spam', '', at(0, -7)),
    rep('post', mePost, 'chi', 'off_topic', 'Bán đồ cũ, không liên quan', at(0, -14)),
    rep('post', mePost, 'ha', 'off_topic', '', at(0, -11)),
    // Xuân: 4 reports dismissed in a row, a 5th still pending (dismissing it triggers the report-abuse warning).
    rep('post', harmlessChi, 'xuan', 'misleading', '', at(-8), 'dismissed'),
    rep('post', harmlessHa, 'xuan', 'spam', '', at(-7), 'dismissed'),
    rep('post', harmlessMinh, 'xuan', 'off_topic', '', at(-5), 'dismissed'),
    rep('comment', okComment, 'xuan', 'other', 'Không thích', at(-4), 'dismissed'),
    rep('post', lanPost, 'xuan', 'misleading', 'Matcha không thể tạo bọt như vậy', at(0, -3))
  ];
  for (const r of reports) {
    const Model = mongoose.model({ post: 'PostReport', comment: 'CommentReport', account: 'AccountReport' }[r.target_type]);
    const { target_type, ...fields } = r;
    const docPlain = plain(Model, fields);
    docPlain.created_at = r.created_at;
    docPlain.updated_at = r.updated_at;
    await Report.collection.insertOne(docPlain);
  }

  // Handled history: Quân's earlier warning, Vy's suspension.
  await insert(ModerationAction, [
    { target_type: 'post', target_id: 'POST-DEMO-OLD', owner_id: U.quan.user_id, owner_name: U.quan.community, action: 'warn', also_hidden: true,
      message: byKey.quan.community_warnings[0].reason, reports_closed: 2, admin_id: sid(staff.cskh), admin_name: staff.cskh.profile_name, admin_role: 'cskh', created_at: at(-14) },
    { target_type: 'post', target_id: vyHidden.post_id, owner_id: U.vy.user_id, owner_name: U.vy.community, action: 'suspend_3d', also_hidden: true, restricted_until: at(2),
      message: byKey.vy.community_warnings[1].reason, reports_closed: 3, admin_id: sid(staff.cc), admin_name: staff.cc.profile_name, admin_role: 'admin_cc', created_at: at(-1) }
  ]);

  // ── Notifications (what the customers see when they log in) ──
  const subOf = (key, status) => subs.find((s) => s.user_id === U[key].user_id && s.status === status)?.subscription_id;
  const n = (key, type, message, fields = {}, created = at(0, -1)) => ({
    notification_id: `NTF${crypto.randomUUID()}`, recipient_id: U[key].user_id, sender: null, type, message, is_read: false,
    created_at: created, updated_at: created, ...fields
  });
  await insert(Notification, [
    n('me', 'ORDER_DELIVERY_FAILED', `Order ${anA1.order_id} could not be delivered: Shipper gọi 3 lần không liên lạc được khách. Confirm the redelivery or cancel within 24 hours.`,
      { order_id: anA1.order_id, post_id: anA1.order_id, target_type: 'order', target_id: anA1.order_id }, at(0, -2)),
    n('binh', 'ORDER_CANCELED', `No reply after the failed delivery, so order ${binhPayout.order_id} was cancelled. Your refund will be sent to Vietcombank ****3456.`,
      { order_id: binhPayout.order_id, post_id: binhPayout.order_id, target_type: 'order', target_id: binhPayout.order_id }, at(-5)),
    n('me', 'SUBSCRIPTION_PAYMENT_FAILED', 'We could not charge your card for your Ritual Box (Card declined). We will try again in 24 hours.',
      { subscription_id: subOf('me', 'payment_failed') }, at(-1)),
    n('me', 'SUBSCRIPTION_PROPOSAL', 'Offsite suggests resuming your Ogura Ritual Box. Accept or decline in Account › Ritual Box within 3 days.',
      { subscription_id: subs.find((s) => s.user_id === U.me.user_id && s.admin_proposal)?.subscription_id }, at(-1)),
    n('me', 'SUBSCRIPTION_PAUSED', 'Your Ichiko Ritual Box is paused because the item is out of stock. Choose a replacement in Account › Ritual Box.',
      { subscription_id: subs.find((s) => s.user_id === U.me.user_id && s.replacement_offer)?.subscription_id }, at(-2)),
    n('quan', 'COMMUNITY_MODERATION', byKey.quan.community_warnings[0].reason, {}, at(-14)),
    n('vy', 'COMMUNITY_MODERATION', byKey.vy.community_warnings[1].reason, { post_id: vyHidden.post_id }, at(-1)),
    n('ha', 'POINTS_PENDING', `${U.lan.name.split(' ').at(-1)} received their first order: +20 referral points pending.`, {}, at(-1))
  ]);

  return { U, P, orders, subs, staff, presenterSnapshot, ids: { mePost, anA1, anA2, anShipping, anCarrier, binhOffsite, binhExhausted, binhPayout, chiDamaged, khoaFirst, spam, offTopic, rude, lanPost } };
}

function printCheatSheet({ U, ids, subs }) {
  const sub = (userKey, test) => subs.filter((s) => s.user_id === U[userKey].user_id && test(s)).map((s) => s.subscription_id).join(', ');
  const me = U.me.presenter ? `${U.me.user_id} (${U.me.name})` : 'Chi';
  console.log(`\nDemo customers (password: ${PASSWORD})`);
  for (const [key, c] of Object.entries(CAST)) console.log(`  ${U[key].user_id}  ${emailOf(key).padEnd(28)} ${c.story}`);
  console.log(`
On ${me} — admin ↔ customer cases
  ${ids.anA1.order_id}  delivery_failed · customer_unreachable · YOU confirm the redelivery (24h) → admin "Ship again"
  ${ids.anShipping.order_id}  shipping (COD) → admin marks "Delivery failed" live → you get the notice and answer
  ${ids.binhExhausted.order_id}  3rd failed delivery, no redelivery left → admin cancels → you add a bank account → admin "Mark refund paid"
                  + ticket CHAT-DEMOCMP01: CSKH issues a complaint voucher for this order live → shows in your vouchers
  ${ids.chiDamaged.order_id}  Ritual Box #4 · refund request pending (damaged) → admin approves / rejects → you see the result
  ${sub('me', (s) => s.product_id === ids.chiDamaged.items[0].product_id)}  Heza box (4 deliveries)
  ${sub('me', (s) => s.status === 'active' && s.frequency_days === 30)}  Tsuyu box · ticket CHAT-DEMOPAUSE1 asks to pause → Admin CC pauses with the ticket id
  ${sub('me', (s) => s.status === 'payment_failed')}  payment_failed → Admin CC proposes resume → you accept
  ${sub('me', (s) => s.status === 'active' && s.frequency_days === 14 && s.product_id !== ids.chiDamaged.items[0].product_id)}  out of stock → QLSP pauses / skips "Item out of stock" → you get the notice
  ${sub('me', (s) => !!s.replacement_offer)}  paused by admin + replacement offer → you pick a replacement
  ${sub('me', (s) => !!s.admin_proposal)}  paused by you + resume proposal → you accept / decline, or admin withdraws
  ${ids.mePost.post_id}  your post reported 2× off topic (first offence) → CSKH warns → you see the warning, post hidden
Staff-only cases
  ${ids.anA2.order_id}  An · Ritual Box cycle 2 · wrong_address · customer already confirmed a new address → "Ship again"
  ${ids.anCarrier.order_id}  An · carrier_issue (GHN) → "Ship again" right away
  ${ids.binhOffsite.order_id}  Bình · carrier_issue (Offsite warehouse) → "Ship again"
  ${ids.binhPayout.order_id}  Bình · cancelled after no reply · QR refund pending payout → "Mark refund paid"
  ${sub('dung', () => true)}  Dũng · suspended          ${sub('giang', () => true)}  Giang · cancelled by admin
Referral: Hà (HA_DEMO2026) · ${ids.khoaFirst.order_id} Khoa's first order, shipping → log in as Khoa, "Order received".
Community queue: spam post (Phong, 1st), off-topic (Quân, 2nd), insulting (Sơn), misleading comment (Phong), account bio (Tú),
  Lan's post reported by Xuân (dismiss → report-limit warning). Vy is suspended 3 days.
Vouchers: DEMOWINTER15, DEMOBLOOM20, DEMOMATCHA10, DEMOFREESHIP, DEMONOEL, DEMOHALLOWEEN, DEMOFLASH50, DEMOSTOPPED,
  DEMOREDEEM300, CMP-DEMO1.`);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const dbName = guardDatabase();
  console.log(`Database: ${dbName}`);
  await clear();
  if (process.argv.includes('--clear')) return;
  const result = await seed();
  console.log(`Seeded ${Object.keys(CAST).length} customers, ${result.orders.length} orders, ${result.subs.length} Ritual Boxes.`);
  printCheatSheet(result);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
