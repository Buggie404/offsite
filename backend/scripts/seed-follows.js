// Target one user, comma-separated IDs, or --all (all active customers).
// Example: node backend/scripts/seed-follows.js --all 20 [followers|following]
const path = require('node:path');
const dns = require('node:dns');
const { MongoClient } = require('mongodb');

async function main() {
  const [target, rawTotal, mode = 'followers'] = process.argv.slice(2);
  if (!target || ['--help', '-h'].includes(target)) {
    console.log('Usage: node backend/scripts/seed-follows.js <user_id,user_id,...|--all> <total> [followers|following]');
    console.log('Example: node backend/scripts/seed-follows.js "USR00095,USR00096" 20');
    console.log('Example: node backend/scripts/seed-follows.js --all 20');
    console.log('Adds missing relationships using existing active customers. Existing follows are kept.');
    return;
  }
  const requestedIds = [...new Set(target.split(',').map(id => id.trim()).filter(Boolean))];
  if (!requestedIds.length || (target.startsWith('--') && target !== '--all')) {
    throw new Error('Provide user IDs separated by commas, or --all.');
  }
  const desired = Number(rawTotal);
  if (!rawTotal || !Number.isSafeInteger(desired) || desired < 0 || desired > 2147483647 || !['followers', 'following'].includes(mode)) {
    throw new Error('Provide a nonnegative integer total and mode followers or following.');
  }

  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing from backend/.env.');
  // Same Windows Atlas DNS configuration as the backend.
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db();
    const users = db.collection('Users');
    const follows = db.collection('Follows');
    const targets = await users.find(
      target === '--all'
        ? { status: 'active', role: 'customer' }
        : { user_id: { $in: requestedIds }, status: 'active' },
      { projection: { _id: 0, user_id: 1 } }
    ).sort({ user_id: 1 }).toArray();
    // Validate the whole selection before inserting any relationships.
    if (target !== '--all') {
      const found = new Set(targets.map(user => user.user_id));
      const missing = requestedIds.filter(id => !found.has(id));
      if (missing.length) throw new Error(`Active users not found: ${missing.join(', ')}`);
    }
    if (!targets.length) {
      console.log('No active customers found.');
      return;
    }

    const ownerField = mode === 'followers' ? 'following_id' : 'follower_id';
    const otherField = mode === 'followers' ? 'follower_id' : 'following_id';
    let totalAdded = 0;
    for (const { user_id: userId } of targets) {
      const filter = { [ownerField]: userId };
      const existing = await follows.distinct(otherField, filter);
      const needed = Math.max(0, desired - existing.length);
      let added = 0;
      if (needed > 0) {
        const candidates = await users.find({
          user_id: { $nin: [userId, ...existing] }, status: 'active', role: 'customer'
        }, { projection: { _id: 0, user_id: 1 } }).sort({ user_id: 1 }).limit(needed).toArray();
        if (candidates.length) {
          const result = await follows.bulkWrite(candidates.map(user => ({ updateOne: {
            filter: { ...filter, [otherField]: user.user_id },
            update: { $setOnInsert: { created_at: new Date() } }, upsert: true
          } })));
          added = result.upsertedCount;
        }
      }
      totalAdded += added;
      const total = await follows.countDocuments(filter);
      console.log(`${userId}: ${total} ${mode} (${added} added).`);
      if (total < desired) console.log(`Not enough eligible users to reach ${desired}.`);
      if (total > desired) console.log('The existing count is already higher; no relationships were removed.');
    }
    console.log(`Done: ${targets.length} users processed, ${totalAdded} relationships added.`);
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
