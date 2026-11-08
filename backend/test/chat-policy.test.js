const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/services/chat-policy');

test('support hours use Vietnam 08:00 inclusive to 22:00 exclusive', () => {
  for (const [utc, expected] of [['00:59', false], ['01:00', true], ['14:59', true], ['15:00', false]]) {
    assert.equal(policy.supportOpen(new Date(`2026-11-08T${utc}:00Z`)), expected);
  }
});
test('reopen is limited to resolved chats within three hours; return-to-bot never reopens', () => {
  const closed_at = '2026-11-08T01:00:00Z';
  const chat = { status: 'closed', close_reason: 'resolved', closed_at };
  assert.equal(policy.canReopen(chat, Date.parse('2026-11-08T03:59:59Z')), true);
  assert.equal(policy.canReopen(chat, Date.parse('2026-11-08T04:00:00Z')), false);
  assert.equal(policy.canReopen({ ...chat, close_reason: 'return_to_bot' }, Date.parse('2026-11-08T02:00:00Z')), false);
});
test('five and fifteen minute warnings clear when the agent replies', () => {
  const chat = { status: 'open', last_customer_message_at: '2026-11-08T01:00:00Z' };
  assert.equal(policy.warningFor(chat, Date.parse('2026-11-08T01:04:59Z')), null);
  assert.equal(policy.warningFor(chat, Date.parse('2026-11-08T01:05:00Z')), 'waiting_reply');
  assert.equal(policy.warningFor(chat, Date.parse('2026-11-08T01:15:00Z')), 'overdue');
  chat.last_agent_message_at = '2026-11-08T01:16:00Z';
  assert.equal(policy.warningFor(chat, Date.parse('2026-11-08T01:17:00Z')), null);
});

test('the three-hour support reopen window is not blocked by AI thirty-minute idle or message rotation', () => {
  const ai = require('../src/services/ai-chat-session.policy');
  const now = Date.parse('2026-11-08T03:00:00Z');
  const session = { status: 'ai_active', support_conversation_id: 'CHAT1', support_reopen_until: '2026-11-08T04:00:00Z', last_activity_at: '2026-11-08T01:00:00Z', created_at: '2026-11-01T01:00:00Z', messages: [] };
  assert.equal(ai.decisionFor(session, now), 'continue');
});
