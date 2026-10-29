// Recompute Users.followers_count / following_count from the Follows collection.
// Run once after deploying the counters, and any time they drift:
//   node backend/scripts/sync-follow-counts.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

async function countBy(follows, field) {
  const rows = await follows.aggregate([{ $group: { _id: `$${field}`, count: { $sum: 1 } } }]).toArray();
  return new Map(rows.map(r => [r._id, r.count]));
}

async function syncFollowCounts() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in backend/.env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db();
    const users = db.collection('Users');
    const follows = db.collection('Follows');

    const [followers, following] = await Promise.all([
      countBy(follows, 'following_id'),
      countBy(follows, 'follower_id')
    ]);

    const allUsers = await users.find({}, { projection: { user_id: 1 } }).toArray();
    const ops = allUsers.map(u => ({
      updateOne: {
        filter: { _id: u._id },
        update: {
          $set: {
            followers_count: followers.get(u.user_id) || 0,
            following_count: following.get(u.user_id) || 0
          }
        }
      }
    }));

    const result = ops.length ? await users.bulkWrite(ops) : { modifiedCount: 0 };
    console.log(`Checked ${allUsers.length} user(s), updated ${result.modifiedCount}.`);
  } finally {
    await client.close();
  }
}

syncFollowCounts().catch((error) => {
  console.error('Follow count sync failed:', error.message);
  process.exitCode = 1;
});
