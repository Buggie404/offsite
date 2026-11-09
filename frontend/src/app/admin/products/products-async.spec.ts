import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { ActivatedRoute, NavigationEnd, Router, Scroll, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductsListingComponent } from './pages/products-listing/products-listing.component';
import { ProductFormComponent } from './pages/product-form/product-form.component';
import { isProductDate, ProductDateInputComponent } from './pages/product-form/product-date-input.component';
import { AdminProduct, AdminProductRow, AdminProductService } from './services/admin-product.service';
import { ProductPublishFeedbackService } from './services/product-publish-feedback.service';
import { AdminAuthService } from '../auth/services/admin-auth.service';
import { CloudinaryService } from '../../features/community/services/cloudinary.service';

const row = { product_id: 10001, name: 'Coffee', variants: [], images: [], is_active: true } as unknown as AdminProductRow;

describe('Products async rendering without user interaction', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('carries Publish feedback through real editor-to-list navigation with retained filters and scroll', async () => {
    const product = { ...row, slug: 'coffee', category: 'coffee', variant_type: 'none', product_tag: [],
      variants: [{ sku: 'C1', price: 10, stock: 2, is_default: true }] } as unknown as AdminProduct;
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([
      { path: 'admin/products', component: ProductsListingComponent },
      { path: 'admin/products/:productId', component: ProductFormComponent }
    ]),
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }),
        update: () => of({ data: product }), cachedRows: () => null, list: () => of({ data: [product] }), drafts: () => of({ data: [] }) } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const harness = await RouterTestingHarness.create();
    const editor = await harness.navigateByUrl('/admin/products/10001?category=coffee&returnScroll=500', ProductFormComponent);
    await harness.fixture.whenStable();
    editor.save(true);
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('/admin/products?');
    expect(TestBed.inject(Router).url).toContain('category=coffee');
    expect(harness.routeNativeElement?.querySelector('.publish-notice')?.textContent).toContain('Product published successfully.');
    expect(TestBed.inject(ProductPublishFeedbackService).consume()).toBe(false);
  });

  it('shows Publish success once after returning from the editor without replaying it on filters or reload', async () => {
    const queryParams = new BehaviorSubject<Record<string, string>>({ category: 'coffee', page: '2' });
    const products = Array.from({ length: 21 }, (_, index) => ({ ...row, product_id: index + 1, name: `Coffee ${index}`,
      category: 'coffee', product_tag: [] } as AdminProductRow));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => of({ data: products }), drafts: () => of({ data: [] }) } }
    ] });
    // ngOnInit can run after the router has already finished its navigation.
    vi.spyOn(TestBed.inject(Router), 'getCurrentNavigation').mockReturnValue(null);
    TestBed.inject(ProductPublishFeedbackService).published();
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.notice')?.textContent).toContain('Product published successfully.');
    expect(fixture.nativeElement.querySelector('.notice')?.classList.contains('publish-notice')).toBe(true);
    expect(fixture.componentInstance.category).toBe('coffee');
    expect(fixture.componentInstance.page).toBe(2);
    queryParams.next({ category: 'matcha' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.notice')).toBeNull();
    fixture.destroy();
    // The success signal is consumed, so visiting the list again cannot replay it.
    const reloaded = TestBed.createComponent(ProductsListingComponent);
    await reloaded.whenStable();
    expect(reloaded.nativeElement.querySelector('.notice')).toBeNull();
  });

  it('clears the discard success banner when switching views, filters or URL search state', async () => {
    const queryParams = new BehaviorSubject<Record<string, string>>({ view: 'drafts' });
    const products = [1, 2, 3].map(product_id => ({ ...row, product_id, name: `Coffee ${product_id}`, category: 'coffee', product_tag: [] } as AdminProductRow));
    let drafts = [...products];
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => of({ data: products }), drafts: () => of({ data: drafts }),
        discardDraft: (id: number) => { drafts = drafts.filter(item => item.product_id !== id); return of({ data: { product_id: id } }); } } }
    ] });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    const discard = async (product: AdminProductRow) => {
      component.requestDiscardDraft(product);
      component.discardSavedDraft();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.notice')?.textContent).toContain('Draft discarded');
    };
    await discard(products[0]);
    (fixture.nativeElement.querySelector('.low-stock-filter') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.notice')).toBeNull();
    (fixture.nativeElement.querySelector('.drafts-filter') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.notice')).toBeNull();
    await discard(products[1]);
    component.category = 'coffee'; component.onFilterChange();
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.notice')).toBeNull();
    await discard(products[2]);
    queryParams.next({ category: 'coffee', search: 'Coffee' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.notice')).toBeNull();
  });

  it('expires success banners after four seconds, restarts the countdown for new actions and cleans up on leaving', async () => {
    const products = [1, 2, 3].map(product_id => ({ ...row, product_id, name: `Coffee ${product_id}`, category: 'coffee', product_tag: [] } as AdminProductRow));
    let drafts = [...products];
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams: of({ view: 'drafts' }) } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => of({ data: products }), drafts: () => of({ data: drafts }),
        discardDraft: (id: number) => { drafts = drafts.filter(item => item.product_id !== id); return of({ data: { product_id: id } }); } } }
    ] });
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const startInterval = vi.spyOn(globalThis, 'setInterval');
    const stopInterval = vi.spyOn(globalThis, 'clearInterval');
    try {
      const discard = async (product: AdminProductRow) => {
        fixture.componentInstance.requestDiscardDraft(product);
        fixture.componentInstance.discardSavedDraft();
        await fixture.whenStable();
      };
      await discard(products[0]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(fixture.componentInstance.notice).toContain('Draft discarded');
      await discard(products[1]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fixture.componentInstance.notice).toContain('Draft discarded');
      await vi.advanceTimersByTimeAsync(3000);
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.notice')).toBeNull();
      await discard(products[2]);
      const noticeInterval = startInterval.mock.results.at(-1)?.value;
      expect(noticeInterval).toBeDefined();
      fixture.destroy();
      expect(stopInterval).toHaveBeenCalledWith(noticeInterval);
      expect(fixture.componentInstance.notice).toBe('');
    } finally { startInterval.mockRestore(); stopInterval.mockRestore(); vi.useRealTimers(); }
  });

  it('renders a legacy swapped composition image and hides null labels without rewriting stored metadata', async () => {
    const entry = { component_product_id: 12006, component_name: 'Chasen Matcha Whisk', component_variant_sku: 'TOM007',
      component_variant_label: 'null', component_image_url: 'legacy-public-id',
      component_image_public_id: 'https://example.com/chasen.jpg', quantity: 1 };
    const product = { product_id: 14002, name: 'Matcha kit', slug: 'matcha-kit', category: 'sets_bundles', variant_type: 'none',
      is_active: true, images: [], sets_bundles: { is_exclusive: false, composition: [entry] },
      variants: [{ sku: 'SET1', price: 50, stock: 3, is_default: true, images: [] }] } as unknown as AdminProduct;
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload, has_draft: true } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '14002' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const row = fixture.nativeElement.querySelector('.composition-product') as HTMLElement;
    const image = row.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('https://example.com/chasen.jpg');
    expect(row.querySelector('small')?.textContent?.trim()).toBe('TOM007');
    image.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.composition-thumb svg')).not.toBeNull();
    for (const value of [null, undefined, 'null', ' NULL ', 'undefined', '']) expect(fixture.componentInstance.compositionLabel(value)).toBe('');
    fixture.componentInstance.save(false);
    expect(saveDraft.mock.calls[0][1].sets_bundles.composition).toEqual([entry]);
    expect(product.sets_bundles?.composition).toEqual([entry]);
  });

  it('searches composition by SKU, uses the selected variant metadata, validates quantity and confirms removal', async () => {
    const image = (id: string) => ({ url: `https://example.com/${id}.jpg`, public_id: id, sort_order: 0, alt_text: id });
    const option = { product_id: 10025, name: 'Matcha Powder', category: 'matcha', is_active: true, images: [image('main')], variants: [
      { sku: 'MAT-A', label: '40g', price: 20, stock: 3, is_default: true, images: [image('a')] },
      { sku: 'MAT-B', label: '80g', price: 35, stock: 2, is_default: false, images: [image('b')] }
    ] };
    const product = { product_id: 14001, name: 'Set', slug: 'set', category: 'sets_bundles', variant_type: 'none', is_active: true,
      sets_bundles: { is_exclusive: false, composition: [] }, images: [],
      variants: [{ sku: 'SET1', price: 50, stock: 3, is_default: true, images: [] }] } as unknown as AdminProduct;
    const first = new Subject<any>(), second = new Subject<any>();
    const search = vi.fn((query: string) => query === 'Matcha' ? first : second);
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload, has_draft: true } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '14001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), searchCompositionProducts: search, saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    expect(search).not.toHaveBeenCalled();
    const input = fixture.nativeElement.querySelector('input[aria-label="Search composition products"]') as HTMLInputElement;
    input.value = 'Matcha'; input.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('Matcha', 14001));
    input.value = 'MAT-B'; input.dispatchEvent(new Event('input'));
    first.next({ data: [{ ...option, name: 'Stale result' }] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Stale result');
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('MAT-B', 14001));
    second.next({ data: [option] });
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.composition-options button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.compositionSku).toBe('MAT-B');
    const quantity = fixture.nativeElement.querySelector('input[aria-label="Composition quantity"]') as HTMLInputElement;
    const add = fixture.nativeElement.querySelector('.composition-selection > button') as HTMLButtonElement;
    expect(quantity.value).toBe('1');
    for (const invalid of ['0', '-1', '1.5', '']) {
      quantity.value = invalid; quantity.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(add.disabled).toBe(true);
    }
    quantity.value = '2'; quantity.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    add.click();
    await fixture.whenStable();
    expect(component.compositionEntries).toEqual([{ component_product_id: 10025, component_name: 'Matcha Powder', component_category: 'matcha',
      component_variant_sku: 'MAT-B', component_variant_label: '80g', component_price: 35,
      component_image_url: image('b').url, component_image_public_id: 'b', quantity: 2 }]);
    expect(saveDraft).not.toHaveBeenCalled();
    component.selectCompositionProduct(option as any);
    component.compositionSku = 'MAT-B';
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect((fixture.nativeElement.querySelector('.composition-selection > button') as HTMLButtonElement).disabled).toBe(true);
    expect(component.compositionEntries).toHaveLength(1);
    const rowQuantity = fixture.nativeElement.querySelector('input[aria-label="Quantity for Matcha Powder"]') as HTMLInputElement;
    rowQuantity.value = '0'; rowQuantity.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    component.save(false);
    expect(saveDraft).not.toHaveBeenCalled();
    rowQuantity.value = '3'; rowQuantity.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    component.save(false);
    await fixture.whenStable();
    expect(saveDraft.mock.calls[0][1].sets_bundles.composition[0]).toEqual(expect.objectContaining({ quantity: 3, component_variant_sku: 'MAT-B', component_image_public_id: 'b' }));
    expect(product.sets_bundles?.composition).toEqual([]);
    const remove = () => (fixture.nativeElement.querySelector('button[aria-label="Remove component Matcha Powder"]') as HTMLButtonElement).click();
    remove();
    await fixture.whenStable();
    expect(component.compositionEntries).toHaveLength(1);
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.compositionEntries).toHaveLength(1);
    remove();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.compositionEntries).toHaveLength(0);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('keeps the action menu outside table clipping and inside the viewport (drafts: %s)', async viewingDrafts => {
    vi.stubGlobal('innerHeight', 600);
    vi.stubGlobal('innerWidth', 800);
    try {
      const product = { ...row, category: 'coffee', product_tag: [],
        variants: [{ sku: 'C1', price: 10, stock: 3, is_default: true }] } as AdminProductRow;
      const discardDraft = vi.fn();
      TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of(viewingDrafts ? { view: 'drafts' } : {}) } },
        { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => of({ data: [product] }), drafts: () => of({ data: [product] }), discardDraft } }
      ] });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = TestBed.createComponent(ProductsListingComponent);
      await fixture.whenStable();
      const anchor = fixture.nativeElement.querySelector('.menu-cell .icon-btn') as HTMLButtonElement;
      const bounds = (top: number) => ({ top, bottom: top + 20, left: 560, right: 580, width: 20, height: 20, x: 560, y: top, toJSON: () => ({}) });
      const rect = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(bounds(565));
      anchor.click();
      await fixture.whenStable();
      let menu = fixture.nativeElement.querySelector('.row-menu') as HTMLElement;
      expect(menu).not.toBeNull();
      expect(menu.closest('.table-scroll')).toBeNull();
      expect(menu.closest('table')).toBeNull();
      expect(getComputedStyle(menu).position).toBe('fixed');
      expect(menu.dataset['placement']).toBe('above');
      expect(Number.parseFloat(menu.style.top)).toBeLessThan(565);
      expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
      expect(menu.querySelectorAll('button')).toHaveLength(viewingDrafts ? 3 : 2);
      expect(document.activeElement).toBe(menu.querySelector('button'));
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement).toBe(menu.querySelectorAll('button')[1]);
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.row-menu')).toBeNull();
      expect(document.activeElement).toBe(anchor);
      rect.mockReturnValue(bounds(10));
      anchor.click();
      await fixture.whenStable();
      menu = fixture.nativeElement.querySelector('.row-menu');
      expect(menu.dataset['placement']).toBe('below');
      expect(Number.parseFloat(menu.style.top)).toBe(36);
      document.body.click();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.row-menu')).toBeNull();
      anchor.click();
      await fixture.whenStable();
      (fixture.nativeElement.querySelector('.table-scroll') as HTMLElement).dispatchEvent(new Event('scroll'));
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.row-menu')).toBeNull();
      anchor.click();
      await fixture.whenStable();
      const buttons = fixture.nativeElement.querySelectorAll('.row-menu button') as NodeListOf<HTMLButtonElement>;
      if (viewingDrafts) {
        buttons[2].click();
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('.row-menu')).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Discard this draft?');
        expect(discardDraft).not.toHaveBeenCalled();
      } else {
        buttons[0].click();
        await fixture.whenStable();
        expect(navigate).toHaveBeenCalledWith(['/admin/products', product.product_id], expect.anything());
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('shows dd/mm/yyyy dates while emitting ISO dates and rejects impossible dates', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(ProductDateInputComponent);
    fixture.componentRef.setInput('value', '2026-12-09');
    const emitted: (string | null)[] = [];
    fixture.componentInstance.valueChange.subscribe(value => { emitted.push(value); fixture.componentRef.setInput('value', value); });
    await fixture.whenStable();
    const text = fixture.nativeElement.querySelector('input[type=text]') as HTMLInputElement;
    expect(text.value).toBe('09/12/2026');
    expect(text.placeholder).toBe('dd/mm/yyyy');
    text.value = '29/02/2028'; text.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(emitted.at(-1)).toBe('2028-02-29');
    text.value = '31/02/2026'; text.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Enter a valid date');
    expect(isProductDate(emitted.at(-1))).toBe(false);
    text.value = ''; text.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(emitted.at(-1)).toBeNull();
    const picker = fixture.nativeElement.querySelector('input[type=date]') as HTMLInputElement;
    picker.value = '2026-12-31'; picker.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(emitted.at(-1)).toBe('2026-12-31');
    expect(text.value).toBe('31/12/2026');
    fixture.componentRef.setInput('disabled', true);
    await fixture.whenStable();
    expect(text.disabled).toBe(true);
    expect(picker.disabled).toBe(true);
  });

  it('uses day-first dates for product expiry and batch editing without changing API date values', async () => {
    const product = { product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', variant_type: 'none', is_active: true,
      batch_expiry_date: '2026-12-09', images: [], variants: [{ sku: 'C1', price: 10, stock: 3, is_default: true, images: [] }] } as unknown as AdminProduct;
    const batch = { _id: 'b1', batch_code: 'B1', variant_sku: 'C1', received_at: '2026-11-09T00:00:00.000Z', best_before: '2026-12-09T00:00:00.000Z', quantity: 3 };
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload } }));
    const updateBatchBestBefore = vi.fn((_id: number, _batchId: string, date: string) => of({ data: { ...batch, best_before: date } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [batch] }), saveDraft, updateBatchBestBefore } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const expiry = fixture.nativeElement.querySelector('input[aria-label="Current batch expiry"]') as HTMLInputElement;
    expect(expiry.value).toBe('09/12/2026');
    expect(fixture.nativeElement.querySelector('.batch-table').textContent).toContain('09/11/2026');
    (fixture.nativeElement.querySelector('.date-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    const bestBefore = fixture.nativeElement.querySelector('input[aria-label="Batch best-before date"]') as HTMLInputElement;
    bestBefore.value = '10/12/2026'; bestBefore.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('[aria-label="Confirm batch row"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(updateBatchBestBefore).not.toHaveBeenCalled();
    expect(fixture.componentInstance.pendingBatchChanges.upserts[0]).toEqual(expect.objectContaining({ id: 'b1', best_before: '2026-12-10' }));
    expiry.value = '31/02/2026'; expiry.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.componentInstance.save(false);
    expect(saveDraft).not.toHaveBeenCalled();
    expiry.value = '01/12/2026'; expiry.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.componentInstance.save(false);
    expect(saveDraft.mock.calls[0][1].batch_expiry_date).toBe('2026-12-01');
    expect(saveDraft.mock.calls[0][1].batch_changes.upserts[0].best_before).toBe('2026-12-10');
  });

  it('requires confirmation to delete a variant and retains a default variant after deletion', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'new' } } } },
      { provide: AdminProductService, useValue: {} },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    fixture.componentInstance.form.variants[0].sku = 'C1';
    fixture.componentInstance.addVariant();
    fixture.componentInstance.form.variants[1].sku = 'C2';
    await fixture.whenStable();
    const remove = () => (fixture.nativeElement.querySelector('[aria-label="Remove variant"]') as HTMLButtonElement).click();
    remove();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.variants).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Delete this variant?');
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.variants).toHaveLength(2);
    remove();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.variants).toHaveLength(1);
    expect(fixture.componentInstance.form.variants[0].sku).toBe('C2');
    expect(fixture.componentInstance.form.variants[0].is_default).toBe(true);
    expect((fixture.nativeElement.querySelector('[aria-label="Remove variant"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before clearing a variant image and keeps the gallery image', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'new' } } } },
      { provide: AdminProductService, useValue: {} },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    const image = { url: 'https://example.com/image.jpg', public_id: 'img', sort_order: 0, alt_text: '' };
    fixture.componentInstance.form.images = [image];
    fixture.componentInstance.form.variants[0].images = [image];
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.variant-image-picker') as HTMLButtonElement).click();
    await fixture.whenStable();
    const clear = () => (fixture.nativeElement.querySelector('[aria-labelledby="variant-image-title"] footer button') as HTMLButtonElement).click();
    clear();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.variants[0].images).toHaveLength(1);
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-labelledby="variant-image-title"]')).not.toBeNull();
    clear();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.variants[0].images).toEqual([]);
    expect(fixture.componentInstance.form.images).toEqual([image]);
  });


  it('stages batch additions and edits locally, supports new variant SKUs and only sends them with Save draft', async () => {
    const product = { product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', variant_type: 'none', is_active: true,
      images: [], variants: [{ sku: 'C1', price: 10, stock: 3, is_default: true, images: [] }] } as unknown as AdminProduct;
    const immediateWrite = vi.fn();
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload, has_draft: true } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), addBatch: immediateWrite, updateBatchBestBefore: immediateWrite, saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.addVariant();
    component.form.variants[1].sku = 'NEW-SKU';
    component.form.variants[1].price = 20;
    const add = fixture.nativeElement.querySelector('.batches-card footer button') as HTMLButtonElement;
    add.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.batch-add-row')).not.toBeNull();
    const sku = fixture.nativeElement.querySelector('select[aria-label="Batch SKU"]') as HTMLSelectElement;
    expect([...sku.options].map(option => option.value)).toEqual(['C1', 'NEW-SKU']);
    (fixture.nativeElement.querySelector('[aria-label="Cancel batch editing"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.batches).toEqual([]);
    add.click();
    await fixture.whenStable();
    const confirm = fixture.nativeElement.querySelector('[aria-label="Confirm batch row"]') as HTMLButtonElement;
    confirm.click();
    await fixture.whenStable();
    expect(component.batches).toEqual([]);
    const code = fixture.nativeElement.querySelector('input[aria-label="Batch code"]') as HTMLInputElement;
    code.value = 'B-TEST'; code.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    confirm.click();
    await fixture.whenStable();
    expect(component.batches).toHaveLength(1);
    expect(immediateWrite).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const id = component.batches[0]._id;
    component.editBatch(component.batches[0]);
    component.batchDraft.quantity = 4;
    component.batchDraft.variant_sku = 'NEW-SKU';
    component.batchDraft.best_before = '2027-12-31';
    expect(component.confirmBatchRow()).toBe(true);
    expect(component.batches[0]._id).toBe(id);
    expect(component.pendingBatchChanges.upserts[0]).toEqual(expect.objectContaining({ client_id: id, quantity: 4, variant_sku: 'NEW-SKU', best_before: '2027-12-31' }));
    component.save(false);
    await fixture.whenStable();
    expect(saveDraft.mock.calls[0][1].batch_changes.upserts[0]).toEqual(expect.objectContaining({ client_id: id, quantity: 4 }));
    expect(immediateWrite).not.toHaveBeenCalled();
    component.requestRemoveBatch(component.batches[0]);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.batches).toHaveLength(1);
    component.requestRemoveBatch(component.batches[0]);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.batches).toEqual([]);
    expect(component.pendingBatchCount).toBe(0);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(immediateWrite).not.toHaveBeenCalled();
  });

  it('restores staged batch edits and deletions from drafts without replacing the original conflict snapshot', async () => {
    const original = { batch_code: 'B1', variant_sku: 'C1', quantity: 1, received_at: '2026-11-09', best_before: null };
    const firstId = '6af100000000000000000001', secondId = '6af100000000000000000002';
    const changes = { upserts: [{ id: firstId, ...original, quantity: 4, expected: original },
      { client_id: 'new-draft-batch', ...original, batch_code: 'NEW', quantity: 2 }],
      deletes: [{ id: secondId, expected: { ...original, batch_code: 'B2' } }] };
    const product = { product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', variant_type: 'none', is_active: true,
      has_draft: true, batch_changes: changes, images: [],
      variants: [{ sku: 'C1', price: 10, stock: 3, is_default: true, images: [] }] } as unknown as AdminProduct;
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [
        { _id: firstId, ...original, quantity: 3, added_by_name: 'Admin' },
        { _id: secondId, ...original, batch_code: 'B2', added_by_name: 'Admin' }
      ] }), saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    expect(component.batches.map(row => [row.batch_code, row.quantity])).toEqual([['B1', 4], ['NEW', 2]]);
    expect(component.pendingBatchChanges).toEqual(changes);
    component.save(false);
    expect(saveDraft.mock.calls[0][1].batch_changes).toEqual(changes);
  });

  it('restores list filters, page and scroll after asynchronous loading and carries them through the editor back link', async () => {
    const params = { category: 'coffee', status: 'active', tag: 'best_seller', stock: 'low', page: '2', search: 'Coffee', scroll: '320' };
    const queryParams = new BehaviorSubject<Record<string, string>>(params);
    const list = new Subject<any>();
    const drafts = new Subject<any>();
    const route = { queryParams, snapshot: { paramMap: { get: () => 'new' }, queryParamMap: { get: (_key: string): string | null => null } } };
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: route },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => list, drafts: () => drafts } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const scrollEvents = new Subject<any>();
    vi.spyOn(TestBed.inject(Router), 'events', 'get').mockReturnValue(scrollEvents);
    vi.spyOn(TestBed.inject(Router), 'getCurrentNavigation').mockReturnValue({} as any);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    drafts.next({ data: [] });
    await fixture.whenStable();
    expect(fixture.componentInstance.page).toBe(2);
    const data = Array.from({ length: 25 }, (_, i) => ({ ...row, product_id: 11000 + i, name: `Coffee ${i}`, category: 'coffee',
      product_tag: [], is_best_seller: true, variants: [{ sku: `C${i}`, stock: 3, price: 10, is_default: true }] } as AdminProductRow));
    list.next({ data });
    await fixture.whenStable();
    const component = fixture.componentInstance;
    expect(component.page).toBe(2);
    expect(component.visibleRows[0].product_id).toBe(11010);
    expect(component.category).toBe('coffee');
    expect(component.status).toBe('active');
    expect(component.stockFilter).toBe('low');
    expect(scrollTo).not.toHaveBeenCalled();
    scrollEvents.next(new Scroll(new NavigationEnd(1, '/admin/products', '/admin/products'), null, null));
    await fixture.whenStable();
    expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'auto' });
    // A later background draft response must not reset the current live page.
    drafts.next({ data: [] });
    await fixture.whenStable();
    expect(component.page).toBe(2);
    component.edit(data[10]);
    const editParams = navigate.mock.calls.at(-1)![1]!.queryParams!;
    expect(editParams).toEqual(expect.objectContaining({ category: 'coffee', status: 'active', tag: 'best_seller', stock: 'low', page: 2, search: 'Coffee' }));
    route.snapshot.queryParamMap.get = key => editParams[key] == null ? null : String(editParams[key]);
    const editor = TestBed.createComponent(ProductFormComponent);
    await editor.whenStable();
    expect(editor.componentInstance.backQueryParams).toEqual({ category: 'coffee', status: 'active', tag: 'best_seller', stock: 'low', page: '2',
      scroll: String(editParams['returnScroll']), view: null, search: 'Coffee' });
    expect(editor.nativeElement.querySelector('.back-link').getAttribute('href')).toContain('category=coffee');
    component.status = 'inactive';
    component.onFilterChange();
    expect(component.page).toBe(1);
    expect(navigate.mock.calls.at(-1)![1]!.queryParams).toEqual(expect.objectContaining({ category: 'coffee', status: 'inactive', page: null, scroll: null }));
    scrollTo.mockRestore();
  });

  it('filters both live and draft rows by New arrival or Best seller alongside the other filters', async () => {
    const queryParams = new BehaviorSubject<Record<string, string>>({});
    const item = (id: number, is_new_arrival: boolean, is_best_seller: boolean, category = 'coffee', stock = 3) => ({
      ...row, product_id: id, name: `Product ${id}`, category, product_tag: [], is_new_arrival, is_best_seller,
      variants: [{ sku: `S${id}`, price: 10, stock, is_default: true }]
    } as AdminProductRow);
    const data = [item(1, true, false), item(2, false, true), item(3, true, true), item(4, true, false, 'matcha'), item(5, true, false, 'coffee', 0)];
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => of({ data }), drafts: () => of({ data: [item(6, true, false)] }) } }
    ] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    const selects = [...fixture.nativeElement.querySelectorAll('.filters select')] as HTMLSelectElement[];
    expect(selects.map(select => select.getAttribute('aria-label'))).toEqual(['Filter by category', 'Filter by status', 'Filter by tag']);
    const tag = selects[2];
    tag.selectedIndex = 1; tag.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.filteredRows.map(item => item.product_id)).toEqual([1, 3, 4, 5]);
    expect(navigate.mock.calls.at(-1)![1]!.queryParams).toEqual(expect.objectContaining({ tag: 'new_arrival', page: null }));
    queryParams.next({ tag: 'new_arrival', category: 'coffee', stock: 'low', status: 'active' });
    await fixture.whenStable();
    expect(fixture.componentInstance.filteredRows.map(item => item.product_id)).toEqual([1, 3]);
    queryParams.next({ tag: 'best_seller' });
    await fixture.whenStable();
    expect(fixture.componentInstance.filteredRows.map(item => item.product_id)).toEqual([2, 3]);
    queryParams.next({ view: 'drafts', tag: 'new_arrival' });
    await fixture.whenStable();
    expect(fixture.componentInstance.filteredRows.map(item => item.product_id)).toEqual([6]);
  });

  it('locks Composition for exclusive sets without clearing its data and unlocks it when unchecked', async () => {
    const composition = ['Cup', { product_id: 123, quantity: 2 }];
    const product = { product_id: 14001, name: 'Set', slug: 'set', category: 'sets_bundles', variant_type: 'none', is_active: true,
      images: [], variants: [{ sku: 'SET1', price: 20, stock: 2, is_default: true, images: [] }],
      sets_bundles: { is_exclusive: true, composition } } as unknown as AdminProduct;
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload, has_draft: true } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '14001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('fieldset[aria-label="Composition"]') as HTMLFieldSetElement;
    const toggle = fixture.nativeElement.querySelector('.category-card .check-field input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('textarea[aria-label="Composition"]')).toBeNull();
    toggle.click();
    await fixture.whenStable();
    expect(input.disabled).toBe(false);
    expect(fixture.componentInstance.setBundle.composition).toEqual(composition);
    toggle.click();
    await fixture.whenStable();
    expect(input.disabled).toBe(true);
    fixture.componentInstance.save(false);
    expect(saveDraft.mock.calls[0][1].sets_bundles.composition).toEqual(composition);
    expect(saveDraft.mock.calls[0][1].sets_bundles.is_exclusive).toBe(true);
  });

  it('discards from the editor only after confirming, and keeps the draft available after an error', async () => {
    const product = { product_id: 10001, name: 'Coffee draft', slug: 'coffee', category: 'coffee', variant_type: 'none',
      has_draft: true, is_active: true, images: [], variants: [{ sku: 'C1', price: 10, stock: 2, is_default: true, images: [] }] } as unknown as AdminProduct;
    const result = new Subject<{ data: { product_id: number } }>();
    const discardDraft = vi.fn(() => result);
    const update = vi.fn();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), discardDraft, update } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const open = () => (fixture.nativeElement.querySelector('.form-actions button') as HTMLButtonElement).click();
    open();
    await fixture.whenStable();
    expect(discardDraft).not.toHaveBeenCalled();
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(discardDraft).not.toHaveBeenCalled();
    open();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(discardDraft).toHaveBeenCalledWith(10001);
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.form-actions button').disabled).toBe(true);
    result.error({ error: { error: 'Try again' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Try again');
    expect(fixture.componentInstance.product?.has_draft).toBe(true);
    discardDraft.mockReturnValue(of({ data: { product_id: 10001 } }) as any);
    open();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/admin/products'], { queryParams: { view: null, search: null } });
    expect(update).not.toHaveBeenCalled();
  });

  it('searches live products and saved drafts separately and publishes from the draft view', async () => {
    const queryParams = new Subject<Record<string, string>>();
    const live: AdminProductRow = { ...row, name: 'Live coffee', category: 'coffee', product_tag: [], has_draft: true,
      variants: [{ sku: 'C1', price: 25, stock: 20, is_default: true }] };
    const edited: AdminProductRow = { ...live, name: 'Draft coffee', draft_saved_at: '2026-11-08T09:00:00Z',
      variants: [{ sku: 'C1', price: 30, stock: 20, is_default: true }] };
    let drafts = [edited];
    const publishDraft = vi.fn(() => { live.name = edited.name; live.variants = edited.variants; drafts = []; return of({ data: live }); });
    const discardDraft = vi.fn(() => of({ data: { product_id: live.product_id } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => of({ data: [live] }), drafts: () => of({ data: drafts }), publishDraft, discardDraft } }
    ] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Live coffee');
    expect(fixture.nativeElement.textContent).not.toContain('Draft changes');
    queryParams.next({ search: 'Draft coffee' });
    await fixture.whenStable();
    expect(fixture.componentInstance.filteredRows).toHaveLength(0);
    (fixture.nativeElement.querySelector('.drafts-filter') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.filteredRows.map(product => product.name)).toEqual(['Draft coffee']);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ view: 'drafts' }) }));
    queryParams.next({ view: 'drafts', search: 'Live coffee' });
    await fixture.whenStable();
    expect(fixture.componentInstance.filteredRows).toHaveLength(0);
    queryParams.next({ view: 'drafts', search: 'Draft coffee' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.status-toggle')).toBeNull();
    fixture.componentInstance.draftPendingDiscard = edited;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(discardDraft).not.toHaveBeenCalled();
    fixture.componentInstance.publishSavedDraft(edited);
    await fixture.whenStable();
    expect(publishDraft).toHaveBeenCalledWith(live.product_id);
    expect(fixture.componentInstance.draftRows).toHaveLength(0);
    expect(fixture.componentInstance.rows[0].variants[0].price).toBe(30);
    queryParams.next({ search: 'Draft coffee' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('separates low-stock and sold-out filters and receives header searches through query params', async () => {
    const queryParams = new Subject<Record<string, string>>();
    const item = (id: number, name: string, sku: string, stock: number): AdminProductRow => ({
      ...row, product_id: id, name, category: 'coffee', product_tag: [],
      variants: [{ sku, stock, price: 10, is_default: true, low_stock_threshold: 10 }]
    });
    const list = vi.fn(() => of({ data: [item(3, 'Available', 'A1', 20), item(1, 'Low coffee', 'L1', 3), item(2, 'Sold out', 'O1', 0)] }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list, drafts: () => of({ data: [] }) } }
    ] });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    expect(component.filteredRows.map(product => product.product_id)).toEqual([1, 2, 3]);
    component.category = 'coffee';
    component.applyFilters();
    expect(component.filteredRows.map(product => product.product_id)).toEqual([1, 2, 3]);
    expect(component.rows.map(product => product.product_id)).toEqual([3, 1, 2]);
    expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeNull();
    expect(component.lowStockCount).toBe(1);
    expect(component.outOfStockCount).toBe(1);
    (fixture.nativeElement.querySelector('.low-stock-filter:not(.out-stock-filter)') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.filteredRows.map(product => product.product_id)).toEqual([1]);
    (fixture.nativeElement.querySelector('.out-stock-filter') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.filteredRows.map(product => product.product_id)).toEqual([2]);
    expect(fixture.nativeElement.querySelector('.low-stock-filter:not(.out-stock-filter)')?.getAttribute('aria-pressed')).toBe('false');
    (fixture.nativeElement.querySelector('.out-stock-filter') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.filteredRows).toHaveLength(3);
    queryParams.next({ search: 'L1' });
    await fixture.whenStable();
    expect(component.filteredRows.map(product => product.product_id)).toEqual([1]);
    queryParams.next({ search: 'available' });
    await fixture.whenStable();
    expect(component.filteredRows.map(product => product.product_id)).toEqual([3]);
    queryParams.next({});
    await fixture.whenStable();
    expect(component.filteredRows).toHaveLength(3);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['matcha', 'product_grade', 'Product grade', 'ceremonial grade', 'premium grade'],
    ['matcha', 'product_grade', 'Product grade', null, 'barista grade'],
    ['matcha', 'product_grade', 'Product grade', 'existing specialty grade', 'barista grade'],
    ['matcha', 'pricing_tier', 'Pricing tier', 'ritual_series', 'ritual_series'],
    ['coffee', 'process_type', 'Process', 'washed', 'wet-hulled'],
    ['drinkware', 'ware_type', 'Ware type', 'mugs', 'bottles'],
    ['drinkware', 'material', 'Material', 'ceramic', 'glass'],
    ['sets_bundles', 'set_type', 'Set type', 'coffee kit', 'matcha bundle'],
    ['tools', 'tool_category', 'Tool category', 'tea tools', 'coffee tools'],
    ['tools', 'tool_type', 'Tool type', 'chasen', 'dripper']
  ])('renders %s.%s as a dropdown without changing its stored value', async (category, field, label, original, selected) => {
    const product = { product_id: 10001, name: 'Product', slug: 'product', category, variant_type: 'none',
      [category!]: { [field!]: original }, is_active: true, images: [],
      variants: [{ sku: 'P1', price: 10, stock: 3, is_default: true, images: [] }] } as unknown as AdminProduct;
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    let select = fixture.nativeElement.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe(original || '');
    expect(Array.from(select.options, option => option.textContent)).not.toContain('Not set');
    if (original === null) expect(select.selectedIndex).toBe(-1);
    fixture.componentInstance.save(false);
    await fixture.whenStable();
    expect(saveDraft.mock.calls[0][1][category!][field!]).toBe(original);
    select = fixture.nativeElement.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    select.value = selected!;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.componentInstance.save(false);
    await fixture.whenStable();
    expect(saveDraft.mock.calls[1][1][category!][field!]).toBe(selected);
  });

  it.each([
    ['coffee', 'Coffee', 'size'], ['matcha', 'Matcha', 'package'], ['matcha', 'Matcha', 'none'],
    ['sets_bundles', 'Sets & bundles', 'none'], ['drinkware', 'Drinkware', 'color'], ['tools', 'Tools', 'type']
  ])('preserves stored dropdown values when reopening and saving %s / %s / %s', async (category, categoryLabel, variantType) => {
    const product = { product_id: 10001, name: 'Product', slug: 'product', category, variant_type: variantType,
      is_active: true, coffee: { roast_level: 'medium roast', process_type: 'washed' },
      sets_bundles: { composition: ['{"product_id":123}', { product_id: 456 }, '2'] }, images: [],
      variants: [{ sku: 'P1', label: '', price: 10, stock: 2, is_default: true, images: [] }] } as unknown as AdminProduct;
    const saveDraft = vi.fn(() => new Subject<any>());
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const categorySelect = fixture.nativeElement.querySelector('.category-select-wrap select') as HTMLSelectElement;
    const variantSelect = fixture.nativeElement.querySelector('select[aria-label="Variant type"]') as HTMLSelectElement;
    expect(categorySelect.selectedOptions[0].textContent?.trim()).toBe(categoryLabel);
    expect(variantSelect.selectedOptions).toHaveLength(1);
    expect(Array.from(variantSelect.options, option => option.textContent)).not.toContain('yuki (existing)');
    expect(fixture.componentInstance.variantTypes.map(type => type.value)).toEqual(['none', 'size', 'color', 'type', 'package']);
    fixture.componentInstance.save(false);
    const args = saveDraft.mock.calls[0] as unknown as [number, any];
    expect(args[1].category).toBe(category);
    expect(args[1].variant_type).toBe(variantType);
    expect(args[1].coffee.roast_level).toBe('medium roast');
    expect(args[1].coffee.process_type).toBe('washed');
    expect(args[1].sets_bundles.composition).toEqual(['{"product_id":123}', { product_id: 456 }, '2']);
    expect(args[1].variants[0].sku).toBe('P1');
    expect(args[1].variants[0].label).toBe('');
    expect(args[1].variants[0].images).toEqual([]);
  });

  it('keeps a saved draft in the editor and allows publishing it afterward', async () => {
    const product = { product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', variant_type: 'none',
      is_active: true, coffee: { roast_level: 'medium roast' }, images: [], variants: [{ sku: 'C1', price: 10, stock: 2, is_default: true, images: [] }] } as unknown as AdminProduct;
    const update = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload } }));
    const saveDraft = vi.fn((_id: number, payload: any) => of({ data: { ...product, ...payload, has_draft: true } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }), update, saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Subscription product');
    expect(fixture.nativeElement.textContent).not.toContain('Eligible for Starter Kit Quiz');
    const roast = fixture.nativeElement.querySelector('select[aria-label="Roast level"]') as HTMLSelectElement;
    expect(roast.value).toBe('medium roast');
    expect(roast.selectedOptions[0].textContent).toBe('Medium');
    (fixture.nativeElement.querySelector('.form-actions .btn--secondary') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(saveDraft.mock.calls[0][1].is_active).toBe(true);
    expect(Object.hasOwn(saveDraft.mock.calls[0][1], 'is_subscription')).toBe(false);
    expect(Object.hasOwn(saveDraft.mock.calls[0][1], 'quiz_eligible')).toBe(false);
    expect(saveDraft.mock.calls[0][1].coffee.roast_level).toBe('medium roast');
    expect(update).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Draft saved');
    const publish = fixture.nativeElement.querySelector('.form-actions .btn--primary') as HTMLButtonElement;
    expect(publish.textContent).toContain('Publish');
    expect(publish.disabled).toBe(false);
    roast.value = 'light roast';
    roast.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    publish.click();
    await fixture.whenStable();
    expect(update.mock.calls[0][1].is_active).toBe(true);
    expect(update.mock.calls[0][1].coffee.roast_level).toBe('light roast');
    expect(Object.hasOwn(update.mock.calls[0][1], 'quiz_eligible')).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/admin/products'], { queryParams: { view: null, search: null } });
    expect(TestBed.inject(ProductPublishFeedbackService).consume()).toBe(true);
    expect(TestBed.inject(ProductPublishFeedbackService).consume()).toBe(false);
  });

  it('shows an inline error for zero price and blocks saving until price is positive', async () => {
    const create = vi.fn();
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'new' } } } },
      { provide: AdminProductService, useValue: { create } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    const component = fixture.componentInstance;
    component.form.name = 'Coffee'; component.form.slug = 'coffee'; component.form.variants[0].sku = 'C1';
    await fixture.whenStable();
    const price = fixture.nativeElement.querySelector('.variant-price-cell input') as HTMLInputElement;
    expect(price.value).toBe('');
    expect(price.classList.contains('invalid')).toBe(false);
    expect(fixture.nativeElement.querySelector('.inline-field-error')).toBeNull();
    price.value = '0';
    price.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(price.classList.contains('invalid')).toBe(true);
    expect(fixture.nativeElement.querySelector('.inline-field-error')?.textContent).toContain('Must be greater than 0.');
    component.save(false);
    expect(create).not.toHaveBeenCalled();
    price.value = '1';
    price.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.inline-field-error')).toBeNull();
    expect(price.classList.contains('invalid')).toBe(false);
  });

  it('keeps a newly added variant blank without a price error, but rejects an empty price on save', async () => {
    const saveDraft = vi.fn();
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'new' } } } },
      { provide: AdminProductService, useValue: { saveDraft } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    const component = fixture.componentInstance;
    component.form.name = 'Coffee'; component.form.slug = 'coffee';
    component.form.variants[0].sku = 'C1'; component.form.variants[0].price = 10;
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.variants-card footer button') as HTMLButtonElement).click();
    await fixture.whenStable();
    const price = fixture.nativeElement.querySelectorAll('.variant-price-cell input')[1] as HTMLInputElement;
    expect(component.form.variants[1].price).toBeNull();
    expect(price.value).toBe('');
    expect(price.classList.contains('invalid')).toBe(false);
    component.save(false);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(price.classList.contains('invalid')).toBe(true);
    (fixture.nativeElement.querySelector('.variants-card footer button') as HTMLButtonElement).click();
    await fixture.whenStable();
    const newlyAdded = fixture.nativeElement.querySelectorAll('.variant-price-cell input')[2] as HTMLInputElement;
    expect(newlyAdded.value).toBe('');
    expect(newlyAdded.classList.contains('invalid')).toBe(false);
  });

  it('uses the configured low-stock threshold with a default of 10 and distinguishes sold-out products', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: {} }, { provide: AdminProductService, useValue: {} }
    ] });
    const component = TestBed.createComponent(ProductsListingComponent).componentInstance;
    const item = (stock: number, threshold?: number): AdminProductRow => ({ ...row,
      variants: [{ sku: 'C1', price: 10, stock, is_default: true, low_stock_threshold: threshold }] });
    expect(component.isLowStock(item(10))).toBe(true);
    expect(component.isLowStock(item(11))).toBe(false);
    expect(component.isLowStock(item(3, 2))).toBe(false);
    expect(component.isLowStock(item(2, 2))).toBe(true);
    expect(component.isLowStock(item(1, 0))).toBe(false);
    expect(component.isLowStock(item(0))).toBe(false);
    expect(component.isOutOfStock(item(0))).toBe(true);
  });

  it('renders list and successful inactive save as soon as responses arrive', async () => {
    const list = new Subject<any>();
    const save = new Subject<any>();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => list, drafts: () => of({ data: [] }), updateStatuses: () => save } }
    ] });
    TestBed.overrideComponent(ProductsListingComponent, { set: { template: '{{loading}}|{{saving}}|{{rows[0]?.is_active}}|{{notice}}|{{error}}' } });
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    list.next({ data: [row] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('false|false|true');
    fixture.componentInstance.toggleStatus(row);
    fixture.componentInstance.applyChanges();
    save.next({ data: [{ product_id: row.product_id, is_active: false }] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('false|false|false|1 product status');
  });

  it('renders failed status save immediately and retains changes for retry', async () => {
    const save = new Subject<any>();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      { provide: AdminProductService, useValue: { cachedRows: () => null, list: () => of({ data: [row] }), drafts: () => of({ data: [] }), updateStatuses: () => save } }
    ] });
    TestBed.overrideComponent(ProductsListingComponent, { set: { template: '{{saving}}|{{error}}' } });
    const fixture = TestBed.createComponent(ProductsListingComponent);
    await fixture.whenStable();
    fixture.componentInstance.toggleStatus(row);
    fixture.componentInstance.applyChanges();
    save.error({ error: { error: 'Database unavailable' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('false|Database unavailable');
    expect(fixture.componentInstance.pendingCount).toBe(1);
    expect(fixture.componentInstance.rows[0].is_active).toBe(true);
  });

  it('renders product detail and save errors immediately', async () => {
    const get = new Subject<any>();
    const update = new Subject<any>();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => get, saveDraft: () => update, batches: () => of({ data: [] }) } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } }
      ,{ provide: CloudinaryService, useValue: {} }
    ] });
    TestBed.overrideComponent(ProductFormComponent, { set: { template: '{{loading}}|{{saving}}|{{form.name}}|{{error}}' } });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    get.next({ data: { ...row, slug: 'coffee', variant_type: 'none', product_tag: [], variants: [{ sku: 'C1', price: 10, stock: 1, is_default: true }] } as unknown as AdminProduct });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('false|false|Coffee');
    fixture.componentInstance.save(false);
    update.error({ error: { error: 'Slug already used' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('false|false|Coffee|Slug already used');
  });

  it('does not create a new product when loading an existing product fails', async () => {
    const get = new Subject<any>();
    const create = vi.fn();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => get, create } },
      { provide: CloudinaryService, useValue: {} },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    get.error({ error: { error: 'Product not found' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Product not found');
    expect(fixture.nativeElement.querySelector('.form-layout')).toBeNull();
    fixture.componentInstance.save(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('shows the selected product image only on its matching variant row', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'new' } } } },
      { provide: AdminProductService, useValue: {} },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    const component = fixture.componentInstance;
    component.form.images = [{ url: 'https://example.com/12oz.jpg', public_id: '12oz', sort_order: 0, alt_text: '12 oz' }];
    // Even a single default SKU stays unassigned until the admin chooses an image.
    expect(component.variantImage(component.form.variants[0])).toBeNull();
    expect(component.form.variants[0].images).toEqual([]);
    component.form.variants = [
      { sku: 'COF-12', label: '12 oz', price: 27, stock: 3, is_default: true, images: [] },
      { sku: 'COF-24', label: '24 oz', price: 54, stock: 4, is_default: false, images: [] }
    ];
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.variant-image-picker') as HTMLButtonElement).click();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('[aria-labelledby="variant-image-title"]');
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(dialog.querySelector('input[type="url"]')).toBeNull();
    component.assignVariantImage({ url: 'https://example.com/outside.jpg', public_id: 'outside', sort_order: 0, alt_text: '' });
    expect(component.form.variants[0].images).toEqual([]);
    (fixture.nativeElement.querySelector('.variant-choice') as HTMLButtonElement).click();
    await fixture.whenStable();
    const rows = fixture.nativeElement.querySelectorAll('.variant-table tbody tr');
    expect(rows[0].querySelector('.variant-image-picker img')?.getAttribute('src')).toBe('https://example.com/12oz.jpg');
    expect(rows[1].querySelector('.variant-image-picker img')).toBeNull();
    expect(component.form.variants[0].images[0].public_id).toBe('12oz');
    component.chooseVariantImage(0);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.variant-choice.is-selected')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.variant-choice.is-selected').getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('.variant-choice-check svg')).not.toBeNull();
    component.chooseVariantImage(1);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.variant-choice.is-selected')).toBeNull();
    expect(component.form.variants[1].images).toEqual([]);
  });

  it('shows every unique variant image in the product gallery when opening an existing product', async () => {
    const picture = (name: string) => ({ url: `https://example.com/${name}.jpg`, public_id: name, sort_order: 0, alt_text: name });
    const product = {
      product_id: 10001, name: 'Coffee', slug: 'coffee', category: 'coffee', product_tag: [], coffee: { roast_level: 'medium dark roast' },
      images: [picture('main')], variants: [
        { sku: 'GREEN', label: 'Green', price: 40, stock: 6, is_default: true, images: [picture('green'), picture('main')] },
        { sku: 'BROWN', label: 'Brown', price: 40, stock: 8, is_default: false, images: [picture('brown')] },
        { sku: 'BLACK', label: 'Black', price: 40, stock: 5, is_default: false, images: [picture('black')] }
      ]
    } as unknown as AdminProduct;
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '10001' } } } },
      { provide: AdminProductService, useValue: { get: () => of({ data: product }), batches: () => of({ data: [] }) } },
      { provide: AdminAuthService, useValue: { getAdminRole: () => 'qlsp' } },
      { provide: CloudinaryService, useValue: {} }
    ] });
    const fixture = TestBed.createComponent(ProductFormComponent);
    await fixture.whenStable();
    const gallery = fixture.nativeElement.querySelectorAll('.image-tile-preview img');
    expect(Array.from(gallery, (img: any) => img.getAttribute('src'))).toEqual([
      picture('main').url, picture('green').url, picture('brown').url, picture('black').url
    ]);
    expect(fixture.componentInstance.form.variants[1].images[0].url).toBe(picture('brown').url);
    expect(fixture.componentInstance.form.coffee?.roast_level).toBe('medium dark roast');
    expect(fixture.componentInstance.form.variants[0].low_stock_threshold).toBe(10);
    (fixture.nativeElement.querySelectorAll('.image-delete')[2] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')?.textContent).toContain('Delete this image?');
    expect(fixture.nativeElement.querySelector('.delete-image-preview img')?.getAttribute('src')).toBe(picture('brown').url);
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.images).toHaveLength(4);
    (fixture.nativeElement.querySelectorAll('.image-delete')[2] as HTMLButtonElement).click();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.images.map(image => image.url)).not.toContain(picture('brown').url);
    expect(fixture.componentInstance.form.variants[1].images).toEqual([]);
  });
});
