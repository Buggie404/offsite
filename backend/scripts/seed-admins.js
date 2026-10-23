require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const ADMIN_DEFINITIONS = [
  { user_id: 'USR00001', role: 'admin_cc', profile_name: 'Senior Admin', emailKey: 'ADMIN_CC_EMAIL', passwordKey: 'ADMIN_CC_PASSWORD' },
  { user_id: 'USR00002', role: 'qlsp', profile_name: 'Sales Ops', emailKey: 'ADMIN_QLSP_EMAIL', passwordKey: 'ADMIN_QLSP_PASSWORD' },
  { user_id: 'USR00003', role: 'cskh', profile_name: 'Services Ops', emailKey: 'ADMIN_CSKH_EMAIL', passwordKey: 'ADMIN_CSKH_PASSWORD' }
];

function configuredAdmins() {
  return ADMIN_DEFINITIONS.map((definition) => {
    const email = String(process.env[definition.emailKey] || '').trim().toLowerCase();
    const password = String(process.env[definition.passwordKey] || '');
    if (!email || !password) throw new Error(`Missing ${definition.emailKey} or ${definition.passwordKey}.`);
    if (password.length < 8) throw new Error(`${definition.passwordKey} must be at least 8 characters.`);
    return { ...definition, email, password };
  });
}

async function seedAdmins() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const users = client.db().collection('Users');
    for (const admin of configuredAdmins()) {
      const existing = await users.findOne({ $or: [{ email: admin.email }, { user_id: admin.user_id }] });
      if (existing) {
        // Idempotent and safe: never overwrite an existing account, password or role.
        console.log(`Admin ${admin.email} already exists, skipping.`);
        continue;
      }

      const password_hash = await bcrypt.hash(admin.password, 12);
      await users.insertOne({
        user_id: admin.user_id,
        email: admin.email,
        password_hash,
        profile_name: admin.profile_name,
        role: admin.role,
        community_name: `${admin.role}-admin`,
        status: 'active',
        addresses: [], payment_methods: [], saved_products: [], saved_recipes: [], saved_posts: [], saved_blogs: [],
        createdAt: new Date(), updatedAt: new Date()
      });
      console.log(`Inserted ${admin.role} admin account.`);
    }
  } finally {
    await client.close();
  }
}

seedAdmins()
  .then(() => console.log('Admin seeding completed.'))
  .catch((error) => {
    console.error('Admin seeding failed:', error.message);
    process.exitCode = 1;
  });
