const User = require('../models/User');
const Post = require('../models/Post');
const Follow = require('../models/Follow');
const AccountReport = require('../models/AccountReport');
const { REPORT_REASONS } = require('../models/PostReport');

async function currentCommunityUserId(req) {
  const tokenId = String(req.user?.user_id || '');
  if (!tokenId) return null;
  const user = await User.findById(tokenId, 'user_id').lean().catch(() => null);
  return user?.user_id || tokenId;
}

// GET /api/profiles/:userId  – public, no email/phone/address. Suspended accounts are not shown.
async function getPublicProfile(req, res) {
  try {
    const { userId } = req.params;
    const user = await User.findOne(
      { user_id: userId, status: 'active' },
      'user_id community_name profile_name avatar_url membership_tier ritual_dna_quiz_completed createdAt'
    ).lean();
    if (!user) return res.status(404).json({ error: 'Profile not found' });

    const currentUserId = await currentCommunityUserId(req);
    const isSelf = currentUserId === userId;
    const [postCount, recipeCount, followerCount, followingCount, followRow] = await Promise.all([
      Post.countDocuments({ user_id: userId, post_type: { $ne: 'recipe' }, status: { $ne: 'hidden' } }),
      Post.countDocuments({ user_id: userId, post_type: 'recipe', status: { $ne: 'hidden' } }),
      Follow.countDocuments({ following_id: userId }),
      Follow.countDocuments({ follower_id: userId }),
      currentUserId && !isSelf ? Follow.exists({ follower_id: currentUserId, following_id: userId }) : null
    ]);

    res.json({
      user_id: user.user_id,
      username: user.community_name || user.profile_name,
      avatar_url: user.avatar_url || null,
      membership_tier: user.membership_tier || 'Seed',
      ritual_dna_completed: !!user.ritual_dna_quiz_completed,
      joined_at: user.createdAt,
      post_count: postCount,
      recipe_count: recipeCount,
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

async function reportAccount(req, res) {
  try {
    const targetId = req.params.userId;
    const reporterId = await currentCommunityUserId(req);
    const reason = String(req.body?.reason || '');
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Invalid report reason' });
    if (reason === 'other' && !note) return res.status(400).json({ error: 'A note is required when the reason is Other' });
    if (!reporterId || reporterId === targetId) return res.status(400).json({ error: 'You cannot report your own account' });
    const target = await User.exists({ user_id: targetId, status: 'active' });
    if (!target) return res.status(404).json({ error: 'Profile not found' });
    try {
      await AccountReport.create({ reported_user_id: targetId, reporter_id: reporterId, reason, note });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'You have already reported this account' });
      throw error;
    }
    res.status(201).json({ message: 'Report submitted' });
  } catch (error) {
    console.error('Error reporting account:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
}

module.exports = { getPublicProfile, reportAccount, currentCommunityUserId };
