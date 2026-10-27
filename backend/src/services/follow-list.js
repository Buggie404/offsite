const Follow = require('../models/Follow');
const User = require('../models/User');

function visibleFollowStages(userId, type) {
  const followers = type === 'followers';
  return [
    { $match: followers ? { following_id: userId } : { follower_id: userId } },
    { $sort: { created_at: -1, _id: -1 } },
    { $lookup: { from: User.collection.name, localField: followers ? 'follower_id' : 'following_id', foreignField: 'user_id', as: 'person' } },
    { $unwind: '$person' },
    { $match: { 'person.status': 'active' } }
  ];
}

async function countVisibleFollows(userId, type) {
  const rows = await Follow.aggregate([...visibleFollowStages(userId, type), { $count: 'total' }]);
  return rows[0]?.total || 0;
}

module.exports = { visibleFollowStages, countVisibleFollows };
