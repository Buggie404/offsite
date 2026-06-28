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
  passport.authenticate('google', { failureRedirect: 'http://localhost:4200/login' }),
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Redirect to frontend with token
    // Frontend sẽ lưu token vào localStorage
    res.redirect(`http://localhost:4200/oauth-success?token=${token}`);
  }
);

// ========== Facebook OAuth Routes ==========
// Initiate Facebook login
router.get('/facebook',
  passport.authenticate('facebook', { scope: ['email'] })
);

// Facebook callback
router.get('/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: 'http://localhost:4200/login' }),
  (req, res) => {
    const token = jwt.sign(
      {
        user_id: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.redirect(`http://localhost:4200/oauth-success?token=${token}`);
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