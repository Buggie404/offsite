import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServicesDashboardData {
  kpis: { chats_waiting: number; reports_to_review: number; restricted_customers: number; avg_first_response_ms: number };
  todos: { chats_waiting: number; reports_to_review: number; recipes_awaiting_approval: number; support_vouchers_issued_today: number };
}

@Injectable({ providedIn: 'root' })
export class ServicesDashboardService {
  private readonly http = inject(HttpClient);
  getDashboard(): Observable<ServicesDashboardData> { return this.http.get<ServicesDashboardData>('/api/admin/services-dashboard'); }
}
