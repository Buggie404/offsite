import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AdminOrdersQuery,
  AdminOrdersResponse
} from '../models/admin-order.model';

@Injectable({
  providedIn: 'root'
})
export class AdminOrderService {
  private http = inject(HttpClient);
  private readonly baseUrl = '/api/admin/orders';

  getOrders(query: AdminOrdersQuery = {}): Observable<AdminOrdersResponse> {
    let params = new HttpParams();

    if (query.order_status && query.order_status !== 'all') {
      params = params.set('order_status', query.order_status);
    }
    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }
    if (query.date_range) {
      params = params.set('date_range', query.date_range);
    }
    if (query.date_range === 'custom' && query.date_from && query.date_to) {
      params = params.set('date_from', query.date_from);
      params = params.set('date_to', query.date_to);
    }
    if (query.page) {
      params = params.set('page', String(query.page));
    }
    if (query.limit) {
      params = params.set('limit', String(query.limit));
    }

    return this.http.get<AdminOrdersResponse>(this.baseUrl, { params });
  }
}
