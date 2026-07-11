import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { LucideChevronDown, LucidePlus, LucideX, LucideShoppingCart } from '@lucide/angular';
import { ProductService } from '../../../home/services/product.service';
import {
  Product,
  Variant,
  getDefaultPrice,
  isProductOutOfStock
} from '../../../home/models/product.model';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { CartService } from '../../../purchase/services/cart.service';
import { Product as CartProduct } from '../../../../shared/models/product.model';
import { createKitBundle } from '../../../purchase/models/bundle-cart.model';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { BundleBuilderStateService } from '../../services/bundle-builder-state.service';
import type {
  BundleBuilderSnapshot,
  BundleCategoryFilter,
  BundlePackageSlotId,
  KitSlotId,
  KitType,
  PackSize,
  PersistedSlotSelection,
  SlotKey
} from './build-your-bundle.types';

interface KitTypeOption {
  id: KitType;
  label: string;
}

interface SlotSelection {
  product: Product;
  variantSku: string;
}

interface SlotProductFilter {
  category: string;
  productTag?: string;
}

interface SlotPanelView {
  position: number;
  key: SlotKey;
  label: string;
  placeholderImage: string;
  visible: boolean;
  optional: boolean;
  filled: boolean;
  active: boolean;
  selection: SlotSelection | null;
}

const KIT_SLOT_FILTERS: Record<
  'matcha_kit' | 'coffee_kit',
  Record<KitSlotId, SlotProductFilter>
> = {
  matcha_kit: {
    package: { category: 'matcha' },
    tool: { category: 'tools', productTag: 'tea-tools' },
    drinkware: { category: 'drinkware' }
  },
  coffee_kit: {
    package: { category: 'coffee' },
    tool: { category: 'tools', productTag: 'coffee-tools' },
    drinkware: { category: 'drinkware' }
  }
};

const BUNDLE_CATEGORY_FILTERS: { id: BundleCategoryFilter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'matcha', label: 'MATCHA' },
  { id: 'coffee', label: 'COFFEE' }
];

const PACKAGE_PLACEHOLDER = 'assets/images/build-bundle/package.png';
const TOOL_PLACEHOLDER = 'assets/images/build-bundle/tool.png';
const DRINKWARE_PLACEHOLDER = 'assets/images/build-bundle/drinkware.png';

@Component({
  selector: 'app-build-your-bundle',
  standalone: true,
  imports: [CommonModule, LucideChevronDown, LucidePlus, LucideX, LucideShoppingCart, ProductCardComponent],
  templateUrl: './build-your-bundle.component.html',
  styleUrl: './build-your-bundle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BuildYourBundleComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly authService = inject(AuthService);
  private readonly authPromptService = inject(AuthPromptModalService);
  private readonly bundleState = inject(BundleBuilderStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('productBrowser') productBrowserRef?: ElementRef<HTMLElement>;

  private pendingSlotRestore: Partial<Record<SlotKey, PersistedSlotSelection>> | null = null;

  savedProductIds = new Set<number>();

  readonly kitTypes: KitTypeOption[] = [
    { id: 'matcha_kit', label: 'MATCHA KIT' },
    { id: 'coffee_kit', label: 'COFFEE KIT' },
    { id: 'bundle', label: 'MATCHA & COFFEE BUNDLE' }
  ];

  readonly bundleCategoryFilters = BUNDLE_CATEGORY_FILTERS;
  readonly slotPositions = [0, 1, 2] as const;

  selectedKitType = signal<KitType>('matcha_kit');
  selectedPackSize = signal<PackSize>(2);
  activeSlotKey = signal<SlotKey | null>('package');
  slotSelections = signal<Partial<Record<SlotKey, SlotSelection>>>({});
  bundleCategoryFilter = signal<BundleCategoryFilter>('all');
  products = signal<Product[]>([]);
  loadingProducts = signal(false);

  isBundleMode = computed(() => this.selectedKitType() === 'bundle');

  showCategoryTabs = computed(() => this.isBundleMode());

  visibleSlots = computed((): SlotPanelView[] => {
    return this.slotPanels().filter((panel) => panel.visible);
  });

  slotPanels = computed((): SlotPanelView[] => {
    const active = this.activeSlotKey();
    const selections = this.slotSelections();
    const packSize = this.selectedPackSize();

    return this.slotPositions.map((position) => {
      const key = this.getSlotKeyForPosition(position);
      return {
        position,
        key,
        label: this.getSlotLabelForPosition(position),
        placeholderImage: this.getSlotPlaceholderImage(position),
        visible: position < 2 || packSize === 3,
        optional: position === 2,
        filled: !!selections[key],
        active: active === key,
        selection: selections[key] ?? null
      };
    });
  });

  productsBySlot = computed(() => {
    const kitType = this.selectedKitType();
    if (kitType === 'bundle') {
      return {} as Record<KitSlotId, Product[]>;
    }

    const products = this.products();
    const filters = KIT_SLOT_FILTERS[kitType];
    const result = {} as Record<KitSlotId, Product[]>;

    (['package', 'tool', 'drinkware'] as KitSlotId[]).forEach((slotId) => {
      result[slotId] = products.filter((product) =>
        this.matchesSlotProductFilter(product, filters[slotId])
      );
    });

    return result;
  });

  activeKitSlotProducts = computed(() => {
    const slotKey = this.activeSlotKey();
    if (!slotKey || this.isBundleMode()) return [];
    return this.productsBySlot()[slotKey as KitSlotId] ?? [];
  });

  requiredSlotKeys = computed(() => this.visibleSlots().map((slot) => slot.key));

  browserProducts = computed(() => {
    const slotKey = this.activeSlotKey();
    if (!slotKey) return [];

    if (this.isBundleMode()) {
      return this.getBundleBrowserProducts();
    }

    const kitType = this.selectedKitType();
    if (kitType !== 'matcha_kit' && kitType !== 'coffee_kit') return [];

    const filter = KIT_SLOT_FILTERS[kitType][slotKey as KitSlotId];
    if (!filter) return [];

    return this.products().filter((product) => this.matchesSlotProductFilter(product, filter));
  });

  showBundlePricing = computed(() => {
    const selections = this.slotSelections();
    return this.requiredSlotKeys().every((key) => !!selections[key]);
  });

  bundlePricing = computed(() => {
    if (!this.showBundlePricing()) return null;

    const selections = this.slotSelections();
    const original = this.requiredSlotKeys().reduce((sum, key) => {
      return sum + this.getSelectionPrice(selections[key]!);
    }, 0);

    return {
      original,
      sale: original * 0.8
    };
  });

  canAddBundleToCart = computed(() => this.showBundlePricing());

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.restoreBuilderState();
      this.loadProducts();
      void this.loadSavedProducts();
    }
  }

  isProductSaved(product: Product): boolean {
    return this.savedProductIds.has(product.product_id);
  }

  async onProductSave(product: Product): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedProduct(product.product_id);
      if (result.saved) {
        this.savedProductIds.add(product.product_id);
      } else {
        this.savedProductIds.delete(product.product_id);
      }
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to save product:', err);
    }
  }

  selectKitType(kitType: KitType): void {
    if (this.selectedKitType() === kitType) return;

    const previousType = this.selectedKitType();
    const previousActive = this.activeSlotKey();

    this.selectedKitType.set(kitType);
    this.bundleCategoryFilter.set('all');
    this.resetSelections();
    this.activeSlotKey.set(this.mapActiveSlotOnKitChange(previousType, kitType, previousActive));
    this.persistBuilderState();

    // Scroll the product browser back to the top so the user sees products from the start
    this.scrollProductBrowserToTop();
  }

  selectPackSize(size: PackSize): void {
    if (this.selectedPackSize() === size) return;

    const previousActive = this.activeSlotKey();
    this.selectedPackSize.set(size);
    this.pruneSelectionsForPackSize(size);
    this.activeSlotKey.set(this.mapActiveSlotOnPackChange(previousActive, size));
    this.persistBuilderState();
  }

  isSlotPositionVisible(position: number): boolean {
    return position < 2 || this.selectedPackSize() === 3;
  }

  isSlotPositionOptional(position: number): boolean {
    return position === 2;
  }

  getSlotKeyForPosition(position: number): SlotKey {
    if (this.isBundleMode()) {
      return `package-${position}` as BundlePackageSlotId;
    }

    if (position === 0) return 'package';
    if (position === 1) return 'tool';
    return 'drinkware';
  }

  getSlotLabelForPosition(position: number): string {
    if (this.isBundleMode()) return `Package ${position + 1}`;
    if (position === 0) return 'Package';
    if (position === 1) return 'Tool';
    return 'Drinkware';
  }

  getSlotPlaceholderImage(position: number): string {
    if (this.isBundleMode()) return PACKAGE_PLACEHOLDER;
    if (position === 0) return PACKAGE_PLACEHOLDER;
    if (position === 1) return TOOL_PLACEHOLDER;
    return DRINKWARE_PLACEHOLDER;
  }

  showPlaceholderAt(position: number, type: 'package' | 'tool' | 'drinkware'): boolean {
    if (this.isBundleMode()) return type === 'package';
    if (position === 0) return type === 'package';
    if (position === 1) return type === 'tool';
    return type === 'drinkware';
  }

  selectBundleCategory(filter: BundleCategoryFilter): void {
    this.bundleCategoryFilter.set(filter);
    this.persistBuilderState();
  }

  selectSlot(slotKey: SlotKey): void {
    if (!this.requiredSlotKeys().includes(slotKey)) return;
    if (this.activeSlotKey() === slotKey) return;
    this.activeSlotKey.set(slotKey);
    this.persistBuilderState();
  }

  onProductAdd(product: Product): void {
    if (this.isBundleMode()) {
      this.addBundleProductInstance(product);
      return;
    }

    const slotKey = this.activeSlotKey();
    if (!slotKey || !this.requiredSlotKeys().includes(slotKey)) return;

    const variant = this.getDefaultInStockVariant(product);
    if (!variant) return;

    this.setSlotSelections((selections) => ({
      ...selections,
      [slotKey]: {
        product,
        variantSku: variant.sku
      }
    }));
  }

  onKitProductDecrement(product: Product): void {
    if (this.isBundleMode()) return;

    const slotKey = this.activeSlotKey();
    if (!slotKey) return;

    const selection = this.slotSelections()[slotKey];
    if (!selection || selection.product.product_id !== product.product_id) return;

    this.setSlotSelections((selections) => {
      const next = { ...selections };
      delete next[slotKey];
      return next;
    });
  }

  getKitSlotProductCount(product: Product): number {
    if (this.isBundleMode()) return 0;

    const slotKey = this.activeSlotKey();
    if (!slotKey) return 0;

    const selection = this.slotSelections()[slotKey];
    return selection?.product.product_id === product.product_id ? 1 : 0;
  }

  onBundleProductIncrement(product: Product): void {
    this.addBundleProductInstance(product);
  }

  onBundleProductDecrement(product: Product): void {
    if (!this.isBundleMode()) return;

    const removeKey = [...this.requiredSlotKeys()]
      .reverse()
      .find((key) => this.slotSelections()[key]?.product.product_id === product.product_id);

    if (!removeKey) return;

    this.setSlotSelections((selections) => {
      const next = { ...selections };
      delete next[removeKey];
      return next;
    });
  }

  getBundleProductCount(product: Product): number {
    if (!this.isBundleMode()) return 0;

    return this.requiredSlotKeys().filter(
      (key) => this.slotSelections()[key]?.product.product_id === product.product_id
    ).length;
  }

  canAddMoreBundleProducts(): boolean {
    if (!this.isBundleMode()) return false;
    return this.getBundleFilledCount() < this.selectedPackSize();
  }

  getBundleFilledCount(): number {
    return this.requiredSlotKeys().filter((key) => !!this.slotSelections()[key]).length;
  }

  private addBundleProductInstance(product: Product): void {
    if (!this.isBundleMode() || !this.canAddMoreBundleProducts()) return;

    const variant = this.getDefaultInStockVariant(product);
    if (!variant) return;

    const emptySlot = this.requiredSlotKeys().find((key) => !this.slotSelections()[key]);
    if (!emptySlot) return;

    this.setSlotSelections((selections) => ({
      ...selections,
      [emptySlot]: {
        product,
        variantSku: variant.sku
      }
    }));
  }

  removeSlotProduct(slotKey: SlotKey, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (typeof (event as MouseEvent).stopImmediatePropagation === 'function') {
      (event as MouseEvent).stopImmediatePropagation();
    }

    this.setSlotSelections((selections) => {
      const next = { ...selections };
      delete next[slotKey];
      return next;
    });
    this.activeSlotKey.set(slotKey);
    this.persistBuilderState();
  }

  selectSlotVariant(slotKey: SlotKey, variantSku: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const selection = this.getSlotSelection(slotKey);
    if (!selection || selection.variantSku === variantSku) return;

    const variant = selection.product.variants.find((entry) => entry.sku === variantSku);
    if (!variant || (variant.stock ?? 0) <= 0) return;

    this.setSlotSelections((selections) => ({
      ...selections,
      [slotKey]: {
        product: selection.product,
        variantSku
      }
    }));
  }

  getKitSlotProducts(slotKey: SlotKey): Product[] {
    return this.productsBySlot()[slotKey as KitSlotId] ?? [];
  }

  getSlotSelection(slotKey: SlotKey): SlotSelection | null {
    return this.slotSelections()[slotKey] ?? null;
  }

  isSlotFilled(slotKey: SlotKey): boolean {
    return !!this.getSlotSelection(slotKey);
  }

  getInStockVariants(product: Product): Variant[] {
    return product.variants.filter((variant) => (variant.stock ?? 0) > 0);
  }

  showSlotVariantPicker(slotKey: SlotKey): boolean {
    const selection = this.getSlotSelection(slotKey);
    if (!selection) return false;
    return this.getInStockVariants(selection.product).length > 1;
  }

  getSlotSelectionImage(slotKey: SlotKey): string {
    const selection = this.getSlotSelection(slotKey);
    if (!selection) return '';

    const variant = selection.product.variants.find((entry) => entry.sku === selection.variantSku);
    const variantImage = variant?.images?.find((image) => image.sort_order === 0) ?? variant?.images?.[0];
    if (variantImage?.url) return variantImage.url;

    return this.getProductPrimaryImage(selection.product);
  }

  getSelectionPrice(selection: SlotSelection): number {
    const variant = selection.product.variants.find((entry) => entry.sku === selection.variantSku);
    return variant?.price ?? getDefaultPrice(selection.product);
  }

  formatPrice(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  showPackPricing(size: PackSize): boolean {
    return this.selectedPackSize() === size && this.showBundlePricing() && !!this.bundlePricing();
  }

  addBundleToCart(): void {
    if (!this.canAddBundleToCart()) return;

    const kitType = this.selectedKitType();
    const packSize = this.selectedPackSize();
    const selections = this.slotSelections();
    const slots = this.visibleSlots();

    const components = slots.map((slot) => {
      const selection = selections[slot.key]!;
      return {
        product: selection.product as unknown as CartProduct,
        variantSku: selection.variantSku,
        slotLabel: slot.label
      };
    });

    const bundle = createKitBundle({
      kitType,
      packSize,
      components,
      pricing: {
        original: this.bundlePricing()!.original,
        sale: this.bundlePricing()!.sale
      }
    });

    this.cartService.addKitBundleToCart(bundle);
    this.resetBuilderAfterAdd();
  }

  private resetBuilderAfterAdd(): void {
    this.slotSelections.set({});
    this.activeSlotKey.set(this.isBundleMode() ? 'package-0' : 'package');
    this.persistBuilderState();
    this.cdr.markForCheck();
  }

  private getBundleBrowserProducts(): Product[] {
    const filter = this.bundleCategoryFilter();
    const categories =
      filter === 'all' ? ['matcha', 'coffee'] : filter === 'matcha' ? ['matcha'] : ['coffee'];

    return this.products().filter(
      (product) => categories.includes(product.category) && !isProductOutOfStock(product)
    );
  }

  private mapActiveSlotOnKitChange(
    from: KitType,
    _to: KitType,
    active: SlotKey | null
  ): SlotKey {
    const position = this.getSlotPositionFromKey(active, from);
    const safePosition = position > 1 && this.selectedPackSize() === 2 ? 0 : position;
    return this.getSlotKeyForPosition(safePosition);
  }

  private mapActiveSlotOnPackChange(active: SlotKey | null, packSize: PackSize): SlotKey {
    const position = this.getSlotPositionFromKey(active, this.selectedKitType());
    const safePosition = position > 1 && packSize === 2 ? 0 : position;
    return this.getSlotKeyForPosition(safePosition);
  }

  private getSlotPositionFromKey(key: SlotKey | null, kitType: KitType): number {
    if (!key) return 0;

    if (kitType === 'bundle') {
      const match = key.match(/^package-(\d+)$/);
      return match ? Number(match[1]) : 0;
    }

    if (key === 'package') return 0;
    if (key === 'tool') return 1;
    if (key === 'drinkware') return 2;
    return 0;
  }

  private getDefaultActiveSlot(): SlotKey {
    return this.visibleSlots()[0]?.key ?? 'package';
  }

  private getDefaultInStockVariant(product: Product): Variant | null {
    const inStock = this.getInStockVariants(product);
    if (!inStock.length) return null;

    return inStock.find((variant) => variant.is_default) ?? inStock[0];
  }

  private matchesSlotProductFilter(product: Product, filter: SlotProductFilter): boolean {
    if (isProductOutOfStock(product)) return false;
    if (product.category !== filter.category) return false;
    if (filter.productTag) {
      return (product.product_tag ?? []).includes(filter.productTag);
    }
    return true;
  }

  private getProductPrimaryImage(product: Product): string {
    if (!product.images?.length) return '';

    const primary = product.images.find((image) => image.sort_order === 0);
    if (primary?.url) return primary.url;

    const sorted = [...product.images].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
    return sorted[0]?.url ?? '';
  }

  private loadProducts(): void {
    this.loadingProducts.set(true);

    this.productService.getProducts().subscribe({
      next: (products) => {
        const inStock = products.filter((product) => !isProductOutOfStock(product));
        const outOfStock = products.filter((product) => isProductOutOfStock(product));
        this.products.set([...inStock, ...outOfStock]);
        this.rehydrateSlotSelections();
        this.loadingProducts.set(false);
      },
      error: () => {
        this.products.set([]);
        this.pendingSlotRestore = null;
        this.loadingProducts.set(false);
      }
    });
  }

  private setSlotSelections(
    updater: (selections: Partial<Record<SlotKey, SlotSelection>>) => Partial<Record<SlotKey, SlotSelection>>
  ): void {
    this.slotSelections.update(updater);
    this.persistBuilderState();
    this.cdr.markForCheck();
  }

  private restoreBuilderState(): void {
    const snapshot = this.bundleState.getSnapshot();
    if (!snapshot) return;

    this.selectedKitType.set(snapshot.kitType);
    this.selectedPackSize.set(snapshot.packSize);
    this.activeSlotKey.set(snapshot.activeSlotKey);
    this.bundleCategoryFilter.set(snapshot.categoryFilter);
    this.pendingSlotRestore = snapshot.slots;
  }

  private rehydrateSlotSelections(): void {
    if (!this.pendingSlotRestore) return;

    const products = this.products();
    const next: Partial<Record<SlotKey, SlotSelection>> = {};

    for (const [key, persisted] of Object.entries(this.pendingSlotRestore)) {
      if (!persisted) continue;

      const product = products.find((entry) => entry.product_id === persisted.productId);
      if (!product || isProductOutOfStock(product)) continue;

      const variant = product.variants.find((entry) => entry.sku === persisted.variantSku);
      if (!variant || (variant.stock ?? 0) <= 0) continue;

      next[key as SlotKey] = {
        product,
        variantSku: persisted.variantSku
      };
    }

    this.slotSelections.set(next);
    this.pendingSlotRestore = null;
    this.cdr.markForCheck();
  }

  private buildSnapshot(): BundleBuilderSnapshot {
    const selections = this.slotSelections();
    const slots: BundleBuilderSnapshot['slots'] = {};

    for (const [key, selection] of Object.entries(selections)) {
      if (!selection) continue;
      slots[key as SlotKey] = {
        productId: selection.product.product_id,
        variantSku: selection.variantSku
      };
    }

    return {
      kitType: this.selectedKitType(),
      packSize: this.selectedPackSize(),
      activeSlotKey: this.activeSlotKey(),
      categoryFilter: this.bundleCategoryFilter(),
      slots
    };
  }

  private persistBuilderState(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.bundleState.saveSnapshot(this.buildSnapshot());
  }

  /** Scroll the product browser panel back to the top after switching kit types. */
  private scrollProductBrowserToTop(): void {
    const el = this.productBrowserRef?.nativeElement;
    if (!el) return;

    // On desktop the panel itself is the scrollable container (overflow-y: auto, max-height).
    // On mobile/tablet the page scrolls, so we use scrollIntoView as a fallback.
    if (el.scrollHeight > el.clientHeight) {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private pruneSelectionsForPackSize(packSize: PackSize): void {
    const allowedKeys = new Set(
      this.slotPositions
        .filter((position) => position < 2 || packSize === 3)
        .map((position) => this.getSlotKeyForPosition(position))
    );

    this.setSlotSelections((selections) => {
      const next: Partial<Record<SlotKey, SlotSelection>> = {};
      for (const key of Object.keys(selections) as SlotKey[]) {
        const selection = selections[key];
        if (allowedKeys.has(key) && selection) {
          next[key] = selection;
        }
      }
      return next;
    });
  }

  private async loadSavedProducts(): Promise<void> {
    if (!this.authService.isAuthenticated()) return;

    try {
      const result = await this.authService.getSavedItems();
      this.savedProductIds = new Set(
        (result.saved_products || [])
          .map((item: { product?: { product_id?: number }; product_id?: number }) =>
            Number(item.product?.product_id ?? item.product_id)
          )
          .filter((id: number) => !Number.isNaN(id))
      );
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load saved products:', err);
    }
  }

  private resetSelections(): void {
    this.slotSelections.set({});
    this.persistBuilderState();
  }
}
