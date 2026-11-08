import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductsListingComponent } from './pages/products-listing/products-listing.component';
import { ProductFormComponent } from './pages/product-form/product-form.component';
import { AdminProduct, AdminProductRow, AdminProductService } from './services/admin-product.service';
import { AdminAuthService } from '../auth/services/admin-auth.service';
import { CloudinaryService } from '../../features/community/services/cloudinary.service';

const row = { product_id: 10001, name: 'Coffee', variants: [], images: [], is_active: true } as unknown as AdminProductRow;

describe('Products async rendering without user interaction', () => {
  afterEach(() => TestBed.resetTestingModule());

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
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { view: 'drafts' } }));
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
    const roast = fixture.nativeElement.querySelector('select[aria-label="Roast level"]') as HTMLSelectElement;
    expect(roast.value).toBe('medium roast');
    expect(roast.selectedOptions[0].textContent).toBe('Medium');
    (fixture.nativeElement.querySelector('.form-actions .btn--secondary') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(saveDraft.mock.calls[0][1].is_active).toBe(true);
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
    expect(navigate).toHaveBeenCalledWith(['/admin/products'], { queryParams: { saved: 10001 } });
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
