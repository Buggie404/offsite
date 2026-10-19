const loyaltyService = require('../services/loyalty.service');

async function getDashboard(req, res) {
  try {
    const dashboard = await loyaltyService.getDashboard(req.user.user_id);
    if (!dashboard) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json(dashboard);
  } catch (error) {
    console.error('getDashboard failed:', error);
    return res.status(500).json({ error: 'Could not load rewards dashboard.' });
  }
}

async function redeemReward(req, res) {
  try {
    const { rewardId } = req.body || {};
    if (!rewardId) {
      return res.status(400).json({ error: 'Missing rewardId.' });
    }

    const result = await loyaltyService.redeemReward(req.user.user_id, rewardId);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    console.error('redeemReward failed:', error);
    return res.status(500).json({ error: 'Could not redeem reward.' });
  }
}

async function completeQuiz(req, res) {
  try {
    const result = await loyaltyService.awardRitualDnaQuizPoints(req.user.user_id);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (error) {
    console.error('completeQuiz failed:', error);
    return res.status(500).json({ error: 'Could not award quiz points.' });
  }
}

module.exports = {
  getDashboard,
  redeemReward,
  completeQuiz
};
