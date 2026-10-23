import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SalesDashboardData {
  kpis: { orders_to_ship: number; refund_requests: number; low_stock_variants: number; active_vouchers: number };
  todos: { orders_to_ship: number; refund_requests: number; reports_to_review: number; chats_waiting: number; low_stock_variants: number; ritual_box_payment_failed: number };
}

@Injectable({ providedIn: 'root' })
export class SalesDashboardService {
  private readonly http = inject(HttpClient);

  getDashboard(start: Date, end: Date, timezone: string): Observable<SalesDashboardData> {
    return this.http.get<SalesDashboardData>('/api/admin/sales-dashboard', {
      params: { start: start.toISOString(), end: end.toISOString(), timezone }
    });
  }
}
