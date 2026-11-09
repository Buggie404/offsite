import { afterNextRender, ChangeDetectorRef, Component, DestroyRef, ElementRef, HostListener, Injector, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, Scroll } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, takeUntil, timer } from 'rxjs';
import { LucideAlertTriangle, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideDownload, LucideMoreHorizontal, LucidePlus } from '@lucide/angular';
import { AdminProductRow, AdminProductService, ProductCategory } from '../../services/admin-product.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { ProductPublishFeedbackService } from '../../services/product-publish-feedback.service';

type StatusFilter = 'all' | 'active' | 'inactive';
type TagFilter = 'all' | 'new_arrival' | 'best_seller';

@Component({
  selector: 'app-admin-products', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucidePlus, LucideDownload, LucideAlertTriangle, LucideMoreHorizontal, LucideChevronDown, LucideChevronLeft, LucideChevronRight, ConfirmationModalComponent],
  templateUrl: './products-listing.component.html', styleUrl: './products-listing.component.scss'
})
export class ProductsListingComponent implements OnInit, OnDestroy {
  private publishFeedback = inject(ProductPublishFeedbackService);
  private productsApi = inject(AdminProductService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private injector = inject(Injector);
  private restoreScrollTop: number | null = null;
  private navigationScrollSettled = true;
  private noticeDismissed = new Subject<void>();

  readonly categories: { value: '' | ProductCategory; label: string }[] = [
    { value: '', label: 'All categories' },
    { value: 'matcha', label: 'Matcha' },
    { value: 'coffee', label: 'Coffee' },
    { value: 'tools', label: 'Tools' },
    { value: 'drinkware', label: 'Drinkware' },
    { value: 'sets_bundles', label: 'Sets & bundles' }
  ];
  readonly statuses: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Any status' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' }
  ];
  readonly pageSize = 10;
  readonly tags: { value: TagFilter; label: string }[] = [
    { value: 'all', label: 'All tags' },
    { value: 'new_arrival', label: 'New arrival' },
    { value: 'best_seller', label: 'Best seller' }
  ];
  loading = true;
  error = '';
  notice = '';
  publishNotice = false;
  search = '';
  category: '' | ProductCategory = '';
  status: StatusFilter = 'all';
  tag: TagFilter = 'all';
  stockFilter: 'all' | 'low' | 'out' = 'all';
  rows: AdminProductRow[] = [];
  draftRows: AdminProductRow[] = [];
  viewingDrafts = false;
  draftsLoading = true;
  draftsError = '';
  draftActionSaving = false;
  draftPendingDiscard: AdminProductRow | null = null;
  get currentLoading(): boolean { return this.viewingDrafts ? this.draftsLoading : this.loading; }
  filteredRows: AdminProductRow[] = [];
  page = 1;
  saving = false;
  pendingStatus: Record<number, boolean> = {};
  openMenuId: number | null = null;
  @ViewChild('rowMenu') private rowMenu?: ElementRef<HTMLElement>;
  private menuAnchor: HTMLElement | null = null;
  get menuRow(): AdminProductRow | null { return this.visibleRows.find(row => row.product_id === this.openMenuId) || null; }

  ngOnInit(): void {
    const navigation = this.router.getCurrentNavigation();
    this.navigationScrollSettled = !navigation;
    let publishNoticePending = this.publishFeedback.consume();
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (event instanceof Scroll) {
        this.navigationScrollSettled = true;
        this.restoreListScroll();
        this.cdr.markForCheck();
      }
    });
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.clearNotice();
      this.search = params['search'] || '';
      this.viewingDrafts = params['view'] === 'drafts';
      this.category = this.categories.find(item => item.value === params['category'])?.value || '';
      this.status = this.statuses.find(item => item.value === params['status'])?.value || 'all';
      this.tag = this.tags.find(item => item.value === params['tag'])?.value || 'all';
      this.stockFilter = !this.viewingDrafts && (params['stock'] === 'low' || params['stock'] === 'out') ? params['stock'] : 'all';
      const page = Number(params['page']);
      this.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
      const scroll = Number(params['scroll']);
      this.restoreScrollTop = params['scroll'] != null && Number.isFinite(scroll) && scroll >= 0 ? scroll : null;
      this.applyFilters(false);
      if (publishNoticePending) {
        publishNoticePending = false;
        this.showNotice('Product published successfully.', true);
      }
      this.cdr.markForCheck();
    });
    this.load();
  }

  ngOnDestroy(): void { this.clearNotice(); this.noticeDismissed.complete(); }

  load(forceRefresh = false): void {
    const cached = this.productsApi.cachedRows();
    if (cached) {
      this.rows = cached;
      this.applyFilters(false);
    }
    this.loading = !cached;
    this.error = '';
    this.productsApi.list(forceRefresh).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.rows = response.data || [];
        this.loading = false;
        this.applyFilters(false);
        this.cdr.markForCheck();
      },
      error: (err) => { this.error = err?.error?.error || 'Could not load products.'; this.loading = false; this.cdr.markForCheck(); }
    });
    this.loadDrafts();
  }

  private loadDrafts(): void {
    this.draftsLoading = true;
    this.draftsError = '';
    this.productsApi.drafts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => { this.draftRows = data; this.draftsLoading = false; this.applyFilters(false); this.cdr.markForCheck(); },
      error: err => { this.draftsLoading = false; this.draftsError = err?.error?.error || 'Could not load drafts.'; this.cdr.markForCheck(); }
    });
  }

  applyFilters(resetPage = true): void {
    const query = this.search.trim().toLowerCase();
    this.filteredRows = (this.viewingDrafts ? this.draftRows : this.rows).filter((row) => {
      if (query && !row.name.toLowerCase().includes(query) && !String(row.product_id).includes(query)
        && !row.variants.some((variant) => variant.sku.toLowerCase().includes(query))) return false;
      if (this.category && row.category !== this.category) return false;
      if (!this.viewingDrafts && this.status === 'active' && !row.is_active) return false;
      if (!this.viewingDrafts && this.status === 'inactive' && row.is_active) return false;
      if (this.tag === 'new_arrival' && !row.is_new_arrival) return false;
      if (this.tag === 'best_seller' && !row.is_best_seller) return false;
      if (this.stockFilter === 'low' && !this.isLowStock(row)) return false;
      if (this.stockFilter === 'out' && !this.isOutOfStock(row)) return false;
      return true;
    }).sort((a, b) => a.product_id - b.product_id);
    if (resetPage) this.page = 1;
    else if (!this.currentLoading) this.page = Math.min(this.page, this.pageCount);
    this.openMenuId = null;
    this.restoreListScroll();
  }

  private restoreListScroll(): void {
    // Wait for both table data and the router's normal scroll reset before restoring.
    if (this.navigationScrollSettled && !this.currentLoading && this.restoreScrollTop !== null) {
      const top = this.restoreScrollTop;
      this.restoreScrollTop = null;
      afterNextRender(() => window.scrollTo({ top, behavior: 'auto' }), { injector: this.injector });
    }
  }

  onFilterChange(): void { this.applyFilters(); this.setViewQuery(); }

  get listQueryParams(): Record<string, string | number | null> {
    return { view: this.viewingDrafts ? 'drafts' : null, search: this.search || null,
      category: this.category || null, status: this.status === 'all' ? null : this.status,
      tag: this.tag === 'all' ? null : this.tag,
      stock: this.stockFilter === 'all' ? null : this.stockFilter, page: this.page > 1 ? this.page : null };
  }

  toggleStockFilter(filter: 'low' | 'out'): void {
    this.viewingDrafts = false;
    this.stockFilter = this.stockFilter === filter ? 'all' : filter;
    this.applyFilters();
    this.setViewQuery();
  }

  toggleDrafts(): void {
    this.viewingDrafts = !this.viewingDrafts;
    this.stockFilter = 'all';
    this.applyFilters();
    this.setViewQuery();
  }

  private setViewQuery(): void {
    this.clearNotice();
    this.restoreScrollTop = null;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { ...this.listQueryParams, scroll: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  publishSavedDraft(row: AdminProductRow): void {
    if (this.draftActionSaving) return;
    this.clearNotice();
    this.draftActionSaving = true;
    this.error = '';
    this.openMenuId = null;
    this.productsApi.publishDraft(row.product_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.draftActionSaving = false; this.showNotice('Draft published successfully.', true); this.load(true); this.cdr.markForCheck(); },
      error: err => { this.draftActionSaving = false; this.error = err?.error?.error || 'Could not publish draft.'; this.cdr.markForCheck(); }
    });
  }

  discardSavedDraft(): void {
    if (!this.draftPendingDiscard || this.draftActionSaving) return;
    this.clearNotice();
    this.draftActionSaving = true;
    this.error = '';
    this.productsApi.discardDraft(this.draftPendingDiscard.product_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.draftActionSaving = false; this.draftPendingDiscard = null; this.showNotice('Draft discarded. The live product has not changed.'); this.load(true); this.cdr.markForCheck(); },
      error: err => { this.draftActionSaving = false; this.draftPendingDiscard = null; this.error = err?.error?.error || 'Could not discard draft.'; this.cdr.markForCheck(); }
    });
  }

  get visibleRows(): AdminProductRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get pageCount(): number { return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize)); }
  get pages(): number[] { return Array.from({ length: this.pageCount }, (_, index) => index + 1).filter((value) => value <= 3 || value === this.pageCount || Math.abs(value - this.page) <= 1); }
  get lowStockCount(): number { return this.rows.filter((row) => this.isLowStock(row)).length; }
  get outOfStockCount(): number { return this.rows.filter((row) => this.isOutOfStock(row)).length; }
  get shownStart(): number { return this.filteredRows.length ? (this.page - 1) * this.pageSize + 1 : 0; }
  get shownEnd(): number { return Math.min(this.page * this.pageSize, this.filteredRows.length); }

  setPage(page: number): void {
    const next = Math.max(1, Math.min(this.pageCount, page));
    if (next === this.page) return;
    this.closeMenu();
    this.page = next;
    this.setViewQuery();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  trackProduct(_index: number, row: AdminProductRow): number { return row.product_id; }
  primaryImage(row: AdminProductRow): string { return row.images?.reduce((first, image) => !first || image.sort_order < first.sort_order ? image : first, row.images[0])?.url || ''; }
  defaultVariant(row: AdminProductRow): AdminProductRow['variants'][number] {
    return row.variants.find((variant) => variant.is_default) || row.variants[0]
      || { sku: '', price: 0, stock: 0, is_default: true };
  }
  totalStock(row: AdminProductRow): number { return row.variants.reduce((sum, variant) => sum + Math.max(0, variant.stock || 0), 0); }
  isOutOfStock(row: AdminProductRow): boolean { return !row.variants.length || row.variants.every((variant) => (variant.stock || 0) <= 0); }
  isLowStock(row: AdminProductRow): boolean {
    return !this.isOutOfStock(row) && row.variants.some((variant) => (variant.stock || 0) <= (variant.low_stock_threshold ?? 10));
  }
  hasStockIssue(row: AdminProductRow): boolean { return this.isOutOfStock(row) || this.isLowStock(row); }
  categoryLabel(value: ProductCategory): string { return this.categories.find((item) => item.value === value)?.label || value; }
  money(value: number): string { return `$${Number(value || 0).toFixed(2)}`; }

  statusOf(row: AdminProductRow): boolean {
    return Object.prototype.hasOwnProperty.call(this.pendingStatus, row.product_id)
      ? this.pendingStatus[row.product_id] : row.is_active;
  }

  get pendingCount(): number { return Object.keys(this.pendingStatus).length; }

  toggleStatus(row: AdminProductRow): void {
    if (this.saving) return;
    const next = !this.statusOf(row);
    if (next === row.is_active) delete this.pendingStatus[row.product_id];
    else this.pendingStatus[row.product_id] = next;
    this.clearNotice();
    this.openMenuId = null;
  }

  discardChanges(): void { this.pendingStatus = {}; this.clearNotice(); }

  applyChanges(): void {
    if (this.saving || !this.pendingCount) return;
    this.clearNotice();
    const changes = Object.entries(this.pendingStatus).map(([id, isActive]) => ({ product_id: Number(id), is_active: isActive }));
    this.saving = true;
    this.error = '';
    this.productsApi.updateStatuses(changes).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => {
        const statuses = new Map(data.map((item) => [item.product_id, item.is_active]));
        this.rows = this.rows.map((row) => statuses.has(row.product_id)
          ? { ...row, is_active: statuses.get(row.product_id)! } : row);
        this.pendingStatus = {};
        this.saving = false;
        this.showNotice(`${data.length} product status change(s) applied.`);
        this.applyFilters(false);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || 'Status changes could not be saved. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  private clearNotice(): void { this.noticeDismissed.next(); this.notice = ''; this.publishNotice = false; }

  private showNotice(message: string, published = false): void {
    this.clearNotice();
    this.notice = message;
    this.publishNotice = published;
    timer(4000).pipe(takeUntil(this.noticeDismissed), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.notice = '';
      this.publishNotice = false;
      this.cdr.markForCheck();
    });
  }

  edit(row: AdminProductRow): void {
    this.closeMenu();
    void this.router.navigate(['/admin/products', row.product_id], { queryParams: {
      ...this.listQueryParams, view: null, returnView: this.viewingDrafts ? 'drafts' : null,
      returnScroll: Math.max(0, window.scrollY)
    } });
  }
  toggleMenu(row: AdminProductRow, event: MouseEvent): void {
    if (this.openMenuId === row.product_id) { this.closeMenu(true); return; }
    this.menuAnchor = event.currentTarget as HTMLElement;
    this.openMenuId = row.product_id;
    afterNextRender(() => {
      if (this.openMenuId !== row.product_id) return;
      this.positionMenu();
      this.rowMenu?.nativeElement.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }, { injector: this.injector });
  }

  closeMenu(restoreFocus = false): void {
    const anchor = this.menuAnchor;
    this.openMenuId = null;
    this.menuAnchor = null;
    if (restoreFocus) anchor?.focus();
  }

  requestDiscardDraft(row: AdminProductRow): void { this.closeMenu(); this.draftPendingDiscard = row; }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  positionMenu(): void {
    const menu = this.rowMenu?.nativeElement;
    if (this.openMenuId === null || !menu || !this.menuAnchor) return;
    const anchor = this.menuAnchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    if (anchor.bottom < 0 || anchor.top > viewportHeight || anchor.right < 0 || anchor.left > viewportWidth) { this.closeMenu(); return; }
    const box = menu.getBoundingClientRect();
    const width = box.width || 180, height = box.height || (this.viewingDrafts ? 112 : 78);
    const gap = 6, edge = 8;
    const below = viewportHeight - anchor.bottom - edge;
    const above = anchor.top - edge;
    const openBelow = height + gap <= below || below >= above;
    const top = openBelow ? anchor.bottom + gap : anchor.top - height - gap;
    menu.style.left = `${Math.max(edge, Math.min(anchor.right - width, viewportWidth - width - edge))}px`;
    menu.style.top = `${Math.max(edge, Math.min(top, viewportHeight - height - edge))}px`;
    menu.dataset['placement'] = openBelow ? 'below' : 'above';
  }

  @HostListener('document:click', ['$event'])
  @HostListener('document:focusin', ['$event'])
  dismissMenuOutside(event: Event): void {
    const target = event.target as Node | null;
    if (target && !this.rowMenu?.nativeElement.contains(target) && !this.menuAnchor?.contains(target)) this.closeMenu();
  }

  @HostListener('document:keydown.escape', ['$event'])
  dismissMenuOnEscape(event: Event): void {
    if (this.openMenuId === null) return;
    event.preventDefault(); this.closeMenu(true);
  }

  onMenuKeydown(event: KeyboardEvent): void {
    const buttons = Array.from(this.rowMenu?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    if (!buttons.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].focus();
  }

  exportCsv(): void {
    const header = ['Product ID', 'Name', 'Slug', 'Category', 'SKUs', 'Price from', 'Stock', 'Status', 'Tags'];
    const lines = this.filteredRows.map((row) => [row.product_id, row.name, row.slug, row.category,
      row.variants.map((item) => item.sku).join(' | '), this.defaultVariant(row)?.price || 0,
      this.totalStock(row), row.is_active ? 'active' : 'inactive', row.product_tag.join(' | ')]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'offsite-products.csv'; anchor.click();
    URL.revokeObjectURL(url);
  }

}
