const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { AUTH_TOKEN_TTL, JWT_SECRET, CLIENT_URL } = require('../config/auth');

// ========== Google OAuth Routes ==========
// Initiate Google login
router.get('/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google callback
router.get('/google/callback',
  (req, res, next) => {
    const clientUrl = CLIENT_URL;
    passport.authenticate('google', { failureRedirect: `${clientUrl}/login` })(req, res, next);
  },
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      JWT_SECRET,
      { expiresIn: AUTH_TOKEN_TTL }
    );

    // Redirect to frontend with token
    const clientUrl = CLIENT_URL;
    res.redirect(`${clientUrl}/oauth-success?token=${token}`);
  }
);

// ========== Facebook OAuth Routes ==========
// Initiate Facebook login
router.get('/facebook',
  passport.authenticate('facebook', { scope: ['email'] })
);

// Facebook callback
router.get('/facebook/callback',
  (req, res, next) => {
    const clientUrl = CLIENT_URL;
    passport.authenticate('facebook', { failureRedirect: `${clientUrl}/login` })(req, res, next);
  },
  (req, res) => {
    const token = jwt.sign(
      {
        user_id: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      JWT_SECRET,
      { expiresIn: AUTH_TOKEN_TTL }
    );

    const clientUrl = CLIENT_URL;
    res.redirect(`${clientUrl}/oauth-success?token=${token}`);
  }
);

// ========== Logout ==========
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: 'Logout successful' });
  });
});

module.exports = router;