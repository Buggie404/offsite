import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminRole } from '../../../shared/models/admin-role.model';

export type CustomerTier = 'Seed' | 'Leaf' | 'Bloom' | 'Zen';
export type CustomerStatus = 'active' | 'suspended';

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
  created_at: string | null;
  order_count: number;
  last_order_at: string | null;
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
  total_spent: number;
  ritual_boxes: number;
  recent_orders: CustomerOrder[];
  notes: CustomerNote[];
}

export interface CustomerListQuery {
  page: number;
  q?: string;
  tier?: CustomerTier | '';
  status?: CustomerStatus | '';
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

  addNote(userId: string, content: string): Observable<{ data: CustomerNote }> {
    return this.http.post<{ data: CustomerNote }>(`${this.api}/${encodeURIComponent(userId)}/notes`, { content });
  }

  setStatus(userId: string, status: CustomerStatus, reason = ''): Observable<{ data: CustomerRow }> {
    return this.http.patch<{ data: CustomerRow }>(`${this.api}/${encodeURIComponent(userId)}/status`, { status, reason });
  }
}
