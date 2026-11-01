import { ChatConversation } from '../../../../core/services/chat.service';

export function customerKey(chat: ChatConversation): string {
  return chat.customer?.user_id || chat.customer_id;
}

export function groupChats(chats: ChatConversation[]): ChatConversation[] {
  const groups = new Map<string, ChatConversation[]>();
  for (const chat of chats) {
    const key = customerKey(chat);
    groups.set(key, [...(groups.get(key) || []), chat]);
  }
  return [...groups.values()].map(group => {
    group.sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
    const latest = group[0];
    const target = group.find(chat => chat.status === 'open' || chat.status === 'waiting') || latest;
    return { ...target, last_message_at: latest.last_message_at,
      last_message_preview: latest.last_message_preview,
      unread_agent: group.reduce((count, chat) => count + chat.unread_agent, 0) };
  }).sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
}
