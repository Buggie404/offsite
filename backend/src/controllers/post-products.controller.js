// backend/src/controllers/post-products.controller.js
// Hai endpoint cho composer Create Post: tìm sản phẩm thủ công + gợi ý thẻ AI.
const productTag = require('../services/product-tag.service');
const SuggestionSession = require('../models/ProductSuggestionSession');
const { randomUUID } = require('crypto');
const { currentCommunityUserId } = require('./profiles.controller');

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

    const userId = await currentCommunityUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const requestedSession = String(req.body.suggestion_session_id || '').slice(0, 80);
    const session = requestedSession
      ? await SuggestionSession.findOneAndUpdate({ session_id: requestedSession, user_id: userId, attempts: { $lt: 3 }, expires_at: { $gt: new Date() } }, { $inc: { attempts: 1 } }, { new: true })
      : await SuggestionSession.create({ session_id: randomUUID(), user_id: userId, attempts: 1, expires_at: new Date(Date.now() + 60 * 60 * 1000) });
    if (!session) return res.status(429).json({ error: 'Suggestion limit reached. Start a new draft to try again.' });

    // Hàm này nằm trong product-tag.service.js (file kèm theo).
    const raw = await productTag.suggestProductTags({ content, base, limit: SUGGEST_LIMIT + Math.min(exclude.size, 50), exclude: [...exclude], userId, sessionId: session.session_id });

    const data = raw.filter(p => !exclude.has(p.product_id)).slice(0, 3);
    res.json({ data, suggestion_session_id: session.session_id, remaining: 3 - session.attempts });
  } catch (err) {
    console.error('suggestProducts error:', err);
    res.status(500).json({ error: 'Failed to suggest products' });
  }
}

module.exports = { searchProducts, suggestProducts };
