import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminChatComponent } from './chat.component';
import { ChatService, ChatConversation } from '../../../../core/services/chat.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminCustomersService } from '../../../customers/services/admin-customers.service';

describe('grouped customer thread', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('loads customer history while preserving the selected reply session', () => {
    const chat = {
      joinConversation: vi.fn(), receipt: vi.fn(() => of({})),
      messages: vi.fn((id: string) => of({ data: [{
        _id: id, conversation_id: id, sender_type: 'customer', sender_id: 'USR1',
        content: id, created_at: id === 'OLD' ? '2026-11-01T01:00:00Z' : '2026-11-01T02:00:00Z'
      }] }))
    };
    TestBed.configureTestingModule({ providers: [
      { provide: ChatService, useValue: chat },
      { provide: AdminCustomersService, useValue: { get: () => of({ data: null }), orders: () => of({ data: [], total: 0, page: 1, limit: 20 }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      { provide: AdminAuthService, useValue: { getUser: () => ({ user_id: 'STAFF1' }) } },
      { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } }
    ] });
    const component = TestBed.runInInjectionContext(() => new AdminChatComponent());
    component.filter = 'mine';
    const thread = (id: string, user: string): ChatConversation => ({
      conversation_id: id, customer_id: user, agent_id: 'STAFF1', status: 'open',
      last_message_preview: id, last_message_at: '2026-11-01T02:00:00Z', unread_agent: 1, unread_customer: 0
    });
    component.conversations = [thread('NEW', 'USR1'), thread('OLD', 'USR1'), thread('OTHER', 'USR2')];
    component.select(component.visible.find(c => c.customer_id === 'USR1')!);
    expect(chat.messages.mock.calls.map(([id]) => id)).toEqual(['NEW', 'OLD']);
    expect(component.messages.map(m => m.content)).toEqual(['OLD', 'NEW']);
    expect(component.visible).toHaveLength(2);
    expect(component.canReply).toBe(true);

    vi.useFakeTimers();
    try {
      const element = { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 };
      const internal = component as any;
      internal.thread = { nativeElement: element };
      internal.refreshMessages('NEW');
      vi.runAllTimers();
      expect(element.scrollTop).toBe(100);

      element.scrollTop = 790;
      internal.refreshMessages('NEW');
      vi.runAllTimers();
      expect(element.scrollTop).toBe(1000);

      element.scrollTop = 100;
      component.select(component.visible[0]);
      vi.runAllTimers();
      expect(element.scrollTop).toBe(1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
