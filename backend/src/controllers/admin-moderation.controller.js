const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const Report = require('../models/Report');
const ModerationAction = require('../models/ModerationAction');
const { hidePost, unhidePost, forfeitPostPoints } = require('../services/post-moderation.service');
const { hideComment, unhideComment } = require('../services/comment-moderation.service');
const { createNotification } = require('../services/notification.service');
const { warnReportAbusers } = require('../services/report-abuse.service');
const {
  PENALTIES, activeRestriction, nextRestriction, reasonLevel, recommendedAction, formatDate, sendSimulatedNotice
} = require('../services/community-restriction.service');

// Community reports queue (3.3) for CSKH and Admin CC: posts, comments and accounts with
// pending reports, the penalty levels (warn, suspend 3 days, suspend 7 days), hide / restore and dismiss.
// Every penalty hides the reported content. A suspension limits Community only, never the account.
// Content is hidden through group 4's moderation services; the author gets the message
// the staff member wrote in the confirmation modal.

const TYPES = ['post', 'comment', 'account'];
// No 'lock': admins cannot lock customer accounts. Restoring an account lifts a suspension or an older lock.
const ACTIONS = ['hide', 'restore', ...Object.keys(PENALTIES), 'dismiss'];
const TARGET_FIELD = { post: 'post_id', comment: 'comment_id', account: 'reported_user_id' };
const HANDLED_PAGE_SIZE = 20;

class ModerationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function reasonCounts(reasons) {
  return reasons.reduce((acc, reason) => ({ ...acc, [reason]: (acc[reason] || 0) + 1 }), {});
}

function topReason(reasons) {
  return Object.entries(reasonCounts(reasons)).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
}

function publicName(user) {
  return user?.community_name || user?.profile_name || null;
}

// GET /api/admin/community/queue?type=all|post|comment|account
async function listQueue(req, res) {
  try {
    const types = TYPES.includes(req.query.type) ? [req.query.type] : TYPES;
    const groups = await Report.aggregate([
      { $match: { status: 'pending', target_type: { $in: types } } },
      {
        $group: {
          _id: {
            type: '$target_type',
            target: { $switch: { branches: [
              { case: { $eq: ['$target_type', 'post'] }, then: '$post_id' },
              { case: { $eq: ['$target_type', 'comment'] }, then: '$comment_id' }
            ], default: '$reported_user_id' } }
          },
          count: { $sum: 1 },
          reasons: { $push: '$reason' },
          notes: { $push: '$note' },
          reporters: { $addToSet: '$reporter_id' },
          first_reported_at: { $min: '$created_at' },
          last_reported_at: { $max: '$created_at' }
        }
      }
    ]);

    const idsOf = (type) => groups.filter((g) => g._id.type === type).map((g) => g._id.target);
    const [posts, comments, accounts] = await Promise.all([
      Post.find({ post_id: { $in: idsOf('post') } }, 'post_id user_id author content media status points_forfeited created_at').lean(),
      Comment.find({ comment_id: { $in: idsOf('comment') } }, 'comment_id post_id user_id author content moderation_status created_at').lean(),
      User.find({ user_id: { $in: idsOf('account') }, role: 'customer' }, 'user_id profile_name community_name avatar_url status bio').lean()
    ]);
    const postById = new Map(posts.map((p) => [p.post_id, p]));
    const commentById = new Map(comments.map((c) => [c.comment_id, c]));
    const accountById = new Map(accounts.map((u) => [u.user_id, u]));

    // Owners of posts / comments: current status and earlier warnings help the decision.
    const ownerIds = [...new Set([...posts.map((p) => p.user_id), ...comments.map((c) => c.user_id), ...accounts.map((u) => u.user_id)])];
    const owners = await User.find({ user_id: { $in: ownerIds } }, 'user_id profile_name community_name avatar_url status community_warnings community_restriction').lean();
    const ownerById = new Map(owners.map((u) => [u.user_id, u]));

    const data = [];
    for (const g of groups) {
      const { type, target } = g._id;
      let item = null;
      if (type === 'post' && postById.has(target)) {
        const p = postById.get(target);
        item = { content: p.content, thumbnail: p.media?.[0]?.url || null, content_status: p.status === 'hidden' ? 'hidden' : 'visible',
          points_forfeited: !!p.points_forfeited, owner_id: p.user_id, owner_name: p.author?.username, posted_at: p.created_at, post_id: p.post_id };
      } else if (type === 'comment' && commentById.has(target)) {
        const c = commentById.get(target);
        item = { content: c.content, thumbnail: null, content_status: c.moderation_status === 'hidden' ? 'hidden' : 'visible',
          owner_id: c.user_id, owner_name: c.author?.username, posted_at: c.created_at, post_id: c.post_id };
      } else if (type === 'account' && accountById.has(target)) {
        const u = accountById.get(target);
        item = { content: u.bio || '', thumbnail: null, content_status: null, owner_id: u.user_id, owner_name: publicName(u), posted_at: null, post_id: null };
      }
      if (!item) continue; // target deleted since it was reported

      const owner = ownerById.get(item.owner_id);
      const restriction = activeRestriction(owner);
      const lastWarning = owner?.community_warnings?.at(-1);
      const mainReason = topReason(g.reasons);
      data.push({
        key: `${type}:${target}`,
        target_type: type,
        target_id: target,
        ...item,
        owner_name: publicName(owner) || item.owner_name || item.owner_id,
        owner_avatar: owner?.avatar_url || null,
        owner_status: owner?.status === 'suspended' ? 'locked' : 'active',
        owner_warnings: owner?.community_warnings?.length || 0,
        owner_restricted_until: restriction?.until || null,
        last_violation: lastWarning ? { level: lastWarning.level || 1, created_at: lastWarning.created_at } : null,
        top_reason: mainReason,
        reason_level: reasonLevel(mainReason),
        recommended_action: recommendedAction(owner?.community_warnings?.length || 0, mainReason),
        pending_reports: g.count,
        reporter_count: g.reporters.length,
        reasons: reasonCounts(g.reasons),
        notes: g.notes.filter(Boolean).slice(0, 3),
        first_reported_at: g.first_reported_at,
        last_reported_at: g.last_reported_at
      });
    }
    data.sort((a, b) => b.pending_reports - a.pending_reports || new Date(b.last_reported_at) - new Date(a.last_reported_at));
    res.json({ data, total: data.length });
  } catch (error) {
    console.error('Error loading community queue:', error);
    res.status(500).json({ error: 'Failed to load community reports.' });
  }
}

async function adminName(req) {
  const id = String(req.user?.user_id || '');
  const query = /^[0-9a-f]{24}$/i.test(id) ? { _id: id } : { user_id: id };
  const admin = await User.findOne(query, 'profile_name email').lean();
  return admin?.profile_name || admin?.email || null;
}

// Loads the target and its owner, and checks that the action makes sense for its current state.
async function loadTarget(type, targetId) {
  if (type === 'post') {
    const post = await Post.findOne({ post_id: targetId }).lean();
    if (!post) throw new ModerationError(404, 'Post not found.');
    return { ownerId: post.user_id, ownerName: post.author?.username, hidden: post.status === 'hidden', postId: post.post_id };
  }
  if (type === 'comment') {
    const comment = await Comment.findOne({ comment_id: targetId }).lean();
    if (!comment) throw new ModerationError(404, 'Comment not found.');
    return { ownerId: comment.user_id, ownerName: comment.author?.username, hidden: comment.moderation_status === 'hidden', postId: comment.post_id };
  }
  const user = await User.findOne({ user_id: targetId }, 'user_id role').lean();
  if (!user) throw new ModerationError(404, 'Account not found.');
  return { ownerId: user.user_id, ownerName: null, hidden: false, postId: null };
}

async function setContentHidden(type, targetId, hide, adminId) {
  if (type === 'post') return hide ? hidePost(targetId, { reason: 'manual', adminId }) : unhidePost(targetId);
  if (type === 'comment') return hide ? hideComment(targetId, { reason: 'manual', adminId }) : unhideComment(targetId);
  return null;
}

// Notifications never fail the moderation itself.
async function notify(data) {
  try {
    await createNotification(data);
  } catch (error) {
    console.error('Moderation notification failed:', error.message);
  }
}

// POST /api/admin/community/moderate
// { target_type, target_id, action: hide|restore|warn|suspend_3d|suspend_7d|dismiss, message, notify_reporters }
async function moderate(req, res) {
  try {
    const type = String(req.body?.target_type || '');
    const targetId = String(req.body?.target_id || '');
    const action = String(req.body?.action || '');
    const message = String(req.body?.message || '').trim().slice(0, 1000);
    if (!TYPES.includes(type) || !targetId) return res.status(400).json({ error: 'Unknown report target.' });
    if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'Unknown action.' });
    const penalty = PENALTIES[action];
    // Hiding and penalties must say why (activity-log convention); the reason is the message to the author.
    if ((action === 'hide' || penalty) && !message) {
      return res.status(400).json({ error: 'Write the message the author will receive.' });
    }

    const target = await loadTarget(type, targetId);
    const owner = await User.findOne({ user_id: target.ownerId }, 'user_id role status email phone community_name profile_name community_warnings community_restriction');
    if (!owner) throw new ModerationError(404, 'The author no longer exists.');
    if (penalty && owner.role !== 'customer') throw new ModerationError(403, 'Only customer accounts can be penalized.');

    const alsoHide = !!penalty && type !== 'account' && !target.hidden;
    const liftsAccount = action === 'restore' && type === 'account';
    const wasLocked = owner.status === 'suspended';
    if (action === 'hide' && (type === 'account' || target.hidden)) throw new ModerationError(409, 'This content is already hidden.');
    if (action === 'restore' && type !== 'account' && !target.hidden) throw new ModerationError(409, 'This content is visible.');
    if (liftsAccount && !wasLocked && !activeRestriction(owner)) throw new ModerationError(409, 'This account has no active suspension.');

    const adminId = String(req.user.user_id);
    const oldValue = { content: type === 'account' ? null : (target.hidden ? 'hidden' : 'visible'), account: owner.status, warnings: owner.community_warnings?.length || 0 };

    // Read first: restoring a post closes its reports.
    const reportFilter = { target_type: type, [TARGET_FIELD[type]]: targetId, status: 'pending' };
    const reporters = await Report.distinct('reporter_id', reportFilter);
    // Dismissing, or restoring the content, means the reports were wrong. Lifting a penalty does not.
    const rejected = action === 'dismiss' || (action === 'restore' && type !== 'account');

    // 1. Content (group 4 services)
    if (action === 'hide' || alsoHide) await setContentHidden(type, targetId, true, adminId);
    if (action === 'restore' && type !== 'account') await setContentHidden(type, targetId, false, adminId);
    if (penalty && type === 'post' && target.hidden) await forfeitPostPoints(targetId);

    // 2. Account
    if (penalty) {
      owner.community_warnings.push({ reason: message, admin_id: adminId, level: penalty.level, created_at: new Date() });
      if (penalty.days) owner.community_restriction = nextRestriction(owner.community_restriction, penalty, { reason: message, adminId });
    } else if (liftsAccount) {
      owner.community_restriction = null;
      if (wasLocked) Object.assign(owner, { status: 'active', suspended_reason: null, suspended_by: null, suspended_at: null });
    }
    if (penalty || liftsAccount) await owner.save();
    const restrictedUntil = penalty?.days ? owner.community_restriction.until : null;

    // 3. Close the pending reports on this target
    const closed = await Report.updateMany(reportFilter, { $set: { status: rejected ? 'dismissed' : 'reviewed' } });

    // 4. Record, notify, log
    const name = await adminName(req);
    const record = await ModerationAction.create({
      target_type: type, target_id: targetId, owner_id: owner.user_id, owner_name: owner.community_name || owner.profile_name,
      action: liftsAccount ? (wasLocked ? 'unlock' : 'lift') : action,
      also_hidden: alsoHide, restricted_until: restrictedUntil, message: message || null, reports_closed: closed.modifiedCount || 0,
      admin_id: adminId, admin_name: name, admin_role: req.user.role
    });

    if (message && action !== 'dismiss') {
      await notify({ recipient_id: owner.user_id, type: 'COMMUNITY_MODERATION', post_id: target.postId, message });
    }
    if (restrictedUntil) sendSimulatedNotice(owner, `${message} (Community limited until ${formatDate(restrictedUntil)})`);
    // Reporters hear the result unless staff untick the box; a dismissed report stays quiet.
    if (reporters.length && (action === 'hide' || penalty) && req.body?.notify_reporters !== false) {
      const reporterMessage = 'Your report has been confirmed and applied. Thank you for helping us moderate the community!';
      await Promise.all(reporters.filter((id) => id !== owner.user_id)
        .map((id) => notify({ recipient_id: id, type: 'COMMUNITY_REPORT_RESOLVED', message: reporterMessage })));
    }
    if (rejected) {
      await warnReportAbusers(reporters).catch((error) => console.error('Report abuse check failed:', error.message));
    }

    const freshOwner = owner.toObject();
    await req.writeActivityLog({
      actionType: `community.${record.action}`, targetEntity: type, targetId,
      oldValue,
      newValue: {
        content: type === 'account' ? null : (action === 'hide' || alsoHide ? 'hidden' : action === 'restore' ? 'visible' : oldValue.content),
        account: freshOwner.status, warnings: freshOwner.community_warnings?.length || 0, reports_closed: record.reports_closed,
        ...(restrictedUntil ? { restricted_until: restrictedUntil } : {})
      },
      reason: message || null
    });

    res.json({ data: { action_id: record.action_id, action: record.action, reports_closed: record.reports_closed, restricted_until: restrictedUntil } });
  } catch (error) {
    if (error instanceof ModerationError) return res.status(error.status).json({ error: error.message });
    console.error('Error moderating community report:', error);
    res.status(500).json({ error: 'The action could not be completed.' });
  }
}

// GET /api/admin/community/handled?type=&page=
async function listHandled(req, res) {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const filter = TYPES.includes(req.query.type) ? { target_type: req.query.type } : {};
    const [total, rows] = await Promise.all([
      ModerationAction.countDocuments(filter),
      ModerationAction.find(filter).sort({ created_at: -1 }).skip((page - 1) * HANDLED_PAGE_SIZE).limit(HANDLED_PAGE_SIZE).lean()
    ]);

    // Can it still be undone? Hidden content can be restored, a suspension lifted, a locked account unlocked.
    const ids = (type) => rows.filter((r) => r.target_type === type).map((r) => r.target_id);
    const ownerIds = rows.map((r) => r.owner_id).filter(Boolean);
    const [hiddenPosts, hiddenComments, lockedUsers, restrictedUsers] = await Promise.all([
      Post.distinct('post_id', { post_id: { $in: ids('post') }, status: 'hidden' }),
      Comment.distinct('comment_id', { comment_id: { $in: ids('comment') }, moderation_status: 'hidden' }),
      User.distinct('user_id', { user_id: { $in: ownerIds }, status: 'suspended' }),
      User.distinct('user_id', { user_id: { $in: ownerIds }, 'community_restriction.until': { $gt: new Date() } })
    ]);
    const hidden = new Set([...hiddenPosts, ...hiddenComments]);
    const locked = new Set(lockedUsers);
    const restricted = new Set(restrictedUsers);

    res.json({
      data: rows.map((r) => ({
        ...r,
        content_hidden: hidden.has(r.target_id),
        owner_locked: locked.has(r.owner_id),
        owner_restricted: restricted.has(r.owner_id)
      })),
      total,
      page,
      limit: HANDLED_PAGE_SIZE
    });
  } catch (error) {
    console.error('Error loading handled reports:', error);
    res.status(500).json({ error: 'Failed to load handled reports.' });
  }
}

module.exports = { listQueue, moderate, listHandled };
