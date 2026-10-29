import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideChevronRight, LucideCreditCard, LucideFlag, LucideMessagesSquare, LucidePackage, LucideTriangleAlert, LucideUndo2 } from '@lucide/angular';
import { SalesDashboardData, SalesDashboardService } from '../../services/sales-dashboard.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';

type RangeKey = 'today' | '7' | '30' | '90' | 'custom';

@Component({
  selector: 'app-sales-dashboard',
  standalone: true,
  imports: [CommonModule, DecimalPipe, FormsModule, LucideChevronRight, LucideCreditCard, LucideFlag, LucideMessagesSquare, LucidePackage, LucideTriangleAlert, LucideUndo2],
  templateUrl: './sales-dashboard.component.html',
  styleUrl: './sales-dashboard.component.scss'
})
export class SalesDashboardComponent implements OnInit {
  private readonly service = inject(SalesDashboardService);
  private readonly router = inject(Router);
  private readonly adminAuth = inject(AdminAuthService);
  private readonly cdr = inject(ChangeDetectorRef);

  range: RangeKey = '30';
  customStart = '';
  customEnd = '';
  data: SalesDashboardData | null = null;
  loading = true;
  error = '';
  private requestVersion = 0;

  ngOnInit(): void {
    const today = this.localDate(new Date());
    this.customStart = today;
    this.customEnd = today;
    this.load();
  }

  selectRange(range: RangeKey): void {
    this.range = range;
    if (range !== 'custom') this.load(range);
    // These are current operational queues, not historical measures. The chosen
    // range is retained for the shared dashboard experience but does not cause a
    // misleading re-query or reset of today’s actionable work.
  }

  applyCustom(): void {
    if (!this.customStart || !this.customEnd || this.customStart > this.customEnd) return;
    this.range = 'custom';
    this.load('custom');
  }

  load(range: RangeKey = this.range): void {
    const dates = this.getRange(range);
    if (!dates) return;
    const requestVersion = ++this.requestVersion;
    this.loading = this.data === null;
    this.error = '';
    this.service.getDashboard(dates.start, dates.end, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').subscribe({
      next: data => {
        if (requestVersion !== this.requestVersion) return;
        this.data = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: error => {
        if (requestVersion !== this.requestVersion) return;
        this.error = error?.error?.error || 'Dashboard data could not be loaded.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  get greeting(): string {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }

  navigate(path: string, queryParams?: Record<string, string>): void {
    // Sales-Ops may see cross-team queue totals but must not gain access to the
    // Services-Ops modules simply by using a dashboard shortcut.
    if (this.adminAuth.getAdminRole() === 'qlsp' && ['/admin/chat', '/admin/community-reports'].includes(path)) return;
    void this.router.navigate([path], { queryParams });
  }

  // Failed renewals live on Subscriptions; Ritual Boxes that never started live on Orders.
  ritualBoxFailedClick(): void {
    const todos = this.data?.todos;
    const renewals = (todos?.ritual_box_payment_failed || 0) - (todos?.ritual_box_start_failed || 0);
    if (!renewals && todos?.ritual_box_start_failed) this.navigate('/admin/orders', { attention: 'ritual_box_not_started' });
    else this.navigate('/admin/subscriptions', { status: 'needs_action' });
  }

  orderQueryParams(status: 'processing' | 'pending_refund'): Record<string, string> {
    if (this.range === 'custom') return { status, date: 'custom', date_from: this.customStart, date_to: this.customEnd };
    return { status, date: this.range };
  }

  private getRange(range: RangeKey): { start: Date; end: Date } | null {
    if (range === 'custom') {
      const start = new Date(`${this.customStart}T00:00:00`);
      const end = new Date(`${this.customEnd}T23:59:59.999`);
      return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end ? null : { start, end };
    }
    const end = new Date();
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (range === 'today' ? 0 : Number(range) - 1));
    return { start, end };
  }

  private localDate(value: Date): string {
    return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  }
}
