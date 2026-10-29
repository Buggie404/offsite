import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideChevronRight, LucideCreditCard, LucideFlag, LucideMessagesSquare, LucidePackage, LucideTriangleAlert, LucideUndo2 } from '@lucide/angular';
import { AdminDashboardService, DashboardData, DashboardResponse } from '../../services/admin-dashboard.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { ADMIN_ROLE_LABELS } from '../../../../shared/models/admin-role.model';

type RangeKey = 'today' | '7' | '30' | '90' | 'custom';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, CurrencyPipe, LucideChevronRight, LucideCreditCard, LucideFlag, LucideMessagesSquare, LucidePackage, LucideTriangleAlert, LucideUndo2],
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
  error = '';

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
    this.error = '';
    const includeTodos = this.data === null;
    this.dashboardService.getDashboard(dates.start, dates.end, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', includeTodos).subscribe({
      // Ignore late responses from a previously selected range.
      next: data => {
        if (requestVersion !== this.requestVersion) return;
        this.applyResponse(data);
        this.initialLoading = false;
        // This application runs zoneless. HTTP callbacks do not automatically
        // schedule template rendering, so mark the new filter data explicitly.
        this.cdr.markForCheck();
      },
      error: err => {
        if (requestVersion !== this.requestVersion) return;
        this.error = err?.error?.error || 'Dashboard data could not be loaded.';
        this.initialLoading = false;
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
    return 'Offsite Official';
  }

  get roleLabel(): string {
    const role = this.adminAuth.getAdminRole();
    return role ? ADMIN_ROLE_LABELS[role] : 'Admin';
  }

  get cards(): { label: string; value: number; currency?: boolean }[] {
    return [
      { label: 'Revenue', value: this.data?.kpis.revenue.value || 0, currency: true },
      { label: 'Orders', value: this.data?.kpis.orders.value || 0 },
      { label: 'Avg. order value', value: this.data?.kpis.aov.value || 0, currency: true },
      { label: 'New customers', value: this.data?.kpis.new_customers.value || 0 }
    ];
  }

  get chartPoints(): string {
    const rows = this.data?.revenue_series || [];
    if (!rows.length) return '';
    const max = Math.max(...rows.map(row => row.revenue), 1);
    const width = 760, height = 250, padding = 18;
    return rows.map((row, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(rows.length - 1, 1);
      const y = height - padding - (row.revenue / max) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  get chartArea(): string {
    if (!this.chartPoints) return '';
    return `18,232 ${this.chartPoints} 742,232`;
  }

  get chartLabels(): { date: string; position: number }[] {
    const rows = this.data?.revenue_series || [];
    if (!rows.length) return [];
    const indexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
    return indexes.map(index => ({ date: rows[index].date, position: 18 + (index * 724) / Math.max(rows.length - 1, 1) }));
  }

  get chartNodes(): { x: number; y: number; date: string; revenue: number }[] {
    const rows = this.data?.revenue_series || [];
    const max = Math.max(...rows.map(row => row.revenue), 1);
    return rows.map((row, index) => ({
      x: 18 + (index * 724) / Math.max(rows.length - 1, 1),
      y: 232 - (row.revenue / max) * 214,
      date: row.date,
      revenue: row.revenue
    }));
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
