import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { afterEach, expect, it, vi } from 'vitest';
import { AiChatDrawerComponent } from './ai-chat-drawer.component';
import { AiChatService } from './ai-chat.service';
import { CartService } from '../../../features/purchase/services/cart.service';
import { ToastService } from '../../services/toast.service';
import { ContactMessageService } from '../../services/contact-message.service';

afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

it('preserves the reading position during updates and follows new messages only near the bottom', () => {
  vi.useFakeTimers();
  const chat = {
    messages: signal<unknown[]>([]), isTyping: signal(false), isOpen: signal(true),
    historyOpen: signal(false), sessionId: signal('CHAT1'), draftToken: signal('')
  };
  TestBed.configureTestingModule({ providers: [
    { provide: AiChatService, useValue: chat },
    ...[CartService, ToastService, ContactMessageService, Router].map(provide => ({ provide, useValue: {} }))
  ] });
  const component = TestBed.runInInjectionContext(() => new AiChatDrawerComponent());
  const el = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 };
  (component as any).messagesContainer = { nativeElement: el };
  TestBed.tick();
  vi.advanceTimersByTime(50);
  expect(el.scrollTop).toBe(1000);

  el.scrollTop = 100;
  chat.messages.set([{}]);
  chat.isTyping.set(true);
  TestBed.tick();
  vi.advanceTimersByTime(50);
  expect(el.scrollTop).toBe(100);

  el.scrollTop = 790;
  chat.messages.set([{}, {}]);
  TestBed.tick();
  el.scrollTop = 200; // The user scrolls before the queued callback runs.
  vi.advanceTimersByTime(50);
  expect(el.scrollTop).toBe(200);

  el.scrollTop = 790;
  chat.isTyping.set(false);
  TestBed.tick();
  vi.advanceTimersByTime(50);
  expect(el.scrollTop).toBe(1000);
});
