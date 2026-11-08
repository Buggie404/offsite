import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminChatComponent } from './chat.component';
import { ChatConversation, ChatService } from '../../../../core/services/chat.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';

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
    list: vi.fn(() => of({ data: rows })), messages: vi.fn(() => of({ data: [] })),
    receipt: vi.fn(() => of({})), joinAgents: vi.fn(), joinConversation: vi.fn(), disconnect: vi.fn(),
    send: vi.fn(), typing: vi.fn(), claim: vi.fn((id: string) => of({ data: { ...rows.find(c => c.conversation_id === id)!, status: 'open', agent_id: 'STAFF1' } })),
    agents: vi.fn(() => of({ data: [{ user_id: 'STAFF2', name: 'Minh' }] })),
    transfer: vi.fn((id: string, agent_id: string, note: string) => of({ data: { ...rows.find(c => c.conversation_id === id)!, agent_id, transfers: [{ from_agent_id: 'STAFF1', to_agent_id: agent_id, note, at: '2026-11-08T01:00:00Z' }] } })),
    close: vi.fn((id: string) => of({ data: { ...rows.find(c => c.conversation_id === id)!, status: 'closed' } })),
    conversation$: new Subject<ChatConversation>(), message$: new Subject(), typing$: new Subject(), listHint$: new Subject()
  };
  TestBed.configureTestingModule({ providers: [
    { provide: ChatService, useValue: chat },
    { provide: AdminAuthService, useValue: { getUser: () => ({ user_id: 'STAFF1', _id: 'mongo-staff', role: 'cskh' }) } },
    { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (key: string) => key === 'status' ? status : conversation } } } },
    { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } }
  ] });
  const fixture = TestBed.createComponent(AdminChatComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return { component, fixture, rows, chat };
}

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
  expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  component.claim();
  fixture.detectChanges();
  expect(component.filter).toBe('mine');
  expect(component.canReply).toBe(true);
  expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  component.closeChat();
  fixture.detectChanges();
  expect(chat.close).toHaveBeenCalledWith('WAIT');
  expect(component.filter).toBe('closed');
  expect(fixture.nativeElement.textContent).toContain('closed and read only');
  expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
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
