const Post = require('../models/Post');
const PostReport = require('../models/PostReport');

// A post is auto-hidden once it has this many pending (unreviewed) reports.
const AUTO_HIDE_THRESHOLD = Math.max(1, parseInt(process.env.POST_AUTO_HIDE_THRESHOLD, 10) || 5);

async function hidePost(postId, { reason, adminId = null }) {
  return Post.findOneAndUpdate(
    { post_id: postId, status: { $ne: 'hidden' } },
    { $set: { status: 'hidden', hidden_reason: reason, hidden_at: new Date(), hidden_by: adminId } },
    { new: true }
  );
}

// Unhiding also clears the pending reports, otherwise the next report would hide it again.
async function unhidePost(postId) {
  const post = await Post.findOneAndUpdate(
    { post_id: postId, status: 'hidden' },
    { $set: { status: 'visible', hidden_reason: null, hidden_at: null, hidden_by: null } },
    { new: true }
  );
  if (post) await PostReport.updateMany({ post_id: postId, status: 'pending' }, { $set: { status: 'dismissed' } });
  return post;
}

// Called after a new report is saved. Returns the post if it was just auto-hidden.
async function maybeAutoHide(postId) {
  const pending = await PostReport.countDocuments({ post_id: postId, status: 'pending' });
  if (pending < AUTO_HIDE_THRESHOLD) return null;
  return hidePost(postId, { reason: 'auto_reports' });
}

module.exports = { AUTO_HIDE_THRESHOLD, hidePost, unhidePost, maybeAutoHide };
