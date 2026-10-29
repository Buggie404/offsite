import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminRole } from '../../../shared/models/admin-role.model';

export interface ActivityLogEntry {
  log_id: string;
  created_at: string;
  action_type: string;
  target_entity: string;
  target_id: string;
  /** Name / @handle when the target is a user (staff or customer) */
  target_label: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  ticket_id: string | null;
  actor: {
    id: string;
    user_id: string | null;
    name: string;
    email: string | null;
    /** Role at the time of the action */
    role: AdminRole;
  };
}

export interface ActivityLogFacets {
  action_types: string[];
  actors: { user_id: string; name: string }[];
}

export interface ActivityLogQuery {
  page: number;
  limit: number;
  q?: string;
  admin_id?: string;
  admin_role?: string;
  action_type?: string;
  from?: string;
  to?: string;
}

export interface ActivityLogPage {
  total: number;
  page: number;
  limit: number;
  data: ActivityLogEntry[];
  facets?: ActivityLogFacets;
  unsaved_count: number;
}

@Injectable({ providedIn: 'root' })
export class AdminActivityLogService {
  private http = inject(HttpClient);
  private readonly api = '/api/admin/activity-logs';

  list(query: ActivityLogQuery, includeFacets = false): Observable<ActivityLogPage> {
    return this.http.get<ActivityLogPage>(this.api, { params: this.params(query, includeFacets) });
  }

  exportCsv(query: ActivityLogQuery): Observable<Blob> {
    return this.http.get(`${this.api}/export`, { params: this.params(query, false), responseType: 'blob' });
  }

  private params(query: ActivityLogQuery, includeFacets: boolean): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params[key] = String(value);
    }
    if (includeFacets) params['include_facets'] = 'true';
    return params;
  }
}
