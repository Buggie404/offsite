/**
 * Admin Activity Logging Middleware
 * ----------------------------------
 * Ghi log mọi request của admin đã qua xác thực vào collection `admin_activity_logs`.
 *
 * Các trường được ghi:
 *   - admin_id   : user_id từ JWT payload
 *   - email      : email admin
 *   - role       : role admin (admin_cc | cskh | qlsp)
 *   - method     : HTTP method (GET, POST, PUT, DELETE …)
 *   - path       : URL gốc được gọi
 *   - body       : request body (loại bỏ password/token nhạy cảm)
 *   - ip         : địa chỉ IP của request
 *   - userAgent  : User-Agent header
 *   - statusCode : HTTP status code trả về
 *   - timestamp  : thời gian thực hiện
 */
const { getCollections } = require('../config/db');

/**
 * Loại bỏ các field nhạy cảm trước khi lưu vào log
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  const clone = { ...body };
  const sensitiveKeys = ['password', 'password_hash', 'token', 'otp', 'newPassword', 'confirmPassword'];
  for (const key of sensitiveKeys) {
    if (key in clone) {
      clone[key] = '***';
    }
  }
  return clone;
}

/**
 * Tạo mô tả hành động dựa trên method + path
 */
function describeAction(method, path) {
  // Chuẩn hóa: bỏ query string
  const cleanPath = path.split('?')[0];

  // Các pattern phổ biến
  const patterns = [
    { match: /^\/api\/admin\/login$/,                        desc: 'Admin login' },
    { match: /^\/api\/admin\/orders$/,                       desc: method === 'GET' ? 'View orders list' : `${method} orders` },
    { match: /^\/api\/admin\/orders\/([^/]+)$/,              desc: method === 'GET' ? 'View order detail' : `${method} order` },
    { match: /^\/api\/admin\/orders\/([^/]+)\/status$/,      desc: 'Update order status' },
    { match: /^\/api\/admin\/orders\/([^/]+)\/refund\/approve$/, desc: 'Approve refund request' },
    { match: /^\/api\/admin\/orders\/([^/]+)\/refund\/reject$/,  desc: 'Reject refund request' },
    { match: /^\/api\/admin\/orders\/([^/]+)\/notes$/,       desc: 'Add internal note' },
  ];

  for (const p of patterns) {
    if (p.match.test(cleanPath)) return p.desc;
  }

  return `${method} ${cleanPath}`;
}

async function adminActivityLog(req, res, next) {
  // Chỉ log khi đã có admin user (qua authMiddleware trước đó)
  if (!req.user || !req.user.user_id) {
    return next();
  }

  // Capture status code sau khi response kết thúc
  const startTime = Date.now();

  res.on('finish', async () => {
    try {
      const { adminActivityLogCollection } = await getCollections();

      await adminActivityLogCollection.insertOne({
        admin_id: req.user.user_id,
        email: req.user.email || '',
        role: req.user.role || '',
        method: req.method,
        path: req.originalUrl,
        action: describeAction(req.method, req.originalUrl),
        body: sanitizeBody(req.body),
        ip: req.ip || req.connection?.remoteAddress || '',
        userAgent: req.get('User-Agent') || '',
        statusCode: res.statusCode,
        duration_ms: Date.now() - startTime,
        timestamp: new Date(),
      });
    } catch (err) {
      // Logging không được phép phá vỡ request flow
      console.error('[AdminActivityLog] Error:', err.message);
    }
  });

  next();
}

module.exports = { adminActivityLog };
