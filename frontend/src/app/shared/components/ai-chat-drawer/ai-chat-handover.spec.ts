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
