require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

// Ritual Box admin logs written before a3e171b used SUBSCRIPTION_* action types and
// target_entity 'subscription'. Rename them to the entity.action convention so the
// Activity log filter sees one naming scheme. Safe to run more than once.
const RENAMES = {
  SUBSCRIPTION_PAUSED: 'subscription.pause',
  SUBSCRIPTION_SKIPPED: 'subscription.skip',
  SUBSCRIPTION_RESUMED: 'subscription.unpause',
  SUBSCRIPTION_PROPOSAL_SENT: 'subscription.propose',
  SUBSCRIPTION_PROPOSAL_WITHDRAWN: 'subscription.withdraw_proposal',
  SUBSCRIPTION_CANCELLED: 'subscription.cancel',
  SUBSCRIPTION_NOTE_UPDATED: 'subscription.note',
  // Removed admin actions (before 9e34316) keep their meaning under the new scheme.
  SUBSCRIPTION_FREQUENCY_CHANGED: 'subscription.frequency',
  SUBSCRIPTION_REACTIVATED: 'subscription.reactivate'
};

async function renameSubscriptionActivityTypes() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in backend/.env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const logs = client.db().collection('ActivityLogs');
    let renamedCount = 0;

    for (const [oldType, newType] of Object.entries(RENAMES)) {
      const result = await logs.updateMany(
        { action_type: oldType },
        { $set: { action_type: newType, target_entity: 'Subscriptions' } }
      );
      renamedCount += result.modifiedCount;
    }

    const leftover = await logs.distinct('action_type', { action_type: /^SUBSCRIPTION_/ });
    console.log(`Renamed ${renamedCount} activity log(s).`);
    if (leftover.length) console.warn(`Unknown SUBSCRIPTION_* types left as is: ${leftover.join(', ')}`);
  } finally {
    await client.close();
  }
}

renameSubscriptionActivityTypes().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
