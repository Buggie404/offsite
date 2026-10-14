require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

async function migrateAdminRoles() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in backend/.env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const users = client.db().collection('Users');
    const legacyAdmins = await users.find({ role: 'admin' }).toArray();
    let migratedCount = 0;

    for (const user of legacyAdmins) {
      const result = await users.updateOne(
        { _id: user._id, role: 'admin' },
        { $set: { role: 'admin_cc' }, $unset: { admin_role: '' } }
      );
      migratedCount += result.modifiedCount;
    }

    const cleanup = await users.updateMany(
      { admin_role: { $exists: true } },
      { $unset: { admin_role: '' } }
    );

    console.log(`Migrated ${migratedCount} legacy admin account(s).`);
    console.log(`Removed admin_role from ${cleanup.modifiedCount} remaining user document(s).`);
  } finally {
    await client.close();
  }
}

migrateAdminRoles().catch((error) => {
  console.error('Admin role migration failed:', error.message);
  process.exitCode = 1;
});