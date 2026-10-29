const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/auth');

const ADMIN_ROLES = new Set(['admin_cc', 'cskh', 'qlsp']);
const ADMIN_ORDER_VIEW_ROLES = ['admin_cc', 'cskh', 'qlsp'];
const ADMIN_ORDER_MANAGE_ROLES = ['admin_cc', 'qlsp'];
const ADMIN_ORDER_UNSCOPED_ROLES = ['admin_cc', 'qlsp'];
const ADMIN_CROSS_USER_ROLES = ['admin_cc'];

async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer [token]"

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const User = require('../models/User');
    const id = String(decoded.user_id || '');
    const query = /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { user_id: id };
    const account = await User.findOne(query, 'status role').lean();
    if (!account) return res.status(401).json({ error: 'Account not found' });
    if (account.status === 'suspended') return res.status(403).json({ error: 'Your account is suspended', code: 'ACCOUNT_SUSPENDED' });
    // Use the stored role so a role change on the Staff page applies right away, not when the token expires.
    const role = account.role === 'admin' ? 'admin_cc' : account.role;
    req.user = { ...decoded, role: role || decoded.role }; // { user_id, email, role }
    next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (['JsonWebTokenError', 'NotBeforeError'].includes(error?.name)) return res.status(403).json({ error: 'Invalid token' });
    return res.status(500).json({ error: 'Could not verify account status' });
  }
}

function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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
