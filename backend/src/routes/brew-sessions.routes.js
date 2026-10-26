const express = require('express');
const { authMiddleware } = require('../middleware/auth.middleware');
const { createBrewSession } = require('../controllers/brew-sessions.controller');

const router = express.Router();

router.post('/', authMiddleware, createBrewSession);

module.exports = router;
