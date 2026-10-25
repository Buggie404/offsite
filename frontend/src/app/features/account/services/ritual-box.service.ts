import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export type SubscriptionStatus =
  | 'active'
  | 'paused'
  | 'payment_failed'
  | 'suspended'
  | 'cancelled'
  | 'cancelled_by_admin';
export type PauseOption = '1_month' | '2_months' | 'until_reactivated';
export type SubscriptionAction =
  | 'skip'
  | 'pause'
  | 'resume'
  | 'frequency'
  | 'payment_method'
  | 'reactivate'
  | 'use_replacement'
  | 'accept_adjustment'
  | 'dismiss_adjustment'
  | 'accept_proposal'
  | 'decline_proposal'
  | 'cancel';

export interface RitualCard {
  id: string;
  card_type: 'NAPAS' | 'credit' | 'debit';
  issued_bank: string | null;
  last4: string;
  expire_date: string;
  is_default: boolean;
  is_expired: boolean;
}

export interface RitualReplacement {
  product_id: string;
  variant_id: string;
  name: string;
  variant_label: string;
  image: string | null;
  price: number;
  same_price: boolean;
}

export interface RitualSubscription {
  subscription_id: string;
  product_id: string;
  variant_id: string;
  product_name: string;
  product_slug: string | null;
  variant_label: string;
  image: string | null;
  quantity: number;
  frequency_days: 7 | 14 | 30;
  /** One charge = one delivery. */
  next_charge_at: string;
  status: SubscriptionStatus;
  /** Within 48h of next_charge_at: frequency / skip / pause apply from the following cycle. */
  is_locked: boolean;
  pending_changes: { frequency_days: number | null; skip: boolean; pause_option: PauseOption | null } | null;
  consecutive_skips: number;
  can_skip: boolean;
  pause_option: PauseOption | null;
  paused_at: string | null;
  resume_at: string | null;
  failed_attempts: number;
  last_failed_at: string | null;
  last_failure_reason: string | null;
  pricing: {
    original_price: number;
    subscribe_price: number;
    discount_percent: number;
    total: number;
  };
  payment_method: RitualCard | null;
  out_of_stock: boolean;
  out_of_stock_deadline: string | null;
  replacement: RitualReplacement | null;
  /** Smart adjustment: bring the next box forward one step (30 → 14 → 7) if confirmed. */
  suggestion: { frequency_days: number; next_charge_at: string; expires_at: string } | null;
  /** Change suggested by Offsite staff; nothing happens unless the customer accepts it. */
  admin_proposal: {
    type: 'frequency' | 'resume';
    frequency_days: number | null;
    message: string;
    expires_at: string;
  } | null;
  /** Who paused the box — 'admin' when staff paused it (e.g. out of stock). */
  paused_by: 'customer' | 'admin' | null;
}

export interface RitualHistoryRow {
  date: string;
  box: string;
  order_id: string | null;
  amount: number | null;
  status:
    | 'processing'
    | 'shipping'
    | 'delivered'
    | 'skipped'
    | 'failed'
    | 'cancelled'
    | 'refund'
    | 'subscription_cancelled'
    | 'cancelled_by_admin';
  /** e.g. the reason given when the subscription was cancelled. */
  note?: string | null;
}

export interface RitualBoxData {
  subscriptions: RitualSubscription[];
  history: RitualHistoryRow[];
  payment_methods: RitualCard[];
}

/** Ritual Box (Subscribe & Save) state shared by the account sidebar and the Ritual Box tab. */
@Injectable({ providedIn: 'root' })
export class RitualBoxService {
  private http = inject(HttpClient);

  readonly data = signal<RitualBoxData | null>(null);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  /** A box needs the user's attention: failed payment, suspended, or an out-of-stock item. */
  readonly needsAttention = computed(() =>
    (this.data()?.subscriptions ?? []).some(
      s => s.status === 'payment_failed' || s.status === 'suspended' || s.out_of_stock
    )
  );

  load(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.http.get<RitualBoxData>('/api/subscriptions').subscribe({
      next: data => {
        this.data.set(data);
        this.isLoading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.error || 'Could not load your Ritual Box. Please try again.');
        this.isLoading.set(false);
      }
    });
  }

  act(subscriptionId: string, action: SubscriptionAction, payload: Record<string, unknown> = {}): Observable<RitualBoxData> {
    return this.http
      .patch<RitualBoxData>(`/api/subscriptions/${encodeURIComponent(subscriptionId)}`, { action, ...payload })
      .pipe(tap(data => this.data.set(data)));
  }

  reset(): void {
    this.data.set(null);
    this.error.set(null);
  }
}
