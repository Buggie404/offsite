const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');

// Read-only Orders scope: explicit assignments plus customers in this agent's chats.
// Resolve from DB because JWTs carry the Mongo ID and no current assignment list.
async function supportOrderCustomerIds(authUser) {
  if (authUser.role !== 'cskh') return null;
  const identity = String(authUser.user_id || '');
  const staff = await User.findOne(/^[a-f0-9]{24}$/i.test(identity) ? { _id: identity } : { user_id: identity }, 'user_id assigned_chat_customer_ids').lean();
  if (!staff) return [];
  const ids = [...new Set([identity, staff.user_id, String(staff._id)].filter(Boolean))];
  const customers = await ChatConversation.distinct('customer_id', { agent_id: { $in: ids }, status: { $in: ['open', 'closed'] } });
  return [...new Set([...(staff.assigned_chat_customer_ids || []), ...customers])];
}

module.exports = { supportOrderCustomerIds };
