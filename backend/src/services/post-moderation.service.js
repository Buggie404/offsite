const Post = require('../models/Post');
const PostReport = require('../models/PostReport');

// A post is auto-hidden once it has this many pending (unreviewed) reports.
const AUTO_HIDE_THRESHOLD = Math.max(1, parseInt(process.env.POST_AUTO_HIDE_THRESHOLD, 10) || 5);

async function transitionPost(postId, hide, { reason, adminId = null } = {}) {
  const session = await Post.db.startSession();
  let post = null;
  try {
    await session.withTransaction(async () => {
      post = await Post.findOneAndUpdate(
        { post_id: postId, status: hide ? { $ne: 'hidden' } : 'hidden' },
        { $set: hide ? { status: 'hidden', hidden_reason: reason, hidden_at: new Date(), hidden_by: adminId }
          : { status: 'visible', hidden_reason: null, hidden_at: null, hidden_by: null } },
        { new: true, session }
      );
      if (!post) return;
      const points = require('./points.service');
      if (hide) await points.reverseCommunityPoints(postId, session);
      else {
        await points.restoreCommunityPoints(postId, session);
        await PostReport.updateMany({ post_id: postId, status: 'pending' }, { $set: { status: 'dismissed' } }, { session });
      }
    });
    return post;
  } finally { await session.endSession(); }
}

const hidePost = (postId, options) => transitionPost(postId, true, options);
const unhidePost = postId => transitionPost(postId, false);

// Called after a new report is saved. Returns the post if it was just auto-hidden.
async function maybeAutoHide(postId) {
  const pending = await PostReport.countDocuments({ post_id: postId, status: 'pending' });
  if (pending < AUTO_HIDE_THRESHOLD) return null;
  return hidePost(postId, { reason: 'auto_reports' });
}

module.exports = { AUTO_HIDE_THRESHOLD, hidePost, unhidePost, maybeAutoHide };
