import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideDownload, LucideEye, LucideChevronDown, LucideCalendar, LucideAlertTriangle } from '@lucide/angular';
import { Subject, catchError, distinctUntilChanged, interval, map, of, switchMap } from 'rxjs';
import { AdminOrderService } from '../../services/admin-order.service';
import { AdminRefreshService } from '../../../shared/services/admin-refresh.service';
import { OrderSocketService } from '../../../../core/services/order-socket.service';
import {
  AdminDateRange,
  AdminOrderAttentionFilter,
  AdminOrderAttentionReason,
  AdminOrderListItem,
  AdminOrderStats,
  AdminOrderStatusFilter,
  AdminOrderTypeFilter,
  AdminOrdersResponse
} from '../../models/admin-order.model';

interface StatusFilterOption {
  value: AdminOrderStatusFilter;
  label: string;
}

/** Stat cards double as filters: Total clears them, the others apply their own. */
type StatCardKey = 'total' | 'processing' | 'shipping' | 'attention';

/** Everything the table is filtered by; mirrored in the URL (?status=&type=&attention=&date=&from=&to=). */
interface ListFilters {
  search: string;
  status: AdminOrderStatusFilter;
  type: AdminOrderTypeFilter;
  attention: AdminOrderAttentionFilter;
  date: AdminDateRange;
  from: string;
  to: string;
}

const DATE_RANGES: readonly AdminDateRange[] = ['today', '7', '30', '90', 'custom'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ATTENTION_REASON_LABEL: Record<AdminOrderAttentionReason, string> = {
  pending_refund: 'Refund requested',
  delivery_failed: 'Delivery failed',
  urgent_preparation: 'Urgent preparation',
  ritual_box_not_started: 'Ritual Box not started'
};

import { ORDER_TYPE_LABEL } from '../../../../shared/utils/order-type';
import { OrderTypeBadgeComponent } from '../../../../shared/components/order-type-badge/order-type-badge.component';
@Component({
  selector: 'app-orders-listing',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideDownload, LucideEye, LucideChevronDown, LucideCalendar, LucideAlertTriangle, OrderTypeBadgeComponent],
  templateUrl: './orders-listing.component.html',
  styleUrl: './orders-listing.component.scss'
})
export class OrdersListingComponent implements OnInit {
  private adminOrderService = inject(AdminOrderService);
  private adminRefresh = inject(AdminRefreshService);
  private orderSocketService = inject(OrderSocketService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private readonly loadTrigger$ = new Subject<{ silent?: boolean }>();
  private readonly pollIntervalMs = 20_000;

  orders: AdminOrderListItem[] = [];
  stats: AdminOrderStats = { total: 0, processing: 0, shipped: 0, needsAttention: 0 };
  loading = true;
  loadingMore = false;
  error: string | null = null;
  /** Orders matching the filters on the server; the table shows them a page at a time. */
  totalOrders = 0;
  private readonly pageSize = 50;

  activeStatus: AdminOrderStatusFilter = 'all';
  orderType: AdminOrderTypeFilter = 'all';
  attention: AdminOrderAttentionFilter = 'all';
  dateRange: AdminDateRange = '30';
  search = '';

  showCustomRange = false;
  customDateFrom = '';
  customDateTo = '';
  appliedCustomFrom = '';
  appliedCustomTo = '';
  customRangeError: string | null = null;
  private previousDateRange: AdminDateRange = '30';

  readonly maxDate = new Date().toISOString().slice(0, 10);

  readonly statusFilters: StatusFilterOption[] = [
    { value: 'all', label: 'All statuses' },
    { value: 'processing', label: 'Processing' },
    { value: 'shipping', label: 'Shipping' },
    { value: 'delivery_failed', label: 'Delivery Failed' },
    { value: 'redelivery_awaiting', label: 'Waiting for customer to confirm' },
    { value: 'redelivery_confirmed', label: 'Customer confirmed, ship again' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'pending_refund', label: 'Pending Refund' },
    { value: 'refund', label: 'Refund' },
    { value: 'refund_rejected', label: 'Refund Rejected' }
  ];

  readonly orderTypeOptions: { value: AdminOrderTypeFilter; label: string }[] = [
    { value: 'all', label: 'All types' },
    { value: 'one_time', label: ORDER_TYPE_LABEL.one_time },
    { value: 'subscription', label: ORDER_TYPE_LABEL.subscription },
    { value: 'mixed', label: ORDER_TYPE_LABEL.mixed }
  ];

  readonly attentionOptions: { value: AdminOrderAttentionFilter; label: string }[] = [
    { value: 'all', label: 'All orders' },
    { value: 'needs_attention', label: 'Needs attention' },
    { value: 'ritual_box_not_started', label: 'Ritual Box not started' }
  ];

  private toAttentionFilter(value: unknown): AdminOrderAttentionFilter {
    return this.attentionOptions.find(o => o.value === value)?.value ?? 'all';
  }

  private toOrderTypeFilter(value: unknown): AdminOrderTypeFilter {
    return this.orderTypeOptions.find(o => o.value === value)?.value ?? 'all';
  }

  /** Unknown or removed filters (e.g. an old ?status=cancelled link) fall back to All. */
  private toStatusFilter(value: unknown): AdminOrderStatusFilter {
    return this.statusFilters.find(f => f.value === value)?.value ?? 'all';
  }

  ngOnInit(): void {
    this.applyFilterState(this.readFilters(this.route.snapshot.queryParams));

    this.loadTrigger$
      .pipe(
        switchMap((options) => {
          if (!options?.silent) {
            this.loading = true;
            this.error = null;
          }

          // A silent refresh keeps the pages already loaded; a new filter starts at page 1.
          const limit = options?.silent
            ? Math.max(this.pageSize, Math.ceil(this.orders.length / this.pageSize) * this.pageSize)
            : this.pageSize;
          return this.adminOrderService
            .getOrders({ ...this.currentQuery(), page: 1, limit })
            .pipe(
              catchError(() => {
                this.error = 'Failed to load orders. Please try again.';
                return of(null);
              })
            );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response: AdminOrdersResponse | null) => {
        if (response) {
          this.orders = response.data;
          this.stats = response.stats;
          this.totalOrders = response.total;
        }
        this.loading = false;
        this.cdr.markForCheck();
      });

    // Header search, stat cards, back / forward and shared links all arrive through the URL.
    this.route.queryParams
      .pipe(
        map((params) => this.readFilters(params)),
        distinctUntilChanged((a, b) => this.sameFilters(a, b)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((next) => {
        if (this.sameFilters(next, this.currentFilters())) return;
        this.applyFilterState(next);
        this.loadTrigger$.next({});
      });

    this.adminRefresh.onOrdersListRefresh$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadTrigger$.next({ silent: true }));

    this.orderSocketService.joinAdminRoom();
    this.orderSocketService.orderUpdated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadTrigger$.next({ silent: true }));

    interval(this.pollIntervalMs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (typeof document !== 'undefined' && !document.hidden) {
          this.loadTrigger$.next({ silent: true });
        }
      });

    this.loadTrigger$.next({});
  }

  setStatusFilter(value: string): void {
    this.updateFilters({ status: this.toStatusFilter(value) });
  }

  setOrderType(value: string): void {
    this.updateFilters({ type: this.toOrderTypeFilter(value) });
  }

  /** Filter-row button: all urgent orders on / off (also clears the Ritual Box-only view). */
  toggleNeedsAttention(): void {
    this.updateFilters({ attention: this.attention === 'all' ? 'needs_attention' : 'all' });
  }

  isStatActive(card: StatCardKey): boolean {
    switch (card) {
      case 'total': return this.activeStatus === 'all' && this.attention === 'all';
      case 'processing': return this.activeStatus === 'processing';
      case 'shipping': return this.activeStatus === 'shipping';
      case 'attention': return this.attention !== 'all';
    }
  }

  /** Clicking a card applies its filter; clicking the active card again removes it. */
  toggleStat(card: StatCardKey): void {
    const active = this.isStatActive(card);
    switch (card) {
      case 'total':
        this.updateFilters({ status: 'all', attention: 'all' });
        break;
      case 'processing':
      case 'shipping':
        this.updateFilters(active ? { status: 'all' } : { status: card, attention: 'all' });
        break;
      case 'attention':
        this.updateFilters(active ? { attention: 'all' } : { attention: 'needs_attention', status: 'all' });
        break;
    }
  }

  isUrgent(order: AdminOrderListItem): boolean {
    return order.needs_attention ?? this.attentionReasons(order).length > 0;
  }

  attentionReasons(order: AdminOrderListItem): AdminOrderAttentionReason[] {
    return order.attention_reasons ?? (order.subscription_start_failed ? ['ritual_box_not_started'] : []);
  }

  attentionReasonLabel(reason: AdminOrderAttentionReason): string {
    return ATTENTION_REASON_LABEL[reason] ?? reason;
  }

  get customRangeOptionLabel(): string {
    return this.dateRange === 'custom' && this.appliedCustomFrom && this.appliedCustomTo
      ? `${this.formatInputDate(this.appliedCustomFrom)} – ${this.formatInputDate(this.appliedCustomTo)}`
      : 'Custom range';
  }

  private currentFilters(): ListFilters {
    return {
      search: this.search,
      status: this.activeStatus,
      type: this.orderType,
      attention: this.attention,
      date: this.dateRange === 'custom' && !(this.appliedCustomFrom && this.appliedCustomTo)
        ? this.previousDateRange
        : this.dateRange,
      from: this.dateRange === 'custom' ? this.appliedCustomFrom : '',
      to: this.dateRange === 'custom' ? this.appliedCustomTo : ''
    };
  }

  /** Unknown values (e.g. an old ?status=cancelled link) fall back to the defaults. */
  private readFilters(params: Record<string, unknown>): ListFilters {
    const from = ISO_DATE.test(String(params['from'] ?? '')) ? String(params['from']) : '';
    const to = ISO_DATE.test(String(params['to'] ?? '')) ? String(params['to']) : '';
    let date = (DATE_RANGES as readonly unknown[]).includes(params['date']) ? params['date'] as AdminDateRange : '30';
    if (date === 'custom' && !(from && to && from <= to)) date = '30';
    return {
      search: typeof params['search'] === 'string' ? params['search'] : '',
      status: this.toStatusFilter(params['status']),
      type: this.toOrderTypeFilter(params['type']),
      attention: this.toAttentionFilter(params['attention']),
      date,
      from: date === 'custom' ? from : '',
      to: date === 'custom' ? to : ''
    };
  }

  private sameFilters(a: ListFilters, b: ListFilters): boolean {
    return a.search === b.search && a.status === b.status && a.type === b.type && a.attention === b.attention &&
      a.date === b.date && a.from === b.from && a.to === b.to;
  }

  private applyFilterState(f: ListFilters): void {
    this.search = f.search;
    this.activeStatus = f.status;
    this.orderType = f.type;
    this.attention = f.attention;
    this.dateRange = f.date;
    this.appliedCustomFrom = f.from;
    this.appliedCustomTo = f.to;
    if (f.date === 'custom') {
      this.customDateFrom = f.from;
      this.customDateTo = f.to;
    } else {
      this.previousDateRange = f.date;
      this.showCustomRange = false;
    }
  }

  /** Apply a filter change: reload the table and keep the URL in step (reload / share / back). */
  private updateFilters(patch: Partial<ListFilters>): void {
    const current = this.currentFilters();
    const next = { ...current, ...patch };
    if (this.sameFilters(next, current)) return;
    this.applyFilterState(next);
    this.loadTrigger$.next({});
    this.syncUrl(next);
  }

  private syncUrl(f: ListFilters): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        status: f.status === 'all' ? null : f.status,
        type: f.type === 'all' ? null : f.type,
        attention: f.attention === 'all' ? null : f.attention,
        date: f.date === '30' ? null : f.date,
        from: f.date === 'custom' ? f.from : null,
        to: f.date === 'custom' ? f.to : null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  onDateChange(value: string): void {
    const next = value as AdminDateRange;

    if (next === 'custom') {
      if (this.dateRange !== 'custom') {
        this.previousDateRange = this.dateRange;
      }
      this.dateRange = 'custom';
      this.showCustomRange = true;
      this.customRangeError = null;

      if (this.appliedCustomFrom && this.appliedCustomTo) {
        this.customDateFrom = this.appliedCustomFrom;
        this.customDateTo = this.appliedCustomTo;
      } else if (!this.customDateFrom || !this.customDateTo) {
        this.initDefaultCustomDates();
      }
      return;
    }

    this.showCustomRange = false;
    this.customRangeError = null;
    // Custom was picked but never applied: the list is still on the previous range.
    if (this.dateRange === 'custom' && !(this.appliedCustomFrom && this.appliedCustomTo)) {
      this.dateRange = this.previousDateRange;
    }
    this.updateFilters({ date: next, from: '', to: '' });
  }

  applyCustomRange(): void {
    this.customRangeError = null;

    if (!this.customDateFrom || !this.customDateTo) {
      this.customRangeError = 'Please select both a start date and an end date.';
      return;
    }

    if (this.customDateFrom > this.customDateTo) {
      this.customRangeError = 'Start date must be on or before the end date.';
      return;
    }

    this.showCustomRange = false;
    this.updateFilters({ date: 'custom', from: this.customDateFrom, to: this.customDateTo });
  }

  cancelCustomRange(): void {
    this.showCustomRange = false;
    this.customRangeError = null;

    if (this.appliedCustomFrom && this.appliedCustomTo) {
      this.customDateFrom = this.appliedCustomFrom;
      this.customDateTo = this.appliedCustomTo;
      this.dateRange = 'custom';
      return;
    }

    // Nothing was applied yet: the list never left the previous range.
    this.dateRange = this.previousDateRange;
  }

  onCustomDateFromChange(value: string): void {
    this.customDateFrom = value;
    this.customRangeError = null;
  }

  onCustomDateToChange(value: string): void {
    this.customDateTo = value;
    this.customRangeError = null;
  }

  get statsPeriodLabel(): string {
    if (this.dateRange === 'custom' && this.appliedCustomFrom && this.appliedCustomTo) {
      return `${this.formatInputDate(this.appliedCustomFrom)} – ${this.formatInputDate(this.appliedCustomTo)}`;
    }
    if (this.dateRange === 'today') return 'Today';
    if (this.dateRange === '7') return 'Last 7 days';
    if (this.dateRange === '90') return 'Last 90 days';
    return 'Last 30 days';
  }

  private initDefaultCustomDates(): void {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 30);
    this.customDateTo = this.toInputDate(to);
    this.customDateFrom = this.toInputDate(from);
  }

  private toInputDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private formatInputDate(value: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(`${value}T00:00:00`));
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(value));
  }

  formatPrice(total: number, currency: string): string {
    if (currency === 'VND') {
      return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(total);
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(total);
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Processing',
      processing: 'Processing',
      shipping: 'Shipping',
      delivery_failed: 'Delivery Failed',
      delivered: 'Delivered',
      canceled: 'Cancelled',
      refund: 'Refund',
      pending_refund: 'Pending Refund',
      refund_rejected: 'Refund Rejected'
    };
    return labels[status] || status;
  }

  statusClass(status: string): string {
    if (status === 'pending' || status === 'processing') return 'status-badge--processing';
    if (status === 'shipping') return 'status-badge--shipping';
    if (status === 'delivery_failed') return 'status-badge--delivery-failed';
    if (status === 'delivered') return 'status-badge--delivered';
    if (status === 'canceled') return 'status-badge--cancelled';
    if (status === 'refund') return 'status-badge--refund';
    if (status === 'pending_refund') return 'status-badge--pending-refund';
    if (status === 'refund_rejected') return 'status-badge--refund-rejected';
    return 'status-badge--processing';
  }

  private currentQuery() {
    return {
      order_status: this.activeStatus,
      order_type: this.orderType,
      attention: this.attention,
      search: this.search,
      date_range: this.dateRange,
      date_from: this.dateRange === 'custom' ? this.appliedCustomFrom : undefined,
      date_to: this.dateRange === 'custom' ? this.appliedCustomTo : undefined
    };
  }

  get hasMoreOrders(): boolean {
    return this.orders.length < this.totalOrders;
  }

  loadMore(): void {
    if (this.loadingMore || !this.hasMoreOrders) return;
    this.loadingMore = true;
    const page = Math.floor(this.orders.length / this.pageSize) + 1;
    this.adminOrderService
      .getOrders({ ...this.currentQuery(), page, limit: this.pageSize })
      .pipe(
        catchError(() => {
          this.error = 'Failed to load more orders. Please try again.';
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        if (response) {
          // New orders may have shifted the pages: skip rows already shown.
          const shown = new Set(this.orders.map((o) => o.order_id));
          this.orders = [...this.orders, ...response.data.filter((o) => !shown.has(o.order_id))];
          this.totalOrders = response.total;
          this.stats = response.stats;
        }
        this.loadingMore = false;
        this.cdr.markForCheck();
      });
  }

  exportOrders(): void {
    if (!this.orders.length) return;

    const headers = ['Order ID', 'Customer', 'Email', 'Date', 'Type', 'Status', 'Total'];
    const rows = this.orders.map((order) => [
      order.order_id,
      order.customer_name,
      order.customer_email ?? '',
      this.formatDate(order.created_at),
      ORDER_TYPE_LABEL[order.order_type],
      this.statusLabel(order.order_status),
      String(order.total)
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `offsite-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
