const express = require('express');
const router = express.Router();
const { optionalAuthMiddleware } = require('../middleware/optionalAuth.middleware');
const starterQuiz = require('../controllers/starter-quiz.controller');

router.get('/questions', optionalAuthMiddleware, starterQuiz.getQuestions);
router.post('/results', optionalAuthMiddleware, starterQuiz.createResult);
router.get('/results/latest', optionalAuthMiddleware, starterQuiz.getLatestResult);

module.exports = router;
