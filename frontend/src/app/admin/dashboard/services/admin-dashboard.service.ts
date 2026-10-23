import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DashboardKpi { value: number; }
export interface DashboardData {
  kpis: { revenue: DashboardKpi; orders: DashboardKpi; aov: DashboardKpi; new_customers: DashboardKpi };
  revenue_series: { date: string; revenue: number }[];
  todos: {
    waiting_to_ship: number; refund_requests: number; reports_to_review: number; chats_waiting: number;
    low_stock_variants: number; ritual_box_payment_failed: number;
  };
}

export interface DashboardResponse extends Omit<DashboardData, 'todos'> {
  todos?: DashboardData['todos'];
}

@Injectable({ providedIn: 'root' })
export class AdminDashboardService {
  private readonly http = inject(HttpClient);

  getDashboard(start: Date, end: Date, timezone: string, includeTodos: boolean): Observable<DashboardResponse> {
    const params = new HttpParams()
      .set('start', start.toISOString())
      .set('end', end.toISOString())
      .set('timezone', timezone)
      .set('include_todos', String(includeTodos));
    return this.http.get<DashboardResponse>('/api/admin/dashboard', { params });
  }
}
