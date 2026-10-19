import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AdminSubscriptionAction,
  AdminSubscriptionDetail,
  AdminSubscriptionFilter,
  AdminSubscriptionsResponse
} from '../models/admin-subscription.model';

@Injectable({
  providedIn: 'root'
})
export class AdminSubscriptionService {
  private http = inject(HttpClient);
  private readonly baseUrl = '/api/admin/subscriptions';

  getSubscriptions(status: AdminSubscriptionFilter, search = ''): Observable<AdminSubscriptionsResponse> {
    let params = new HttpParams();
    if (status !== 'all') params = params.set('status', status);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<AdminSubscriptionsResponse>(this.baseUrl, { params });
  }

  getSubscription(id: string): Observable<{ data: AdminSubscriptionDetail }> {
    return this.http.get<{ data: AdminSubscriptionDetail }>(`${this.baseUrl}/${encodeURIComponent(id)}`);
  }

  runAction(
    id: string,
    action: AdminSubscriptionAction,
    payload: Record<string, unknown> = {}
  ): Observable<{ data: AdminSubscriptionDetail }> {
    return this.http.post<{ data: AdminSubscriptionDetail }>(
      `${this.baseUrl}/${encodeURIComponent(id)}/${action}`,
      payload
    );
  }
}
