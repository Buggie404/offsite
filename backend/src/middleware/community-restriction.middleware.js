const { activeRestriction, isBlocked, formatDate } = require('../services/community-restriction.service');

// Goes after authMiddleware, which loads community_restriction with the account.
// kind: 'write' (posts, comments) or 'interact' (likes, saves, shares, reports, follows).
function requireCommunityAccess(kind) {
  return (req, res, next) => {
    const restriction = activeRestriction(req.user);
    if (!isBlocked(restriction, kind)) return next();
    return res.status(403).json({
      error: `Your Community access is limited until ${formatDate(restriction.until)}.`,
      code: 'COMMUNITY_RESTRICTED',
      level: restriction.level,
      until: restriction.until
    });
  };
}

module.exports = { requireCommunityAccess };
