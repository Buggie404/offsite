import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/** % change vs the previous period; null when the previous period had nothing to compare to. */
export type Change = number | null;

export interface DashboardKpis {
  /** Net revenue: paid orders minus money given back; ritual_box_share in % */
  net_revenue: { value: number; previous: number; change_pct: Change; ritual_box_share: number; spark: number[] };
  orders: { value: number; previous: number; change_pct: Change; aov: number; aov_change_pct: Change; spark: number[] };
  /** change = new - cancelled in the period (absolute boxes) */
  active_boxes: { value: number; change: number; new: number; cancelled: number; spark: number[] };
  /** % of buyers with 2+ orders in the 90 days ending at the period end; change_pt in percentage points */
  repeat_customers: { value: number | null; previous: number | null; change_pt: Change; spark: number[] };
}

/** Day (or 7-day bucket on long ranges); previous = net revenue of the matching previous-period bucket. */
export interface RevenuePoint { date: string; one_time: number; ritual_box: number; previous: number; }

export interface TopProduct { product_id: string; name: string; revenue: number; refund_rate: number; rating: number | null; }

export interface ArchetypeStat {
  archetype_id: string;
  name: string;
  tagline: string;
  customers: number;
  /** % of ALL customers (those who never took the quiz are the remainder) */
  share: number;
  revenue_per_customer: number;
  repeat_rate: number | null;
  top_pick: string | null;
}

export type MembershipTier = 'Seed' | 'Leaf' | 'Bloom' | 'Zen';

export interface RetentionStats {
  ritual_box: { new: number; cancelled: number; churn_rate: number | null; payment_failed: number; suspended: number };
  tiers: { tier: MembershipTier; customers: number; revenue: number }[];
  referrals: { referred: number; first_order: number };
  brew_coach: { with_rate: number | null; without_rate: number | null };
}

/** Team backlog; independent of the selected period. */
export interface OpenWork {
  refunds_waiting: number;
  reports_to_review: number;
  chats_waiting: number;
  boxes_payment_failed: number;
  boxes_suspended: number;
  boxes_not_started: number;
  out_of_stock_variants: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  revenue_series: RevenuePoint[];
  top_products: TopProduct[];
  archetypes: ArchetypeStat[];
  ritual_dna_coverage: { customers: number; quiz_customers: number };
  retention: RetentionStats;
  open_work: OpenWork;
}

export interface DashboardResponse extends Omit<DashboardData, 'open_work'> {
  open_work?: OpenWork;
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
