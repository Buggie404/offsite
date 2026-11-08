import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../core/auth.service';
import { AiChatService } from './ai-chat.service';

describe('AI Concierge human handover', () => {
  let service: AiChatService;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: { isAuthenticated: signal(false), currentUser: signal(null) } }]
    });
    service = TestBed.inject(AiChatService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
  });
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); vi.useRealTimers(); });

  function handover() {
    service.requestHandover('user_request', 'I need help');
    http.expectOne(request => request.url.endsWith('/ai-chat/handover')).flush({ handover: true });
  }

  it('shares a selected account order through the existing human conversation', () => {
    handover();
    vi.spyOn(service, 'canUseHistory').mockReturnValue(true);
    service.openOrderPicker();
    http.expectOne(request => request.url.endsWith('/ai-chat/my-orders')).flush({ orders: [{ order_id: 'OF1029', order_status: 'processing', total_amount: 74.8, currency: 'USD' }] });
    expect(service.shareableOrders()[0].code).toBe('#OF1029');
    service.shareOrder(service.shareableOrders()[0]);
    const request = http.expectOne(request => request.url.endsWith('/ai-chat/message'));
    expect(request.request.body.order_id).toBe('OF1029');
    expect(request.request.body.metadata).toBeUndefined();
    expect(service.orderPickerOpen()).toBe(false);
    request.flush({ human_chat: true, status: 'in_progress', messages: [{ sender: 'user', text: 'Order OF1029', metadata: { orderCard: { order_id: 'OF1029', order_status: 'processing', total_amount: 74.8 } } }] });
    expect(service.messages().at(-1)?.orderCard?.total).toBe(74.8);
  });

  it('does not open the account order picker for a guest or an AI-only chat', () => {
    service.openOrderPicker();
    expect(service.orderPickerOpen()).toBe(false);
    http.expectNone(request => request.url.endsWith('/ai-chat/my-orders'));
  });

  it('selecting Talk to a person alone does not create a waiting conversation', () => {
    service.requestHandover();
    http.expectNone(request => request.url.endsWith('/ai-chat/handover'));
    expect(service.humanHandoverPending()).toBe(true);
    expect(service.humanChatActive()).toBe(false);
    expect(service.sendMessage('   ')).toBe(false);
    service.returnToBot();
    expect(service.humanHandoverPending()).toBe(false);
    http.expectNone(request => request.url.endsWith('/ai-chat/return-to-bot'));
  });

  it('the first actual message after selecting a person is handed over once, then enters Waiting', () => {
    service.requestHandover();
    expect(service.sendMessage('My bowl arrived broken')).toBe(true);
    const request = http.expectOne(request => request.url.endsWith('/ai-chat/handover'));
    expect(request.request.body.message).toBe('My bowl arrived broken');
    expect(service.humanChatActive()).toBe(false);
    expect(service.sendMessage('Duplicate click')).toBe(false);
    request.flush({ handover: true });
    expect(service.humanHandoverPending()).toBe(false);
    expect(service.humanChatActive()).toBe(true);
  });

  it('outside support hours shows the leave-message form without entering Waiting', () => {
    service.requestHandover();
    service.sendMessage('My bowl arrived broken');
    http.expectOne(request => request.url.endsWith('/ai-chat/handover')).flush({
      handover: false, show_contact_form: true, message: 'Support is offline'
    });
    expect(service.humanChatActive()).toBe(false);
    expect(service.humanHandoverPending()).toBe(false);
    expect(service.isTyping()).toBe(false);
    expect(service.messages().find(message => message.sender === 'user')?.deliveryStatus).toBe('sent');
  });

  it('restores human mode from waiting status even when an older session lacks the conversation link', () => {
    service.openHistory('LEGACY1');
    http.expectOne(request => request.url.endsWith('/ai-chat/sessions/LEGACY1')).flush({
      status: 'waiting', messages: [
        { message_id: 'SYSTEM1', sender: 'system', text: 'Customer asked to talk to a person.' }
      ]
    });
    expect(service.humanChatActive()).toBe(true);
  });

  it('activates human chat after the shared handover endpoint succeeds', () => {
    handover();
    expect(service.humanChatActive()).toBe(true);
    expect(service.messages().at(-1)?.text).toContain('continue messaging here');
  });

  it('sends the next customer message through the same drawer without requesting another handover', () => {
    handover();
    expect(service.sendMessage('talk to a human')).toBe(true);
    const request = http.expectOne(request => request.url.endsWith('/ai-chat/message'));
    expect(request.request.body.message).toBe('talk to a human');
    request.flush({ human_chat: true, status: 'waiting', support_conversation_id: 'CHAT1', messages: [
      { message_id: 'CUSTOMER1', sender: 'user', text: 'talk to a human', created_at: new Date().toISOString() }
    ] });
    expect(service.messages().at(-1)?.id).toBe('CUSTOMER1');
    expect(service.isTyping()).toBe(false);
  });

  it('receives agent messages in the existing drawer and stops human mode when support closes', () => {
    handover(); service.isOpen.set(true);
    vi.advanceTimersByTime(2500);
    http.expectOne(request => request.url.endsWith('/ai-chat/sessions/' + service.sessionId())).flush({
      status: 'in_progress', support_conversation_id: 'CHAT1', messages: [
        { message_id: 'AGENT1', sender: 'agent', text: 'How can I help?', created_at: new Date().toISOString() }
      ]
    });
    expect(service.messages()[0].sender).toBe('agent');
    vi.advanceTimersByTime(2500);
    http.expectOne(request => request.url.endsWith('/ai-chat/sessions/' + service.sessionId())).flush({
      status: 'ai_active', support_conversation_id: 'CHAT1', messages: [
        { message_id: 'END1', sender: 'system', text: 'Support conversation ended', created_at: new Date().toISOString() }
      ]
    });
    expect(service.humanChatActive()).toBe(false);
  });

  it('keeps Talk to chatbot usable during the support reopen window', () => {
    handover(); service.isOpen.set(true);
    vi.advanceTimersByTime(2500);
    http.expectOne(request => request.url.endsWith('/ai-chat/sessions/' + service.sessionId())).flush({
      status: 'ai_active', can_reopen_support: true, support_conversation_id: 'CHAT1', messages: [
        { message_id: 'CLOSED1', sender: 'system', text: 'Support conversation closed.', created_at: new Date().toISOString() }
      ]
    });
    expect(service.humanChatActive()).toBe(false);
    expect(service.canReopenSupport()).toBe(true);
    service.returnToBot();
    http.expectOne(request => request.url.endsWith('/ai-chat/return-to-bot')).flush({
      status: 'ai_active', messages: [
        { message_id: 'BOT1', sender: 'system', text: 'You are now chatting with the chatbot.', created_at: new Date().toISOString() }
      ]
    });
    expect(service.canReopenSupport()).toBe(false);
  });
});
