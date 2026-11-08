import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { afterEach, expect, it, vi } from 'vitest';
import { AiChatDrawerComponent } from './ai-chat-drawer.component';
import { AiChatService } from './ai-chat.service';
import { CartService } from '../../../features/purchase/services/cart.service';
import { ToastService } from '../../services/toast.service';
import { ContactMessageService } from '../../services/contact-message.service';

afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

it('renders order cards sent by both customer and agent, including after history is restored', () => {
  const order = { code: '#OF1029', status: 'processing', total: 74.8, itemCount: 3, currency: 'USD' };
  const chat = {
    messages: signal([{ id: 'USER', sender: 'user', text: 'My order', timestamp: new Date(), orderCard: order }, { id: 'AGENT', sender: 'agent', text: 'Checking your order', timestamp: new Date(), orderCard: order }]),
    isTyping: signal(false), isOpen: signal(true), historyOpen: signal(false), sessionId: signal('AI1'), draftToken: signal(0), draftText: signal(''),
    interaction: signal('ready'), composerLocked: signal(false), composerBlocked: signal(false), canUseHistory: signal(true), humanChatActive: signal(true), canReopenSupport: signal(false), humanHandoverPending: signal(false),
    orderPickerOpen: signal(false), orderPickerLoading: signal(false), orderPickerError: signal(''), shareableOrders: signal([])
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AiChatService, useValue: chat }, ...[CartService, ToastService, ContactMessageService].map(provide => ({ provide, useValue: {} }))] });
  const fixture = TestBed.createComponent(AiChatDrawerComponent);
  fixture.detectChanges();
  for (const sender of ['user', 'agent']) {
    const card = fixture.nativeElement.querySelector(`.msg-row--${sender} .support-order-card`);
    expect(card.textContent).toContain('#OF1029');
    expect(card.textContent).toContain('3 items');
    expect(card.textContent).toContain('$74.80');
  }
  chat.messages.set([...chat.messages()]); fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('.support-order-card')).toHaveLength(2);
});

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
