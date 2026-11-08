require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
// Match the application's Windows/Atlas SRV resolver configuration.
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const User = require('../src/models/User');
const ChatConversation = require('../src/models/ChatConversation');
const AiChatSession = require('../src/models/AiChatSession');

// Idempotent: only replace legacy Mongo IDs that resolve to a known staff account.
async function migrate() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not defined');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    let conversations = 0;
    let sessions = 0;
    const staff = User.find({ role: { $in: ['cskh', 'admin_cc', 'admin'] } }, 'user_id').lean().cursor();
    for await (const user of staff) {
      if (!user.user_id) continue;
      const legacyId = String(user._id);
      const chats = await ChatConversation.updateMany({ agent_id: legacyId }, { $set: { agent_id: user.user_id } });
      const ai = await AiChatSession.updateMany({ assigned_admin_id: legacyId }, { $set: { assigned_admin_id: user.user_id } });
      conversations += chats.modifiedCount;
      sessions += ai.modifiedCount;
    }
    console.log(`Normalized ${conversations} conversations and ${sessions} AI session assignments.`);
  } finally {
    await mongoose.disconnect();
  }
}

migrate().catch(error => {
  console.error('Chat agent migration failed:', error.message);
  process.exitCode = 1;
});
