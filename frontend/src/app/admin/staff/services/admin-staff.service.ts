import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminRole } from '../../../shared/models/admin-role.model';

export type StaffStatus = 'active' | 'disabled';

export interface StaffMember {
  user_id: string;
  email: string;
  profile_name: string;
  avatar_url: string | null;
  role: AdminRole;
  status: StaffStatus;
  disabled_reason: string | null;
  disabled_at: string | null;
  /** Still on the temporary password (never signed in since it was set) */
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

export interface StaffOpenWork {
  open_chats: number;
}

export interface NewStaff {
  profile_name: string;
  email: string;
  role: AdminRole;
}

/** temp_password is returned only once, right after create / reset */
export interface StaffWithPassword {
  data: StaffMember;
  temp_password: string;
}

@Injectable({ providedIn: 'root' })
export class AdminStaffService {
  private http = inject(HttpClient);
  private readonly api = '/api/admin/staff';

  list(q = ''): Observable<{ data: StaffMember[]; total: number }> {
    return this.http.get<{ data: StaffMember[]; total: number }>(this.api, { params: q ? { q } : {} });
  }

  create(payload: NewStaff): Observable<StaffWithPassword> {
    return this.http.post<StaffWithPassword>(this.api, payload);
  }

  getOpenWork(userId: string): Observable<{ data: StaffOpenWork }> {
    return this.http.get<{ data: StaffOpenWork }>(`${this.api}/${userId}/open-work`);
  }

  changeRole(userId: string, role: AdminRole): Observable<{ data: StaffMember; returned_chats: number }> {
    return this.http.patch<{ data: StaffMember; returned_chats: number }>(`${this.api}/${userId}/role`, { role });
  }

  setStatus(userId: string, status: StaffStatus, reason = ''): Observable<{ data: StaffMember; returned_chats: number }> {
    return this.http.patch<{ data: StaffMember; returned_chats: number }>(`${this.api}/${userId}/status`, { status, reason });
  }

  resetPassword(userId: string): Observable<StaffWithPassword> {
    return this.http.post<StaffWithPassword>(`${this.api}/${userId}/reset-password`, {});
  }
}
