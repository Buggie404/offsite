import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  LucideArrowRight,
  LucideChevronLeft,
  LucideChevronRight,
  LucideDownload,
  LucideEllipsis,
  LucideHistory,
  LucideSearch,
  LucideTriangleAlert,
  LucideX
} from '@lucide/angular';
import { AdminRole } from '../../../../shared/models/admin-role.model';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  ActivityLogEntry,
  ActivityLogFacets,
  ActivityLogQuery,
  AdminActivityLogService
} from '../../services/admin-activity-log.service';

type Period = '24h' | '7' | '30' | '90' | 'all' | 'custom';

export interface FieldChange {
  key: string;
  before: string | null;
  after: string | null;
}

// Readable names for the action_type values written by each group. Unknown types fall back to
// a cleaned-up version of the raw value, so new log types show up without touching this file.
export const ACTION_LABELS: Record<string, string> = {
  'order.update-status': 'Order status changed',
  'order.add-internal-note': 'Internal note added',
  'order.mark-out-of-stock': 'Marked out of stock',
  'refund.approve': 'Refund approved',
  'refund.reject': 'Refund rejected',
  'product.batch-expiry': 'Batch expiry updated',
  'contact.update': 'Contact message updated',
  community_post_hide: 'Post hidden',
  community_post_unhide: 'Post restored',
  community_comment_hide: 'Comment hidden',
  community_comment_unhide: 'Comment restored',
  community_reports_dismiss: 'Reports dismissed',
  community_user_warn: 'User warned',
  community_user_suspend: 'Account suspended',
  'community.hide': 'Reported content hidden',
  'community.restore': 'Reported content restored',
  'community.warn': 'User warned',
  'community.lock': 'Account locked (report)',
  'community.unlock': 'Account unlocked (report)',
  'community.dismiss': 'Reports dismissed',
  'user.suspend': 'Customer locked',
  'user.unsuspend': 'Customer unlocked',
  'customer.add_note': 'Customer note added',
  'staff.create': 'Staff created',
  'staff.change_role': 'Role changed',
  'staff.disable': 'Staff disabled',
  'staff.enable': 'Staff enabled',
  'staff.reset_password': 'Password reset',
  'subscription.pause': 'Ritual Box paused',
  'subscription.skip': 'Ritual Box cycle skipped',
  'subscription.unpause': 'Ritual Box resumed',
  'subscription.propose': 'Change proposed',
  'subscription.withdraw_proposal': 'Proposal withdrawn',
  'subscription.cancel': 'Ritual Box cancelled',
  'subscription.note': 'Ritual Box note added'
};

export function actionLabel(type: string): string {
  if (ACTION_LABELS[type]) return ACTION_LABELS[type];
  const words = type.replace(/[._-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Field-by-field difference between old_value and new_value (objects), or a single before/after pair. */
export function diffValues(oldValue: unknown, newValue: unknown): FieldChange[] {
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObject(oldValue) || isObject(newValue)) {
    const before = isObject(oldValue) ? oldValue : {};
    const after = isObject(newValue) ? newValue : {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => ({ key, before: formatValue(before[key]), after: formatValue(after[key]) }));
  }
  const before = formatValue(oldValue);
  const after = formatValue(newValue);
  return before === after ? [] : [{ key: 'value', before, after }];
}

const ROLE_LABELS: Record<AdminRole, string> = { admin_cc: 'Admin CC', qlsp: 'QLSP', cskh: 'CSKH' };
const PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-activity-log',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideArrowRight,
    LucideChevronLeft,
    LucideChevronRight,
    LucideDownload,
    LucideEllipsis,
    LucideHistory,
    LucideSearch,
    LucideTriangleAlert,
    LucideX
  ],
  templateUrl: './activity-log.component.html',
  styleUrl: './activity-log.component.scss'
})
export class AdminActivityLogComponent implements OnInit {
  private logService = inject(AdminActivityLogService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private search$ = new Subject<string>();
  private requestVersion = 0;

  readonly roleOptions = (Object.keys(ROLE_LABELS) as AdminRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }));
  readonly periodOptions: { value: Period; label: string }[] = [
    { value: '24h', label: 'Last 24 hours' },
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: 'all', label: 'All time' },
    { value: 'custom', label: 'Custom range' }
  ];

  // Filters
  q = '';
  adminId = '';
  adminRole = '';
  actionType = '';
  period: Period = '7';
  customFrom = '';
  customTo = '';

  page = 1;
  total = 0;
  rows: ActivityLogEntry[] = [];
  facets: ActivityLogFacets = { action_types: [], actors: [] };
  unsavedCount = 0;
  loading = true;
  error = '';
  exporting = false;
  selected: ActivityLogEntry | null = null;

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.load(true);
  }

  // ── Loading ──

  private buildQuery(): ActivityLogQuery {
    const query: ActivityLogQuery = { page: this.page, limit: PAGE_SIZE };
    if (this.q.trim()) query.q = this.q.trim();
    if (this.adminId) query.admin_id = this.adminId;
    if (this.adminRole) query.admin_role = this.adminRole;
    if (this.actionType) query.action_type = this.actionType;
    const range = this.periodRange();
    if (range.from) query.from = range.from;
    if (range.to) query.to = range.to;
    return query;
  }

  private periodRange(): { from?: string; to?: string } {
    if (this.period === 'all') return {};
    if (this.period === 'custom') {
      return {
        from: this.customFrom ? new Date(`${this.customFrom}T00:00:00`).toISOString() : undefined,
        to: this.customTo ? new Date(`${this.customTo}T23:59:59.999`).toISOString() : undefined
      };
    }
    const hours = this.period === '24h' ? 24 : Number(this.period) * 24;
    return { from: new Date(Date.now() - hours * 3_600_000).toISOString() };
  }

  load(includeFacets = false): void {
    const version = ++this.requestVersion;
    this.loading = true;
    this.error = '';
    this.logService.list(this.buildQuery(), includeFacets).subscribe({
      next: (res) => {
        if (version !== this.requestVersion) return;
        this.rows = res.data;
        this.total = res.total;
        this.unsavedCount = res.unsaved_count;
        if (res.facets) this.facets = res.facets;
        if (this.selected && !this.rows.some((r) => r.log_id === this.selected!.log_id)) this.selected = null;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (version !== this.requestVersion) return;
        this.loading = false;
        this.error = err?.error?.error || 'The activity log could not be loaded.';
        this.cdr.markForCheck();
      }
    });
  }

  onSearch(value: string): void {
    this.q = value;
    this.search$.next(value.trim());
  }

  applyFilters(): void {
    if (this.period === 'custom' && this.customFrom && this.customTo && this.customFrom > this.customTo) return;
    this.page = 1;
    this.load();
  }

  get hasFilters(): boolean {
    return !!(this.q.trim() || this.adminId || this.adminRole || this.actionType || this.period !== '7');
  }

  clearFilters(): void {
    this.q = '';
    this.adminId = '';
    this.adminRole = '';
    this.actionType = '';
    this.period = '7';
    this.customFrom = '';
    this.customTo = '';
    this.applyFilters();
  }

  // ── Pagination ──

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / PAGE_SIZE));
  }

  get rangeText(): string {
    if (!this.total) return 'No entries';
    const start = (this.page - 1) * PAGE_SIZE + 1;
    const end = Math.min(this.page * PAGE_SIZE, this.total);
    return `Showing ${start}-${end} of ${this.total.toLocaleString('en-US')}`;
  }

  /** Page numbers with null for a gap, e.g. 1 2 3 null 13 */
  get pages(): (number | null)[] {
    const count = this.pageCount;
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
    const around = [this.page - 1, this.page, this.page + 1].filter((p) => p > 1 && p < count);
    const list: (number | null)[] = [1];
    if (around[0] > 2) list.push(null);
    list.push(...around);
    if (around[around.length - 1] < count - 1) list.push(null);
    list.push(count);
    return list;
  }

  goTo(page: number): void {
    if (page < 1 || page > this.pageCount || page === this.page) return;
    this.page = page;
    this.load();
  }

  // ── Row display ──

  actionLabel(type: string): string {
    return actionLabel(type);
  }

  roleLabel(role: AdminRole): string {
    return ROLE_LABELS[role] || role;
  }

  /** "Khoa Nguyen" -> "Khoa N." as in Figma */
  shortName(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.` : name;
  }

  entityLabel(entity: string): string {
    const clean = entity.replace(/[_-]+/g, ' ').trim().replace(/s$/i, '');
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }

  targetText(row: ActivityLogEntry): string {
    return `${this.entityLabel(row.target_entity)} · ${row.target_label || row.target_id}`;
  }

  changes(row: ActivityLogEntry): FieldChange[] {
    return diffValues(row.old_value, row.new_value);
  }

  /** First changed field for the table column; the drawer shows all of them */
  summary(row: ActivityLogEntry): { change: FieldChange | null; more: number } {
    const all = this.changes(row);
    return { change: all[0] || null, more: Math.max(all.length - 1, 0) };
  }

  shortTime(value: string): string {
    const date = new Date(value);
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${time}`;
  }

  fullTime(value: string): string {
    const date = new Date(value);
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${day} ${time}`;
  }

  select(row: ActivityLogEntry): void {
    this.selected = this.selected?.log_id === row.log_id ? null : row;
  }

  @HostListener('document:keydown.escape')
  closeDetail(): void {
    this.selected = null;
  }

  // ── Export ──

  exportCsv(): void {
    if (this.exporting) return;
    this.exporting = true;
    // Same filters as the table; the export endpoint ignores paging and returns every match (capped).
    this.logService.exportCsv(this.buildQuery()).subscribe({
      next: (blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        this.exporting = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.exporting = false;
        this.toast.error('The CSV export failed. Please try again.');
        this.cdr.markForCheck();
      }
    });
  }
}
