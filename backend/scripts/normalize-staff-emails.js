require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

// Moves existing staff accounts to firstname.lastname@offsite.vn (first and last word of profile_name).
// Dry run by default; pass --apply to write. Sign-in uses the email, so tell each person their new one.
const STAFF_ROLES = ['admin_cc', 'cskh', 'qlsp', 'admin'];
const STAFF_EMAIL_REGEX = /^[a-z]+\.[a-z]+\d*@offsite\.vn$/;

function emailPart(word) {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function suggestEmail(name) {
  const words = String(name || '').trim().split(/\s+/).map(emailPart).filter(Boolean);
  return words.length < 2 ? null : `${words[0]}.${words[words.length - 1]}@offsite.vn`;
}

async function normalizeStaffEmails() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  const apply = process.argv.includes('--apply');

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const users = client.db().collection('Users');
    const staff = await users.find({ role: { $in: STAFF_ROLES } }, { projection: { user_id: 1, email: 1, profile_name: 1 } }).toArray();

    for (const member of staff) {
      const label = `${member.user_id} "${member.profile_name}" <${member.email}>`;
      if (STAFF_EMAIL_REGEX.test(member.email || '')) continue;
      const email = suggestEmail(member.profile_name);
      if (!email) {
        console.log(`SKIP ${label}: the name has no first and last name.`);
        continue;
      }
      if (await users.findOne({ email, _id: { $ne: member._id } }, { projection: { _id: 1 } })) {
        console.log(`SKIP ${label}: ${email} is already taken.`);
        continue;
      }
      if (apply) await users.updateOne({ _id: member._id }, { $set: { email, updatedAt: new Date() } });
      console.log(`${apply ? 'UPDATED' : 'WOULD UPDATE'} ${label} -> ${email}`);
    }
    if (!apply) console.log('Dry run: nothing was written. Run with --apply to save.');
  } finally {
    await client.close();
  }
}

normalizeStaffEmails().catch((error) => {
  console.error('Staff email normalization failed:', error.message);
  process.exitCode = 1;
});
