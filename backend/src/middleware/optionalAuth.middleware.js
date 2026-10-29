const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/auth');

function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer [token]"

  if (!token) {
    req.user = undefined;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { user_id, email, role }
  } catch (error) {
    // Optional auth: an expired / invalid token left in the browser must not block guest
    // flows (order tracking, starter quiz…), so carry on as a guest. Handlers that need
    // to tell "guest" from "session expired" can check req.authError.
    req.user = undefined;
    req.authError = error?.name === 'TokenExpiredError' ? 'expired' : 'invalid';
  }
  next();
}

module.exports = { optionalAuthMiddleware };
