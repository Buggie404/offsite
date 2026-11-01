import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  LucideArrowRight,
  LucideCalendar,
  LucideChevronDown,
  LucideChevronLeft,
  LucideChevronRight,
  LucideDownload,
  LucideEllipsis,
  LucideHistory,
  LucideSearch,
  LucideTriangleAlert,
  LucideX
} from '@lucide/angular';
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, AdminRole } from '../../../../shared/models/admin-role.model';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  ActionTypeOption,
  ActivityLogEntry,
  ActivityLogQuery,
  AdminActivityLogService
} from '../../services/admin-activity-log.service';

type Period = '24h' | '7' | '30' | '90' | 'all' | 'custom';

export interface FieldChange {
  key: string;
  before: string | null;
  after: string | null;
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

const PAGE_SIZE = 20;

/** yyyy-mm-dd in the admin's own time zone */
function inputDate(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

@Component({
  selector: 'app-admin-activity-log',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideArrowRight,
    LucideCalendar,
    LucideChevronDown,
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

  readonly roleOptions = ADMIN_ROLES.map((value) => ({ value, label: ADMIN_ROLE_LABELS[value] }));
  readonly maxDate = inputDate(new Date());
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
  adminRole = '';
  actionType = '';
  period: Period = '7';
  private previousPeriod: Period = '7';

  // Custom range panel: the draft dates apply to the table only after "Apply range"
  showCustomRange = false;
  customFrom = '';
  customTo = '';
  appliedFrom = '';
  appliedTo = '';
  customRangeError = '';

  page = 1;
  total = 0;
  rows: ActivityLogEntry[] = [];
  actionGroups: { name: string; types: ActionTypeOption[] }[] = [];
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
    if (this.adminRole) query.admin_role = this.adminRole;
    if (this.actionType) query.action_type = this.actionType;
    const range = this.periodRange();
    if (range.from) query.from = range.from;
    if (range.to) query.to = range.to;
    return query;
  }

  private periodRange(): { from?: string; to?: string } {
    if (this.period === 'custom' && this.appliedFrom) {
      return {
        from: new Date(`${this.appliedFrom}T00:00:00`).toISOString(),
        to: new Date(`${this.appliedTo}T23:59:59.999`).toISOString()
      };
    }
    // Custom picked but not applied yet: the table keeps the previous period.
    const period = this.period === 'custom' ? this.previousPeriod : this.period;
    if (period === 'all') return {};
    const hours = period === '24h' ? 24 : Number(period) * 24;
    return { from: new Date(Date.now() - hours * 3_600_000).toISOString() };
  }

  private setActionTypes(types: ActionTypeOption[]): void {
    const groups = new Map<string, ActionTypeOption[]>();
    for (const type of types) groups.set(type.group, [...(groups.get(type.group) || []), type]);
    this.actionGroups = [...groups].map(([name, list]) => ({ name, types: list }));
  }

  load(includeFacets = !this.actionGroups.length): void {
    const version = ++this.requestVersion;
    this.loading = true;
    this.error = '';
    this.logService.list(this.buildQuery(), includeFacets).subscribe({
      next: (res) => {
        if (version !== this.requestVersion) return;
        this.rows = res.data;
        this.total = res.total;
        this.unsavedCount = res.unsaved_count;
        if (res.facets) this.setActionTypes(res.facets.action_types);
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
    this.page = 1;
    this.load();
  }

  onPeriodChange(value: Period): void {
    if (value === 'custom') {
      if (this.period !== 'custom') this.previousPeriod = this.period;
      this.period = 'custom';
      this.openCustomRange();
      return;
    }
    this.showCustomRange = false;
    this.period = value;
    this.applyFilters();
  }

  openCustomRange(): void {
    this.customRangeError = '';
    this.customFrom = this.appliedFrom;
    this.customTo = this.appliedTo;
    if (!this.customFrom) {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      this.customFrom = inputDate(from);
      this.customTo = this.maxDate;
    }
    this.showCustomRange = true;
  }

  applyCustomRange(): void {
    if (!this.customFrom || !this.customTo) {
      this.customRangeError = 'Please select both a start date and an end date.';
      return;
    }
    if (this.customFrom > this.customTo) {
      this.customRangeError = 'Start date must be on or before the end date.';
      return;
    }
    this.appliedFrom = this.customFrom;
    this.appliedTo = this.customTo;
    this.showCustomRange = false;
    this.applyFilters();
  }

  cancelCustomRange(): void {
    this.showCustomRange = false;
    if (!this.appliedFrom) this.period = this.previousPeriod;
  }

  get appliedRangeText(): string {
    return this.appliedFrom ? `${displayDate(this.appliedFrom)} – ${displayDate(this.appliedTo)}` : '';
  }

  get hasFilters(): boolean {
    return !!(this.q.trim() || this.adminRole || this.actionType || this.period !== '7');
  }

  clearFilters(): void {
    this.q = '';
    this.adminRole = '';
    this.actionType = '';
    this.period = '7';
    this.previousPeriod = '7';
    this.showCustomRange = false;
    this.appliedFrom = '';
    this.appliedTo = '';
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

  roleLabel(role: AdminRole): string {
    return ADMIN_ROLE_LABELS[role] || role;
  }

  changes(row: ActivityLogEntry): FieldChange[] {
    return diffValues(row.old_value, row.new_value);
  }

  /** Nothing to compare against (e.g. a new note): the drawer shows the New box alone */
  hasOldValues(list: FieldChange[]): boolean {
    return list.some((change) => change.before !== null);
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
    if (this.showCustomRange) this.cancelCustomRange();
    else this.selected = null;
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
