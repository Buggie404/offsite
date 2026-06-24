// backend/src/app.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const passport = require('passport');
const setupPassport = require('./config/passport');

const app = express();

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/auth/oauth', require('./routes/oauth.routes'));
app.use('/api/products', require('./routes/products.routes'));
app.use('/api/vouchers', require('./routes/vouchers.routes'));
app.use('/api/orders', require('./routes/orders.routes'));
app.use('/api/order-tracking', require('./routes/order-tracking.routes'));
app.use('/api/recipes', require('./routes/recipes.routes'));
app.use('/api/posts', require('./routes/posts.routes'));
app.use('/api/comments', require('./routes/comments.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running' });
});

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

module.exports = app;
