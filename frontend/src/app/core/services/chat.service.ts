import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AdminAuthService } from '../../admin/auth/services/admin-auth.service';

export interface ChatConversation {
  created_at?: string;
  conversation_id: string;
  customer_id: string;
  agent_id: string | null;
  agent_name?: string | null;
  agent_user_id?: string | null;
  status: 'bot' | 'waiting' | 'open' | 'closed';
  handoff_summary?: string;
  summary?: string;
  handover_reason?: string | null;
  /** Order the customer opened the chat from ("Chat with a human" on the order page). */
  context_order_id?: string | null;
  ai_session_id?: string | null;
  dify_conversation_id?: string | null;
  response_warning?: 'waiting_reply' | 'overdue' | null;
  waiting_on?: 'customer' | 'agent';
  close_reason?: 'resolved' | 'idle' | 'return_to_bot' | null;
  closed_at?: string | null;
  claimed_at?: string | null;
  closed_by_name?: string | null;
  close_outcome?: 'resolved' | 'forwarded' | 'no_response' | 'spam' | null;
  transfers?: { from_agent_id: string; to_agent_id: string; note: string; at: string }[];
  last_message_preview: string;
  last_message_at: string;
  unread_agent: number;
  unread_customer: number;
  customer?: { user_id: string; profile_name: string; avatar_url: string | null; membership_tier: string } | null;
}

export interface ChatMessage {
  _id?: string;
  source_session_id?: string | null;
  source_message_id?: string | null;
  conversation_id: string;
  sender_type: 'customer' | 'agent' | 'bot' | 'system';
  sender_id: string | null;
  content: string;
  created_at: string;
  metadata?: {
    orderCard?: ChatOrderSnapshot | null;
    orders?: ChatOrderSnapshot[];
  } | null;
}

export interface ChatOrderSnapshot {
  code?: string;
  order_id?: string;
  order_status?: string;
  total_amount?: number;
  image_url?: string | null;
  imageUrl?: string;
  item_count?: number;
  items?: { quantity?: number }[];
  status?: string;
  total?: number;
  currency?: string;
}

export interface ChatTyping {
  conversation_id: string;
  user_id?: string;
  typing: boolean;
}

export interface ChatAgent {
  user_id: string;
  name: string;
  online?: boolean;
  active_chats?: number;
  available?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private adminAuth = inject(AdminAuthService);
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
  private requestOptions() {
    const token = this.asAgent ? this.adminAuth.getToken() : null;
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  }

  // ── REST ──
  getMine() { return this.http.get<{ data: ChatConversation | null }>(`${this.api}/me`); }
  start() { return this.http.post<{ data: ChatConversation }>(`${this.api}/start`, {}); }
  list(status?: string) {
    return this.http.get<{ data: ChatConversation[]; support_open?: boolean; support_hours?: string }>(`${this.api}/conversations${status ? '?status=' + status : ''}`, this.requestOptions());
  }
  agents() { return this.http.get<{ data: ChatAgent[] }>(`${this.api}/agents`, this.requestOptions()); }
  transfer(id: string, agent_id: string, note: string) {
    return this.http.patch<{ data: ChatConversation }>(`${this.api}/conversations/${id}/transfer`, { agent_id, note }, this.requestOptions());
  }
  messages(id: string) { return this.http.get<{ data: ChatMessage[] }>(`${this.api}/conversations/${id}/messages`, this.requestOptions()); }
  claim(id: string) { return this.http.patch<{ data: ChatConversation }>(`${this.api}/conversations/${id}/claim`, {}, this.requestOptions()); }
  shareOrder(id: string, order_id: string) { return this.http.post<{ data: ChatMessage | null }>(`${this.api}/conversations/${id}/order-card`, { order_id }, this.requestOptions()); }
  reportCustomer(userId: string, reason: string, note: string) {
    const token = this.adminAuth.getToken();
    return this.http.post(`/api/profiles/${encodeURIComponent(userId)}/report`, { reason, note }, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  }
  receipt(id: string, status: 'delivered' | 'seen', through: string) {
    return this.http.post(`${this.api}/conversations/${id}/receipt`, { status, through }, this.requestOptions());
  }
  close(id: string, options: { outcome: string; summary: string; send_closing_message: boolean } = { outcome: 'resolved', summary: '', send_closing_message: true }) { return this.http.patch<{ data: ChatConversation }>(`${this.api}/conversations/${id}/close`, options, this.requestOptions()); }

  // ── Socket ──
  connect(): void {
    if (!isPlatformBrowser(this.platformId) || this.socket) return;
    const { protocol, hostname, port, origin } = window.location;
    const url = port === '4200' ? `${protocol}//${hostname}:5000` : origin;
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      auth: callback => callback({ token: this.asAgent ? this.adminAuth.getToken() : localStorage.getItem('token') }),
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

  joinAgents(): void {
    if (!this.asAgent && this.socket) this.disconnect();
    this.asAgent = true;
    this.connect();
    this.socket?.emit('join_chat_agents');
  }
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
