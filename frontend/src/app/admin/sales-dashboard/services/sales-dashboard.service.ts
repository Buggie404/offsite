import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Orders created in the last 90 days (same window as the Orders page links), plus today's deliveries. */
export interface OrderStatusCounts {
  pending: number;
  processing: number;
  processing_over_24h: number;
  shipping: number;
  delivery_failed: number;
  pending_refund: number;
  delivered_today: number;
  refund_window_days: number;
}

export type SalesTaskType = 'orders' | 'refunds' | 'stock' | 'ritual_box';

export interface SalesTask {
  key: string;
  type: SalesTaskType;
  icon: 'package' | 'refund' | 'box' | 'card' | 'truck' | 'calendar';
  tone: 'danger' | 'warning' | 'info' | 'neutral';
  /** Items behind this row (feeds the filter pills and the header total) */
  count: number;
  overdue?: boolean;
  /** Red bar on the left: money or a customer is waiting */
  urgent?: boolean;
  title: string;
  detail: string;
  /** How the time chip reads: Overdue 7h · Waiting 22h · Due tomorrow · Today · Failed 3h ago */
  chip: 'overdue' | 'waiting' | 'due' | 'today' | 'since';
  since?: string;
  due_at: string;
  link: string;
  query?: Record<string, string> | null;
  /** Button on the row itself: "Mark refunded" for a cancelled QR order waiting for its payout. */
  action?: { type: 'mark_refund_paid'; order_id: string; enabled: boolean } | null;
}

export interface StockRow {
  product_id: number;
  sku: string;
  name: string;
  product_name: string;
  in_stock: number;
  ritual_box_due: number;
  avg_sold_per_day: number;
  /** 0 when out of stock */
  days_of_cover: number;
  needs_expiry: boolean;
  batch_expiry_date?: string | null;
}

export interface SalesDashboardData {
  updated_at: string;
  order_status: OrderStatusCounts;
  tasks: SalesTask[];
  stock: StockRow[];
}

@Injectable({ providedIn: 'root' })
export class SalesDashboardService {
  private readonly http = inject(HttpClient);

  getDashboard(): Observable<SalesDashboardData> {
    return this.http.get<SalesDashboardData>('/api/admin/sales-dashboard');
  }
}
