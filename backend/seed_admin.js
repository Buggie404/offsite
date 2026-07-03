const dns = require('dns');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const User = require('./src/models/User');

const ADMIN_EMAIL = 'admin@offsite.vn';
const ADMIN_PASSWORD = 'P@ssword123';

async function seedAdmin() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI is not defined in backend/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log('Connected to MongoDB.');

    const existing = await User.findOne({ email: ADMIN_EMAIL });
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    if (existing) {
      existing.password_hash = passwordHash;
      existing.role = 'admin';
      existing.status = 'active';
      if (!existing.profile_name) {
        existing.profile_name = 'Offsite Admin';
      }
      await existing.save();
      console.log(`Updated existing admin account: ${ADMIN_EMAIL}`);
    } else {
      await User.create({
        user_id: 'USR00001',
        email: ADMIN_EMAIL,
        password_hash: passwordHash,
        profile_name: 'Offsite Admin',
        role: 'admin',
        status: 'active',
        oauth_providers: [],
        addresses: [],
        payment_methods: [],
        saved_products: [],
        saved_recipes: [],
        saved_posts: [],
        saved_blogs: []
      });
      console.log(`Created admin account: ${ADMIN_EMAIL}`);
    }

    console.log('Admin seed complete.');
  } catch (error) {
    console.error('Admin seed failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

seedAdmin();
