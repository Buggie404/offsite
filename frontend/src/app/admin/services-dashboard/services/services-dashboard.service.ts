import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type TaskType = 'reports' | 'recipes' | 'messages';

export interface ChatQueueItem {
  conversation_id: string;
  customer_name: string;
  avatar_url: string | null;
  tier: string | null;
  summary: string;
  reason: string | null;
  waiting_since: string;
  /** Waiting 5 minutes or more */
  overdue: boolean;
}

export interface DashboardTask {
  key: string;
  type: TaskType;
  count: number;
  title: string;
  detail: string;
  since: string;
  /** Admin page to open, or an email to write for contact messages */
  link?: string;
  mailto?: string;
  action: string;
}

export interface ServicesDashboardData {
  chat: { waiting: number; my_open: number; queue: ChatQueueItem[] };
  tasks: DashboardTask[];
  counts: Record<TaskType, number>;
  support_vouchers_issued_today: number;
}

@Injectable({ providedIn: 'root' })
export class ServicesDashboardService {
  private readonly http = inject(HttpClient);
  getDashboard(): Observable<ServicesDashboardData> { return this.http.get<ServicesDashboardData>('/api/admin/services-dashboard'); }
}
