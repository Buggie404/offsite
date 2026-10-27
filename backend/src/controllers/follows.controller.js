const Follow = require('../models/Follow');
const User = require('../models/User');
const { visibleFollowStages } = require('../services/follow-list');

async function currentCommunityUserId(req) {
  const tokenId = String(req.user?.user_id || '');
  if (!tokenId) return null;
  const user = await User.findById(tokenId, 'user_id').lean().catch(() => null);
  return user?.user_id || tokenId;
}

// POST /api/follows/:userId  -> toggle follow
async function toggleFollow(req, res) {
  try {
    const targetId = req.params.userId;
    const me = await currentCommunityUserId(req);
    if (targetId === me) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }
    const target = await User.findOne({ user_id: targetId, status: 'active' }, 'user_id').lean();
    if (!target) return res.status(404).json({ error: 'User not found' });

    const existing = await Follow.findOneAndDelete({ follower_id: me, following_id: targetId });
    if (existing) return res.json({ following: false });

    await Follow.create({ follower_id: me, following_id: targetId });
    res.status(201).json({ following: true });
  } catch (error) {
    if (error.code === 11000) return res.json({ following: true });
    console.error('Error toggling follow:', error);
    res.status(500).json({ error: 'Failed to update follow' });
  }
}

// GET /api/follows/ids -> user_ids the current user follows
async function getFollowingIds(req, res) {
  try {
    const rows = await Follow.find({ follower_id: await currentCommunityUserId(req) }, 'following_id').lean();
    res.json({ data: rows.map(r => r.following_id) });
  } catch (error) {
    console.error('Error loading following:', error);
    res.status(500).json({ error: 'Failed to load following' });
  }
}

async function getFollowList(req, res) {
  try {
    const { userId, type } = req.params;
    if (!['followers', 'following'].includes(type)) return res.status(400).json({ error: 'Invalid list type' });
    if (!await User.exists({ user_id: userId, status: 'active' })) return res.status(404).json({ error: 'Profile not found' });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const me = await currentCommunityUserId(req);
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

module.exports = { toggleFollow, getFollowingIds, getFollowList };
