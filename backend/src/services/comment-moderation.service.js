const Comment = require('../models/Comment');
const CommentReport = require('../models/CommentReport');

// Public thread queries must use this filter (documents created before this field existed have no value).
const VISIBLE_COMMENT_FILTER = { moderation_status: { $ne: 'hidden' } };

async function hideComment(commentId, { reason = 'manual', adminId = null } = {}) {
  return Comment.findOneAndUpdate(
    { comment_id: commentId, moderation_status: { $ne: 'hidden' } },
    { $set: { moderation_status: 'hidden', hidden_reason: reason, hidden_at: new Date(), hidden_by: adminId } },
    { new: true }
  );
}

// Unhiding also clears pending reports, otherwise the comment would look reported again.
async function unhideComment(commentId) {
  const comment = await Comment.findOneAndUpdate(
    { comment_id: commentId, moderation_status: 'hidden' },
    { $set: { moderation_status: 'visible', hidden_reason: null, hidden_at: null, hidden_by: null } },
    { new: true }
  );
  if (comment) await CommentReport.updateMany({ comment_id: commentId, status: 'pending' }, { $set: { status: 'dismissed' } });
  return comment;
}

module.exports = { VISIBLE_COMMENT_FILTER, hideComment, unhideComment };
