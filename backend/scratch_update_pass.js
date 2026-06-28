const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const User = require('./src/models/User');

async function resetPasswords() {
  const uri = process.env.MONGODB_URI;
  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB.');

    const hashedPassword = await bcrypt.hash('P@ssword123', 10);
    const result = await User.updateMany(
      { role: 'customer' },
      { $set: { password_hash: hashedPassword } }
    );
    console.log(`Updated ${result.modifiedCount} customer users' passwords to 'P@ssword123'.`);
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

resetPasswords();
