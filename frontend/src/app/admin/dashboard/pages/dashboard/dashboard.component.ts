import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  LucideChevronRight,
  LucideCircleCheck,
  LucideCreditCard,
  LucideDownload,
  LucideFlag,
  LucideMessagesSquare,
  LucidePackage,
  LucideReceipt,
  LucideRotateCcw,
  LucideShoppingBag,
  LucideTriangleAlert,
  LucideUserPlus,
  LucideWallet
} from '@lucide/angular';
import { AdminDashboardService, DashboardData, DashboardResponse } from '../../services/admin-dashboard.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { ADMIN_ROLE_LABELS } from '../../../../shared/models/admin-role.model';

type RangeKey = 'today' | '7' | '30' | '90' | 'custom';
type KpiIcon = 'revenue' | 'orders' | 'aov' | 'customers';
type TodoTone = 'green' | 'amber' | 'pink' | 'blue' | 'red';

export interface KpiCard {
  label: string;
  icon: KpiIcon;
  value: number;
  currency?: boolean;
}

export interface TodoRow {
  key: string;
  label: string;
  icon: 'package' | 'refund' | 'flag' | 'chat' | 'stock' | 'card';
  tone: TodoTone;
  count: number;
  /** Highlight in red when there is anything to handle (money / customer at risk) */
  urgent?: boolean;
  open: () => void;
}

// Chart drawn in a 760x200 viewBox stretched to the card width.
const CHART_W = 760;
const CHART_H = 200;
const Y_TICKS = 4;

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DecimalPipe, CurrencyPipe,
    LucideChevronRight, LucideCircleCheck, LucideCreditCard, LucideDownload, LucideFlag, LucideMessagesSquare,
    LucidePackage, LucideReceipt, LucideRotateCcw, LucideShoppingBag, LucideTriangleAlert, LucideUserPlus, LucideWallet
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class AdminDashboardComponent implements OnInit {
  private readonly dashboardService = inject(AdminDashboardService);
  private readonly router = inject(Router);
  private readonly adminAuth = inject(AdminAuthService);
  private readonly cdr = inject(ChangeDetectorRef);
  private requestVersion = 0;

  range: RangeKey = '30';
  customStart = '';
  customEnd = '';
  data: DashboardData | null = null;
  initialLoading = true;
  refreshing = false;
  error = '';
  /** Index of the chart point under the mouse */
  hoverIndex: number | null = null;

  ngOnInit(): void {
    const today = this.localDate(new Date());
    this.customStart = today;
    this.customEnd = today;
    this.load();
  }

  selectRange(range: RangeKey): void {
    this.range = range;
    if (range !== 'custom') this.load(range);
  }

  applyCustom(): void {
    if (!this.customStart || !this.customEnd || this.customStart > this.customEnd) return;
    this.load('custom');
  }

  load(range: RangeKey = this.range): void {
    const dates = this.getRange(range);
    if (!dates) return;
    const requestVersion = ++this.requestVersion;
    this.initialLoading = this.data === null;
    this.refreshing = this.data !== null;
    this.error = '';
    this.hoverIndex = null;
    const includeTodos = this.data === null;
    this.dashboardService.getDashboard(dates.start, dates.end, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', includeTodos).subscribe({
      // Ignore late responses from a previously selected range.
      next: data => {
        if (requestVersion !== this.requestVersion) return;
        this.applyResponse(data);
        this.initialLoading = false;
        this.refreshing = false;
        // This application runs zoneless. HTTP callbacks do not automatically
        // schedule template rendering, so mark the new filter data explicitly.
        this.cdr.markForCheck();
      },
      error: err => {
        if (requestVersion !== this.requestVersion) return;
        this.error = err?.error?.error || 'Dashboard data could not be loaded.';
        this.initialLoading = false;
        this.refreshing = false;
        this.cdr.markForCheck();
      }
    });
  }

  get greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  get accountName(): string {
    return this.adminAuth.getDisplayName();
  }

  get roleLabel(): string {
    const role = this.adminAuth.getAdminRole();
    return role ? ADMIN_ROLE_LABELS[role] : 'Admin';
  }

  // ── KPI cards ──

  get cards(): KpiCard[] {
    const kpis = this.data?.kpis;
    return [
      { label: 'Revenue', icon: 'revenue', value: kpis?.revenue.value || 0, currency: true },
      { label: 'Orders', icon: 'orders', value: kpis?.orders.value || 0 },
      { label: 'Avg. order value', icon: 'aov', value: kpis?.aov.value || 0, currency: true },
      { label: 'New customers', icon: 'customers', value: kpis?.new_customers.value || 0 }
    ];
  }

  // ── Revenue chart ──

  get periodRevenue(): number {
    return (this.data?.revenue_series || []).reduce((sum, row) => sum + row.revenue, 0);
  }

  /** Rounded-up top of the y axis so grid labels are readable numbers */
  private get chartMax(): number {
    const max = Math.max(...(this.data?.revenue_series || []).map(row => row.revenue), 0);
    if (max <= 0) return 100;
    const magnitude = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 2.5, 5, 10].find(s => s * magnitude * Y_TICKS >= max) || 10;
    return step * magnitude * Y_TICKS;
  }

  get yTicks(): { value: number; top: number }[] {
    const max = this.chartMax;
    return Array.from({ length: Y_TICKS + 1 }, (_, i) => ({ value: (max * (Y_TICKS - i)) / Y_TICKS, top: (i / Y_TICKS) * 100 }));
  }

  private chartCoords(): { x: number; y: number; date: string; revenue: number }[] {
    const rows = this.data?.revenue_series || [];
    const max = this.chartMax;
    return rows.map((row, index) => ({
      x: rows.length === 1 ? CHART_W / 2 : (index * CHART_W) / (rows.length - 1),
      y: CHART_H - (row.revenue / max) * CHART_H,
      date: row.date,
      revenue: row.revenue
    }));
  }

  get chartPoints(): string {
    return this.chartCoords().map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }

  get chartArea(): string {
    const coords = this.chartCoords();
    if (!coords.length) return '';
    return `${coords[0].x},${CHART_H} ${this.chartPoints} ${coords[coords.length - 1].x},${CHART_H}`;
  }

  // Up to 5 evenly spaced dates under the chart, e.g. "Sep 5"
  get chartLabels(): string[] {
    const rows = this.data?.revenue_series || [];
    if (!rows.length) return [];
    const count = Math.min(5, rows.length);
    const indexes = [...new Set(Array.from({ length: count }, (_, i) => Math.round((i * (rows.length - 1)) / Math.max(count - 1, 1))))];
    return indexes.map(index => this.shortDate(rows[index].date));
  }

  /** Hovered point in % of the plot, so the dot and tooltip are plain HTML (not stretched by the SVG) */
  get hoverPoint(): { left: number; top: number; date: string; revenue: number } | null {
    if (this.hoverIndex === null) return null;
    const point = this.chartCoords()[this.hoverIndex];
    if (!point) return null;
    return { left: (point.x / CHART_W) * 100, top: (point.y / CHART_H) * 100, date: this.longDate(point.date), revenue: point.revenue };
  }

  onChartMove(event: MouseEvent): void {
    const rows = this.data?.revenue_series || [];
    if (!rows.length) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    this.hoverIndex = rows.length === 1 ? 0 : Math.round(ratio * (rows.length - 1));
  }

  private shortDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private longDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ── To do today ──

  get todos(): TodoRow[] {
    const t = this.data?.todos;
    if (!t) return [];
    return [
      { key: 'ship', label: 'Orders waiting to ship', icon: 'package', tone: 'green', count: t.waiting_to_ship,
        open: () => this.todoClick('/admin/orders', { status: 'processing', date: 'today' }) },
      { key: 'refund', label: 'Refund requests', icon: 'refund', tone: 'amber', count: t.refund_requests,
        open: () => this.todoClick('/admin/orders', { status: 'pending_refund', date: 'today' }) },
      { key: 'reports', label: 'Reports to review', icon: 'flag', tone: 'pink', count: t.reports_to_review,
        open: () => this.todoClick('/admin/community-reports') },
      { key: 'chats', label: 'Chats waiting', icon: 'chat', tone: 'blue', count: t.chats_waiting,
        open: () => this.todoClick('/admin/chat', { status: 'waiting' }) },
      { key: 'stock', label: 'Low stock variants', icon: 'stock', tone: 'amber', count: t.low_stock_variants,
        open: () => this.todoClick('/admin/products') },
      { key: 'ritual', label: 'Ritual Box payment failed', icon: 'card', tone: 'red', count: t.ritual_box_payment_failed, urgent: true,
        open: () => this.ritualBoxFailedClick() }
    ];
  }

  get openTodoCount(): number {
    return this.todos.reduce((sum, todo) => sum + todo.count, 0);
  }

  todoClick(path: string, queryParams?: Record<string, string>): void {
    void this.router.navigate([path], { queryParams });
  }

  // Failed renewals live on Subscriptions; Ritual Boxes that never started live on Orders.
  ritualBoxFailedClick(): void {
    const todos = this.data?.todos;
    const renewals = (todos?.ritual_box_payment_failed || 0) - (todos?.ritual_box_start_failed || 0);
    if (!renewals && todos?.ritual_box_start_failed) this.todoClick('/admin/orders', { attention: 'ritual_box_not_started' });
    else this.todoClick('/admin/subscriptions', { status: 'needs_action' });
  }

  exportRevenue(): void {
    const rows = this.data?.revenue_series || [];
    const csv = ['Date,Revenue', ...rows.map(row => `${row.date},${row.revenue}`)].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `revenue-${this.rangeLabel().replaceAll(' ', '-').toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private applyResponse(response: DashboardResponse): void {
    if (response.todos) {
      this.data = response as DashboardData;
      return;
    }
    // To-do counts are independent of the selected KPI period.  They stay in
    // place while a range refetch updates only KPIs and the revenue series.
    if (this.data) this.data = { ...response, todos: this.data.todos };
  }

  private getRange(range: RangeKey): { start: Date; end: Date } | null {
    if (range === 'custom') {
      const start = this.startOfDay(this.customStart);
      const end = this.endOfDay(this.customEnd);
      return start && end && start <= end ? { start, end } : null;
    }
    const end = new Date();
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    const days = range === 'today' ? 0 : Number(range) - 1;
    start.setDate(start.getDate() - days);
    return { start, end };
  }

  private startOfDay(value: string): Date | null {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private endOfDay(value: string): Date | null {
    const date = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private localDate(date: Date): string {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  private rangeLabel(): string { return this.range === 'custom' ? `${this.customStart}-${this.customEnd}` : `${this.range} days`; }
}
