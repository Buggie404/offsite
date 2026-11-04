require('dotenv').config();
const mongoose = require('mongoose');
const AiCallLog = require('../src/models/AiCallLog');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await AiCallLog.collection.updateMany(
    { feature: { $ne: 'ritual_dna' }, ritual_dna: { $exists: false } },
    { $set: { ritual_dna: null } }
  );
  console.log(`Non-Ritual AI logs updated: ${result.modifiedCount}`);
}

main()
  .catch(error => { console.error('AI log backfill failed:', error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
