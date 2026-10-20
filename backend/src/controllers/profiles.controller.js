const User = require('../models/User');
const Post = require('../models/Post');
const Follow = require('../models/Follow');

// GET /api/profiles/:userId  – public, no email/phone/address. Suspended accounts are not shown.
async function getPublicProfile(req, res) {
  try {
    const { userId } = req.params;
    const user = await User.findOne(
      { user_id: userId, status: 'active' },
      'user_id community_name profile_name avatar_url membership_tier ritual_dna_quiz_completed createdAt'
    ).lean();
    if (!user) return res.status(404).json({ error: 'Profile not found' });

    const isSelf = !!req.user && req.user.user_id === userId;
    const [postCount, followerCount, followingCount, followRow] = await Promise.all([
      Post.countDocuments({ user_id: userId, status: { $ne: 'hidden' } }),
      Follow.countDocuments({ following_id: userId }),
      Follow.countDocuments({ follower_id: userId }),
      req.user && !isSelf ? Follow.exists({ follower_id: req.user.user_id, following_id: userId }) : null
    ]);

    res.json({
      user_id: user.user_id,
      username: user.community_name || user.profile_name,
      avatar_url: user.avatar_url || null,
      membership_tier: user.membership_tier || 'Seed',
      ritual_dna_completed: !!user.ritual_dna_quiz_completed,
      joined_at: user.createdAt,
      post_count: postCount,
      follower_count: followerCount,
      following_count: followingCount,
      is_following: !!followRow,
      is_self: isSelf
    });
  } catch (error) {
    console.error('Error loading public profile:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
}

module.exports = { getPublicProfile };
