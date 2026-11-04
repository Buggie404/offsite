import { describe, expect, it } from 'vitest';
import { ChatConversation } from '../../../../core/services/chat.service';
import { groupChats } from './chat-grouping';

function chat(id: string, customer: string, status: ChatConversation['status'], date: string, unread = 1): ChatConversation {
  return { conversation_id: id, customer_id: customer, agent_id: null, status,
    last_message_at: date, last_message_preview: id, unread_agent: unread, unread_customer: 0 };
}

describe('support inbox grouped by user_id', () => {
  it('combines sessions and legacy ObjectIds for one user, sums unread and replies to an active session', () => {
    const old = chat('OLD', 'mongo-id', 'waiting', '2026-11-01T01:00:00Z', 2);
    old.customer = { user_id: 'USR1', profile_name: 'Customer', avatar_url: null, membership_tier: 'Seed' };
    const latest = chat('LATEST', 'USR1', 'closed', '2026-11-01T02:00:00Z', 3);
    const groups = groupChats([old, latest]);
    expect(groups).toHaveLength(1);
    expect(groups[0].conversation_id).toBe('OLD');
    expect(groups[0].last_message_preview).toBe('LATEST');
    expect(groups[0].unread_agent).toBe(5);
    expect(old.unread_agent).toBe(2);
  });

  it('keeps different users and guest sessions separate, ordered by latest activity', () => {
    const groups = groupChats([
      chat('A', 'USR1', 'waiting', '2026-11-01T01:00:00Z'),
      chat('B', 'guest:one', 'waiting', '2026-11-01T02:00:00Z'),
      chat('C', 'guest:two', 'waiting', '2026-11-01T03:00:00Z'),
      chat('D', 'USR2', 'open', '2026-11-01T04:00:00Z')
    ]);
    expect(groups.map(c => c.conversation_id)).toEqual(['D', 'C', 'B', 'A']);
  });
});
