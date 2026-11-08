import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAlertTriangle, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideDownload, LucideMoreHorizontal, LucidePlus } from '@lucide/angular';
import { AdminProductRow, AdminProductService, ProductCategory } from '../../services/admin-product.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';

type StatusFilter = 'all' | 'active' | 'inactive';

@Component({
  selector: 'app-admin-products', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucidePlus, LucideDownload, LucideAlertTriangle, LucideMoreHorizontal, LucideChevronDown, LucideChevronLeft, LucideChevronRight, ConfirmationModalComponent],
  templateUrl: './products-listing.component.html', styleUrl: './products-listing.component.scss'
})
export class ProductsListingComponent implements OnInit {
  private productsApi = inject(AdminProductService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

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
  loading = true;
  error = '';
  notice = '';
  search = '';
  category: '' | ProductCategory = '';
  status: StatusFilter = 'all';
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

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.search = params['search'] || '';
      this.viewingDrafts = params['view'] === 'drafts';
      if (this.viewingDrafts) this.stockFilter = 'all';
      this.applyFilters();
      this.cdr.markForCheck();
    });
    this.load();
  }

  load(forceRefresh = false): void {
    const cached = this.productsApi.cachedRows();
    if (cached) {
      this.rows = cached;
      this.applyFilters();
    }
    this.loading = !cached;
    this.error = '';
    this.productsApi.list(forceRefresh).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const currentPage = this.page;
        this.rows = response.data || [];
        this.loading = false;
        this.applyFilters();
        this.page = Math.min(currentPage, this.pageCount);
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
      next: ({ data }) => { this.draftRows = data; this.draftsLoading = false; this.applyFilters(); this.cdr.markForCheck(); },
      error: err => { this.draftsLoading = false; this.draftsError = err?.error?.error || 'Could not load drafts.'; this.cdr.markForCheck(); }
    });
  }

  applyFilters(): void {
    const query = this.search.trim().toLowerCase();
    this.filteredRows = (this.viewingDrafts ? this.draftRows : this.rows).filter((row) => {
      if (query && !row.name.toLowerCase().includes(query) && !String(row.product_id).includes(query)
        && !row.variants.some((variant) => variant.sku.toLowerCase().includes(query))) return false;
      if (this.category && row.category !== this.category) return false;
      if (!this.viewingDrafts && this.status === 'active' && !row.is_active) return false;
      if (!this.viewingDrafts && this.status === 'inactive' && row.is_active) return false;
      if (this.stockFilter === 'low' && !this.isLowStock(row)) return false;
      if (this.stockFilter === 'out' && !this.isOutOfStock(row)) return false;
      return true;
    }).sort((a, b) => a.product_id - b.product_id);
    this.page = 1;
    this.openMenuId = null;
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
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: this.viewingDrafts ? 'drafts' : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  publishSavedDraft(row: AdminProductRow): void {
    if (this.draftActionSaving) return;
    this.draftActionSaving = true;
    this.error = '';
    this.openMenuId = null;
    this.productsApi.publishDraft(row.product_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.draftActionSaving = false; this.notice = 'Draft published.'; this.load(true); this.cdr.markForCheck(); },
      error: err => { this.draftActionSaving = false; this.error = err?.error?.error || 'Could not publish draft.'; this.cdr.markForCheck(); }
    });
  }

  discardSavedDraft(): void {
    if (!this.draftPendingDiscard || this.draftActionSaving) return;
    this.draftActionSaving = true;
    this.error = '';
    this.productsApi.discardDraft(this.draftPendingDiscard.product_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.draftActionSaving = false; this.draftPendingDiscard = null; this.notice = 'Draft discarded. The live product has not changed.'; this.load(true); this.cdr.markForCheck(); },
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
    this.page = next;
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
    this.notice = '';
    this.openMenuId = null;
  }

  discardChanges(): void { this.pendingStatus = {}; this.notice = ''; }

  applyChanges(): void {
    if (this.saving || !this.pendingCount) return;
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
        this.notice = `${data.length} product status change(s) applied.`;
        const currentPage = this.page;
        this.applyFilters();
        this.page = Math.min(currentPage, this.pageCount);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || 'Status changes could not be saved. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  edit(row: AdminProductRow): void { void this.router.navigate(['/admin/products', row.product_id], { queryParams: { returnView: this.viewingDrafts ? 'drafts' : null, search: this.search || null } }); }
  toggleMenu(row: AdminProductRow): void { this.openMenuId = this.openMenuId === row.product_id ? null : row.product_id; }

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
