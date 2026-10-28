// Thời hạn phiên đăng nhập (JWT access token) cho cả user và admin.
const AUTH_TOKEN_TTL = '3d';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Secrets come from the environment only. Production refuses to start without them;
// dev falls back to fixed, clearly-fake values and says so once at startup.
function requireSecret(name, devValue) {
  const value = process.env[name];
  if (value) return value;
  if (IS_PRODUCTION) {
    throw new Error(`${name} is not set. Add it to the environment before starting the server in production.`);
  }
  console.warn(`[config] ${name} is not set; using an insecure development value.`);
  return devValue;
}

const JWT_SECRET = requireSecret('JWT_SECRET', 'dev-only-jwt-secret');
const REFRESH_SECRET = requireSecret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret');
const SESSION_SECRET = requireSecret('SESSION_SECRET', 'dev-only-session-secret');

// CLIENT_URL may list several frontends, comma-separated. The first one is where OAuth
// redirects back to; all of them (plus the Angular dev server outside production) may
// call the API and open sockets.
const DEV_CLIENT_URL = 'http://localhost:4200';
const CLIENT_URLS = String(process.env.CLIENT_URL || '')
  .split(',')
  .map(url => url.trim().replace(/\/+$/, ''))
  .filter(Boolean);
if (IS_PRODUCTION && !CLIENT_URLS.length) {
  throw new Error('CLIENT_URL is not set. Add the frontend origin(s) before starting the server in production.');
}
const CLIENT_URL = CLIENT_URLS[0] || DEV_CLIENT_URL;
const ALLOWED_ORIGINS = [...new Set(IS_PRODUCTION ? CLIENT_URLS : [...CLIENT_URLS, DEV_CLIENT_URL])];

// Shared by Express (cors) and socket.io. Requests without an Origin header
// (same-origin navigations such as the OAuth callbacks, curl, server-to-server) pass.
const isAllowedOrigin = origin => !origin || ALLOWED_ORIGINS.includes(origin);

const corsOptions = {
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

module.exports = {
  AUTH_TOKEN_TTL,
  JWT_SECRET,
  REFRESH_SECRET,
  SESSION_SECRET,
  CLIENT_URL,
  ALLOWED_ORIGINS,
  isAllowedOrigin,
  corsOptions
};
