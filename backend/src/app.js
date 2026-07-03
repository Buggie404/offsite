// backend/src/app.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const setupPassport = require('./config/passport');

const app = express();

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport Initialization
app.use(passport.initialize());
app.use(passport.session());

// Setup Passport strategies (after session)
const { getCollections } = require('./config/db');
getCollections().then(({ userCollection }) => {
  setupPassport(userCollection);
});

// OAuth Callback routes matching callback URL in .env
app.get('/auth/callback/google',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const token = jwt.sign(
      {
        user_id: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '8h' }
    );
    res.redirect(`http://localhost:4200/oauth-success?token=${token}`);
  }
);

app.get('/auth/callback/facebook',
  passport.authenticate('facebook', { failureRedirect: '/login' }),
  (req, res) => {
    const token = jwt.sign(
      {
        user_id: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '8h' }
    );
    res.redirect(`http://localhost:4200/oauth-success?token=${token}`);
  }
);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/auth/oauth', require('./routes/oauth.routes'));
app.use('/api/products', require('./routes/products.routes'));
app.use('/api/vouchers', require('./routes/vouchers.routes'));
app.use('/api/orders', require('./routes/orders.routes'));
app.use('/api/order-tracking', require('./routes/order-tracking.routes'));
app.use('/api/recipes', require('./routes/recipes.routes'));
app.use('/api/blogs', require('./routes/blogs.routes'));
app.use('/api/posts', require('./routes/posts.routes'));
app.use('/api/comments', require('./routes/comments.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running' });
});

module.exports = app;
