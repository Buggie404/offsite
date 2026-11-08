const Counter = require('../models/Counter');
const User = require('../models/User');

// Customers and staff share one USR00001 sequence, kept in Counters so two sign-ups at the same
// moment never get the same id. The counter is first raised to the highest id already stored,
// so users inserted by seed scripts (which skip the counter) cannot be handed out again.
const USER_COUNTER_ID = 'user_id';

async function highestUserNumber() {
  const last = await User.findOne({ user_id: /^USR\d+$/ }, 'user_id').sort({ user_id: -1 }).lean();
  return last ? parseInt(last.user_id.slice(3), 10) : 0;
}

async function nextUserId() {
  await Counter.updateOne({ _id: USER_COUNTER_ID }, { $max: { seq: await highestUserNumber() } }, { upsert: true });
  const counter = await Counter.findOneAndUpdate({ _id: USER_COUNTER_ID }, { $inc: { seq: 1 } }, { new: true });
  return `USR${String(counter.seq).padStart(5, '0')}`;
}

module.exports = { nextUserId };
