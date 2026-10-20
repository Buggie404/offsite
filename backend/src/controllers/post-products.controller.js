// backend/src/controllers/post-products.controller.js
// Hai endpoint cho composer Create Post: tìm sản phẩm thủ công + gợi ý thẻ AI.
const productTag = require('../services/product-tag.service');

const SUGGEST_LIMIT = 6; // lấy dư để sau khi loại "exclude" vẫn còn đủ 3

// GET /api/posts/product-search?q=matcha
async function searchProducts(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ data: [] });
    const data = await productTag.searchProducts(q, 8);
    res.json({ data });
  } catch (err) {
    console.error('searchProducts error:', err);
    res.status(500).json({ error: 'Failed to search products' });
  }
}

// POST /api/posts/product-suggestions  { content, base, exclude: number[] }
async function suggestProducts(req, res) {
  try {
    const content = String(req.body.content || '').slice(0, 2000);
    const base = ['COFFEE', 'MATCHA'].includes(req.body.base) ? req.body.base : null;
    const exclude = new Set((Array.isArray(req.body.exclude) ? req.body.exclude : []).map(Number));

    if (!content.trim() && !base) return res.json({ data: [] });

    // Hàm này nằm trong product-tag.service.js (file kèm theo).
    const raw = await productTag.suggestProductTags({ content, base, limit: SUGGEST_LIMIT + exclude.size });

    const data = raw.filter(p => !exclude.has(p.product_id)).slice(0, 3);
    res.json({ data });
  } catch (err) {
    console.error('suggestProducts error:', err);
    res.status(500).json({ error: 'Failed to suggest products' });
  }
}

module.exports = { searchProducts, suggestProducts };
