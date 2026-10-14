const jwt = require('jsonwebtoken');

const ADMIN_ROLES = new Set(['admin_cc', 'cskh', 'qlsp']);
const ADMIN_ORDER_VIEW_ROLES = ['admin_cc', 'cskh', 'qlsp'];
const ADMIN_ORDER_MANAGE_ROLES = ['admin_cc', 'qlsp'];
const ADMIN_ORDER_UNSCOPED_ROLES = ['admin_cc', 'qlsp'];
const ADMIN_CROSS_USER_ROLES = ['admin_cc'];

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer [token]"

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
    req.user = decoded; // { user_id, email, role }
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
    req.user = decoded;
  } catch (error) {
    // Token không hợp lệ, nhưng vì là optional nên vẫn cho qua, không set req.user
  }
  next();
}

function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied', code: 'ROLE_FORBIDDEN' });
    }
    next();
  };
}

function hasAdminRole(user, allowedRoles) {
  return isAdminRole(user?.role) && allowedRoles.includes(user.role);
}

function requireAdminRole(...allowedRoles) {
  return requireRole(...allowedRoles);
}

module.exports = {
  authMiddleware,
  optionalAuthMiddleware,
  requireRole,
  requireAdminRole,
  hasAdminRole,
  isAdminRole,
  ADMIN_ORDER_VIEW_ROLES,
  ADMIN_ORDER_MANAGE_ROLES,
  ADMIN_ORDER_UNSCOPED_ROLES,
  ADMIN_CROSS_USER_ROLES
};