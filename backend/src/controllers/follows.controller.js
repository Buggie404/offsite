const Follow = require('../models/Follow');
const User = require('../models/User');

// POST /api/follows/:userId  -> toggle follow
async function toggleFollow(req, res) {
  try {
    const targetId = req.params.userId;
    const me = req.user.user_id;
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
    const rows = await Follow.find({ follower_id: req.user.user_id }, 'following_id').lean();
    res.json({ data: rows.map(r => r.following_id) });
  } catch (error) {
    console.error('Error loading following:', error);
    res.status(500).json({ error: 'Failed to load following' });
  }
}

module.exports = { toggleFollow, getFollowingIds };
