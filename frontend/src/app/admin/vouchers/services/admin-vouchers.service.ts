import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type VoucherKind = 'discount' | 'shipping';
export type DiscountKind = 'percentage' | 'fixed';
export type VoucherStatus = 'active' | 'upcoming' | 'expired' | 'inactive';
export type VoucherTier = 'seed' | 'leaf' | 'bloom' | 'zen';
export type VoucherPurpose = 'campaign' | 'loyalty_redeem' | 'referral' | 'complaint';
export type VoucherScope = 'all' | 'category' | 'product';

export interface ScopeProduct {
  _id: string;
  name: string;
  category: string;
  sku: string;
  price: number;
  is_active: boolean;
}

export interface ComplaintOrder {
  order_id: string;
  user_id: string;
  total: number;
}

export interface ComplaintQuota {
  limit: number | null;
  used: number;
  left: number | null;
}

export interface AdminVoucher {
  _id: string;
  code: string;
  voucher_type: VoucherKind;
  discount_type: DiscountKind;
  discount_value: number;
  min_order_amount: number;
  max_discount_value: number | null;
  usage_limit: number | null;
  usage_limit_per_user: number | null;
  used_count: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  target_tier: VoucherTier | null;
  applies_to: VoucherScope;
  applicable_categories: string[];
  applicable_product_ids: string[];
  related_ref: string | null;
  points_cost: number | null;
  source_voucher_id: string | null;
  purpose: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  status: VoucherStatus;
}

export interface VoucherPayload {
  code: string;
  voucher_type: VoucherKind;
  discount_type: DiscountKind;
  discount_value: number | null;
  min_order_amount: number | null;
  max_discount_value: number | null;
  valid_from: string;
  valid_to: string;
  usage_limit: number | null;
  target_tier: VoucherTier | null;
  purpose?: VoucherPurpose;
  applies_to?: VoucherScope;
  applicable_categories?: string[] | null;
  applicable_product_ids?: string[] | null;
  usage_limit_per_user?: number | null;
  points_cost?: number | null;
  assigned_user_id?: string;
  related_ref?: string;
  reason?: string;
  message?: string;
}

export interface VoucherListQuery {
  page: number;
  q: string;
  status: string;
  type: string;
  purpose: string;
}

export interface CustomerSuggestion {
  user_id: string;
  profile_name: string;
  email: string;
}

export interface VoucherBucket {
  start: string;
  end: string;
  count: number;
  discounted?: number;
  revenue?: number;
}

export interface VoucherPerformance {
  code: string;
  used_count: number;
  usage_limit: number | null;
  times_used: number;
  total_discounted: number;
  revenue: number;
  range_from: string;
  range_to: string;
  buckets: VoucherBucket[];
}

@Injectable({ providedIn: 'root' })
export class AdminVouchersService {
  private http = inject(HttpClient);
  private readonly api = '/api/admin/vouchers';

  list(query: VoucherListQuery): Observable<{ data: AdminVoucher[]; total: number; page: number; limit: number; performance: VoucherPerformance | null }> {
    const params: Record<string, string> = {
      page: String(query.page),
      limit: '20'
    };
    if (query.q) params['q'] = query.q;
    if (query.status) params['status'] = query.status;
    if (query.type) params['type'] = query.type;
    if (query.purpose) params['purpose'] = query.purpose;
    return this.http.get<{ data: AdminVoucher[]; total: number; page: number; limit: number; performance: VoucherPerformance | null }>(this.api, { params });
  }

  searchCustomers(q: string): Observable<{ data: CustomerSuggestion[] }> {
    return this.http.get<{ data: CustomerSuggestion[] }>(`${this.api}/customers`, { params: { q } });
  }

  searchProducts(q: string): Observable<{ data: ScopeProduct[] }> {
    return this.http.get<{ data: ScopeProduct[] }>(`${this.api}/products`, { params: { q } });
  }

  productsByIds(ids: string[]): Observable<{ data: ScopeProduct[] }> {
    return this.http.get<{ data: ScopeProduct[] }>(`${this.api}/products`, { params: { ids: ids.join(',') } });
  }

  codeAvailable(code: string): Observable<{ data: { available: boolean } }> {
    return this.http.get<{ data: { available: boolean } }>(`${this.api}/code-available`, { params: { code } });
  }

  complaintOrder(orderId: string, userId: string): Observable<{ data: ComplaintOrder }> {
    return this.http.get<{ data: ComplaintOrder }>(`${this.api}/complaint-order`, { params: { order_id: orderId, user_id: userId } });
  }

  complaintQuota(): Observable<{ data: ComplaintQuota }> {
    return this.http.get<{ data: ComplaintQuota }>(`${this.api}/complaint-quota`);
  }

  performance(id: string): Observable<{ data: VoucherPerformance }> {
    return this.http.get<{ data: VoucherPerformance }>(`${this.api}/${encodeURIComponent(id)}/performance`);
  }

  create(payload: VoucherPayload): Observable<{ data: AdminVoucher }> {
    return this.http.post<{ data: AdminVoucher }>(this.api, payload);
  }

  update(id: string, payload: VoucherPayload): Observable<{ data: AdminVoucher }> {
    return this.http.patch<{ data: AdminVoucher }>(`${this.api}/${encodeURIComponent(id)}`, payload);
  }

  stop(id: string): Observable<{ data: AdminVoucher }> {
    return this.http.patch<{ data: AdminVoucher }>(`${this.api}/${encodeURIComponent(id)}/stop`, {});
  }
}
