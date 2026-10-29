const Follow = require('../models/Follow');
const User = require('../models/User');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const PUBLIC_USER_FIELDS = 'user_id community_name profile_name avatar_url membership_tier followers_count';

// The JWT carries the Mongo _id, while Follows store User.user_id (e.g. USR000001).
// Every follow lookup must go through this to compare the same kind of id.
async function resolveCommunityUserId(req) {
  const tokenId = String(req.user?.user_id || '');
  if (!tokenId) return null;
  const user = await User.findById(tokenId, 'user_id').lean().catch(() => null);
  return user?.user_id || tokenId;
}

async function findActiveUser(userId) {
  return User.findOne({ user_id: userId, status: 'active' }, 'user_id').lean();
}

// Idempotent: following twice is not an error. Returns true if a new row was created.
async function follow(followerId, followingId) {
  try {
    await Follow.create({ follower_id: followerId, following_id: followingId });
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
  await Promise.all([
    User.updateOne({ user_id: followerId }, { $inc: { following_count: 1 } }),
    User.updateOne({ user_id: followingId }, { $inc: { followers_count: 1 } })
  ]);
  return true;
}

// Idempotent: unfollowing someone you do not follow is not an error. Returns true if a row was removed.
async function unfollow(followerId, followingId) {
  const removed = await Follow.findOneAndDelete({ follower_id: followerId, following_id: followingId });
  if (!removed) return false;
  await Promise.all([
    User.updateOne({ user_id: followerId, following_count: { $gt: 0 } }, { $inc: { following_count: -1 } }),
    User.updateOne({ user_id: followingId, followers_count: { $gt: 0 } }, { $inc: { followers_count: -1 } })
  ]);
  return true;
}

async function isFollowing(followerId, followingId) {
  if (!followerId || followerId === followingId) return false;
  return !!(await Follow.exists({ follower_id: followerId, following_id: followingId }));
}

// user_ids that followerId follows. Used by the "Following" feed (posts.controller).
async function getFollowingIds(followerId) {
  if (!followerId) return [];
  const rows = await Follow.find({ follower_id: followerId }, 'following_id').lean();
  return rows.map(r => r.following_id);
}

function parsePaging(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE));
  return { page, limit };
}

// direction 'following': people userId follows; 'followers': people who follow userId.
// Suspended accounts are left out. is_following is computed for the viewer, never stored.
async function listConnections(userId, direction, { page, limit, viewerId }) {
  const matchField = direction === 'following' ? 'follower_id' : 'following_id';
  const otherField = direction === 'following' ? 'following_id' : 'follower_id';

  const rows = await Follow.find({ [matchField]: userId }, `${otherField} created_at`)
    .sort({ created_at: -1 })
    .lean();
  const ids = rows.map(r => r[otherField]);

  const activeUsers = await User.find({ user_id: { $in: ids }, status: 'active' }, PUBLIC_USER_FIELDS).lean();
  const usersById = new Map(activeUsers.map(u => [u.user_id, u]));
  const visibleRows = rows.filter(r => usersById.has(r[otherField]));

  const pageRows = visibleRows.slice((page - 1) * limit, page * limit);
  const pageIds = pageRows.map(r => r[otherField]);

  const viewerFollows = viewerId
    ? new Set((await Follow.find({ follower_id: viewerId, following_id: { $in: pageIds } }, 'following_id').lean())
      .map(r => r.following_id))
    : new Set();

  const data = pageRows.map(r => {
    const user = usersById.get(r[otherField]);
    return {
      user_id: user.user_id,
      username: user.community_name || user.profile_name,
      avatar_url: user.avatar_url || null,
      membership_tier: user.membership_tier || 'Seed',
      followers_count: user.followers_count || 0,
      followed_at: r.created_at,
      is_following: viewerFollows.has(user.user_id),
      is_self: !!viewerId && viewerId === user.user_id
    };
  });

  return { data, total: visibleRows.length, page, limit };
}

module.exports = {
  resolveCommunityUserId,
  findActiveUser,
  follow,
  unfollow,
  isFollowing,
  getFollowingIds,
  parsePaging,
  listConnections
};
