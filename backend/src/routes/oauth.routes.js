const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');

// ========== Google OAuth Routes ==========
// Initiate Google login
router.get('/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google callback
router.get('/google/callback',
  (req, res, next) => {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:4200';
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
      process.env.JWT_SECRET || 'fallback-secret-key',
      { expiresIn: '8h' }
    );

    // Redirect to frontend with token
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:4200';
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
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:4200';
    passport.authenticate('facebook', { failureRedirect: `${clientUrl}/login` })(req, res, next);
  },
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

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:4200';
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