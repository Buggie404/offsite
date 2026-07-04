import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideDownload, LucideEye, LucideChevronDown, LucideCalendar } from '@lucide/angular';
import { Subject, catchError, distinctUntilChanged, interval, map, of, switchMap } from 'rxjs';
import { AdminOrderService } from '../../services/admin-order.service';
import { AdminRefreshService } from '../../services/admin-refresh.service';
import {
  AdminDateRange,
  AdminOrderListItem,
  AdminOrderStats,
  AdminOrderStatusFilter,
  AdminOrdersResponse
} from '../../models/admin-order.model';

interface StatusFilterOption {
  value: AdminOrderStatusFilter;
  label: string;
}

@Component({
  selector: 'app-orders-listing',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideDownload, LucideEye, LucideChevronDown, LucideCalendar],
  templateUrl: './orders-listing.component.html',
  styleUrl: './orders-listing.component.scss'
})
export class OrdersListingComponent implements OnInit {
  private adminOrderService = inject(AdminOrderService);
  private adminRefresh = inject(AdminRefreshService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private readonly loadTrigger$ = new Subject<{ silent?: boolean }>();
  private readonly pollIntervalMs = 20_000;

  orders: AdminOrderListItem[] = [];
  stats: AdminOrderStats = { total: 0, processing: 0, shipped: 0, needsAttention: 0 };
  loading = true;
  error: string | null = null;

  activeStatus: AdminOrderStatusFilter = 'all';
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
    { value: 'all', label: 'All' },
    { value: 'processing', label: 'Processing' },
    { value: 'shipping', label: 'Shipping' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'pending_refund', label: 'Pending Refund' },
    { value: 'refund', label: 'Refund' },
    { value: 'refund_rejected', label: 'Refund Rejected' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  ngOnInit(): void {
    const initial = this.route.snapshot.queryParams;
    this.search = initial['search'] || '';
    this.activeStatus = (initial['status'] as AdminOrderStatusFilter) || 'all';
    this.dateRange = (initial['date'] as AdminDateRange) || '30';

    this.loadTrigger$
      .pipe(
        switchMap((options) => {
          if (!options?.silent) {
            this.loading = true;
            this.error = null;
          }

          return this.adminOrderService
            .getOrders({
              order_status: this.activeStatus,
              search: this.search,
              date_range: this.dateRange,
              date_from: this.dateRange === 'custom' ? this.appliedCustomFrom : undefined,
              date_to: this.dateRange === 'custom' ? this.appliedCustomTo : undefined,
              limit: 100
            })
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
        }
        this.loading = false;
        this.cdr.markForCheck();
      });

    this.route.queryParams
      .pipe(
        map((params) => params['search'] || ''),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((search) => {
        if (search === this.search) return;
        this.search = search;
        this.loadTrigger$.next({});
      });

    this.adminRefresh.onOrdersListRefresh$
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

  setStatusFilter(status: AdminOrderStatusFilter): void {
    if (this.activeStatus === status) return;
    this.activeStatus = status;
    this.loadTrigger$.next({});
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

    if (this.dateRange === next) return;
    this.dateRange = next;
    this.loadTrigger$.next({});
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

    this.appliedCustomFrom = this.customDateFrom;
    this.appliedCustomTo = this.customDateTo;
    this.loadTrigger$.next({});
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

    this.dateRange = this.previousDateRange;
    this.loadTrigger$.next({});
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
    if (status === 'delivered') return 'status-badge--delivered';
    if (status === 'canceled') return 'status-badge--cancelled';
    if (status === 'refund') return 'status-badge--refund';
    if (status === 'pending_refund') return 'status-badge--pending-refund';
    if (status === 'refund_rejected') return 'status-badge--refund-rejected';
    return 'status-badge--processing';
  }

  exportOrders(): void {
    if (!this.orders.length) return;

    const headers = ['Order ID', 'Customer', 'Email', 'Date', 'Status', 'Total'];
    const rows = this.orders.map((order) => [
      order.order_id,
      order.customer_name,
      order.customer_email,
      this.formatDate(order.created_at),
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
