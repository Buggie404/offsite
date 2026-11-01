const Post = require('../models/Post');
const PostReport = require('../models/PostReport');

async function transitionPost(postId, hide, { reason, adminId = null } = {}) {
  const session = await Post.db.startSession();
  let post = null;
  try {
    await session.withTransaction(async () => {
      post = await Post.findOneAndUpdate(
        { post_id: postId, status: hide ? { $ne: 'hidden' } : 'hidden' },
        { $set: hide ? { status: 'hidden', hidden_reason: reason, hidden_at: new Date(), hidden_by: adminId, ...(reason === 'manual' ? { points_forfeited: true } : {}) }
          : { status: 'visible', hidden_reason: null, hidden_at: null, hidden_by: null } },
        { new: true, session }
      );
      if (!post) return;
      const points = require('./points.service');
      if (hide) await points.reverseCommunityPoints(postId, session);
      else {
        // Only posts auto-hidden in the past can get points back: no staff member judged them.
        if (!post.points_forfeited) await points.restoreCommunityPoints(postId, session);
        await PostReport.updateMany({ post_id: postId, status: 'pending' }, { $set: { status: 'dismissed' } }, { session });
      }
    });
    return post;
  } finally { await session.endSession(); }
}

const hidePost = (postId, options) => transitionPost(postId, true, options);
const unhidePost = postId => transitionPost(postId, false);
// A penalty on a post that was already hidden: the points are gone already, keep them gone.
const forfeitPostPoints = postId => Post.updateOne({ post_id: postId }, { $set: { points_forfeited: true } });

module.exports = { hidePost, unhidePost, forfeitPostPoints };
