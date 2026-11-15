import { ChangeDetectorRef, Component, DestroyRef, EventEmitter, HostListener, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { LucideCalendar, LucideCheck, LucideChevronDown, LucideCircleAlert, LucideInfo, LucideLock, LucidePencil, LucidePlus, LucideSearch, LucideTriangleAlert, LucideX } from '@lucide/angular';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { ADMIN_ROLE_LABELS, AdminRole } from '../../../../shared/models/admin-role.model';
import {
  AdminVoucher,
  AdminVouchersService,
  ComplaintQuota,
  CustomerSuggestion,
  DiscountKind,
  ScopeProduct,
  VoucherPurpose,
  VoucherScope,
  VoucherKind,
  VoucherPerformance,
  VoucherStatus,
  VoucherTier
} from '../../services/admin-vouchers.service';

type StatusFilter = VoucherStatus | 'all';
type TierFilter = '' | VoucherTier;
type PurposeFilter = '' | 'campaign' | 'complaint' | 'loyalty' | 'referral';
type FormField = keyof VoucherForm;

const SCOPE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'matcha', label: 'Matcha' },
  { value: 'coffee', label: 'Coffee' },
  { value: 'tools', label: 'Tools' },
  { value: 'drinkware', label: 'Drinkware' },
  { value: 'sets_bundles', label: 'Sets & bundles' }
];


const ORDER_ID_PATTERN = /OFS-\d{4}-\d{5}/i;

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
  purpose: VoucherPurpose;
  applies_to: VoucherScope;
  usage_limit_per_user: string;
  points_cost: string;
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
  applies_to: 'all',
  usage_limit_per_user: '1',
  points_cost: '',
  assigned_user: '',
  related_ref: '',
  reason: '',
  message: '',
  expires_in: '30'
};

@Component({
  selector: 'app-admin-vouchers',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideSearch, LucidePlus, LucidePencil, LucideX, LucideChevronDown, LucideTriangleAlert, LucideInfo, LucideCheck, LucideLock, LucideCircleAlert, LucideCalendar],
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
  private product$ = new Subject<string>();
  private code$ = new Subject<string>();
  private reason$ = new Subject<string>();
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
  readonly scopeCategories = SCOPE_CATEGORIES;
  readonly maxScopeProducts = 50;
  readonly typeChoices: { value: VoucherPurpose; label: string; hint: string }[] = [
    { value: 'campaign', label: 'Campaign', hint: 'All customers' },
    { value: 'loyalty_redeem', label: 'Loyalty', hint: 'By member tier' },
    { value: 'referral', label: 'Referral', hint: 'WELCOME, one use' },
    { value: 'complaint', label: 'Complaint', hint: 'One customer' }
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
  scopeCats: string[] = [];
  scopeProducts: ScopeProduct[] = [];
  productQuery = '';
  productHits: ScopeProduct[] = [];
  codeState: 'idle' | 'checking' | 'available' | 'taken' = 'idle';
  orderState: 'idle' | 'checking' | 'found' | 'error' = 'idle';
  orderMessage = '';
  orderId = '';
  orderTotal: number | null = null;
  quota: ComplaintQuota | null = null;

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
      this.listenForm();
      this.openCreate();
      this.setPurpose('complaint');
      this.pickCustomer(this.chatCustomer);
      return;
    }
    // The search box lives in the admin header and writes ?search= on this page.
    this.query = this.route.snapshot.queryParamMap.get('search') || '';
    this.queryApplied = this.query.trim();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const value = params.get('search') || '';
      if (value !== this.query) this.onSearch(value);
    });
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
    this.listenForm();
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

  get typeLocked(): boolean {
    return this.complaintOnly;
  }

  get canStop(): boolean {
    return this.canManage && this.modalMode === 'edit' && !!this.editing?.is_active;
  }

  openCreate(): void {
    this.modalMode = 'create';
    this.editing = null;
    this.form = {
      ...EMPTY_FORM,
      ...(this.complaintOnly ? { purpose: 'complaint' as const, discount_type: 'fixed' as const, usage_limit: '1', expires_in: '30' } : {})
    };
    this.resetExtras();
    this.submitAttempted = false;
    this.saveError = '';
    this.modalOpen = true;
    if (this.complaintOnly) this.loadQuota();
  }

  private resetExtras(): void {
    this.touched.clear();
    this.customerQuery = '';
    this.customerName = '';
    this.customerHits = [];
    this.previewCode = '';
    this.scopeCats = [];
    this.scopeProducts = [];
    this.productQuery = '';
    this.productHits = [];
    this.codeState = 'idle';
    this.orderState = 'idle';
    this.orderMessage = '';
    this.orderId = '';
    this.orderTotal = null;
  }

  /** Which voucher types this role may create (Senior Admin all, Sales Ops Campaign + Loyalty, Services Ops Complaint). */
  canCreateType(purpose: VoucherPurpose): boolean {
    if (this.role === 'admin_cc') return true;
    if (this.role === 'qlsp') return purpose === 'campaign' || purpose === 'loyalty_redeem';
    if (this.role === 'cskh') return purpose === 'complaint';
    return false;
  }

  setPurpose(purpose: VoucherPurpose): void {
    if (this.modalMode === 'create' && !this.canCreateType(purpose)) return;
    this.form.purpose = purpose;
    this.saveError = '';
    if (purpose === 'complaint') {
      this.form.voucher_type = 'discount';
      this.form.discount_type = 'fixed';
      this.form.usage_limit = '1';
      this.form.target_tier = '';
      this.form.applies_to = 'all';
      this.form.expires_in = this.form.expires_in || '30';
      this.loadQuota();
    } else if (purpose === 'referral') {
      this.form.applies_to = 'all';
      this.form.target_tier = '';
      this.form.usage_limit_per_user = '1';
    } else if (purpose === 'campaign') {
      this.form.target_tier = '';
    }
  }

  get scoped(): boolean {
    return (this.form.purpose === 'campaign' || this.form.purpose === 'loyalty_redeem') && this.form.voucher_type === 'discount';
  }

  setScope(scope: VoucherScope): void {
    if (this.locked || !this.scoped) return;
    this.form.applies_to = scope;
    this.touch('applies_to');
  }

  toggleCategory(value: string): void {
    if (this.locked) return;
    this.scopeCats = this.scopeCats.includes(value)
      ? this.scopeCats.filter((item) => item !== value)
      : [...this.scopeCats, value];
    this.touch('applies_to');
  }

  categoryLabel(value: string): string {
    return SCOPE_CATEGORIES.find((item) => item.value === value)?.label || value;
  }

  onProductInput(value: string): void {
    this.productQuery = value;
    const q = value.trim();
    if (q.length < 2) {
      this.productHits = [];
      return;
    }
    this.product$.next(q);
  }

  isPicked(product: ScopeProduct): boolean {
    return this.scopeProducts.some((item) => item._id === product._id);
  }

  addProduct(product: ScopeProduct): void {
    if (this.locked || this.isPicked(product) || this.scopeProducts.length >= this.maxScopeProducts) return;
    this.scopeProducts = [...this.scopeProducts, product];
    this.touch('applies_to');
  }

  removeProduct(product: ScopeProduct): void {
    if (this.locked) return;
    this.scopeProducts = this.scopeProducts.filter((item) => item._id !== product._id);
    this.touch('applies_to');
  }

  onCodeInput(value: string): void {
    this.form.code = value.toUpperCase();
    this.touch('code');
    const code = this.form.code.trim();
    this.codeState = /^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(code) ? 'checking' : 'idle';
    if (this.codeState === 'checking') this.code$.next(code);
  }

  onReasonInput(value: string): void {
    this.form.reason = value;
    this.touch('reason');
    this.reason$.next(value);
  }

  get complaintCap(): number | null {
    if (this.form.discount_type === 'percentage') return 20;
    return this.orderState === 'found' ? this.orderTotal : null;
  }

  get complaintExpiry(): string {
    return this.formatDmy(this.complaintRange().to || '');
  }

  get issueList(): { field: FormField; label: string; message: string }[] {
    const labels: Partial<Record<FormField, string>> = {
      code: 'Voucher code', discount_value: 'Value', min_order_amount: 'Min. order', max_discount_value: 'Max discount',
      valid_from: 'Valid from', valid_to: 'Valid to', usage_limit: 'Total uses', usage_limit_per_user: 'Per customer',
      target_tier: 'Member tier', points_cost: 'Points to redeem', applies_to: 'Scope', assigned_user: 'Customer', reason: 'Reason'
    };
    const issues = this.issues(true);
    return (Object.keys(issues) as FormField[])
      .filter((field) => this.submitAttempted || this.touched.has(field) || !!this.issues(false)[field])
      .map((field) => ({ field, label: labels[field] || field, message: issues[field] || '' }));
  }

  get issueLabels(): string {
    return this.issueList.map((item) => item.label).join(', ');
  }

  get hasPendingIssues(): boolean {
    return Object.keys(this.issues(true)).length > 0;
  }

  get purposeHint(): string {
    if (this.complaintMode) return 'For one customer, one use, valid for up to 30 days.';
    if (this.modalMode === 'edit') return this.locked ? 'Already used: only dates, usage limits and status can change.' : 'Edit the voucher terms.';
    return 'Pick a voucher type first. The fields below change to match.';
  }

  openEdit(voucher: AdminVoucher, event?: Event): void {
    event?.stopPropagation();
    if (!this.canManage) return;
    this.select(voucher);
    this.modalMode = 'edit';
    this.editing = voucher;
    const purpose: VoucherPurpose = voucher.purpose === 'complaint' ? 'complaint'
      : voucher.purpose === 'referral' ? 'referral'
      : voucher.purpose === 'loyalty_redeem' || voucher.purpose === 'archetype' ? 'loyalty_redeem'
      : 'campaign';
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
      purpose,
      applies_to: voucher.applies_to || 'all',
      usage_limit_per_user: voucher.usage_limit_per_user != null ? String(voucher.usage_limit_per_user) : '',
      points_cost: voucher.points_cost ? String(voucher.points_cost) : '',
      assigned_user: voucher.assigned_user_id || '',
      related_ref: voucher.related_ref || '',
      reason: '',
      message: '',
      expires_in: '30'
    };
    this.resetExtras();
    this.scopeCats = [...(voucher.applicable_categories || [])];
    if (voucher.applies_to === 'product' && voucher.applicable_product_ids?.length) {
      this.vouchersService.productsByIds(voucher.applicable_product_ids).subscribe({
        next: (res) => {
          const order = new Map(voucher.applicable_product_ids.map((id, index) => [id, index]));
          this.scopeProducts = [...res.data].sort((a, b) => (order.get(a._id) ?? 0) - (order.get(b._id) ?? 0));
          this.paint();
        }
      });
    }
    this.customerQuery = voucher.assigned_user_name || voucher.assigned_user_id || '';
    this.customerName = voucher.assigned_user_name || '';
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
    if (this.complaintMode) return 'Create complaint voucher';
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

  /** Most points a voucher may cost: the lifetime points of the next tier above its target tier (Zen: 2000). */
  get pointsCap(): number {
    const caps: Record<string, number> = { seed: 150, leaf: 400, bloom: 1000, zen: 2000 };
    return (this.form.purpose === 'loyalty_redeem' && caps[this.form.target_tier]) || 2000;
  }

  get pointsValue(): number {
    return Number(this.form.points_cost) || 0;
  }

  tierName(tier: string): string {
    return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '';
  }

  onWhole(field: 'usage_limit' | 'usage_limit_per_user' | 'discount_value' | 'points_cost', value: string): void {
    this.form[field] = value.replace(/\D/g, '');
    this.touch(field);
  }

  onCustomerInput(value: string): void {
    this.customerQuery = value;
    this.form.assigned_user = '';
    this.customerName = '';
    this.previewCode = '';
    this.orderState = 'idle';
    this.orderTotal = null;
    this.touch('assigned_user');
    this.customer$.next(value.trim());
  }

  pickCustomer(hit: Pick<CustomerSuggestion, 'user_id' | 'profile_name'>): void {
    this.form.assigned_user = hit.user_id;
    this.customerName = hit.profile_name;
    this.customerQuery = `${hit.profile_name} · ${hit.user_id}`;
    this.customerHits = [];
    this.touch('assigned_user');
    this.customerEmail = (hit as CustomerSuggestion).email || '';
    if (this.form.reason) this.checkOrder(this.form.reason);
  }

  customerEmail = '';

  initials(name: string): string {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0].charAt(0);
    const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  clearCustomer(): void {
    this.onCustomerInput('');
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
    const purpose: VoucherPurpose = complaint ? 'complaint' : this.form.purpose;
    const scope: VoucherScope = this.scoped ? this.form.applies_to : 'all';
    const payload = {
      code: complaint ? '' : this.form.code.trim().toUpperCase(),
      voucher_type: complaint ? 'discount' as const : this.form.voucher_type,
      discount_type: this.form.discount_type,
      discount_value: this.numberOrNull(this.form.discount_value),
      min_order_amount: complaint || this.form.min_order_amount.trim() === '' ? 0 : this.numberOrNull(this.form.min_order_amount),
      max_discount_value: complaint || this.form.max_discount_value.trim() === '' ? null : this.numberOrNull(this.form.max_discount_value),
      valid_from: range.from || '',
      valid_to: range.to || '',
      usage_limit: complaint
        ? 1
        : (this.form.usage_limit.trim() === '' ? null : this.numberOrNull(this.form.usage_limit)),
      usage_limit_per_user: complaint || purpose === 'referral'
        ? 1
        : (this.form.usage_limit_per_user.trim() === '' ? null : this.numberOrNull(this.form.usage_limit_per_user)),
      target_tier: purpose === 'loyalty_redeem' ? (this.form.target_tier || null) : null,
      purpose,
      points_cost: purpose === 'campaign' || purpose === 'loyalty_redeem' ? (this.pointsValue || null) : null,
      applies_to: scope,
      applicable_categories: scope === 'category' ? [...this.scopeCats] : null,
      applicable_product_ids: scope === 'product' ? this.scopeProducts.map((item) => item._id) : null,
      ...(complaint
        ? {
            assigned_user_id: this.form.assigned_user.trim(),
            related_ref: this.orderId,
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

  private previewEdit(payload: { code: string; voucher_type: VoucherKind; discount_type: DiscountKind; discount_value: number | null; min_order_amount: number | null; max_discount_value: number | null; valid_from: string; valid_to: string; usage_limit: number | null; target_tier: VoucherTier | null; applies_to?: VoucherScope; applicable_categories?: string[] | null; applicable_product_ids?: string[] | null }, editing: AdminVoucher): AdminVoucher {
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
      applies_to: this.locked ? editing.applies_to : (payload.applies_to || 'all'),
      applicable_categories: this.locked ? editing.applicable_categories : (payload.applicable_categories || []),
      applicable_product_ids: this.locked ? editing.applicable_product_ids : (payload.applicable_product_ids || []),
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
        count: 0,
        discounted: 0,
        revenue: 0
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

  hoverBucket: number | null = null;

  bucketRange(bucket: { start: string; end: string }): string {
    return bucket.start === bucket.end
      ? this.formatDay(bucket.start)
      : `${this.formatDay(bucket.start)} – ${this.formatDay(bucket.end)}`;
  }

  money2(value: number): string {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      else if (this.complaintMode && form.discount_type === 'fixed' && this.orderTotal != null && value > this.orderTotal) {
        issues.discount_value = `Cannot exceed ${this.orderTotal.toFixed(2)} USD, the total of order ${this.orderId}.`;
      }
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
    if (!this.complaintMode && form.usage_limit_per_user.trim()) {
      const per = this.numberOrNull(form.usage_limit_per_user);
      if (per == null || !Number.isInteger(per) || per <= 0) issues.usage_limit_per_user = 'Use a whole number greater than 0, or leave empty for no cap.';
    }
    if (!this.complaintMode && form.points_cost.trim() && this.pointsValue > this.pointsCap) {
      issues.points_cost = form.purpose === 'loyalty_redeem' && form.target_tier
        ? `A ${this.tierName(form.target_tier)} voucher can cost at most ${this.pointsCap.toLocaleString('en-US')} points.`
        : `A voucher can cost at most ${this.pointsCap.toLocaleString('en-US')} points.`;
    }
    if (this.locked) return issues;

    if (this.scoped && form.applies_to === 'category' && !this.scopeCats.length && (strict || this.touched.has('applies_to'))) {
      issues.applies_to = 'Pick at least one category.';
    }
    if (this.scoped && form.applies_to === 'product' && !this.scopeProducts.length && (strict || this.touched.has('applies_to'))) {
      issues.applies_to = 'Pick at least one product.';
    }
    if (!this.complaintMode && form.purpose === 'loyalty_redeem' && strict && !form.target_tier) {
      issues.target_tier = 'Choose the member tier.';
    }

    if (!this.complaintMode && strict && !form.code.trim()) issues.code = 'Code is required.';
    if (!this.complaintMode && this.modalMode === 'create' && this.codeState === 'taken') issues.code = 'That code is already in use.';
    if (!this.complaintMode && form.code.trim() && !/^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(form.code.trim())) {
      issues.code = 'Use 2–30 letters, numbers, hyphens or underscores.';
    }
    if (this.complaintMode && strict && !form.assigned_user.trim()) issues.assigned_user = 'Choose a customer from the list.';
    if (this.complaintMode && strict && !form.reason.trim()) issues.reason = 'A reason is required for a complaint voucher.';
    else if (this.complaintMode && form.reason.trim() && !ORDER_ID_PATTERN.test(form.reason) && (strict || this.touched.has('reason'))) {
      issues.reason = 'Include the related order ID, like OFS-2026-00418.';
    } else if (this.complaintMode && this.orderState === 'error') issues.reason = this.orderMessage;
    else if (this.complaintMode && strict && this.orderState !== 'found') issues.reason = 'Waiting for the order check.';
    if (this.complaintMode && this.quota?.left === 0) issues.assigned_user = 'You have used all 3 complaint vouchers for today. Ask a Senior Admin.';
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

  private formListening = false;

  private listenForm(): void {
    if (this.formListening) return;
    this.formListening = true;
    this.product$
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => {
        this.vouchersService.searchProducts(q).subscribe({
          next: (res) => {
            if (this.productQuery.trim() === q) this.productHits = res.data;
            this.paint();
          },
          error: () => { this.productHits = []; this.paint(); }
        });
      });
    this.code$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => {
        this.vouchersService.codeAvailable(code).subscribe({
          next: (res) => {
            if (this.form.code.trim() !== code) return;
            this.codeState = res.data.available ? 'available' : 'taken';
            this.paint();
          },
          error: () => { this.codeState = 'idle'; this.paint(); }
        });
      });
    this.reason$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((reason) => this.checkOrder(reason));
  }

  private checkOrder(reason: string): void {
    const match = ORDER_ID_PATTERN.exec(reason || '');
    const orderId = match ? match[0].toUpperCase() : '';
    if (!orderId) {
      this.orderId = '';
      this.orderState = 'idle';
      this.orderTotal = null;
      this.paint();
      return;
    }
    if (!this.form.assigned_user) {
      this.orderId = orderId;
      this.orderState = 'idle';
      this.paint();
      return;
    }
    const user = this.form.assigned_user;
    this.orderId = orderId;
    this.orderState = 'checking';
    this.paint();
    this.vouchersService.complaintOrder(orderId, user).subscribe({
      next: (res) => {
        if (this.orderId !== orderId || this.form.assigned_user !== user) return;
        this.orderState = 'found';
        this.orderTotal = res.data.total;
        this.orderMessage = '';
        this.paint();
      },
      error: (err) => {
        if (this.orderId !== orderId) return;
        this.orderState = 'error';
        this.orderTotal = null;
        this.orderMessage = err?.error?.error || 'The order could not be checked.';
        this.paint();
      }
    });
  }

  private loadQuota(): void {
    if (!this.complaintOnly) { this.quota = null; return; }
    this.vouchersService.complaintQuota().subscribe({
      next: (res) => { this.quota = res.data; this.paint(); },
      error: () => { this.quota = null; }
    });
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
