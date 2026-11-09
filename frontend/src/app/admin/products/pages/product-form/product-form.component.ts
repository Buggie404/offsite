import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, of, Subject, switchMap, timer } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCheck, LucideChevronDown, LucideImage, LucideImagePlus, LucidePencil, LucidePlus, LucideSearch, LucideTrash2, LucideX } from '@lucide/angular';
import {
  AdminProduct, AdminProductImage, AdminProductPayload, AdminProductService,
  AdminProductVariant, CompositionProduct, ProductBatch, ProductBatchChanges, ProductBatchValues, ProductHistoryEntry, ProductCategory, ProductVariantType
} from '../../services/admin-product.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { CloudinaryService } from '../../../../features/community/services/cloudinary.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { PRODUCT_ATTRIBUTE_OPTIONS, ProductAttributeKey, ProductAttributeOption } from '../../services/product-attribute-options';
import { isProductDate, ProductDateInputComponent } from './product-date-input.component';
import { ProductPublishFeedbackService } from '../../services/product-publish-feedback.service';

function emptyImage(order = 0): AdminProductImage {
  return { url: '', public_id: '', sort_order: order, alt_text: '' };
}

type VariantForm = Omit<AdminProductVariant, 'price'> & { price: number | null };
type ProductForm = Omit<AdminProductPayload, 'variants'> & { variants: VariantForm[] };

function emptyVariant(): VariantForm {
  return { sku: '', label: 'Default', price: null, stock: 0, low_stock_threshold: 10, is_default: true, images: [] };
}

function emptyForm(): ProductForm {
  return {
    name: '', slug: '', description: '', seo_title: '', category: 'coffee', product_tag: [],
    is_best_seller: false, is_new_arrival: false, is_subscribable: false,
    subscribe_discount_percent: null, batch_expiry_date: null, variant_type: 'none', images: [],
    variants: [emptyVariant()], is_active: false,
    matcha: {}, coffee: { tasting_notes: [] }, drinkware: {}, sets_bundles: { composition: [] }, tools: {}
  };
}

@Component({
  selector: 'app-admin-product-form', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideArrowLeft, LucideCheck, LucideChevronDown, LucideImage, LucidePencil, LucidePlus, LucideSearch, LucideTrash2, LucideImagePlus, LucideX, ConfirmationModalComponent, ProductDateInputComponent],
  templateUrl: './product-form.component.html', styleUrl: './product-form.component.scss'
})
export class ProductFormComponent implements OnInit {
  private publishFeedback = inject(ProductPublishFeedbackService);
  private productsApi = inject(AdminProductService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private auth = inject(AdminAuthService);
  private cloudinary = inject(CloudinaryService);
  uploadingImages = false;
  imageError = '';
  selectingVariantIndex: number | null = null;
  imagePendingDelete: AdminProductImage | null = null;
  variantPendingDelete: VariantForm | null = null;
  variantPendingImageClear: VariantForm | null = null;
  get canViewHistory(): boolean { return this.auth.getAdminRole() === 'admin_cc'; }
  batches: ProductBatch[] = [];
  private publishedBatches: ProductBatch[] = [];
  batchesLoading = false;
  batchesLoadFailed = false;
  batchPendingDelete: ProductBatch | null = null;
  batchEditingId: string | null = null;
  private nextBatchKey = 0;
  history: ProductHistoryEntry[] = [];
  addingBatch = false;
  batchError = '';
  batchDraft = { batch_code: '', variant_sku: '', quantity: 1, received_at: new Date().toISOString().slice(0, 10), best_before: null as string | null };
  loadFailed = false;

  readonly categories: { value: ProductCategory; label: string }[] = [
    { value: 'coffee', label: 'Coffee' }, { value: 'matcha', label: 'Matcha' },
    { value: 'tools', label: 'Tools' }, { value: 'drinkware', label: 'Drinkware' },
    { value: 'sets_bundles', label: 'Sets & bundles' }
  ];
  readonly variantTypes: { value: ProductVariantType; label: string }[] = [
    { value: 'none', label: 'No option' }, { value: 'size', label: 'Size' },
    { value: 'color', label: 'Color' }, { value: 'type', label: 'Type' }, { value: 'package', label: 'Package' }
  ];
  hasVariantType(value: string): boolean { return this.variantTypes.some(type => type.value === value); }
  readonly roastLevels = [
    { value: 'light roast', label: 'Light' },
    { value: 'medium light roast', label: 'Medium light' },
    { value: 'medium roast', label: 'Medium' },
    { value: 'medium dark roast', label: 'Medium dark' },
    { value: 'dark roast', label: 'Dark' }
  ];
  hasRoastLevel(value: string): boolean { return this.roastLevels.some(level => level.value === value); }
  private readonly extraAttributeOptions = new Map<string, ProductAttributeOption[]>();
  attributeOptions(key: ProductAttributeKey, current: string | null | undefined): ProductAttributeOption[] {
    const choices = PRODUCT_ATTRIBUTE_OPTIONS[key];
    if (!current || choices.some(option => option.value === current)) return choices;
    const cacheKey = `${key}:${current}`;
    if (!this.extraAttributeOptions.has(cacheKey)) this.extraAttributeOptions.set(cacheKey, [...choices, { value: current, label: current }]);
    return this.extraAttributeOptions.get(cacheKey)!;
  }

  form = emptyForm();
  product: AdminProduct | null = null;
  loading = false;
  saving = false;
  discardDraftOpen = false;
  error = '';
  notice = '';
  returnToDrafts = false;
  returnSearch = '';
  private returnFilters: Record<string, string> = {};
  get backQueryParams(): Record<string, string | null> { return { ...this.returnFilters, view: this.returnToDrafts ? 'drafts' : null, search: this.returnSearch || null }; }
  submitAttempted = false;
  private submittedPriceRows = new WeakSet<VariantForm>();
  tagsText = '';
  tastingNotesText = '';
  compositionQuery = '';
  compositionOptions: CompositionProduct[] = [];
  compositionLoading = false;
  compositionError = '';
  compositionMessage = '';
  compositionSelection: CompositionProduct | null = null;
  compositionSku = '';
  compositionQuantity: number | null = 1;
  compositionPendingDelete: { entry: unknown; index: number } | null = null;
  private compositionSearch = new Subject<string>();
  private editedCompositionEntries = new Set<unknown>();
  private failedCompositionImages = new Set<string>();
  slugEdited = false;
  private originalTextFields = { tags: '', tastingNotes: '' };

  get isEdit(): boolean { return !!this.product; }
  get title(): string { return this.isEdit ? 'Edit product' : 'Add product'; }
  get subtitle(): string { return this.isEdit ? `${this.product!.name} · ${this.defaultVariant()?.sku || this.product!.product_id}` : 'Create a new catalog product'; }
  get coffee() { return this.form.coffee!; }
  get matcha() { return this.form.matcha!; }
  get drinkware() { return this.form.drinkware!; }
  get tools() { return this.form.tools!; }
  get setBundle() { return this.form.sets_bundles!; }

  ngOnInit(): void {
    this.compositionSearch.pipe(switchMap(query => {
      if (!query || this.form.category !== 'sets_bundles' || this.setBundle.is_exclusive) return of({ data: [] as CompositionProduct[] });
      return timer(200).pipe(switchMap(() => this.productsApi.searchCompositionProducts(query, this.product?.product_id)),
        catchError(err => { this.compositionError = err?.error?.error || 'Could not search products. Try again.'; return of({ data: [] as CompositionProduct[] }); }));
    }), takeUntilDestroyed(this.destroyRef)).subscribe(({ data }) => {
      this.compositionLoading = false;
      this.compositionOptions = this.form.category === 'sets_bundles' && !this.setBundle.is_exclusive ? data : [];
      this.cdr.markForCheck();
    });
    this.returnToDrafts = this.route.snapshot.queryParamMap?.get('returnView') === 'drafts';
    this.returnSearch = this.route.snapshot.queryParamMap?.get('search') || '';
    for (const key of ['category', 'status', 'tag', 'stock', 'page']) {
      const value = this.route.snapshot.queryParamMap?.get(key);
      if (value) this.returnFilters[key] = value;
    }
    const returnScroll = this.route.snapshot.queryParamMap?.get('returnScroll');
    if (returnScroll != null) this.returnFilters['scroll'] = returnScroll;
    const rawId = this.route.snapshot.paramMap.get('productId');
    if (!rawId || rawId === 'new') return;
    const productId = Number(rawId);
    if (!Number.isSafeInteger(productId) || productId <= 0) { this.loadFailed = true; this.error = 'Invalid product id.'; return; }
    this.loading = true;
    this.productsApi.get(productId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => { this.product = data; this.form = this.toForm(data); this.hydrateTextFields(); this.loading = false;
        if (this.route.snapshot.queryParamMap?.get('draftSaved') === '1') this.notice = 'Draft saved. You can continue editing or publish this product.';
        this.loadRelated(data.product_id); this.cdr.markForCheck(); },
      error: (err) => { this.loadFailed = true; this.error = err?.error?.error || 'Could not load this product.'; this.loading = false; this.cdr.markForCheck(); }
    });
  }

  onNameChange(): void {
    if (!this.slugEdited || !this.form.slug) this.form.slug = this.slugify(this.form.name);
  }

  onCompositionSearch(query: string): void {
    this.compositionQuery = query;
    this.compositionOptions = [];
    this.compositionSelection = null;
    this.compositionSku = '';
    this.compositionQuantity = 1;
    this.compositionError = '';
    this.compositionMessage = '';
    this.compositionLoading = !!query.trim() && !this.setBundle.is_exclusive && this.form.category === 'sets_bundles';
    this.compositionSearch.next(query.trim());
  }
  resetCompositionSearch(): void { this.onCompositionSearch(''); }
  selectCompositionProduct(product: CompositionProduct): void {
    if (this.setBundle.is_exclusive || product.product_id === this.product?.product_id || product.category === 'sets_bundles' || product.is_active === false) return;
    const query = this.compositionQuery.trim().toLowerCase();
    this.compositionSearch.next('');
    this.compositionSelection = product;
    this.compositionQuery = product.name;
    this.compositionSku = (product.variants.find(variant => variant.sku.toLowerCase() === query)
      || product.variants.find(variant => variant.is_default) || product.variants[0])?.sku || '';
    this.compositionQuantity = 1;
    this.compositionOptions = [];
    this.compositionLoading = false;
  }
  get compositionEntries(): unknown[] { return this.setBundle.composition || []; }
  get selectedCompositionVariant() { return this.compositionSelection?.variants.find(variant => variant.sku === this.compositionSku); }
  get compositionAlreadyAdded(): boolean {
    return !!this.compositionSelection && this.compositionEntries.some(entry => {
      const details = this.compositionDetails(entry);
      return details.id === this.compositionSelection!.product_id && details.sku === this.compositionSku;
    });
  }
  isCompositionQuantity(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1; }
  compositionLabel(value: unknown): string {
    const label = typeof value === 'string' ? value.trim() : '';
    return /^(null|undefined)$/i.test(label) ? '' : label;
  }
  private compositionImage(values: unknown[]): string {
    for (const value of values) {
      const url = typeof value === 'string' ? value.trim() : '';
      if (!url || this.failedCompositionImages.has(url)) continue;
      try { if (['https:', 'http:'].includes(new URL(url).protocol)) return url; } catch { /* A public ID is not an image URL. */ }
    }
    return '';
  }
  compositionOptionImage(product: CompositionProduct): string {
    return this.compositionImage([...(product.images || [])].sort((a, b) => a.sort_order - b.sort_order).map(image => image.url)
      .concat(product.variants.flatMap(variant => (variant.images || []).map(image => image.url))));
  }
  onCompositionImageError(event: Event): void {
    const url = (event.target as HTMLImageElement).getAttribute('src');
    if (url) this.failedCompositionImages.add(url);
    this.cdr.markForCheck();
  }
  compositionDetails(entry: unknown) {
    let display = entry;
    if (typeof display === 'string') { try { display = JSON.parse(display); } catch { /* Keep legacy names as display text. */ } }
    const record = display && typeof display === 'object' && !Array.isArray(display) ? display as Record<string, unknown> : null;
    const id = Number(record?.['component_product_id'] ?? record?.['product_id']);
    const rawQuantity = record && Object.hasOwn(record, 'quantity') ? record['quantity'] : record?.['component_quantity'] ?? record?.['qty'] ?? 1;
    const quantity = rawQuantity == null ? null : Number(rawQuantity);
    const sku = String(record?.['component_variant_sku'] ?? record?.['variant_sku'] ?? record?.['sku'] ?? '');
    return { id, sku, name: String(record?.['component_name'] || record?.['name'] || (Number.isFinite(id) ? `Product #${id}` : typeof entry === 'string' ? entry : 'Existing component')),
      label: this.compositionLabel(record?.['component_variant_label']) || this.compositionLabel(record?.['variant_label']),
      // Some legacy entries swapped URL and public ID. Resolve only for display; never rewrite the entry.
      image: this.compositionImage([record?.['component_image_url'], record?.['component_image_public_id'], record?.['image_url']]),
      quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
      editable: !!entry && typeof entry === 'object' && !Array.isArray(entry) && Number.isSafeInteger(id) && id > 0 && !!sku };
  }
  compositionQuantityError(entry: unknown): boolean { return this.editedCompositionEntries.has(entry) && !this.isCompositionQuantity(this.compositionDetails(entry).quantity); }
  updateCompositionQuantity(index: number, quantity: number | null): void {
    const entry = this.compositionEntries[index];
    if (this.setBundle.is_exclusive || !this.compositionDetails(entry).editable) return;
    const updated = { ...(entry as Record<string, unknown>), quantity };
    this.compositionEntries[index] = updated;
    this.editedCompositionEntries.delete(entry);
    this.editedCompositionEntries.add(updated);
  }
  addComposition(): void {
    const product = this.compositionSelection, variant = this.selectedCompositionVariant;
    if (this.setBundle.is_exclusive || !product || !variant || !this.isCompositionQuantity(this.compositionQuantity) || this.compositionAlreadyAdded || this.compositionEntries.length >= 100) return;
    const image = [...(variant.images?.length ? variant.images : product.images || [])].sort((a, b) => a.sort_order - b.sort_order)[0];
    const entry = { component_product_id: product.product_id, component_name: product.name, component_category: product.category,
      component_variant_sku: variant.sku, component_variant_label: this.compositionLabel(variant.label), component_price: variant.price,
      component_image_url: image?.url || '', component_image_public_id: image?.public_id || '', quantity: this.compositionQuantity };
    this.setBundle.composition = [...this.compositionEntries, entry];
    this.editedCompositionEntries.add(entry);
    this.resetCompositionSearch();
    this.compositionMessage = 'Component added. Save draft or Publish to keep your changes.';
  }
  requestRemoveComposition(index: number): void {
    if (!this.setBundle.is_exclusive && index >= 0 && index < this.compositionEntries.length) this.compositionPendingDelete = { entry: this.compositionEntries[index], index };
  }
  removePendingComposition(): void {
    const pending = this.compositionPendingDelete;
    this.compositionPendingDelete = null;
    if (!pending || this.setBundle.is_exclusive || this.compositionEntries[pending.index] !== pending.entry) return;
    this.compositionEntries.splice(pending.index, 1);
    this.editedCompositionEntries.delete(pending.entry);
  }

  addVariant(): void {
    this.form.variants.push({ ...emptyVariant(), label: '', is_default: false });
  }
  variantImage(variant: Pick<AdminProductVariant, 'images'>): AdminProductImage | null {
    return [...(variant.images || [])].filter(image => !!image.url).sort((a, b) => a.sort_order - b.sort_order)[0] || null;
  }
  chooseVariantImage(index: number): void { this.selectingVariantIndex = index; this.imageError = ''; }
  isSelectedVariantImage(image: AdminProductImage): boolean {
    if (this.selectingVariantIndex === null) return false;
    const variant = this.form.variants[this.selectingVariantIndex];
    return !!variant && this.variantImage(variant)?.url.trim() === image.url.trim();
  }
  assignVariantImage(image: AdminProductImage): void {
    if (this.selectingVariantIndex === null || !image.url.trim()
      || !this.form.images.some(candidate => candidate.url.trim() === image.url.trim())) return;
    this.form.variants[this.selectingVariantIndex].images = [{ ...image, sort_order: 0 }];
    this.selectingVariantIndex = null;
  }
  clearVariantImage(): void {
    if (this.selectingVariantIndex === null) return;
    const variant = this.form.variants[this.selectingVariantIndex];
    this.variantPendingImageClear = variant?.images.length ? variant : null;
    this.selectingVariantIndex = null;
  }
  cancelVariantImageClear(): void {
    const index = this.variantPendingImageClear ? this.form.variants.indexOf(this.variantPendingImageClear) : -1;
    this.variantPendingImageClear = null;
    this.selectingVariantIndex = index >= 0 ? index : null;
  }
  confirmVariantImageClear(): void {
    if (this.variantPendingImageClear && this.form.variants.includes(this.variantPendingImageClear)) this.variantPendingImageClear.images = [];
    this.variantPendingImageClear = null;
  }

  private loadRelated(productId: number): void {
    if (this.product?.is_new_product) this.restoreBatchChanges([], this.product.batch_changes);
    else {
      this.batchesLoading = true;
      this.batchesLoadFailed = false;
      this.productsApi.batches(productId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ data }) => { this.restoreBatchChanges(data, this.product?.batch_changes); this.batchesLoading = false; this.cdr.markForCheck(); },
        error: () => { this.batchesLoading = false; this.batchesLoadFailed = true; this.batchError = 'Could not load batches. Reload the editor before saving.'; this.cdr.markForCheck(); }
      });
    }
    if (this.canViewHistory) this.productsApi.history(productId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => { this.history = data; this.cdr.markForCheck(); },
      error: () => { this.cdr.markForCheck(); }
    });
  }

  addBatchRow(): void {
    if (this.addingBatch || this.batchesLoading || this.batchesLoadFailed || this.saving) return;
    const variants = this.batchVariantOptions;
    if (!variants.length) { this.batchError = 'Enter a variant SKU before adding a batch.'; return; }
    this.batchEditingId = null;
    this.batchDraft = { batch_code: '', variant_sku: (variants.find(variant => variant.is_default) || variants[0])?.sku || '', quantity: 1,
      received_at: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()), best_before: null };
    this.batchError = '';
    this.addingBatch = true;
  }
  cancelBatchRow(): void { if (!this.saving) { this.addingBatch = false; this.batchEditingId = null; this.batchError = ''; } }
  get batchVariantOptions(): VariantForm[] { return this.form.variants.filter(variant => !!variant.sku.trim()); }
  hasBatchSku(sku: string): boolean { return this.batchVariantOptions.some(variant => variant.sku.trim() === sku.trim()); }
  private batchDay(value: string | null): string | null {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date) : value;
  }
  private batchValues(row: ProductBatchValues): ProductBatchValues {
    return { batch_code: row.batch_code.trim(), variant_sku: row.variant_sku.trim(), quantity: row.quantity,
      received_at: this.batchDay(row.received_at) || '', best_before: this.batchDay(row.best_before) };
  }
  private restoreBatchChanges(published: ProductBatch[], changes?: ProductBatchChanges): void {
    this.publishedBatches = published.map(row => ({ ...row, ...this.batchValues(row) }));
    this.batches = this.publishedBatches.map(row => ({ ...row }));
    const rememberOriginal = (id: string, expected: ProductBatchValues) => {
      const index = this.publishedBatches.findIndex(row => row._id === id);
      const row: ProductBatch = { ...(this.publishedBatches[index] || {}), ...expected, _id: id, product_id: this.product?.product_id || 0, added_by_name: this.publishedBatches[index]?.added_by_name || '—' };
      if (index >= 0) this.publishedBatches[index] = row;
      else this.publishedBatches.push(row);
    };
    for (const operation of changes?.deletes || []) {
      rememberOriginal(operation.id, operation.expected);
      this.batches = this.batches.filter(row => row._id !== operation.id);
    }
    for (const operation of changes?.upserts || []) {
      const id = operation.id || operation.client_id!;
      const previous = this.batches.find(row => row._id === id);
      if (operation.id && operation.expected) rememberOriginal(operation.id, operation.expected);
      const row = { ...previous, ...this.batchValues(operation), _id: id, product_id: this.product?.product_id || 0, added_by_name: previous?.added_by_name || '—' };
      const index = this.batches.findIndex(row => row._id === id);
      if (index >= 0) this.batches[index] = row;
      else this.batches.push(row);
    }
  }
  get pendingBatchChanges(): ProductBatchChanges {
    const byId = new Map(this.publishedBatches.map(row => [row._id, row]));
    const upserts: ProductBatchChanges['upserts'] = [];
    for (const row of this.batches) {
      const original = byId.get(row._id), values = this.batchValues(row);
      if (!original) upserts.push({ ...values, client_id: row._id });
      else if (JSON.stringify(values) !== JSON.stringify(this.batchValues(original))) upserts.push({ ...values, id: row._id, expected: this.batchValues(original) });
    }
    const ids = new Set(this.batches.map(row => row._id));
    return { upserts, deletes: this.publishedBatches.filter(row => !ids.has(row._id)).map(row => ({ id: row._id, expected: this.batchValues(row) })) };
  }
  get pendingBatchCount(): number { const changes = this.pendingBatchChanges; return changes.upserts.length + changes.deletes.length; }
  editBatch(row: ProductBatch): void {
    if (this.addingBatch || this.saving || this.batchesLoading) return;
    this.batchEditingId = row._id;
    this.batchDraft = { ...this.batchValues(row) };
    this.addingBatch = true;
    this.batchError = '';
  }
  confirmBatchRow(): boolean {
    if (!this.addingBatch || this.saving) return false;
    const draft = this.batchDraft;
    if (!draft.batch_code.trim() || !this.hasBatchSku(draft.variant_sku)
      || !Number.isSafeInteger(draft.quantity) || draft.quantity < 1 || !isProductDate(draft.received_at)
      || (draft.best_before && !isProductDate(draft.best_before))
      || (draft.best_before && draft.best_before < draft.received_at)) {
      this.batchError = 'Enter a batch code, valid SKU, positive quantity and dates. Best before cannot precede received date.';
      return false;
    }
    if (this.batches.some(row => row._id !== this.batchEditingId && row.batch_code === draft.batch_code.trim())) {
      this.batchError = 'Batch code already exists in this product.'; return false;
    }
    if (this.batchEditingId) {
      this.batches = this.batches.map(row => row._id === this.batchEditingId ? { ...row, ...this.batchValues(draft) } : row);
    } else this.batches.push({ ...this.batchValues(draft), _id: `new-${Date.now()}-${++this.nextBatchKey}`, product_id: this.product?.product_id || 0, added_by_name: '—' });
    this.cancelBatchRow();
    return true;
  }
  requestRemoveBatch(row: ProductBatch): void { if (!this.saving && !this.addingBatch) this.batchPendingDelete = row; }
  removePendingBatch(): void {
    if (this.batchPendingDelete && !this.saving) this.batches = this.batches.filter(row => row._id !== this.batchPendingDelete!._id);
    this.batchPendingDelete = null;
  }
  historyLabel(entry: ProductHistoryEntry): string {
    if (entry.action_type === 'product.update' && entry.old_value?.['price'] !== entry.new_value?.['price']) {
      return `Price ${entry.old_value?.['price'] ?? '—'} → ${entry.new_value?.['price'] ?? '—'}`;
    }
    return ({ 'product.create': 'Created', 'product.update': 'Updated', 'product.draft-save': 'Draft saved', 'product.status': 'Status changed',
      'product.batch-create': 'Batch added', 'product.batch-update': 'Batch updated', 'product.batch-delete': 'Batch removed',
      'product.batch-expiry': 'Best-before changed' } as Record<string, string>)[entry.action_type] || entry.action_type;
  }

  removeVariant(index: number): void {
    if (this.form.variants.length <= 1) return;
    this.variantPendingDelete = this.form.variants[index] || null;
  }
  deletePendingVariant(): void {
    const index = this.variantPendingDelete ? this.form.variants.indexOf(this.variantPendingDelete) : -1;
    this.variantPendingDelete = null;
    if (index < 0 || this.form.variants.length <= 1) return;
    const removedDefault = this.form.variants[index].is_default;
    this.form.variants.splice(index, 1);
    if (removedDefault) this.setDefault(0);
  }

  setDefault(index: number): void {
    this.form.variants.forEach((variant, variantIndex) => variant.is_default = variantIndex === index);
  }

  addImage(): void { this.form.images.push(emptyImage(this.form.images.length)); }
  uploadImages(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    if (files.some(file => !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) {
      this.imageError = 'Select image files under 5MB each.';
      return;
    }
    this.uploadingImages = true;
    this.imageError = '';
    this.cloudinary.uploadMultiple(files).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (uploaded) => {
        const target = this.form.images;
        const images = uploaded.map((item, index) => ({ url: item.url, public_id: item.public_id,
          sort_order: target.length + index, alt_text: this.form.name }));
        target.push(...images);
        this.uploadingImages = false;
        this.cdr.markForCheck();
      },
      error: () => { this.uploadingImages = false; this.imageError = 'Image upload failed. Please try again.'; this.cdr.markForCheck(); }
    });
  }
  removeImage(index: number): void {
    const [removed] = this.form.images.splice(index, 1);
    if (removed?.url) this.form.variants.forEach(variant => {
      variant.images = variant.images.filter(image => image.url.trim() !== removed.url.trim());
    });
    this.form.images.forEach((image, order) => image.sort_order = order);
  }
  confirmRemoveImage(index: number): void {
    this.imagePendingDelete = this.form.images[index] || null;
  }
  cancelImageDelete(): void { this.imagePendingDelete = null; }
  deletePendingImage(): void {
    const index = this.form.images.indexOf(this.imagePendingDelete!);
    if (index >= 0) this.removeImage(index);
    this.imagePendingDelete = null;
  }
  isMainImage(index: number): boolean {
    return !!this.form.images[index]?.url.trim() && this.form.images.findIndex((image) => !!image.url.trim()) === index;
  }
  setMainImage(index: number): void {
    if (index <= 0 || !this.form.images[index]?.url.trim()) return;
    const [image] = this.form.images.splice(index, 1);
    this.form.images.unshift(image);
    this.form.images.forEach((item, order) => item.sort_order = order);
  }

  discardDraft(): void {
    if (!this.product?.has_draft || this.saving || this.uploadingImages) return;
    this.discardDraftOpen = false;
    this.saving = true;
    this.error = '';
    this.productsApi.discardDraft(this.product.product_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving = false;
        void this.router.navigate(['/admin/products'], { queryParams: this.backQueryParams });
        this.cdr.markForCheck();
      },
      error: err => {
        this.saving = false;
        this.error = err?.error?.error || 'Could not discard draft. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  save(publish: boolean): void {
    if (this.saving || this.loading || this.loadFailed || this.uploadingImages) return;
    this.submitAttempted = true;
    this.form.variants.forEach(variant => this.submittedPriceRows.add(variant));
    this.error = '';
    this.notice = '';
    if (this.addingBatch && !this.confirmBatchRow()) { this.error = this.batchError; return; }
    this.syncTextFields();
    const issue = this.validate();
    if (issue) { this.error = issue; return; }
    if (publish && (!this.product || this.product.is_new_product)) this.form.is_active = true;
    this.saving = true;
    const wasNew = !this.product;
    // Blank prices exist only in the editor; validation above requires a positive number.
    const payload: AdminProductPayload = { ...this.form, variants: this.form.variants.map(variant => ({ ...variant, price: Number(variant.price) })) };
    const batchChanges = this.pendingBatchChanges;
    if (batchChanges.upserts.length || batchChanges.deletes.length) payload.batch_changes = batchChanges;
    const request = !publish ? this.productsApi.saveDraft(this.product?.product_id ?? null, payload)
      : this.product ? this.productsApi.update(this.product.product_id, payload) : this.productsApi.create(payload);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => {
        this.saving = false;
        if (publish) {
          this.publishFeedback.published();
          void this.router.navigate(['/admin/products'], { queryParams: this.backQueryParams });
        } else {
          this.product = data;
          this.form = this.toForm(data);
          this.hydrateTextFields();
          this.notice = data.is_active ? 'Draft saved. The current product stays live. Publish to apply your changes.'
            : 'Draft saved. Publish when this product is ready to go live.';
          if (wasNew) void this.router.navigate(['/admin/products', data.product_id], { replaceUrl: true, queryParams: { draftSaved: 1, returnView: 'drafts' } });
        }
        this.cdr.markForCheck();
      },
      error: (err) => { this.saving = false; this.error = err?.error?.error || 'The product could not be saved.'; this.cdr.markForCheck(); }
    });
  }

  categoryLabel(): string { return this.categories.find((item) => item.value === this.form.category)?.label || 'Product'; }
  defaultVariant(): VariantForm | undefined { return this.form.variants.find((variant) => variant.is_default) || this.form.variants[0]; }
  isInvalidPrice(value: unknown): boolean { return typeof value !== 'number' || !Number.isFinite(value) || value <= 0; }
  showPriceError(variant: VariantForm): boolean {
    return this.isInvalidPrice(variant.price) && (variant.price != null || this.submittedPriceRows.has(variant));
  }
  trackIndex(index: number): number { return index; }

  private hydrateTextFields(): void {
    this.tagsText = this.form.product_tag.join(', ');
    this.tastingNotesText = this.form.coffee?.tasting_notes?.join(', ') || '';
    this.originalTextFields = { tags: this.tagsText, tastingNotes: this.tastingNotesText };
    this.editedCompositionEntries.clear();
    this.resetCompositionSearch();
    this.slugEdited = true;
  }

  private syncTextFields(): void {
    if (!this.product || this.tagsText !== this.originalTextFields.tags) this.form.product_tag = this.splitList(this.tagsText);
    if (!this.product || this.tastingNotesText !== this.originalTextFields.tastingNotes) {
      this.form.coffee = { ...(this.form.coffee || {}), tasting_notes: this.splitList(this.tastingNotesText) };
    }
    this.form.images = this.form.images.filter((image) => image.url.trim()).map((image, index) => ({
      ...image, url: image.url.trim(), public_id: (image.public_id || '').trim(), alt_text: (image.alt_text || '').trim(), sort_order: index
    }));
  }

  private validate(): string {
    if (!this.form.name.trim()) return 'Product name is required.';
    if (!this.form.slug.trim()) return 'Slug is required.';
    if (this.batchesLoading || this.batchesLoadFailed) return 'Wait for batch records to load, or reload the editor before saving.';
    if (this.batches.some(row => !this.hasBatchSku(row.variant_sku))) return 'A batch refers to a removed variant. Edit or remove that batch before saving.';
    if (this.form.category === 'sets_bundles' && !this.setBundle.is_exclusive && this.compositionEntries.some(entry => this.compositionQuantityError(entry))) return 'Composition quantities must be whole numbers of at least 1.';
    if (this.form.batch_expiry_date && !isProductDate(this.form.batch_expiry_date)) return 'Enter a valid current batch expiry as dd/mm/yyyy.';
    if (!this.hasVariantType(this.form.variant_type)) return 'Choose a valid variant type.';
    if (!this.form.variants.length) return 'Add at least one variant.';
    if (this.form.variants.some(variant => this.isInvalidPrice(variant.price))) return 'Variant prices must be greater than 0.';
    if (this.form.variants.some((variant) => !variant.sku.trim())) return 'Every variant needs a SKU.';
    if (new Set(this.form.variants.map((variant) => variant.sku.trim().toLowerCase())).size !== this.form.variants.length) return 'Variant SKUs must be unique.';
    if (this.form.variants.some((variant) => variant.stock < 0 || (variant.low_stock_threshold ?? 10) < 0)) return 'Stock and low-stock threshold cannot be negative.';
    if (this.form.variants.filter((variant) => variant.is_default).length !== 1) return 'Choose one default variant.';
    if (this.form.is_subscribable && this.form.subscribe_discount_percent != null
      && (this.form.subscribe_discount_percent < 5 || this.form.subscribe_discount_percent > 15 || !Number.isInteger(this.form.subscribe_discount_percent))) {
      return 'Subscription discount must be a whole number from 5 to 15.';
    }
    return '';
  }

  private toForm(product: AdminProduct): ProductForm {
    const variants = (product.variants || []).map((variant) => ({
      ...variant, low_stock_threshold: variant.low_stock_threshold ?? 10,
      images: (variant.images || []).map((image) => ({ ...image }))
    }));
    const images = this.mergeImages(product.images || [], variants.flatMap(variant => variant.images));
    return {
      name: product.name, slug: product.slug, description: product.description || '', seo_title: product.seo_title || '',
      category: product.category, product_tag: [...(product.product_tag || [])],
      is_best_seller: !!product.is_best_seller, is_new_arrival: !!product.is_new_arrival,
      is_subscribable: !!product.is_subscribable, subscribe_discount_percent: product.subscribe_discount_percent ?? null,
      batch_expiry_date: product.batch_expiry_date || null,
      variant_type: product.variant_type,
      images,
      variants,
      is_active: product.is_active,
      matcha: { ...(product.matcha || {}) }, coffee: { ...(product.coffee || {}),
        roast_level: product.coffee?.roast_level || '',
        tasting_notes: [...(product.coffee?.tasting_notes || [])] },
      drinkware: { ...(product.drinkware || {}) }, sets_bundles: { ...(product.sets_bundles || {}), composition: [...(product.sets_bundles?.composition || [])] },
      tools: { ...(product.tools || {}) }
    };
  }

  private mergeImages(primary: AdminProductImage[], additional: AdminProductImage[]): AdminProductImage[] {
    const seen = new Set<string>();
    return [...primary].sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
      .concat(additional)
      .filter(image => {
        const key = image.url?.trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((image, sort_order) => ({ ...image, sort_order }));
  }

  private splitList(value: string): string[] { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
  private slugify(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
}
