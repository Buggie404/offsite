import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthService } from '../../admin/auth/services/admin-auth.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { ChatService } from './chat.service';
import { io } from 'socket.io-client';

vi.mock('socket.io-client', () => ({ io: vi.fn(() => ({
  on: vi.fn(), emit: vi.fn(), disconnect: vi.fn()
})) }));

describe('chat authentication with simultaneous customer and admin sessions', () => {
  let service: ChatService;
  let http: HttpTestingController;
  beforeEach(() => {
    localStorage.setItem('token', 'customer-token');
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
      { provide: AdminAuthService, useValue: { getToken: () => 'staff-token' } }
    ] });
    service = TestBed.inject(ChatService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    service.disconnect(); http.verify(); TestBed.resetTestingModule();
    localStorage.removeItem('token'); vi.clearAllMocks();
  });

  it('uses the staff token for the socket and every admin chat request', () => {
    service.joinAgents();
    const options = vi.mocked(io).mock.calls.at(-1)?.[1] as any;
    const authenticated = vi.fn();
    options.auth(authenticated);
    expect(authenticated).toHaveBeenCalledWith({ token: 'staff-token' });
    const calls = [service.list(), service.messages('CHAT1'), service.claim('CHAT1'),
      service.close('CHAT1'), service.receipt('CHAT1', 'seen', new Date().toISOString())];
    calls.forEach(call => call.subscribe());
    const requests = http.match(request => request.url.includes('/api/chat/'));
    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(request.request.headers.get('Authorization')).toBe('Bearer staff-token');
      request.flush({ data: [] });
    }
  });

  it('keeps customer REST and socket authentication on the customer session', () => {
    service.connect();
    const options = vi.mocked(io).mock.calls.at(-1)?.[1] as any;
    const authenticated = vi.fn();
    options.auth(authenticated);
    expect(authenticated).toHaveBeenCalledWith({ token: 'customer-token' });
    service.getMine().subscribe();
    const request = http.expectOne(request => request.url.endsWith('/api/chat/me'));
    expect(request.request.headers.get('Authorization')).toBe('Bearer customer-token');
    request.flush({ data: null });
  });
});
