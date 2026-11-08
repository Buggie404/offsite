import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminRole } from '../../../shared/models/admin-role.model';

export type CustomerTier = 'Seed' | 'Leaf' | 'Bloom' | 'Zen';
export type CustomerStatus = 'active' | 'suspended';
export type CustomerStatusFilter = CustomerStatus | 'restricted' | '';

export interface CustomerRow {
  user_id: string;
  profile_name: string;
  community_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  membership_tier: CustomerTier;
  points: number;
  status: CustomerStatus;
  suspended_reason: string | null;
  suspended_at: string | null;
  /** Community restriction still running; status stays 'active' because the customer can sign in */
  restricted_until: string | null;
  restricted_reason: string | null;
  created_at: string | null;
  order_count: number;
  last_order_at: string | null;
  last_chat_at?: string | null;
  last_chat_status?: string | null;
  open_reports?: number;
  handled_reports?: number;
}

export interface CustomerOrder {
  order_id: string;
  created_at: string;
  item_count: number;
  total: number;
  status: string;
}

export interface CustomerNote {
  note_id: string;
  content: string;
  author_name: string | null;
  author_role: AdminRole;
  created_at: string;
}

export interface CustomerDetail extends CustomerRow {
  can_add_note?: boolean;
  ritual_dna?: string | null;
  violation_level?: number;
  past_chats?: number;
  vouchers: { code: string; title: string | null; discount_type: string; discount_value: number; is_active: boolean; valid_to: string; used_count: number; usage_limit: number | null }[];
  violations: { reason: string; level: number; created_at: string }[];
  total_spent: number;
  ritual_boxes: number;
  notes: CustomerNote[];
}

export interface CustomerListQuery {
  page: number;
  q?: string;
  tier?: CustomerTier | '';
  status?: CustomerStatusFilter;
}

export interface CustomerConversation {
  conversation_id: string;
  status: 'bot' | 'waiting' | 'open' | 'closed';
  last_message_at: string;
  last_message_preview: string;
  summary: string;
  close_outcome: string | null;
  agent_name: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminCustomersService {
  private http = inject(HttpClient);
  private readonly api = '/api/admin/customers';

  list(query: CustomerListQuery): Observable<{ data: CustomerRow[]; total: number; page: number; limit: number }> {
    const params: Record<string, string> = { page: String(query.page) };
    if (query.q) params['q'] = query.q;
    if (query.tier) params['tier'] = query.tier;
    if (query.status) params['status'] = query.status;
    return this.http.get<{ data: CustomerRow[]; total: number; page: number; limit: number }>(this.api, { params });
  }

  get(userId: string): Observable<{ data: CustomerDetail }> {
    return this.http.get<{ data: CustomerDetail }>(`${this.api}/${encodeURIComponent(userId)}`);
  }

  orders(userId: string, page: number): Observable<{ data: CustomerOrder[]; total: number; page: number; limit: number }> {
    return this.http.get<{ data: CustomerOrder[]; total: number; page: number; limit: number }>(
      `${this.api}/${encodeURIComponent(userId)}/orders`, { params: { page: String(page) } }
    );
  }

  addNote(userId: string, content: string): Observable<{ data: CustomerNote }> {
    return this.http.post<{ data: CustomerNote }>(`${this.api}/${encodeURIComponent(userId)}/notes`, { content });
  }

  conversations(userId: string): Observable<{ data: CustomerConversation[] }> {
    return this.http.get<{ data: CustomerConversation[] }>(`${this.api}/${encodeURIComponent(userId)}/conversations`);
  }

  conversationMessages(userId: string, conversationId: string) {
    return this.http.get<{ data: import('../../../core/services/chat.service').ChatMessage[] }>(`${this.api}/${encodeURIComponent(userId)}/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  setStatus(userId: string, status: CustomerStatus, reason = ''): Observable<{ data: CustomerRow }> {
    return this.http.patch<{ data: CustomerRow }>(`${this.api}/${encodeURIComponent(userId)}/status`, { status, reason });
  }
}
