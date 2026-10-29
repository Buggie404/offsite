const Follow = require('../models/Follow');
const User = require('../models/User');
const followService = require('../services/follow.service');
const { visibleFollowStages } = require('../services/follow-list');

// Shared checks for follow / unfollow / toggle. Returns { me, targetId } or sends the error response.
async function resolveFollowPair(req, res) {
  const targetId = String(req.params.userId || '');
  const me = await followService.resolveCommunityUserId(req);
  if (targetId === me) {
    res.status(400).json({ error: 'You cannot follow yourself' });
    return null;
  }
  if (!(await followService.findActiveUser(targetId))) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return { me, targetId };
}

// PUT /api/follows/:userId -> follow (idempotent)
async function followUser(req, res) {
  try {
    const pair = await resolveFollowPair(req, res);
    if (!pair) return;
    const created = await followService.follow(pair.me, pair.targetId);
    res.status(created ? 201 : 200).json({ following: true });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({ error: 'Failed to follow user' });
  }
}

// DELETE /api/follows/:userId -> unfollow (idempotent)
async function unfollowUser(req, res) {
  try {
    const targetId = String(req.params.userId || '');
    const me = await followService.resolveCommunityUserId(req);
    await followService.unfollow(me, targetId);
    res.json({ following: false });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
}

// POST /api/follows/:userId -> toggle follow (kept for the existing profile button)
async function toggleFollow(req, res) {
  try {
    const pair = await resolveFollowPair(req, res);
    if (!pair) return;
    if (await followService.unfollow(pair.me, pair.targetId)) return res.json({ following: false });
    await followService.follow(pair.me, pair.targetId);
    res.status(201).json({ following: true });
  } catch (error) {
    console.error('Error toggling follow:', error);
    res.status(500).json({ error: 'Failed to update follow' });
  }
}

// GET /api/follows/:userId/status -> whether the current user follows :userId
async function getFollowStatus(req, res) {
  try {
    const me = await followService.resolveCommunityUserId(req);
    res.json({ following: await followService.isFollowing(me, String(req.params.userId || '')) });
  } catch (error) {
    console.error('Error loading follow status:', error);
    res.status(500).json({ error: 'Failed to load follow status' });
  }
}

// GET /api/follows/ids -> user_ids the current user follows (for the Following feed / follow buttons)
async function getFollowingIds(req, res) {
  try {
    const me = await followService.resolveCommunityUserId(req);
    res.json({ data: await followService.getFollowingIds(me) });
  } catch (error) {
    console.error('Error loading following:', error);
    res.status(500).json({ error: 'Failed to load following' });
  }
}

// GET /api/follows/following?page=&limit= -> people the current user follows
async function getMyFollowing(req, res) {
  try {
    const me = await followService.resolveCommunityUserId(req);
    const paging = followService.parsePaging(req.query);
    res.json(await followService.listConnections(me, 'following', { ...paging, viewerId: me }));
  } catch (error) {
    console.error('Error loading following list:', error);
    res.status(500).json({ error: 'Failed to load following' });
  }
}

// GET /api/follows/:userId/followers|following?page=&q= -> public lists with search (used by the follow modal)
async function getFollowList(req, res) {
  try {
    const { userId, type } = req.params;
    if (!['followers', 'following'].includes(type)) return res.status(400).json({ error: 'Invalid list type' });
    if (!await User.exists({ user_id: userId, status: 'active' })) return res.status(404).json({ error: 'Profile not found' });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const me = await followService.resolveCommunityUserId(req);
    const search = String(req.query.q || '').trim().slice(0, 80);
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const result = await Follow.aggregate([
      ...visibleFollowStages(userId, type),
      { $project: { _id: 0, user_id: '$person.user_id', username: { $cond: ['$person.community_name', '$person.community_name', '$person.profile_name'] }, avatar_url: '$person.avatar_url', membership_tier: '$person.membership_tier' } },
      ...(search ? [{ $match: { username: { $regex: escaped, $options: 'i' } } }] : []),
      { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit + 1 }], count: [{ $count: 'total' }] } }
    ]);
    const rows = result[0]?.data || [];
    const total = result[0]?.count[0]?.total || 0;
    const users = rows.slice(0, limit);
    const following = me ? await Follow.find({ follower_id: me, following_id: { $in: users.map(user => user.user_id) } }, 'following_id').lean() : [];
    const ids = new Set(following.map(row => row.following_id));
    res.json({ data: users.map(user => ({ ...user, is_self: user.user_id === me, is_following: ids.has(user.user_id) })), has_more: rows.length > limit, total });
  } catch (error) {
    console.error('Error loading follow list:', error);
    res.status(500).json({ error: 'Failed to load follow list' });
  }
}

module.exports = {
  followUser,
  unfollowUser,
  toggleFollow,
  getFollowStatus,
  getFollowingIds,
  getMyFollowing,
  getFollowList
};
