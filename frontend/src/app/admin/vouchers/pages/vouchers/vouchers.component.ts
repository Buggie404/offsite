import { Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { LucideChevronDown, LucidePencil, LucidePlus, LucideSearch, LucideTriangleAlert, LucideX } from '@lucide/angular';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import {
  AdminVoucher,
  AdminVouchersService,
  DiscountKind,
  VoucherKind,
  VoucherPerformance,
  VoucherStatus,
  VoucherTier
} from '../../services/admin-vouchers.service';

type StatusFilter = VoucherStatus | 'all';
type TierFilter = '' | VoucherTier;

interface VoucherForm {
  code: string;
  voucher_type: VoucherKind;
  discount_type: DiscountKind;
  discount_value: string;
  min_order_amount: string;
  max_discount_value: string;
  valid_from: string;
  valid_to: string;
  usage_limit: string;
  target_tier: TierFilter;
  purpose: 'campaign' | 'complaint';
  assigned_user: string;
  related_ref: string;
  reason: string;
}

const EMPTY_FORM: VoucherForm = {
  code: '',
  voucher_type: 'discount',
  discount_type: 'percentage',
  discount_value: '',
  min_order_amount: '',
  max_discount_value: '',
  valid_from: '',
  valid_to: '',
  usage_limit: '',
  target_tier: '',
  purpose: 'campaign',
  assigned_user: '',
  related_ref: '',
  reason: ''
};

@Component({
  selector: 'app-admin-vouchers',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideSearch, LucidePlus, LucidePencil, LucideX, LucideChevronDown, LucideTriangleAlert],
  templateUrl: './vouchers.component.html',
  styleUrl: './vouchers.component.scss'
})
export class VouchersComponent implements OnInit {
  private vouchersService = inject(AdminVouchersService);
  private adminAuth = inject(AdminAuthService);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyRef = inject(DestroyRef);
  private search$ = new Subject<string>();
  private listVersion = 0;
  private perfVersion = 0;

  readonly statuses: { value: StatusFilter; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'expired', label: 'Expired' },
    { value: 'all', label: 'All' }
  ];
  readonly types: { value: '' | VoucherKind; label: string }[] = [
    { value: '', label: 'Any type' },
    { value: 'discount', label: 'Discount' },
    { value: 'shipping', label: 'Shipping' }
  ];
  readonly tiers: { value: TierFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'seed', label: 'Seed' },
    { value: 'leaf', label: 'Leaf' },
    { value: 'bloom', label: 'Bloom' },
    { value: 'zen', label: 'Zen' }
  ];

  vouchers: AdminVoucher[] = [];
  total = 0;
  loading = true;
  error = '';
  query = '';
  queryApplied = '';
  status: StatusFilter = 'active';
  type: '' | VoucherKind = '';
  selectedId = '';

  performance: VoucherPerformance | null = null;
  performanceLoading = false;
  performanceError = '';

  modalOpen = false;
  modalMode: 'create' | 'edit' = 'create';
  editing: AdminVoucher | null = null;
  form: VoucherForm = { ...EMPTY_FORM };
  submitAttempted = false;
  saving = false;
  saveError = '';
  notice = '';

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.queryApplied = value.trim();
        this.keepSelection();
      });
    this.load();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.modalOpen && !this.saving) this.closeModal();
  }

  load(): void {
    const version = ++this.listVersion;
    this.loading = true;
    this.error = '';
    this.vouchersService.list().subscribe({
      next: (res) => {
        if (version !== this.listVersion) return;
        this.vouchers = res.data;
        this.total = res.total;
        this.loading = false;
        this.keepSelection();
      },
      error: (err) => {
        if (version !== this.listVersion) return;
        this.loading = false;
        this.error = err?.error?.error || 'Vouchers could not be loaded.';
      }
    });
  }

  get visible(): AdminVoucher[] {
    const q = this.queryApplied.toLowerCase();
    return this.vouchers.filter((voucher) => {
      if (this.status !== 'all' && voucher.status !== this.status) return false;
      if (this.type && voucher.voucher_type !== this.type) return false;
      if (q && !voucher.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  get selected(): AdminVoucher | null {
    return this.vouchers.find((voucher) => voucher._id === this.selectedId) || null;
  }

  onSearch(value: string): void {
    this.query = value;
    this.search$.next(value);
  }

  setStatus(status: StatusFilter): void {
    this.status = status;
    this.keepSelection();
  }

  setType(type: '' | VoucherKind): void {
    this.type = type;
    this.keepSelection();
  }

  select(voucher: AdminVoucher): void {
    if (this.selectedId === voucher._id) return;
    this.selectedId = voucher._id;
    this.loadPerformance(voucher._id);
  }

  get role() {
    return this.adminAuth.getAdminRole();
  }

  // Admin CC and QLSP edit and stop. CSKH only views and creates a complaint voucher.
  get canManage(): boolean {
    return this.role === 'admin_cc' || this.role === 'qlsp';
  }

  get complaintOnly(): boolean {
    return this.role === 'cskh';
  }

  get complaintMode(): boolean {
    return this.modalMode === 'create' && (this.complaintOnly || this.form.purpose === 'complaint');
  }

  get canStop(): boolean {
    return this.canManage && this.modalMode === 'edit' && !!this.editing?.is_active;
  }

  openCreate(): void {
    this.modalMode = 'create';
    this.editing = null;
    this.form = {
      ...EMPTY_FORM,
      ...(this.complaintOnly
        ? { purpose: 'complaint' as const, voucher_type: 'discount' as const, discount_type: 'fixed' as const, usage_limit: '1' }
        : {})
    };
    this.submitAttempted = false;
    this.saveError = '';
    this.modalOpen = true;
  }

  setPurpose(purpose: 'campaign' | 'complaint'): void {
    this.form.purpose = purpose;
    if (purpose === 'complaint') {
      this.form.voucher_type = 'discount';
      this.form.discount_type = 'fixed';
      this.form.usage_limit = '1';
      this.form.target_tier = '';
    }
  }

  openEdit(voucher: AdminVoucher, event?: Event): void {
    event?.stopPropagation();
    if (!this.canManage) return;
    this.select(voucher);
    this.modalMode = 'edit';
    this.editing = voucher;
    this.form = {
      code: voucher.code,
      voucher_type: voucher.voucher_type,
      discount_type: voucher.discount_type,
      discount_value: String(voucher.discount_value),
      min_order_amount: voucher.min_order_amount ? String(voucher.min_order_amount) : '',
      max_discount_value: voucher.max_discount_value != null ? String(voucher.max_discount_value) : '',
      valid_from: voucher.valid_from,
      valid_to: voucher.valid_to,
      usage_limit: voucher.usage_limit != null ? String(voucher.usage_limit) : '',
      target_tier: voucher.target_tier || '',
      purpose: voucher.purpose === 'complaint' ? 'complaint' : 'campaign',
      assigned_user: voucher.assigned_user_id || '',
      related_ref: '',
      reason: ''
    };
    this.submitAttempted = false;
    this.saveError = '';
    this.modalOpen = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.modalOpen = false;
  }

  get locked(): boolean {
    return this.modalMode === 'edit' && (this.editing?.used_count || 0) > 0;
  }

  get modalTitle(): string {
    if (this.modalMode === 'create') return 'Create voucher';
    return `Edit voucher · ${this.editing?.code || this.form.code}`;
  }

  fieldError(field: keyof VoucherForm | 'max_discount_value'): string {
    return this.issues()[field] || '';
  }

  save(): void {
    this.submitAttempted = true;
    this.saveError = '';
    const issues = this.issues();
    if (Object.keys(issues).length) return;

    const complaint = this.complaintMode;
    const payload = {
      code: this.form.code.trim().toUpperCase(),
      voucher_type: complaint ? 'discount' as const : this.form.voucher_type,
      discount_type: complaint ? 'fixed' as const : this.form.discount_type,
      discount_value: this.numberOrNull(this.form.discount_value),
      min_order_amount: this.form.min_order_amount.trim() === '' ? 0 : this.numberOrNull(this.form.min_order_amount),
      max_discount_value: this.form.max_discount_value.trim() === '' ? null : this.numberOrNull(this.form.max_discount_value),
      valid_from: this.form.valid_from,
      valid_to: this.form.valid_to,
      usage_limit: complaint
        ? 1
        : (this.form.usage_limit.trim() === '' ? null : this.numberOrNull(this.form.usage_limit)),
      target_tier: complaint ? null : (this.form.target_tier || null),
      purpose: complaint ? 'complaint' as const : 'campaign' as const,
      ...(complaint
        ? {
            assigned_user_id: this.form.assigned_user.trim(),
            related_ref: this.form.related_ref.trim(),
            reason: this.form.reason.trim()
          }
        : {})
    };

    this.saving = true;
    const request = this.modalMode === 'create'
      ? this.vouchersService.create(payload)
      : this.vouchersService.update(this.editing!._id, payload);

    request.subscribe({
      next: (res) => {
        const created = this.modalMode === 'create';
        this.finishSave(res.data, created ? 'Voucher created.' : 'Voucher saved.');
      },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'The voucher could not be saved.';
      }
    });
  }

  stop(): void {
    if (!this.editing || !this.canStop || this.saving) return;
    const code = this.editing.code;
    if (!window.confirm(`Stop ${code}? Customers will no longer be able to use it. Past orders keep their discount.`)) return;
    this.saving = true;
    this.saveError = '';
    this.vouchersService.stop(this.editing._id).subscribe({
      next: (res) => this.finishSave(res.data, 'Voucher stopped.'),
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'The voucher could not be stopped.';
      }
    });
  }

  private finishSave(voucher: AdminVoucher, message: string): void {
    this.saving = false;
    this.modalOpen = false;
    const index = this.vouchers.findIndex((row) => row._id === voucher._id);
    if (index >= 0) {
      this.vouchers[index] = voucher;
    } else {
      this.vouchers = [voucher, ...this.vouchers];
      this.total += 1;
    }
    this.status = voucher.status === 'inactive' ? 'all' : voucher.status;
    this.type = '';
    this.query = '';
    this.queryApplied = '';
    this.selectedId = voucher._id;
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = '';
      this.noticeTimer = null;
    }, 4000);
    this.loadPerformance(voucher._id);
  }

  usedLabel(voucher: AdminVoucher): string {
    const used = this.compact(voucher.used_count);
    if (voucher.usage_limit == null) return used;
    return `${used} / ${this.compact(voucher.usage_limit)}`;
  }

  showMeter(voucher: AdminVoucher): boolean {
    return voucher.used_count > 0 && voucher.usage_limit != null && voucher.usage_limit > 0;
  }

  meterWidth(voucher: AdminVoucher): number {
    if (!voucher.usage_limit) return 0;
    return Math.max(0, Math.min(100, (voucher.used_count / voucher.usage_limit) * 100));
  }

  valueLabel(voucher: AdminVoucher): string {
    if (voucher.discount_type === 'percentage') return `${this.trimNumber(voucher.discount_value)}%`;
    return this.money(voucher.discount_value);
  }

  minLabel(voucher: AdminVoucher): string {
    return voucher.min_order_amount > 0 ? this.money(voucher.min_order_amount) : '—';
  }

  validityLabel(voucher: AdminVoucher): string {
    return `${this.formatDay(voucher.valid_from)} – ${this.formatDay(voucher.valid_to)}`;
  }

  shortName(name: string | null): string {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
  }

  typeLabel(kind: VoucherKind): string {
    return kind === 'shipping' ? 'Shipping' : 'Discount';
  }

  statusLabel(status: VoucherStatus): string {
    if (status === 'inactive') return 'Inactive';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  limitCaption(perf: VoucherPerformance): string {
    if (perf.usage_limit == null) return 'no usage limit';
    return `of ${this.compact(perf.usage_limit)} limit`;
  }

  rangeLabel(perf: VoucherPerformance): string {
    return `${this.formatDay(perf.range_from)} – ${this.formatDay(perf.range_to)}`;
  }

  barHeight(count: number): number {
    const max = Math.max(...(this.performance?.buckets.map((bucket) => bucket.count) || [0]));
    if (!max || !count) return 0;
    return Math.max(8, (count / max) * 100);
  }

  axisLabels(perf: VoucherPerformance): string[] {
    const span = this.daysBetween(perf.range_from, perf.range_to);
    const points = [0, Math.round(span / 3), Math.round((span * 2) / 3), span];
    return [...new Set(points.map((offset) => this.addDays(perf.range_from, offset)))].map((day) => this.formatDay(day));
  }

  warningCount(): number {
    return this.editing?.used_count || 0;
  }

  private keepSelection(): void {
    const rows = this.visible;
    if (!rows.length) {
      this.selectedId = '';
      this.performance = null;
      this.performanceError = '';
      return;
    }
    const chosen = rows.find((voucher) => voucher._id === this.selectedId) || rows[0];
    const needsStats = chosen._id !== this.selectedId || this.performance?.code !== chosen.code;
    this.selectedId = chosen._id;
    if (needsStats) this.loadPerformance(chosen._id);
  }

  private loadPerformance(id: string): void {
    const version = ++this.perfVersion;
    this.performanceLoading = true;
    this.performanceError = '';
    if (this.performance && this.selected?.code !== this.performance.code) this.performance = null;
    this.vouchersService.performance(id).subscribe({
      next: (res) => {
        if (version !== this.perfVersion) return;
        this.performance = res.data;
        this.performanceLoading = false;
      },
      error: (err) => {
        if (version !== this.perfVersion) return;
        this.performance = null;
        this.performanceLoading = false;
        this.performanceError = err?.error?.error || 'Performance could not be loaded.';
      }
    });
  }

  private issues(): Partial<Record<keyof VoucherForm, string>> {
    const form = this.form;
    const issues: Partial<Record<keyof VoucherForm, string>> = {};
    const value = this.numberOrNull(form.discount_value);
    const min = form.min_order_amount.trim() === '' ? 0 : this.numberOrNull(form.min_order_amount);
    const max = form.max_discount_value.trim() === '' ? null : this.numberOrNull(form.max_discount_value);
    const usage = form.usage_limit.trim() === '' ? null : this.numberOrNull(form.usage_limit);
    const valueTouched = form.discount_value.trim() !== '';

    if (form.valid_from && form.valid_to && form.valid_to <= form.valid_from) {
      issues.valid_to = 'End date must be after start date.';
    } else if (this.complaintMode && form.valid_from && form.valid_to && this.daysBetween(form.valid_from, form.valid_to) > 30) {
      issues.valid_to = 'A complaint voucher can last at most 30 days.';
    } else if (this.submitAttempted && !form.valid_to) {
      issues.valid_to = 'Choose an end date.';
    }
    if (this.submitAttempted && !form.valid_from) issues.valid_from = 'Choose a start date.';
    if ((this.submitAttempted || form.usage_limit.trim() !== '') && usage != null && (!Number.isInteger(usage) || usage <= 0)) {
      issues.usage_limit = 'Usage limit must be a whole number greater than 0, or left empty for no limit.';
    } else if (usage != null && this.editing && usage < this.editing.used_count) {
      issues.usage_limit = 'Usage limit cannot be lower than uses already recorded.';
    }
    if (this.locked) return issues;

    if (this.submitAttempted && !form.code.trim()) issues.code = 'Code is required.';
    if (valueTouched || this.submitAttempted) {
      if (value == null) issues.discount_value = 'Enter a discount value.';
      else if (form.discount_type === 'percentage' && value < 1) issues.discount_value = 'Percentage must be at least 1.';
      else if (form.discount_type === 'percentage' && value > 100) issues.discount_value = 'Percentage cannot exceed 100.';
      else if (form.discount_type === 'fixed' && value <= 0) issues.discount_value = 'Amount must be greater than 0.';
      else if (this.complaintMode && value > 10) issues.discount_value = 'A complaint voucher cannot exceed $10.';
      else if (form.discount_type === 'fixed' && min != null && min > 0 && value >= min) {
        issues.discount_value = 'Fixed amount must be less than the minimum order.';
      }
    }
    if (this.complaintMode && this.submitAttempted) {
      if (!form.assigned_user.trim()) issues.assigned_user = 'Enter the customer this voucher is for.';
      if (!form.related_ref.trim()) issues.related_ref = 'Enter the order or conversation this voucher relates to.';
      if (!form.reason.trim()) issues.reason = 'A reason is required for a complaint voucher.';
    }
    if (form.discount_type === 'percentage' && value != null && value >= 30 && value <= 100 && !(max != null && max > 0)) {
      issues.max_discount_value = 'Enter a maximum discount for percentages of 30% or more.';
    }
    if (min != null && min < 0) issues.min_order_amount = 'Minimum order cannot be negative.';
    return issues;
  }

  private numberOrNull(value: string): number | null {
    const trimmed = value.trim().replace(/[$,\s]/g, '');
    if (!trimmed) return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
  }

  money(value: number): string {
    const whole = Number.isInteger(value);
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
  }

  private compact(value: number): string {
    return value.toLocaleString('en-US');
  }

  private trimNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  }

  private formatDay(iso: string): string {
    const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private addDays(iso: string, days: number): string {
    const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private daysBetween(start: string, end: string): number {
    const ms = Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
    return Math.max(0, Math.round(ms / 86400000));
  }
}
