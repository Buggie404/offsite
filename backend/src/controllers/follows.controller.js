const followService = require('../services/follow.service');

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

// GET /api/follows/:userId/following and /:userId/followers -> public lists
function listFor(direction) {
  return async (req, res) => {
    try {
      const userId = String(req.params.userId || '');
      if (!(await followService.findActiveUser(userId))) {
        return res.status(404).json({ error: 'User not found' });
      }
      const viewerId = await followService.resolveCommunityUserId(req);
      const paging = followService.parsePaging(req.query);
      res.json(await followService.listConnections(userId, direction, { ...paging, viewerId }));
    } catch (error) {
      console.error(`Error loading ${direction} list:`, error);
      res.status(500).json({ error: `Failed to load ${direction}` });
    }
  };
}

module.exports = {
  followUser,
  unfollowUser,
  toggleFollow,
  getFollowStatus,
  getFollowingIds,
  getMyFollowing,
  getUserFollowing: listFor('following'),
  getUserFollowers: listFor('followers')
};
