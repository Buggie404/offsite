const jwt = require('jsonwebtoken');

function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer [token]"

  if (!token) {
    req.user = undefined;
    return next();
  }

  try {
    const secret = process.env.JWT_SECRET || 'fallback-secret-key';
    const decoded = jwt.verify(token, secret);
    req.user = decoded; // { user_id, email, role }
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { optionalAuthMiddleware };
