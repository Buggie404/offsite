import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type VoucherKind = 'discount' | 'shipping';
export type DiscountKind = 'percentage' | 'fixed';
export type VoucherStatus = 'active' | 'upcoming' | 'expired' | 'inactive';
export type VoucherTier = 'seed' | 'leaf' | 'bloom' | 'zen';

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
  purpose: string;
  assigned_user_id: string | null;
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
  purpose?: 'campaign' | 'complaint';
  assigned_user_id?: string;
  related_ref?: string;
  reason?: string;
}

export interface VoucherBucket {
  start: string;
  end: string;
  count: number;
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

  list(): Observable<{ data: AdminVoucher[]; total: number }> {
    return this.http.get<{ data: AdminVoucher[]; total: number }>(this.api);
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
