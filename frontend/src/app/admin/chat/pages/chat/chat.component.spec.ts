import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminChatComponent } from './chat.component';
import { ChatService, ChatConversation } from '../../../../core/services/chat.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';

describe('grouped customer thread', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('opens all sessions for the selected user and merges their messages chronologically', () => {
    const chat = {
      joinConversation: vi.fn(), receipt: vi.fn(() => of({})),
      messages: vi.fn((id: string) => of({ data: [{
        _id: id, conversation_id: id, sender_type: 'customer', sender_id: 'USR1',
        content: id, created_at: id === 'OLD' ? '2026-11-01T01:00:00Z' : '2026-11-01T02:00:00Z'
      }] }))
    };
    TestBed.configureTestingModule({ providers: [
      { provide: ChatService, useValue: chat },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      { provide: AdminAuthService, useValue: { getUser: () => ({ user_id: 'STAFF1' }) } },
      { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } }
    ] });
    const component = TestBed.runInInjectionContext(() => new AdminChatComponent());
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
  });
});
