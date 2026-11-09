import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminChatComponent } from './chat.component';
import { ChatConversation, ChatMessage, ChatService } from '../../../../core/services/chat.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminCustomersService, CustomerDetail } from '../../../customers/services/admin-customers.service';

const row = (id: string, status: ChatConversation['status'], agent: string | null, customer = id): ChatConversation => ({
  conversation_id: id, customer_id: customer, status, agent_id: agent,
  last_message_at: '2026-11-08T01:00:00Z', last_message_preview: '', unread_agent: 0, unread_customer: 0
});

afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks(); });

function setup(status: string | null = null, conversation: string | null = null) {
  vi.useFakeTimers();
  const rows = [row('WAIT', 'waiting', null), row('OWN', 'open', 'STAFF1'),
    row('LEGACY', 'open', 'mongo-staff'), row('OTHER', 'open', 'STAFF2'),
    row('CLOSED', 'closed', 'STAFF1', 'OWN')];
  const chat = {
    list: vi.fn(() => of({ data: rows })), messages: vi.fn((_id: string) => of<{ data: ChatMessage[] }>({ data: [] })),
    receipt: vi.fn(() => of({})), joinAgents: vi.fn(), joinConversation: vi.fn(), disconnect: vi.fn(),
    send: vi.fn(), typing: vi.fn(), claim: vi.fn((id: string) => of({ data: { ...rows.find(c => c.conversation_id === id)!, status: 'open', agent_id: 'STAFF1' } })),
    agents: vi.fn(() => of({ data: [{ user_id: 'STAFF2', name: 'Minh' }] })),
    transfer: vi.fn((id: string, agent_id: string, note: string) => of({ data: { ...rows.find(c => c.conversation_id === id)!, agent_id, transfers: [{ from_agent_id: 'STAFF1', to_agent_id: agent_id, note, at: '2026-11-08T01:00:00Z' }] } })),
    close: vi.fn((id: string, options?: { outcome: string }) => of({ data: { ...rows.find(c => c.conversation_id === id)!, status: 'closed', close_outcome: options?.outcome } })),
    conversation$: new Subject<ChatConversation>(), message$: new Subject(), typing$: new Subject(), listHint$: new Subject()
  };
  TestBed.configureTestingModule({ providers: [
    { provide: ChatService, useValue: chat },
    { provide: AdminCustomersService, useValue: { get: () => of({ data: null }), orders: () => of({ data: [], total: 0, page: 1, limit: 20 }) } },
    { provide: AdminAuthService, useValue: { getUser: () => ({ user_id: 'STAFF1', _id: 'mongo-staff', role: 'cskh' }) } },
    { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (key: string) => key === 'status' ? status : conversation } } } },
    { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } }
  ] });
  const fixture = TestBed.createComponent(AdminChatComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return { component, fixture, rows, chat };
}

it('scrolls the thread to the rendered newest message after a socket update', () => {
  const { component, fixture, rows, chat } = setup();
  component.select(rows[1]);
  fixture.detectChanges();
  vi.spyOn(component, 'loadList').mockImplementation(() => {});
  const thread = fixture.nativeElement.querySelector('.chat-thread') as HTMLElement;
  Object.defineProperty(thread, 'scrollHeight', { configurable: true, get: () => 500 + thread.querySelectorAll('.message-row').length * 100 });
  thread.scrollTop = 0;
  chat.message$.next({ _id: 'NEW', conversation_id: 'OWN', sender_type: 'customer', sender_id: 'OWN', content: 'Newest message', created_at: '2026-11-08T10:00:00Z' });
  fixture.detectChanges();
  vi.advanceTimersByTime(20);
  expect(thread.textContent).toContain('Newest message');
  expect(thread.scrollTop).toBe(thread.scrollHeight);
});

it('deduplicates socket replays and copied history by message identity, preserving intentional repeats', () => {
  const { component, fixture, rows, chat } = setup();
  const original = { _id: 'FIRST', conversation_id: 'OWN', sender_type: 'agent' as const, sender_id: 'STAFF1', content: 'Same text', created_at: '2026-11-08T10:00:00Z', source_session_id: 'AI1', source_message_id: 'SOURCE1' };
  chat.messages.mockImplementation(id => of({ data: id === 'OWN' ? [original, { ...original }] : [{ ...original, _id: 'COPY', conversation_id: 'CLOSED' }] }));
  component.select(rows[1]);
  expect(component.messages).toHaveLength(1);
  vi.spyOn(component, 'loadList').mockImplementation(() => {});
  chat.message$.next(original);
  expect(component.messages).toHaveLength(1);
  chat.message$.next({ ...original, _id: 'SECOND', source_message_id: 'SOURCE2' });
  fixture.detectChanges();
  expect(component.messages).toHaveLength(2);
});

it('does not send during IME composition or repeated Enter key events', () => {
  const { component, rows, chat } = setup();
  component.select(rows[1]);
  component.draft = 'Reply';
  component.onKey(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
  component.onKey(new KeyboardEvent('keydown', { key: 'Enter', repeat: true }));
  expect(chat.send).not.toHaveBeenCalled();
  expect(component.draft).toBe('Reply');
  component.onKey(new KeyboardEvent('keydown', { key: 'Enter' }));
  expect(chat.send).toHaveBeenCalledTimes(1);
  expect(component.draft).toBe('');
});

it('defaults to Waiting, isolates Mine including legacy IDs, and keeps closed history visible', () => {
  const { component } = setup();
  expect(component.visible.map(c => c.conversation_id)).toEqual(['WAIT']);
  component.setFilter('mine');
  expect(component.visible.map(c => c.conversation_id)).toEqual(['OWN', 'LEGACY']);
  component.setFilter('closed');
  expect(component.visible.map(c => c.conversation_id)).toEqual(['CLOSED']);
  component.setFilter('all');
  expect(component.visible.some(c => c.conversation_id === 'OTHER')).toBe(true);
});

it('combines search, source and activity ordering without changing tab counts', () => {
  const { component, rows } = setup();
  rows[0].ai_session_id = 'AI1';
  rows[0].customer = { user_id: 'USR1', profile_name: 'Mai Anh', avatar_url: null, membership_tier: 'seed' };
  component.conversations.push({ ...row('DIRECT', 'waiting', null), last_message_at: '2026-11-08T02:00:00Z' });
  expect(component.visible.map(c => c.conversation_id)).toEqual(['DIRECT', 'WAIT']);
  component.sortOrder = 'oldest';
  expect(component.visible.map(c => c.conversation_id)).toEqual(['WAIT', 'DIRECT']);
  component.sourceFilter = 'ai';
  component.search = '  MAI  ';
  expect(component.visible.map(c => c.conversation_id)).toEqual(['WAIT']);
  component.search = 'usr1';
  expect(component.visible).toHaveLength(1);
  component.sourceFilter = 'direct';
  expect(component.visible).toHaveLength(0);
  expect(component.waitingCount).toBe(2);
});

it('maps existing dashboard open links to Mine and opens an exact closed deep link', () => {
  const { component } = setup('open', 'CLOSED');
  expect(component.filter).toBe('closed');
  expect(component.active?.conversation_id).toBe('CLOSED');
  component.loadList();
  expect(component.active?.conversation_id).toBe('CLOSED');
});

it('maps status=open to Mine when there is no conversation deep link', () => {
  expect(setup('open').component.filter).toBe('mine');
});

it('renders claim, reply and closed states and moves the selected chat through its tabs', () => {
  const { component, fixture, rows, chat } = setup();
  component.select(rows[0]);
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Claim & reply');
  expect(fixture.nativeElement.querySelector('.chat-compose textarea')).toBeNull();
  component.claim();
  fixture.detectChanges();
  expect(component.filter).toBe('mine');
  expect(component.canReply).toBe(true);
  expect(fixture.nativeElement.querySelector('.chat-compose textarea')).not.toBeNull();
  component.closeChat();
  expect(component.closeOpen).toBe(true);
  expect(chat.close).not.toHaveBeenCalled();
  component.closeOutcome = 'no_response';
  component.closeSummary = 'Customer stopped replying.';
  component.sendClosingMessage = false;
  component.confirmClose();
  fixture.detectChanges();
  expect(chat.close).toHaveBeenCalledWith('WAIT', { outcome: 'no_response', summary: 'Customer stopped replying.', send_closing_message: false });
  expect(component.closedLabel).toBe('No response');
  expect(component.filter).toBe('closed');
  expect(fixture.nativeElement.textContent).toContain('closed and read only');
  expect(fixture.nativeElement.querySelector('.chat-compose textarea')).toBeNull();
});

it('prevents replies and claim/close actions for another agent and clears drafts on selection', () => {
  const { component, fixture, rows, chat } = setup();
  component.draft = 'For a different customer';
  component.select(rows[3]);
  fixture.detectChanges();
  expect(component.draft).toBe('');
  expect(fixture.nativeElement.textContent).toContain('Another agent is handling');
  component.draft = 'Should not send';
  component.send(); component.claim(); component.closeChat();
  expect(chat.send).not.toHaveBeenCalled();
  expect(chat.claim).not.toHaveBeenCalled();
  expect(chat.close).not.toHaveBeenCalled();
});

it('transfers an owned chat with a required note and displays capacity errors without losing the thread', () => {
  const { component, rows, chat } = setup();
  component.select(rows[0]);
  chat.claim.mockImplementation(() => throwError(() => ({ error: { error: 'This agent already has 5 active conversations' } })));
  component.claim();
  expect(component.actionError).toContain('5 active');
  expect(component.actionPending).toBe(false);
  expect(component.active?.conversation_id).toBe('WAIT');
  component.select(rows[1]);
  component.openTransfer();
  component.transferTarget = 'STAFF2';
  component.transfer();
  expect(chat.transfer).not.toHaveBeenCalled();
  component.transferNote = 'Customer asked about their damaged bowl';
  component.transfer();
  expect(chat.transfer).toHaveBeenCalledWith('OWN', 'STAFF2', component.transferNote);
  expect(component.canReply).toBe(false);
  expect(component.filter).toBe('all');
});

it('can cancel closing and prevents transferring to an unavailable colleague', () => {
  const { component, rows, chat } = setup();
  component.select(rows[1]);
  component.closeChat();
  component.closeSummary = 'Unsaved';
  component.dismissDialogs();
  component.confirmClose();
  expect(chat.close).not.toHaveBeenCalled();
  component.openTransfer();
  component.agents = [{ user_id: 'STAFF2', name: 'Minh', online: true, active_chats: 5, available: false }];
  component.transferTarget = 'STAFF2'; component.transferNote = 'Context';
  component.transfer();
  expect(chat.transfer).not.toHaveBeenCalled();
});

it('shares the selected order as a card and blocks sharing after the chat closes', () => {
  const { component, rows } = setup();
  const share = vi.fn(() => of({ data: { _id: 'CARD1', conversation_id: 'OWN', sender_type: 'agent', content: 'Order #OF1029', metadata: { orderCard: { order_id: 'OF1029' } } } }));
  (TestBed.inject(ChatService) as any).shareOrder = share;
  component.select(rows[1]); component.orderShareId = 'OF1029'; component.shareOrder();
  expect(share).toHaveBeenCalledWith('OWN', 'OF1029');
  expect(component.messages.at(-1)?.metadata?.orderCard?.order_id).toBe('OF1029');
  component.active = { ...component.active!, status: 'closed' };
  component.shareOrder();
  expect(share).toHaveBeenCalledTimes(1);
});

it('renders the customer panel and closed footer from authorized customer data', () => {
  const { component, fixture, rows } = setup();
  vi.spyOn(TestBed.inject(AdminCustomersService), 'get').mockReturnValue(of({ data: {
    user_id: 'OWN', profile_name: 'Mai', community_name: 'mai.matcha', email: 'mai@example.com', status: 'active',
    membership_tier: 'Bloom', ritual_boxes: 2, violations: [], recent_orders: [{ order_id: 'OF1029', status: 'processing', created_at: '2026-11-08', item_count: 3, total: 74.8 }],
    vouchers: [], notes: [], phone: null, avatar_url: null, points: 0, total_spent: 74.8, suspended_reason: null, suspended_at: null,
    restricted_until: null, restricted_reason: null, created_at: null, order_count: 1, last_order_at: null
  } as CustomerDetail }));
  vi.spyOn(TestBed.inject(AdminCustomersService), 'orders').mockReturnValue(of({ data: [{ order_id: 'OF1029', status: 'processing', created_at: '2026-11-08', item_count: 3, total: 74.8 }], total: 1, page: 1, limit: 20 }));
  component.select(rows[4]);
  component.messages = [{ _id: 'ORDER1', conversation_id: 'CLOSED', sender_type: 'bot', sender_id: null, content: '', created_at: '2026-11-08T01:00:00Z', metadata: { orderCard: { code: 'OF1029', status: 'Processing', total: 74.8 } } }];
  fixture.detectChanges();
  const panel = fixture.nativeElement.querySelector('.customer-panel');
  expect(panel.textContent).toContain('mai@example.com');
  expect(panel.textContent).toContain('OF1029');
  expect(panel.querySelector('.customer-profile-link').getAttribute('href')).toBe('/admin/service-customers/OWN');
  expect(fixture.nativeElement.querySelector('.chat-compose .profile-button')).not.toBeNull();
  expect(fixture.nativeElement.querySelector('.chat-order-card').textContent).toContain('OF1029');
});

it('uses real quick actions and a formatted order card in an owned chat', () => {
  const { component, fixture, rows } = setup();
  component.select(rows[1]);
  component.customerDetails = { user_id: 'OWN', community_name: 'mai.matcha', status: 'active', recent_orders: [{ order_id: 'OF1029', status: 'processing' }], ritual_boxes: 2, violations: [] } as unknown as NonNullable<typeof component.customerDetails>;
  component.messages = [{ sender_type: 'agent', sender_id: 'STAFF1', conversation_id: 'OWN', content: 'Your order', created_at: '2026-11-08', metadata: { orderCard: { order_id: 'OF1029', order_status: 'processing', total_amount: 74.8, item_count: 3 } } }];
  fixture.detectChanges();
  const card = fixture.nativeElement.querySelector('.chat-order-card');
  expect(card.textContent).toContain('3 items'); expect(card.textContent).toContain('$74.80');
  expect(card.querySelector('img').getAttribute('src')).toContain('order-placeholder.svg');
  const actions = fixture.nativeElement.querySelectorAll('.customer-action');
  expect(actions).toHaveLength(3);
  expect(actions[0].getAttribute('href')).toBe('/admin/orders/OF1029');
  expect(actions[1].tagName).toBe('BUTTON');
  actions[1].click();
  expect(component.voucherCustomer).toMatchObject({ user_id: 'OWN', conversation_id: 'OWN' });
  component.voucherCustomer = null;
  actions[2].click(); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('app-report-post-modal')).not.toBeNull();
  expect(component.draft).toBe(''); component.useQuickReply('Let me check.'); expect(component.draft).toBe('Let me check.');
});

it('keeps private customer data out of the panel when customer scope is denied', () => {
  const { component, fixture, rows } = setup();
  vi.spyOn(TestBed.inject(AdminCustomersService), 'get').mockReturnValue(throwError(() => ({ status: 403 })));
  component.select(rows[0]);
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.customer-panel').textContent).toContain('assigned support staff');
  expect(fixture.nativeElement.querySelector('.customer-profile-link')).toBeNull();
  expect(fixture.nativeElement.querySelector('.chat-compose .btn').textContent).toContain('Claim & reply');
});

it('reloads customer facts after claim succeeds and uses the server history count', () => {
  const { component, fixture, rows } = setup();
  const get = vi.spyOn(TestBed.inject(AdminCustomersService), 'get')
    .mockReturnValueOnce(throwError(() => ({ status: 403 })))
    .mockReturnValue(of({ data: {
      user_id: 'WAIT', profile_name: 'Mai', email: 'mai@example.com', membership_tier: 'Seed', status: 'active',
      ritual_boxes: 0, violations: [], recent_orders: [], past_chats: 7,
      vouchers: [], notes: [], phone: null, avatar_url: null, points: 0, total_spent: 0, community_name: null,
      suspended_reason: null, suspended_at: null, restricted_until: null, restricted_reason: null,
      created_at: null, order_count: 0, last_order_at: null
    } as CustomerDetail }));
  component.select(rows[0]);
  expect(component.customerDetails).toBeNull();
  component.claim();
  fixture.detectChanges();
  expect(get).toHaveBeenCalledTimes(2);
  expect(component.pastChats).toBe(7);
  expect(fixture.nativeElement.querySelector('.customer-panel').textContent).toContain('mai@example.com');
  expect(fixture.nativeElement.querySelector('.customer-profile-link')).not.toBeNull();
  component.active = { ...component.active!, status: 'closed' };
  expect(component.pastChats).toBe(6);
});

it('shows Vietnam calendar dates when messages cross midnight', () => {
  const { component, fixture } = setup();
  component.select(component.conversations.find(c => c.conversation_id === 'OWN')!);
  component.messages = [
    { _id: 'D1', conversation_id: 'OWN', sender_type: 'customer', sender_id: 'OWN', content: 'Before', created_at: '2026-11-08T16:59:00Z' },
    { _id: 'D2', conversation_id: 'OWN', sender_type: 'agent', sender_id: 'STAFF1', content: 'After', created_at: '2026-11-08T17:01:00Z' }
  ];
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  const dates = [...fixture.nativeElement.querySelectorAll('.chat-date-divider')].map((node: any) => node.textContent.trim());
  expect(dates).toEqual(['08/11/2026', '09/11/2026']);
});

it('loads old sessions in the timeline without changing the active reply target', () => {
  const { component, rows, chat } = setup();
  component.select(rows[1]);
  expect(chat.messages.mock.calls.map(([id]) => id)).toEqual(['OWN', 'CLOSED']);
  vi.spyOn(component, 'loadList').mockImplementation(() => {});
  chat.message$.next({ _id: 'OLD', conversation_id: 'CLOSED', sender_type: 'customer', sender_id: 'OWN', content: 'Old session', created_at: '2026-11-08T01:00:00Z' });
  expect(component.messages).toHaveLength(1);
  expect(component.active?.conversation_id).toBe('OWN');
  expect(component.sessionThreads).toHaveLength(2);
});

it('shows handler names and per-admin assignment filters only to the senior admin', () => {
  const { component, fixture, rows } = setup();
  rows[1].agent_name = 'Quynh'; rows[1].agent_user_id = 'STAFF1';
  rows[4].agent_name = 'Quynh'; rows[4].closed_by_name = 'Quynh'; rows[4].agent_user_id = 'STAFF1';
  component.select(rows[1]);
  fixture.changeDetectorRef.markForCheck(); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[aria-label="Assigned admin"]')).toBeNull();
  expect(fixture.nativeElement.querySelector('.chat-session-divider').textContent).not.toContain('Quynh');
  vi.spyOn(TestBed.inject(AdminAuthService), 'getUser').mockReturnValue({ user_id: 'SENIOR', _id: 'mongo-senior', role: 'admin_cc', email: 'senior@example.com' });
  component.inboxAgents = [{ user_id: 'STAFF1', name: 'Quynh' }, { user_id: 'STAFF2', name: 'Minh' }];
  component.setAssignedAgent('STAFF1');
  fixture.changeDetectorRef.markForCheck(); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[aria-label="Assigned admin"]')).not.toBeNull();
  expect(component.visible.map(c => c.conversation_id)).toEqual(['OWN']);
  expect(component.assignedCount('STAFF1')).toBe(1);
  component.select(rows[1]);
  fixture.changeDetectorRef.markForCheck(); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.chat-session-divider').textContent).toContain('Quynh');
  component.setAssignedAgent('STAFF2');
  expect(component.visible.map(c => c.conversation_id)).toEqual(['OTHER']);
});
