import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface ChatConversation {
  conversation_id: string;
  customer_id: string;
  agent_id: string | null;
  status: 'bot' | 'waiting' | 'open' | 'closed';
  handoff_summary?: string;
  summary?: string;
  handover_reason?: string | null;
  ai_session_id?: string | null;
  last_message_preview: string;
  last_message_at: string;
  unread_agent: number;
  unread_customer: number;
  customer?: { user_id: string; profile_name: string; avatar_url: string | null; membership_tier: string } | null;
}

export interface ChatMessage {
  _id?: string;
  conversation_id: string;
  sender_type: 'customer' | 'agent' | 'bot' | 'system';
  sender_id: string | null;
  content: string;
  created_at: string;
}

export interface ChatTyping {
  conversation_id: string;
  user_id?: string;
  typing: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private socket: Socket | null = null;

  private messageSubject = new Subject<ChatMessage>();
  private conversationSubject = new Subject<ChatConversation>();
  private typingSubject = new Subject<ChatTyping>();
  private hintSubject = new Subject<string>();

  readonly message$ = this.messageSubject.asObservable();
  readonly conversation$ = this.conversationSubject.asObservable();
  readonly typing$ = this.typingSubject.asObservable();
  readonly listHint$ = this.hintSubject.asObservable();

  private readonly api = '/api/chat';

  // ── REST ──
  getMine() { return this.http.get<{ data: ChatConversation | null }>(`${this.api}/me`); }
  start() { return this.http.post<{ data: ChatConversation }>(`${this.api}/start`, {}); }
  list(status?: string) {
    return this.http.get<{ data: ChatConversation[] }>(`${this.api}/conversations${status ? '?status=' + status : ''}`);
  }
  messages(id: string) { return this.http.get<{ data: ChatMessage[] }>(`${this.api}/conversations/${id}/messages`); }
  claim(id: string) { return this.http.patch<{ data: ChatConversation }>(`${this.api}/conversations/${id}/claim`, {}); }
  close(id: string) { return this.http.patch<{ data: ChatConversation }>(`${this.api}/conversations/${id}/close`, {}); }

  // ── Socket ──
  connect(): void {
    if (!isPlatformBrowser(this.platformId) || this.socket) return;
    const { protocol, hostname, port, origin } = window.location;
    const url = port === '4200' ? `${protocol}//${hostname}:5000` : origin;
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('token') },
      reconnection: true
    });
    this.socket.on('chat_message', (m: ChatMessage) => this.messageSubject.next(m));
    this.socket.on('chat_handoff', (c: ChatConversation) => this.conversationSubject.next(c));
    this.socket.on('chat_updated', (c: ChatConversation) => this.conversationSubject.next(c));
    this.socket.on('chat_typing', (t: ChatTyping) => this.typingSubject.next(t));
    this.socket.on('chat_updated_hint', (h: { conversation_id: string }) => this.hintSubject.next(h.conversation_id));
    // Re-join rooms after a reconnect.
    this.socket.on('connect', () => this.rejoin());
  }

  private joined = new Set<string>();
  private asAgent = false;

  private rejoin(): void {
    if (this.asAgent) this.socket?.emit('join_chat_agents');
    this.joined.forEach(id => this.socket?.emit('join_chat', { conversation_id: id }));
  }

  joinAgents(): void { this.connect(); this.asAgent = true; this.socket?.emit('join_chat_agents'); }
  joinConversation(id: string): void {
    this.connect();
    this.joined.add(id);
    this.socket?.emit('join_chat', { conversation_id: id });
  }
  send(conversationId: string, content: string): void {
    this.socket?.emit('chat_message', { conversation_id: conversationId, content });
  }
  typing(conversationId: string, typing: boolean): void {
    this.socket?.emit('chat_typing', { conversation_id: conversationId, typing });
  }
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.joined.clear();
    this.asAgent = false;
  }
}
