// backend/src/services/product-tag.service.js
// Tìm + gợi ý sản phẩm để gắn vào bài viết (tối đa 3). Gợi ý dựa trên keyword scoring, không gọi LLM.
// Dùng đúng schema Product.js: giá/tồn kho nằm ở variants[], từ khoá ở product_tag + các block matcha/coffee/drinkware/tools.
const Product = require('../models/Product');

const MAX_TAGS = 3;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const MIN_SCORE = 0.25; // dưới ngưỡng này coi như không liên quan

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'just', 'today', 'love', 'really',
  'very', 'some', 'was', 'are', 'you', 'your', 'our', 'but', 'not', 'can', 'its', 'had', 'has',
]);

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// bỏ dấu, lowercase, chỉ giữ chữ-số
function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(s) {
  return [...new Set(normalize(s).split(' ').filter(t => t.length >= 3 && !STOPWORDS.has(t)))];
}

// ── Product helpers ─────────────────────────────────────────────────────────
const CATALOG_FIELDS = [
  'product_id', 'name', 'slug', 'category', 'product_tag', 'images',
  'variants.price', 'variants.stock', 'variants.is_default',
  'matcha.product_grade', 'matcha.origin',
  'coffee.roast_level', 'coffee.process_type', 'coffee.product_origin', 'coffee.tasting_notes',
  'drinkware.ware_type', 'tools.tool_category', 'tools.tool_type',
].join(' ');

function sellableVariants(p) {
  return (p.variants || []).filter(v => (v.stock ?? 0) > 0);
}
function inStock(p) {
  return sellableVariants(p).length > 0;
}
function priceOf(p) {
  const list = sellableVariants(p);
  if (!list.length) return null;
  const def = list.find(v => v.is_default);
  const price = def ? def.price : Math.min(...list.map(v => v.price));
  return typeof price === 'number' ? price : null;
}
function tagsOf(p) {
  const out = [...(p.product_tag || [])];
  const add = (o, keys) => keys.forEach(k => { if (o && o[k]) out.push(...[].concat(o[k]).map(String)); });
  add(p.matcha, ['product_grade', 'origin']);
  add(p.coffee, ['roast_level', 'process_type', 'product_origin', 'tasting_notes']);
  add(p.drinkware, ['ware_type']);
  add(p.tools, ['tool_category', 'tool_type']);
  return out;
}

// Dạng thẻ trả về cho frontend (khớp interface ProductTag)
function toTag(p, source, confidence) {
  return {
    product_id: p.product_id,
    name: p.name,
    image_url: p.images?.[0]?.url || null,
    price: priceOf(p),
    source,
    confidence,
  };
}

// ── Catalog cache ───────────────────────────────────────────────────────────
let catalogCache = { at: 0, items: [] };

async function loadCatalog() {
  if (Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.items;
  const items = await Product.find({ is_active: true }, CATALOG_FIELDS).limit(2000).lean();
  catalogCache = { at: Date.now(), items: items.filter(inStock) };
  return catalogCache.items;
}

// ── Scoring ─────────────────────────────────────────────────────────────────
function scoreProduct(p, contentNorm, contentTokens, base) {
  let score = 0;
  const nameNorm = normalize(p.name);

  // tên sản phẩm xuất hiện nguyên văn trong bài
  if (nameNorm.length >= 4 && contentNorm.includes(nameNorm)) score += 0.7;

  // tỉ lệ token trong tên khớp với bài
  const nameTokens = tokenize(p.name);
  if (nameTokens.length) {
    const hits = nameTokens.filter(t => contentTokens.includes(t)).length;
    score += 0.4 * (hits / nameTokens.length);
  }

  // keyword từ product_tag / chi tiết sản phẩm
  const tagHits = tagsOf(p).map(normalize).filter(t => t.length >= 3 && contentNorm.includes(t)).length;
  score += Math.min(0.3, tagHits * 0.15);

  // Post.base là MATCHA / COFFEE; Product.category là matcha / coffee / ...
  if (base && p.category && normalize(p.category) === normalize(base)) score += 0.1;

  return Math.min(1, score);
}

// ── Public API ──────────────────────────────────────────────────────────────

// Tìm thủ công theo tên (ô search trong composer)
async function searchProducts(q, limit = 8) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const rows = await Product.find(
    { is_active: true, name: { $regex: escapeRegex(term), $options: 'i' } },
    CATALOG_FIELDS,
  ).limit(limit * 3).lean();
  return rows.filter(inStock).slice(0, limit).map(p => toTag(p, 'manual', null));
}

// Gợi ý theo nội dung bài. Hàm controller gọi: suggestProductTags({ content, base, limit })
async function suggestProductTags({ content = '', base = null, limit = 6 } = {}) {
  const contentNorm = normalize(content);
  const contentTokens = tokenize(content);
  if (!contentNorm && !base) return [];

  const catalog = await loadCatalog();
  return catalog
    .map(p => ({ p, score: scoreProduct(p, contentNorm, contentTokens, base) }))
    // chỉ có base mà không có nội dung -> điểm base (0.1) không đủ ngưỡng, nên không gợi bừa
    .filter(x => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => toTag(x.p, 'ai', Math.round(x.score * 100) / 100));
}

// Chuẩn hoá danh sách id (từ client) thành thẻ hợp lệ, tối đa 3
async function resolveProductTags(ids = []) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, MAX_TAGS);
  if (!wanted.length) return [];
  const rows = await Product.find({ product_id: { $in: wanted }, is_active: true }, CATALOG_FIELDS).lean();
  const byId = new Map(rows.filter(inStock).map(p => [p.product_id, p]));
  return wanted.map(id => byId.get(id)).filter(Boolean).map(p => toTag(p, 'manual', null));
}

module.exports = { searchProducts, suggestProductTags, resolveProductTags, MAX_TAGS };
