const router = require('express').Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const controller = require('../controllers/ritual-dna.controller');

router.use(authMiddleware, requireRole('customer'));
router.get('/questions', controller.questions);
router.get('/me', controller.profile);
router.get('/fits', controller.fits);
router.get('/recommendations', controller.recommendations);
router.get('/recommendations/products/:productId', controller.productRecommendations);
router.post('/quiz', controller.submit);

module.exports = router;
