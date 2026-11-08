import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowRight, LucideCalendar, LucideCreditCard, LucidePackage, LucideRepeat, LucideRotateCcw, LucideTruck } from '@lucide/angular';
import { SalesDashboardData, SalesDashboardService, SalesTask, SalesTaskType, StockRow } from '../../services/sales-dashboard.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';

type TaskFilter = 'all' | SalesTaskType;

export interface StatusTile {
  key: string;
  label: string;
  count: number;
  caption: string;
  captionTone?: 'danger' | 'warning';
  /** Something needs a decision: tinted while the count is above zero */
  warning?: boolean;
  queryParams: Record<string, string>;
}

const PREVIEW_TASKS = 5;
const REFRESH_MS = 60_000;
const HOUR_MS = 3_600_000;
const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'orders', label: 'Orders' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'stock', label: 'Stock' },
  { key: 'ritual_box', label: 'Ritual Box' }
];

/** Sales-Ops (QLSP) dashboard: order queues, today's work and stock at risk. No revenue. */
@Component({
  selector: 'app-sales-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideArrowRight, LucideCalendar, LucideCreditCard, LucidePackage, LucideRepeat, LucideRotateCcw, LucideTruck],
  templateUrl: './sales-dashboard.component.html',
  styleUrl: './sales-dashboard.component.scss'
})
export class SalesDashboardComponent implements OnInit {
  private readonly service = inject(SalesDashboardService);
  private readonly router = inject(Router);
  private readonly adminAuth = inject(AdminAuthService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  data: SalesDashboardData | null = null;
  loading = true;
  error = '';
  filter: TaskFilter = 'all';
  showAllTasks = false;
  /** Re-read on every refresh so the time chips stay current */
  now = Date.now();
  private requestVersion = 0;

  ngOnInit(): void {
    this.load();
    // Queues change through the day; refresh quietly once a minute.
    const timer = setInterval(() => this.load(), REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  load(): void {
    const requestVersion = ++this.requestVersion;
    this.loading = this.data === null;
    this.service.getDashboard().subscribe({
      next: data => {
        if (requestVersion !== this.requestVersion) return;
        this.data = data;
        this.now = Date.now();
        this.loading = false;
        this.error = '';
        // Zoneless app: HTTP callbacks do not schedule rendering on their own.
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

  get accountName(): string {
    return this.adminAuth.getDisplayName();
  }

  get updatedAt(): string {
    return this.data ? new Date(this.data.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  }

  // ── 3.1 Order status strip ──

  get statusTiles(): StatusTile[] {
    const s = this.data?.order_status;
    if (!s) return [];
    return [
      { key: 'pending', label: 'Pending', count: s.pending, caption: s.pending ? 'to confirm' : 'none waiting', queryParams: { date: '90' } },
      {
        key: 'processing', label: 'Processing', count: s.processing,
        caption: s.processing_over_24h ? `${s.processing_over_24h} over 24h` : 'all within 24h',
        captionTone: s.processing_over_24h ? 'danger' : undefined, queryParams: { status: 'processing', date: '90' }
      },
      { key: 'shipping', label: 'Shipping', count: s.shipping, caption: 'in transit', queryParams: { status: 'shipping', date: '90' } },
      {
        key: 'failed', label: 'Delivery failed', count: s.delivery_failed, warning: true,
        caption: s.delivery_failed ? 'contact customer' : 'none today', captionTone: s.delivery_failed ? 'warning' : undefined,
        queryParams: { status: 'delivery_failed', date: '90' }
      },
      {
        key: 'refund', label: 'Pending refund', count: s.pending_refund, warning: true,
        caption: s.pending_refund ? 'you decide' : 'none waiting', captionTone: s.pending_refund ? 'warning' : undefined,
        queryParams: { status: 'pending_refund', date: '90' }
      },
      {
        key: 'delivered', label: 'Delivered today', count: s.delivered_today,
        caption: `${s.refund_window_days}-day return window`, queryParams: { status: 'delivered', date: '7' }
      }
    ];
  }

  openStatus(tile: StatusTile): void {
    void this.router.navigate(['/admin/orders'], { queryParams: tile.queryParams });
  }

  // ── 3.2 To do today ──

  get filters(): { key: TaskFilter; label: string; count: number }[] {
    const tasks = this.data?.tasks || [];
    return FILTERS.map(f => ({
      ...f,
      count: tasks.filter(task => f.key === 'all' || task.type === f.key).reduce((sum, task) => sum + task.count, 0)
    }));
  }

  get totalTasks(): number { return this.filters[0]?.count || 0; }

  get overdueTasks(): number {
    return (this.data?.tasks || []).filter(task => task.overdue).reduce((sum, task) => sum + task.count, 0);
  }

  get filteredTasks(): SalesTask[] {
    return (this.data?.tasks || []).filter(task => this.filter === 'all' || task.type === this.filter);
  }

  get visibleTasks(): SalesTask[] {
    return this.showAllTasks ? this.filteredTasks : this.filteredTasks.slice(0, PREVIEW_TASKS);
  }

  selectFilter(filter: TaskFilter): void {
    this.filter = filter;
  }

  timeChip(task: SalesTask): { text: string; tone: 'danger' | 'warning' } {
    const hours = (from: string | undefined) => Math.max(1, Math.round((this.now - new Date(from || task.due_at).getTime()) / HOUR_MS));
    switch (task.chip) {
      case 'overdue': return { text: `Overdue ${this.age(this.now - new Date(task.due_at).getTime())}`, tone: 'danger' };
      case 'waiting': return { text: `Waiting ${this.age(this.now - new Date(task.since || task.due_at).getTime())}`, tone: 'danger' };
      case 'since': return { text: `Failed ${hours(task.since)}h ago`, tone: 'danger' };
      case 'due': {
        const days = this.dayDiff(task.due_at);
        return { text: days <= 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`, tone: 'warning' };
      }
      default: return { text: 'Today', tone: 'warning' };
    }
  }

  // ── 3.3 Stock check ──

  coverChip(row: StockRow): { text: string; tone: 'danger' | 'warning' | 'ok' } {
    if (row.in_stock <= 0) return { text: 'Out of stock', tone: 'danger' };
    const days = Math.floor(row.days_of_cover);
    const text = `${days} day${days === 1 ? '' : 's'}`;
    if (days <= 5) return { text, tone: 'danger' };
    return { text, tone: days <= 7 ? 'warning' : 'ok' };
  }

  expiryLabel(row: StockRow): string | null {
    if (!row.batch_expiry_date) return null;
    return new Date(row.batch_expiry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace('Sept', 'Sep');
  }

  /** Stock and expiry are both edited on the Products page; the label says what to do first. */
  stockAction(row: StockRow): string {
    if (row.in_stock <= 0 || row.days_of_cover <= 7) return 'Update stock';
    if (row.needs_expiry && !row.batch_expiry_date) return 'Add expiry';
    return 'Edit';
  }

  private age(ms: number): string {
    const hours = Math.max(1, Math.round(ms / HOUR_MS));
    return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  }

  /** Calendar days from today to the given instant, in the viewer's timezone */
  private dayDiff(value: string): number {
    const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return Math.round((start(new Date(value)) - start(new Date(this.now))) / 86_400_000);
  }
}
