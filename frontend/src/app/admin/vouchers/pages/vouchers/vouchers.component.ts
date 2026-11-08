import { ChangeDetectorRef, Component, DestroyRef, EventEmitter, HostListener, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { LucideChevronDown, LucideInfo, LucidePencil, LucidePlus, LucideSearch, LucideTriangleAlert, LucideX } from '@lucide/angular';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { ADMIN_ROLE_LABELS, AdminRole } from '../../../../shared/models/admin-role.model';
import {
  AdminVoucher,
  AdminVouchersService,
  CustomerSuggestion,
  DiscountKind,
  VoucherKind,
  VoucherPerformance,
  VoucherStatus,
  VoucherTier
} from '../../services/admin-vouchers.service';

type StatusFilter = VoucherStatus | 'all';
type TierFilter = '' | VoucherTier;
type PurposeFilter = '' | 'campaign' | 'complaint' | 'loyalty' | 'referral';
type FormField = keyof VoucherForm;

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
  message: string;
  expires_in: string;
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
  reason: '',
  message: '',
  expires_in: '30'
};

@Component({
  selector: 'app-admin-vouchers',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideSearch, LucidePlus, LucidePencil, LucideX, LucideChevronDown, LucideTriangleAlert, LucideInfo],
  templateUrl: './vouchers.component.html',
  styleUrl: './vouchers.component.scss'
})
export class VouchersComponent implements OnInit {
  @Input() chatCustomer: { user_id: string; profile_name: string; conversation_id: string } | null = null;
  @Output() dismissed = new EventEmitter<void>();
  @Output() created = new EventEmitter<{ voucher: AdminVoucher; message: string; conversation_id: string }>();
  private route = inject(ActivatedRoute);
  private vouchersService = inject(AdminVouchersService);
  private adminAuth = inject(AdminAuthService);
  private cdr = inject(ChangeDetectorRef);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyRef = inject(DestroyRef);
  private search$ = new Subject<string>();
  private customer$ = new Subject<string>();
  private listVersion = 0;
  private perfVersion = 0;
  private readonly touched = new Set<FormField>();

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
  readonly purposes: { value: PurposeFilter; label: string }[] = [
    { value: '', label: 'All purposes' },
    { value: 'campaign', label: 'Campaign' },
    { value: 'complaint', label: 'Complaint' },
    { value: 'loyalty', label: 'Loyalty' },
    { value: 'referral', label: 'Referral' }
  ];
  readonly expireChoices = [
    { value: '7', label: '7 days' },
    { value: '14', label: '14 days' },
    { value: '30', label: '30 days' }
  ];

  vouchers: AdminVoucher[] = [];
  total = 0;
  loading = true;
  error = '';
  query = '';
  queryApplied = '';
  status: StatusFilter = 'active';
  type: '' | VoucherKind = '';
  purpose: PurposeFilter = '';
  page = 1;
  selectedId = '';
  customerQuery = '';
  customerName = '';
  customerHits: CustomerSuggestion[] = [];
  previewCode = '';

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
    if (this.chatCustomer) {
      this.openCreate();
      this.setPurpose('complaint');
      this.pickCustomer(this.chatCustomer);
      return;
    }
    this.search$
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.queryApplied = value.trim();
        this.page = 1;
        this.selectedId = '';
        this.load();
      });
    this.customer$
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.fetchCustomers(value));
    this.load();
    const params = this.route.snapshot.queryParamMap;
    if (params.get('create') === 'complaint' && params.get('customer_id')) {
      this.openCreate(); this.setPurpose('complaint');
      this.pickCustomer({
        user_id: params.get('customer_id')!,
        profile_name: params.get('customer_name') || params.get('customer_id')!
      });
      this.customerQuery = this.customerName;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.modalOpen && !this.saving) this.closeModal();
  }

  load(): void {
    const version = ++this.listVersion;
    this.loading = this.vouchers.length === 0;
    this.error = '';
    this.paint();
    this.vouchersService.list({
      page: this.page,
      q: this.queryApplied,
      status: this.status,
      type: this.type,
      purpose: this.purpose
    }).subscribe({
      next: (res) => this.applyList(version, res),
      error: (err) => this.failList(version, err)
    });
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / 20));
  }

  get selected(): AdminVoucher | null {
    return this.vouchers.find((voucher) => voucher._id === this.selectedId) || null;
  }

  onSearch(value: string): void {
    this.query = value;
    this.search$.next(value);
  }

  setStatus(status: StatusFilter): void {
    if (this.status === status) return;
    this.status = status;
    this.page = 1;
    this.selectedId = '';
    this.load();
  }

  setType(type: '' | VoucherKind): void {
    if (this.type === type) return;
    this.type = type;
    this.page = 1;
    this.selectedId = '';
    this.load();
  }

  setPurposeFilter(purpose: PurposeFilter): void {
    if (this.purpose === purpose) return;
    this.purpose = purpose;
    this.page = 1;
    this.selectedId = '';
    this.load();
  }

  goTo(page: number): void {
    if (page < 1 || page > this.pageCount || page === this.page) return;
    this.page = page;
    this.selectedId = '';
    this.load();
  }

  select(voucher: AdminVoucher): void {
    if (this.selectedId === voucher._id) return;
    this.selectedId = voucher._id;
    this.showPerformance(voucher, true);
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
      ...(this.complaintOnly ? { purpose: 'complaint' as const, discount_type: 'percentage' as const, usage_limit: '1', expires_in: '30' } : {})
    };
    this.touched.clear();
    this.customerQuery = '';
    this.customerName = '';
    this.customerHits = [];
    this.previewCode = '';
    this.submitAttempted = false;
    this.saveError = '';
    this.modalOpen = true;
  }

  setPurpose(purpose: 'campaign' | 'complaint'): void {
    this.form.purpose = purpose;
    if (purpose === 'complaint') {
      this.form.voucher_type = 'discount';
      this.form.discount_type = 'percentage';
      this.form.usage_limit = '1';
      this.form.target_tier = '';
      this.form.expires_in = this.form.expires_in || '30';
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
      valid_from: this.formatDmy(voucher.valid_from),
      valid_to: this.formatDmy(voucher.valid_to),
      usage_limit: voucher.usage_limit != null ? String(voucher.usage_limit) : '',
      target_tier: voucher.target_tier || '',
      purpose: voucher.purpose === 'complaint' ? 'complaint' : 'campaign',
      assigned_user: voucher.assigned_user_id || '',
      related_ref: '',
      reason: '',
      message: '',
      expires_in: '30'
    };
    this.touched.clear();
    this.customerQuery = voucher.assigned_user_name || voucher.assigned_user_id || '';
    this.customerName = voucher.assigned_user_name || '';
    this.customerHits = [];
    this.submitAttempted = false;
    this.saveError = '';
    this.modalOpen = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.modalOpen = false;
    this.dismissed.emit();
  }

  get locked(): boolean {
    return this.modalMode === 'edit' && (this.editing?.used_count || 0) > 0;
  }

  get modalTitle(): string {
    if (this.complaintMode) return 'Create personal voucher';
    if (this.modalMode === 'create') return 'Create voucher';
    return `Edit voucher · ${this.editing?.code || this.form.code}`;
  }

  get canSubmit(): boolean {
    return !this.saving && Object.keys(this.issues(true)).length === 0;
  }

  get saveLabel(): string {
    if (this.saving) return 'Saving…';
    return this.modalMode === 'create' ? 'Create voucher' : 'Save changes';
  }

  fieldError(field: FormField): string {
    const live = this.issues(false)[field];
    if (live) return live;
    if (this.submitAttempted || this.touched.has(field)) return this.issues(true)[field] || '';
    return '';
  }

  touch(field: FormField): void {
    this.touched.add(field);
  }

  onAmount(field: 'discount_value' | 'min_order_amount' | 'max_discount_value', value: string): void {
    const cleaned = value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    this.form[field] = cleaned;
    this.touch(field);
  }

  onWhole(field: 'usage_limit' | 'discount_value', value: string): void {
    this.form[field] = value.replace(/\D/g, '');
    this.touch(field);
  }

  onCustomerInput(value: string): void {
    this.customerQuery = value;
    this.form.assigned_user = '';
    this.customerName = '';
    this.previewCode = '';
    this.touch('assigned_user');
    this.customer$.next(value.trim());
  }

  pickCustomer(hit: Pick<CustomerSuggestion, 'user_id' | 'profile_name'>): void {
    this.form.assigned_user = hit.user_id;
    this.customerName = hit.profile_name;
    this.customerQuery = `${hit.profile_name} · ${hit.user_id}`;
    this.customerHits = [];
    this.touch('assigned_user');
    const name = hit.profile_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'CUST';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 3; i += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    this.previewCode = `PERS-${name}-${suffix}`;
  }

  purposeLabel(purpose: string): string {
    if (purpose === 'complaint') return 'Complaint';
    if (purpose === 'loyalty_redeem' || purpose === 'archetype') return 'Loyalty';
    if (purpose === 'referral') return 'Referral';
    return 'Campaign';
  }

  roleLabel(role: string | null): string {
    if (!role || !(role in ADMIN_ROLE_LABELS)) return '';
    return ADMIN_ROLE_LABELS[role as AdminRole];
  }

  save(): void {
    this.submitAttempted = true;
    this.saveError = '';
    const issues = this.issues(true);
    if (Object.keys(issues).length) return;

    const complaint = this.complaintMode;
    const range = complaint ? this.complaintRange() : { from: this.parseDmy(this.form.valid_from), to: this.parseDmy(this.form.valid_to) };
    const payload = {
      code: (complaint ? this.previewCode : this.form.code).trim().toUpperCase(),
      voucher_type: complaint ? 'discount' as const : this.form.voucher_type,
      discount_type: this.form.discount_type,
      discount_value: this.numberOrNull(this.form.discount_value),
      min_order_amount: this.form.min_order_amount.trim() === '' ? 0 : this.numberOrNull(this.form.min_order_amount),
      max_discount_value: complaint || this.form.max_discount_value.trim() === '' ? null : this.numberOrNull(this.form.max_discount_value),
      valid_from: range.from || '',
      valid_to: range.to || '',
      usage_limit: complaint
        ? 1
        : (this.form.usage_limit.trim() === '' ? null : this.numberOrNull(this.form.usage_limit)),
      target_tier: complaint ? null : (this.form.target_tier || null),
      purpose: complaint ? 'complaint' as const : (this.editing?.purpose === 'complaint' ? 'complaint' as const : 'campaign' as const),
      ...(complaint
        ? {
            assigned_user_id: this.form.assigned_user.trim(),
            reason: this.form.reason.trim(),
            message: this.form.message.trim()
          }
        : {})
    };

    this.saving = true;
    const request = this.modalMode === 'create'
      ? this.vouchersService.create(payload)
      : null;

    if (!request && this.editing) {
      const editing = this.editing;
      const previousRows = this.vouchers.map((row) => ({ ...row }));
      const previousPerformance = this.performance;
      const preview = this.previewEdit(payload, editing);
      this.applyRow(preview, 'Voucher saved.');
      this.vouchersService.update(editing._id, payload).subscribe({
        next: (res) => this.applyRow(this.withNames(res.data, preview), 'Voucher saved.'),
        error: (err) => {
          this.vouchers = previousRows;
          this.performance = previousPerformance;
          this.selectedId = editing._id;
          this.editing = editing;
          this.modalMode = 'edit';
          this.modalOpen = true;
          this.saving = false;
          this.notice = '';
          this.saveError = err?.error?.error || 'The voucher could not be saved.';
          this.paint();
        }
      });
      return;
    }

    request!.subscribe({
      next: (res) => {
        if (this.chatCustomer) {
          this.saving = false;
          this.modalOpen = false;
          this.created.emit({ voucher: res.data, message: this.form.message.trim(), conversation_id: this.chatCustomer.conversation_id });
          return;
        }
        this.applyRow(res.data, 'Voucher created.');
      },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'The voucher could not be saved.';
        this.paint();
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
      next: (res) => this.applyRow(this.withNames(res.data, this.editing!), 'Voucher stopped.'),
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'The voucher could not be stopped.';
        this.paint();
      }
    });
  }

  private applyRow(voucher: AdminVoucher, message: string): void {
    this.saving = false;
    this.modalOpen = false;
    const index = this.vouchers.findIndex((row) => row._id === voucher._id);
    const visible = this.status === 'all' || voucher.status === this.status;
    if (!visible) {
      if (index >= 0) this.vouchers = this.vouchers.filter((row) => row._id !== voucher._id);
      this.selectedId = this.vouchers[0]?._id || '';
      if (this.selected) this.showPerformance(this.selected, true);
      else this.performance = null;
    } else if (index >= 0) {
      this.vouchers[index] = voucher;
      this.selectedId = voucher._id;
      this.showPerformance(voucher, false);
    } else {
      this.vouchers = [voucher, ...this.vouchers];
      this.total += 1;
      this.selectedId = voucher._id;
      this.showPerformance(voucher, voucher.used_count > 0);
    }
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = '';
      this.noticeTimer = null;
      this.paint();
    }, 4000);
    this.paint();
  }

  private previewEdit(payload: { code: string; voucher_type: VoucherKind; discount_type: DiscountKind; discount_value: number | null; min_order_amount: number | null; max_discount_value: number | null; valid_from: string; valid_to: string; usage_limit: number | null; target_tier: VoucherTier | null }, editing: AdminVoucher): AdminVoucher {
    const today = this.businessToday();
    let status = editing.status;
    if (!editing.is_active) status = 'inactive';
    else if (today < payload.valid_from) status = 'upcoming';
    else if (today > payload.valid_to) status = 'expired';
    else status = 'active';
    return {
      ...editing,
      code: payload.code,
      voucher_type: payload.voucher_type,
      discount_type: payload.discount_type,
      discount_value: payload.discount_value || 0,
      min_order_amount: payload.min_order_amount || 0,
      max_discount_value: payload.max_discount_value,
      valid_from: payload.valid_from,
      valid_to: payload.valid_to,
      usage_limit: payload.usage_limit,
      target_tier: payload.target_tier,
      status
    };
  }

  private withNames(saved: AdminVoucher, previous: AdminVoucher): AdminVoucher {
    return {
      ...previous,
      ...saved,
      created_by_name: saved.created_by_name || previous.created_by_name,
      created_by_role: saved.created_by_role || previous.created_by_role,
      assigned_user_name: saved.assigned_user_name || previous.assigned_user_name
    };
  }

  private showPerformance(voucher: AdminVoucher, refreshUsed: boolean): void {
    if (this.performance?.code === voucher.code && voucher.used_count > 0) {
      this.performance = { ...this.performance, used_count: voucher.used_count, usage_limit: voucher.usage_limit };
      this.performanceLoading = false;
      return;
    }
    this.performance = this.localEmpty(voucher);
    this.performanceError = '';
    this.performanceLoading = false;
    if (refreshUsed && voucher.used_count > 0) this.loadPerformance(voucher._id);
  }

  private localEmpty(voucher: AdminVoucher): VoucherPerformance {
    const today = this.businessToday();
    const from = voucher.valid_from || today;
    const to = voucher.valid_to || today;
    let start = from;
    let end = to < today ? to : today;
    if (from > today) {
      end = this.addDays(from, Math.min(29, this.daysBetween(from, to)));
    } else {
      const earliest = this.addDays(end, -29);
      start = from > earliest ? from : earliest;
      if (end < start) end = start;
    }
    const span = Math.max(1, this.daysBetween(start, end) + 1);
    const bucketCount = Math.min(12, span);
    const size = span / bucketCount;
    return {
      code: voucher.code,
      used_count: voucher.used_count,
      usage_limit: voucher.usage_limit,
      times_used: 0,
      total_discounted: 0,
      revenue: 0,
      range_from: start,
      range_to: end,
      buckets: Array.from({ length: bucketCount }, (_, index) => ({
        start: this.addDays(start, Math.floor(index * size)),
        end: index === bucketCount - 1 ? end : this.addDays(start, Math.floor((index + 1) * size) - 1),
        count: 0
      }))
    };
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

  private applyList(version: number, res: { data: AdminVoucher[]; total: number; page: number; performance: VoucherPerformance | null }): void {
    if (version !== this.listVersion) return;
    this.vouchers = res.data;
    this.total = res.total;
    this.page = res.page;
    this.loading = false;
    const chosen = this.vouchers.find((voucher) => voucher._id === this.selectedId) || this.vouchers[0];
    this.selectedId = chosen?._id || '';
    if (!chosen) {
      this.performance = null;
      this.performanceLoading = false;
      this.paint();
      return;
    }
    if (res.performance && res.performance.code === chosen.code) {
      this.performance = res.performance;
      this.performanceLoading = false;
      this.performanceError = '';
      this.paint();
      return;
    }
    this.showPerformance(chosen, true);
    this.paint();
  }

  private failList(version: number, err: { error?: { error?: string } }): void {
    if (version !== this.listVersion) return;
    this.loading = false;
    this.performanceLoading = false;
    this.error = err?.error?.error || 'Vouchers could not be loaded.';
    this.paint();
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
        this.paint();
      },
      error: (err) => {
        if (version !== this.perfVersion) return;
        this.performance = null;
        this.performanceLoading = false;
        this.performanceError = err?.error?.error || 'Performance could not be loaded.';
        this.paint();
      }
    });
  }

  private issues(strict: boolean): Partial<Record<FormField, string>> {
    const form = this.form;
    const issues: Partial<Record<FormField, string>> = {};
    const value = this.numberOrNull(form.discount_value);
    const min = form.min_order_amount.trim() === '' ? 0 : this.numberOrNull(form.min_order_amount);
    const max = form.max_discount_value.trim() === '' ? null : this.numberOrNull(form.max_discount_value);
    const usage = form.usage_limit.trim() === '' ? null : this.numberOrNull(form.usage_limit);
    const from = this.complaintMode ? this.complaintRange().from : this.parseDmy(form.valid_from);
    const to = this.complaintMode ? this.complaintRange().to : this.parseDmy(form.valid_to);

    if (!this.complaintMode) {
      if (form.valid_from.trim() && !from) issues.valid_from = 'Use the date format dd/mm/yyyy.';
      if (form.valid_to.trim() && !to) issues.valid_to = 'Use the date format dd/mm/yyyy.';
      if (from && to && to <= from) issues.valid_to = 'End date must be after start date.';
      if (strict && !form.valid_from.trim()) issues.valid_from = 'Choose a start date.';
      if (strict && !form.valid_to.trim()) issues.valid_to = 'Choose an end date.';
    }
    if (form.usage_limit.trim() !== '' && (usage == null || !Number.isInteger(usage) || usage <= 0)) {
      issues.usage_limit = 'Usage limit must be a whole number greater than 0, or left empty for no limit.';
    } else if (usage != null && this.editing && usage < this.editing.used_count) {
      issues.usage_limit = 'Usage limit cannot be lower than uses already recorded.';
    }
    if (form.min_order_amount.trim() && (min == null || min < 0)) issues.min_order_amount = 'Minimum order cannot be negative.';
    if (form.discount_value.trim()) {
      if (value == null) issues.discount_value = 'Enter a discount value.';
      else if (form.discount_type === 'percentage' && value < 1) issues.discount_value = 'Percentage must be at least 1.';
      else if (form.discount_type === 'percentage' && value > (this.complaintMode ? 20 : 100)) {
        issues.discount_value = this.complaintMode ? 'A complaint voucher cannot exceed 20%.' : 'Percentage cannot exceed 100.';
      } else if (form.discount_type === 'fixed' && value <= 0) issues.discount_value = 'Amount must be greater than 0.';
      else if (this.complaintMode && form.discount_type === 'fixed' && value > 10) issues.discount_value = 'A complaint voucher cannot exceed $10.';
      else if (form.discount_type === 'fixed' && min != null && min > 0 && value >= min) {
        issues.discount_value = 'Fixed amount must be less than the minimum order.';
      }
    } else if (strict) {
      issues.discount_value = 'Enter a discount value.';
    }
    if (!this.complaintMode && form.discount_type === 'percentage' && value != null && value >= 30 && value <= 100 && !(max != null && max > 0)) {
      issues.max_discount_value = 'Enter a maximum discount for percentages of 30% or more.';
    }
    if (form.max_discount_value.trim() && (max == null || max <= 0)) issues.max_discount_value = 'Maximum discount must be greater than 0.';
    if (this.locked) return issues;

    if (!this.complaintMode && strict && !form.code.trim()) issues.code = 'Code is required.';
    if (!this.complaintMode && form.code.trim() && !/^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(form.code.trim())) {
      issues.code = 'Use 2–30 letters, numbers, hyphens or underscores.';
    }
    if (this.complaintMode && strict && !form.assigned_user.trim()) issues.assigned_user = 'Choose a customer from the list.';
    if (this.complaintMode && strict && !form.reason.trim()) issues.reason = 'A reason is required for a complaint voucher.';
    return issues;
  }

  private complaintRange(): { from: string | null; to: string | null } {
    const from = this.businessToday();
    const days = Number(this.form.expires_in) || 30;
    return { from, to: this.addDays(from, days) };
  }

  private businessToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  private parseDmy(value: string): string | null {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private formatDmy(iso: string): string {
    const [year, month, day] = String(iso || '').slice(0, 10).split('-');
    if (!year || !month || !day) return '';
    return `${day}/${month}/${year}`;
  }

  private fetchCustomers(query: string): void {
    if (query.length < 1) {
      this.customerHits = [];
      this.paint();
      return;
    }
    this.vouchersService.searchCustomers(query).subscribe({
      next: (res) => {
        if (this.customerQuery.trim() === query) this.customerHits = res.data;
        this.paint();
      },
      error: () => {
        if (this.customerQuery.trim() === query) this.customerHits = [];
        this.paint();
      }
    });
  }

  private paint(): void {
    this.cdr.markForCheck();
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
