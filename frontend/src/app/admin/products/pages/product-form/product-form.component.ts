import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideChevronDown, LucideImagePlus, LucidePlus, LucideTrash2 } from '@lucide/angular';
import {
  AdminProduct, AdminProductImage, AdminProductPayload, AdminProductService,
  AdminProductVariant, ProductBatch, ProductHistoryEntry, ProductCategory, ProductVariantType
} from '../../services/admin-product.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { CloudinaryService } from '../../../../features/community/services/cloudinary.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { PRODUCT_ATTRIBUTE_OPTIONS, ProductAttributeKey, ProductAttributeOption } from '../../services/product-attribute-options';

function emptyImage(order = 0): AdminProductImage {
  return { url: '', public_id: '', sort_order: order, alt_text: '' };
}

function emptyVariant(): AdminProductVariant {
  return { sku: '', label: 'Default', price: 0, stock: 0, low_stock_threshold: 10, is_default: true, images: [] };
}

function emptyForm(): AdminProductPayload {
  return {
    name: '', slug: '', description: '', seo_title: '', category: 'coffee', product_tag: [],
    is_subscription: false, is_best_seller: false, is_new_arrival: false, is_subscribable: false,
    subscribe_discount_percent: null, batch_expiry_date: null, variant_type: 'none', images: [],
    variants: [emptyVariant()], is_active: false, quiz_eligible: true,
    matcha: {}, coffee: { tasting_notes: [] }, drinkware: {}, sets_bundles: { composition: [] }, tools: {}
  };
}

@Component({
  selector: 'app-admin-product-form', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideArrowLeft, LucideChevronDown, LucidePlus, LucideTrash2, LucideImagePlus, ConfirmationModalComponent],
  templateUrl: './product-form.component.html', styleUrl: './product-form.component.scss'
})
export class ProductFormComponent implements OnInit {
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
  get canViewHistory(): boolean { return this.auth.getAdminRole() === 'admin_cc'; }
  batches: ProductBatch[] = [];
  history: ProductHistoryEntry[] = [];
  batchModalOpen = false;
  batchSaving = false;
  batchError = '';
  batchDraft = { batch_code: '', variant_sku: '', quantity: 1, received_at: new Date().toISOString().slice(0, 10), best_before: null as string | null };
  editingBatchId: string | null = null;
  editingBestBefore: string | null = null;
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
  get backQueryParams(): Record<string, string | null> { return { view: this.returnToDrafts ? 'drafts' : null, search: this.returnSearch || null }; }
  submitAttempted = false;
  tagsText = '';
  tastingNotesText = '';
  compositionText = '';
  slugEdited = false;
  private originalTextFields = { tags: '', tastingNotes: '', composition: '' };

  get isEdit(): boolean { return !!this.product; }
  get title(): string { return this.isEdit ? 'Edit product' : 'Add product'; }
  get subtitle(): string { return this.isEdit ? `${this.product!.name} · ${this.defaultVariant()?.sku || this.product!.product_id}` : 'Create a new catalog product'; }
  get coffee() { return this.form.coffee!; }
  get matcha() { return this.form.matcha!; }
  get drinkware() { return this.form.drinkware!; }
  get tools() { return this.form.tools!; }
  get setBundle() { return this.form.sets_bundles!; }

  ngOnInit(): void {
    this.returnToDrafts = this.route.snapshot.queryParamMap?.get('returnView') === 'drafts';
    this.returnSearch = this.route.snapshot.queryParamMap?.get('search') || '';
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

  addVariant(): void {
    this.form.variants.push({ ...emptyVariant(), label: '', is_default: false });
  }
  variantImage(variant: AdminProductVariant): AdminProductImage | null {
    return [...(variant.images || [])].filter(image => !!image.url).sort((a, b) => a.sort_order - b.sort_order)[0] || null;
  }
  chooseVariantImage(index: number): void { this.selectingVariantIndex = index; this.imageError = ''; }
  assignVariantImage(image: AdminProductImage): void {
    if (this.selectingVariantIndex === null || !image.url.trim()
      || !this.form.images.some(candidate => candidate.url.trim() === image.url.trim())) return;
    this.form.variants[this.selectingVariantIndex].images = [{ ...image, sort_order: 0 }];
    this.selectingVariantIndex = null;
  }
  clearVariantImage(): void {
    if (this.selectingVariantIndex === null) return;
    this.form.variants[this.selectingVariantIndex].images = [];
    this.selectingVariantIndex = null;
  }

  private loadRelated(productId: number): void {
    this.productsApi.batches(productId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => { this.batches = data; this.cdr.markForCheck(); },
      error: () => { this.batchError = 'Could not load batches.'; this.cdr.markForCheck(); }
    });
    if (this.canViewHistory) this.productsApi.history(productId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => { this.history = data; this.cdr.markForCheck(); },
      error: () => { this.cdr.markForCheck(); }
    });
  }

  openBatchModal(): void {
    this.batchDraft = { batch_code: '', variant_sku: this.defaultVariant()?.sku || '', quantity: 1,
      received_at: new Date().toISOString().slice(0, 10), best_before: null };
    this.batchError = '';
    this.batchModalOpen = true;
  }
  closeBatchModal(): void { if (!this.batchSaving) this.batchModalOpen = false; }
  saveBatch(): void {
    if (!this.product || this.batchSaving) return;
    this.batchSaving = true;
    this.batchError = '';
    this.productsApi.addBatch(this.product.product_id, this.batchDraft).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => { this.batches = [data, ...this.batches]; this.batchSaving = false; this.batchModalOpen = false; this.cdr.markForCheck(); },
      error: (err) => { this.batchSaving = false; this.batchError = err?.error?.error || 'Could not add batch.'; this.cdr.markForCheck(); }
    });
  }
  editBestBefore(batch: ProductBatch): void { this.editingBatchId = batch._id; this.editingBestBefore = batch.best_before?.slice(0, 10) || null; }
  saveBestBefore(batch: ProductBatch): void {
    if (!this.product) return;
    this.productsApi.updateBatchBestBefore(this.product.product_id, batch._id, this.editingBestBefore).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => { this.batches = this.batches.map(item => item._id === data._id ? data : item); this.editingBatchId = null; this.batchError = ''; this.cdr.markForCheck(); },
      error: (err) => { this.batchError = err?.error?.error || 'Could not update date.'; this.cdr.markForCheck(); }
    });
  }
  historyLabel(entry: ProductHistoryEntry): string {
    if (entry.action_type === 'product.update' && entry.old_value?.['price'] !== entry.new_value?.['price']) {
      return `Price ${entry.old_value?.['price'] ?? '—'} → ${entry.new_value?.['price'] ?? '—'}`;
    }
    return ({ 'product.create': 'Created', 'product.update': 'Updated', 'product.draft-save': 'Draft saved', 'product.status': 'Status changed',
      'product.batch-create': 'Batch added', 'product.batch-expiry': 'Best-before changed' } as Record<string, string>)[entry.action_type] || entry.action_type;
  }

  removeVariant(index: number): void {
    if (this.form.variants.length === 1) return;
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
    this.error = '';
    this.notice = '';
    this.syncTextFields();
    const issue = this.validate();
    if (issue) { this.error = issue; return; }
    if (publish && (!this.product || this.product.is_new_product)) this.form.is_active = true;
    this.saving = true;
    const wasNew = !this.product;
    const request = !publish ? this.productsApi.saveDraft(this.product?.product_id ?? null, this.form)
      : this.product ? this.productsApi.update(this.product.product_id, this.form) : this.productsApi.create(this.form);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => {
        this.saving = false;
        if (publish) {
          void this.router.navigate(['/admin/products'], { queryParams: { saved: data.product_id } });
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
  defaultVariant(): AdminProductVariant | undefined { return this.form.variants.find((variant) => variant.is_default) || this.form.variants[0]; }
  isInvalidPrice(value: unknown): boolean { return typeof value !== 'number' || !Number.isFinite(value) || value <= 0; }
  trackIndex(index: number): number { return index; }

  private hydrateTextFields(): void {
    this.tagsText = this.form.product_tag.join(', ');
    this.tastingNotesText = this.form.coffee?.tasting_notes?.join(', ') || '';
    this.compositionText = (this.form.sets_bundles?.composition || []).map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n');
    this.originalTextFields = { tags: this.tagsText, tastingNotes: this.tastingNotesText, composition: this.compositionText };
    this.slugEdited = true;
  }

  private syncTextFields(): void {
    if (!this.product || this.tagsText !== this.originalTextFields.tags) this.form.product_tag = this.splitList(this.tagsText);
    if (!this.product || this.tastingNotesText !== this.originalTextFields.tastingNotes) {
      this.form.coffee = { ...(this.form.coffee || {}), tasting_notes: this.splitList(this.tastingNotesText) };
    }
    if (!this.product || this.compositionText !== this.originalTextFields.composition) {
      this.form.sets_bundles = { ...(this.form.sets_bundles || {}), composition: this.compositionText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return line; }
      }) };
    }
    this.form.images = this.form.images.filter((image) => image.url.trim()).map((image, index) => ({
      ...image, url: image.url.trim(), public_id: (image.public_id || '').trim(), alt_text: (image.alt_text || '').trim(), sort_order: index
    }));
  }

  private validate(): string {
    if (!this.form.name.trim()) return 'Product name is required.';
    if (!this.form.slug.trim()) return 'Slug is required.';
    if (!this.hasVariantType(this.form.variant_type)) return 'Choose a valid variant type.';
    if (!this.form.variants.length) return 'Add at least one variant.';
    if (this.form.variants.some(variant => this.isInvalidPrice(variant.price))) return 'Variant prices must be greater than 0.';
    if (this.form.variants.some((variant) => !variant.sku.trim())) return 'Every variant needs a SKU.';
    if (new Set(this.form.variants.map((variant) => variant.sku.trim().toLowerCase())).size !== this.form.variants.length) return 'Variant SKUs must be unique.';
    if (this.form.variants.some((variant) => variant.price < 0 || variant.stock < 0 || (variant.low_stock_threshold ?? 10) < 0)) return 'Price, stock and low-stock threshold cannot be negative.';
    if (this.form.variants.filter((variant) => variant.is_default).length !== 1) return 'Choose one default variant.';
    if (this.form.is_subscribable && this.form.subscribe_discount_percent != null
      && (this.form.subscribe_discount_percent < 5 || this.form.subscribe_discount_percent > 15 || !Number.isInteger(this.form.subscribe_discount_percent))) {
      return 'Subscription discount must be a whole number from 5 to 15.';
    }
    return '';
  }

  private toForm(product: AdminProduct): AdminProductPayload {
    const variants = (product.variants || []).map((variant) => ({
      ...variant, low_stock_threshold: variant.low_stock_threshold ?? 10,
      images: (variant.images || []).map((image) => ({ ...image }))
    }));
    const images = this.mergeImages(product.images || [], variants.flatMap(variant => variant.images));
    return {
      name: product.name, slug: product.slug, description: product.description || '', seo_title: product.seo_title || '',
      category: product.category, product_tag: [...(product.product_tag || [])], is_subscription: !!product.is_subscription,
      is_best_seller: !!product.is_best_seller, is_new_arrival: !!product.is_new_arrival,
      is_subscribable: !!product.is_subscribable, subscribe_discount_percent: product.subscribe_discount_percent ?? null,
      batch_expiry_date: product.batch_expiry_date || null,
      variant_type: product.variant_type,
      images,
      variants,
      is_active: product.is_active, quiz_eligible: product.quiz_eligible !== false,
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
