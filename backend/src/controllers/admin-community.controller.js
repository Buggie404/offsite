const Post = require('../models/Post');
const PostReport = require('../models/PostReport');
const { AUTO_HIDE_THRESHOLD, hidePost, unhidePost } = require('../services/post-moderation.service');

const snap = (p) => p && ({ post_id: p.post_id, status: p.status, hidden_reason: p.hidden_reason });

// GET /api/admin/community/reports
// Posts that have pending reports and/or are currently hidden, most reported first.
async function listReportedPosts(req, res) {
  try {
    const grouped = await PostReport.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: '$post_id', count: { $sum: 1 }, reasons: { $push: '$reason' }, last_reported_at: { $max: '$created_at' } } }
    ]);
    const byPost = new Map(grouped.map(g => [g._id, g]));

    const posts = await Post.find({
      $or: [{ post_id: { $in: [...byPost.keys()] } }, { status: 'hidden' }]
    }).lean();

    const data = posts.map(p => {
      const g = byPost.get(p.post_id);
      const reasonCounts = {};
      (g?.reasons || []).forEach(r => { reasonCounts[r] = (reasonCounts[r] || 0) + 1; });
      return {
        post_id: p.post_id,
        user_id: p.user_id,
        author: p.author,
        content: p.content,
        thumbnail: p.media?.[0]?.url || null,
        status: p.status || 'visible',
        hidden_reason: p.hidden_reason || null,
        hidden_at: p.hidden_at || null,
        pending_reports: g?.count || 0,
        reasons: reasonCounts,
        last_reported_at: g?.last_reported_at || null
      };
    }).sort((a, b) => b.pending_reports - a.pending_reports);

    res.json({ data, auto_hide_threshold: AUTO_HIDE_THRESHOLD });
  } catch (error) {
    console.error('Error listing reported posts:', error);
    res.status(500).json({ error: 'Failed to load reports' });
  }
}

// POST /api/admin/community/posts/:postId/hide
async function hide(req, res) {
  try {
    const before = await Post.findOne({ post_id: req.params.postId }).lean();
    if (!before) return res.status(404).json({ error: 'Post not found' });
    if (before.status === 'hidden') return res.status(409).json({ error: 'Post is already hidden' });

    const post = await hidePost(before.post_id, { reason: 'manual', adminId: req.user.user_id });
    await req.writeActivityLog({
      actionType: 'community_post_hide', targetEntity: 'post', targetId: post.post_id,
      oldValue: snap(before), newValue: snap(post)
    });
    res.json({ data: snap(post) });
  } catch (error) {
    console.error('Error hiding post:', error);
    res.status(500).json({ error: 'Failed to hide post' });
  }
}

// POST /api/admin/community/posts/:postId/unhide  (also dismisses pending reports)
async function unhide(req, res) {
  try {
    const before = await Post.findOne({ post_id: req.params.postId }).lean();
    if (!before) return res.status(404).json({ error: 'Post not found' });
    if (before.status !== 'hidden') return res.status(409).json({ error: 'Post is not hidden' });

    const post = await unhidePost(before.post_id);
    await req.writeActivityLog({
      actionType: 'community_post_unhide', targetEntity: 'post', targetId: before.post_id,
      oldValue: snap(before), newValue: snap(post)
    });
    res.json({ data: snap(post) });
  } catch (error) {
    console.error('Error unhiding post:', error);
    res.status(500).json({ error: 'Failed to unhide post' });
  }
}

// POST /api/admin/community/posts/:postId/dismiss  (reports reviewed, post stays visible)
async function dismissReports(req, res) {
  try {
    const post = await Post.findOne({ post_id: req.params.postId }).lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const result = await PostReport.updateMany({ post_id: post.post_id, status: 'pending' }, { $set: { status: 'dismissed' } });
    await req.writeActivityLog({
      actionType: 'community_reports_dismiss', targetEntity: 'post', targetId: post.post_id,
      oldValue: { pending_reports: result.matchedCount }, newValue: { pending_reports: 0 }
    });
    res.json({ dismissed: result.modifiedCount });
  } catch (error) {
    console.error('Error dismissing reports:', error);
    res.status(500).json({ error: 'Failed to dismiss reports' });
  }
}

module.exports = { listReportedPosts, hide, unhide, dismissReports };
