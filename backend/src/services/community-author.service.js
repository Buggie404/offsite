const User = require('../models/User');

// Posts/comments retain a snapshot; render the current public identity when available.
async function hydrateAuthors(rows) {
  const users = await User.find({ user_id: { $in: [...new Set(rows.map(row => row.user_id))] } },
    'user_id community_name profile_name avatar_url').lean();
  const byId = new Map(users.map(user => [user.user_id, user]));
  return rows.map(row => {
    const value = typeof row.toObject === 'function' ? row.toObject() : row;
    const user = byId.get(value.user_id);
    if (user) value.author = { ...value.author, username: user.community_name || user.profile_name || 'Anonymous', avatar_url: user.avatar_url || null };
    return value;
  });
}

module.exports = { hydrateAuthors };
