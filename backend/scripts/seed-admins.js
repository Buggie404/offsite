require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

// Admin accounts to seed
const admins = [
  {
    user_id: 'USR00001',
    email: 'senioradmin@example.com',
    password: 'SeniorAdmin123', // plaintext, will be hashed
    profile_name: 'Senior Admin',
    role: 'admin_cc' // badge: Senior Admin
  },
  {
    user_id: 'USR00002',
    email: 'salesops@example.com',
    password: 'SalesOps123',
    profile_name: 'Sales Ops',
    role: 'qlsp' // badge: Sales-Ops
  },
  {
    user_id: 'USR00003',
    email: 'servicesops@example.com',
    password: 'ServicesOps123',
    profile_name: 'Services Ops',
    role: 'cskh' // badge: Services-Ops
  }
];

async function seedAdmins() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const users = client.db().collection('Users');

  for (const admin of admins) {
    const existing = await users.findOne({ email: admin.email });
    if (existing) {
      console.log(`Admin ${admin.email} already exists, skipping`);
      continue;
    }
    const password_hash = await bcrypt.hash(admin.password, 10);
    const newUser = {
      user_id: admin.user_id,
      email: admin.email,
      password_hash,
      profile_name: admin.profile_name,
      role: admin.role,
      community_name: admin.profile_name.toLowerCase().replace(/\s+/g, '-') + '-admin',
      status: 'active',
      addresses: [],
      payment_methods: [],
      saved_products: [],
      saved_recipes: [],
      saved_posts: [],
      saved_blogs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await users.insertOne(newUser);
    console.log(`Inserted admin ${admin.email} with role ${admin.role}`);
  }
  await client.close();
}

seedAdmins()
  .then(() => console.log('Seeding completed'))
  .catch(err => {
    console.error('Error seeding admins:', err);
    process.exit(1);
  });
